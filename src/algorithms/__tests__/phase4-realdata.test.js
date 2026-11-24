import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  GENESIS_HASH,
  advanceCapaStage,
  calculatePortRebate,
  canonicalAuditPayload,
  defaultGrossTonnage,
  matchRebateTier,
  rankPortsByDistance,
  recommendNearestPort,
  sealAuditRecord,
  sha256Hex,
  sha256HexAsync,
  truncateHash,
  verifyAuditChain,
  verifyAuditChainAsync,
} from "../ecologicalAndAudit.js";
import { haversineKm } from "../geometry.js";
import { INGESTED_PORTS } from "../../data/ingestedDatasets.js";
import { getPortTariffOptions, verifyCapaChain } from "../../services/oceanGuardApi.js";

const auditor = { name: "Dr. Elena Rostova", accreditationId: "ACC-1042" };
const baseCapa = () => ({ id: "CAPA-2026-041", currentStage: 1, verifiedReductionDb: 0, history: [] });

function advanceTo(capa, stages) {
  let c = capa;
  for (let i = 0; i < stages; i++) {
    const closing = c.currentStage + 1 === 8;
    const r = advanceCapaStage(
      c,
      { evidence: closing ? ["acoustic_rescan"] : [], note: `Checked stage ${c.currentStage} evidence`, measuredReductionDb: closing ? 4.2 : null },
      auditor,
      new Date(Date.UTC(2026, 10, 24, 10, i)),
    );
    assert.ok(r.ok, r.errors.join(" "));
    c = r.capa;
  }
  return c;
}

test("sha256Hex matches Node crypto for known and edge-length inputs", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
    const text = "é✓x".repeat(n);
    assert.equal(sha256Hex(text), createHash("sha256").update(text).digest("hex"), `length ${n}`);
  }
});

test("Web Crypto path agrees with the synchronous hash", async () => {
  assert.equal(await sha256HexAsync("oceanguard"), sha256Hex("oceanguard"));
});

test("genesis hash is 64 zeros and truncateHash shortens for display", () => {
  assert.equal(GENESIS_HASH, "0".repeat(64));
  assert.equal(GENESIS_HASH.length, 64);
  const h = sha256Hex("x");
  assert.equal(truncateHash(h), `${h.slice(0, 8)}…${h.slice(-6)}`);
  assert.equal(truncateHash(""), "");
});

test("advancing a CAPA seals each transition and links it to the previous hash", () => {
  const capa = advanceTo(baseCapa(), 3);
  assert.equal(capa.history.length, 3);
  const [a, b, c] = capa.history;
  assert.equal(a.previousHash, GENESIS_HASH);
  assert.equal(b.previousHash, a.recordHash);
  assert.equal(c.previousHash, b.recordHash);
  assert.match(a.recordHash, /^[0-9a-f]{64}$/);
  assert.equal(a.eventId, "CAPA-2026-041-EVT-02");
  assert.equal(a.timestamp, a.at);
  assert.equal(a.auditorName, auditor.name);
  assert.equal(a.accreditationId, auditor.accreditationId);
  assert.equal(a.recordHash, sha256Hex(canonicalAuditPayload(capa.id, a)));
});

test("an untouched chain verifies, including the full 7-transition lifecycle", async () => {
  const capa = advanceTo(baseCapa(), 7);
  assert.equal(capa.currentStage, 8);
  const v = verifyAuditChain(capa.id, capa.history);
  assert.equal(v.valid, true);
  assert.equal(v.checked, 7);
  assert.equal(v.brokenAt, null);
  assert.equal(v.headHash, capa.history[6].recordHash);
  assert.equal(await verifyAuditChainAsync(capa.id, capa.history), true);
  assert.equal((await verifyCapaChain(capa)).webCryptoVerified, true);
});

test("an empty history is a valid chain at genesis", () => {
  const v = verifyAuditChain("CAPA-2026-041", []);
  assert.equal(v.valid, true);
  assert.equal(v.checked, 0);
  assert.equal(v.headHash, GENESIS_HASH);
});

test("tampering with a covered field is detected at that entry", async () => {
  const capa = advanceTo(baseCapa(), 4);
  const edits = [
    (h) => (h[1].note = "Altered after signing"),
    (h) => (h[1].auditorName = "Someone Else"),
    (h) => (h[1].evidence = ["acoustic_rescan"]),
    (h) => (h[1].timestamp = "2020-01-01T00:00:00.000Z"),
  ];
  for (const edit of edits) {
    const history = structuredClone(capa.history);
    edit(history);
    const v = verifyAuditChain(capa.id, history);
    assert.equal(v.valid, false);
    assert.equal(v.brokenAt, 1);
    assert.match(v.reason, /do not match its recorded hash/);
    assert.equal(await verifyAuditChainAsync(capa.id, history), false);
  }
});

test("removing, reordering or forging a link breaks the chain", () => {
  const capa = advanceTo(baseCapa(), 4);
  const removed = capa.history.filter((_, i) => i !== 1);
  assert.equal(verifyAuditChain(capa.id, removed).brokenAt, 1);

  const swapped = [capa.history[1], capa.history[0], ...capa.history.slice(2)];
  assert.equal(verifyAuditChain(capa.id, swapped).valid, false);

  // Re-hashing a modified entry fixes its own hash but not the next entry's link.
  const forged = structuredClone(capa.history);
  forged[1].note = "Forged note";
  forged[1].recordHash = sha256Hex(canonicalAuditPayload(capa.id, forged[1]));
  const v = verifyAuditChain(capa.id, forged);
  assert.equal(v.valid, false);
  assert.equal(v.brokenAt, 2);
  assert.match(v.reason, /does not link/);

  // A record moved to another CAPA does not verify there.
  assert.equal(verifyAuditChain("CAPA-2026-999", capa.history).valid, false);
});

test("entries recorded before the hash chain are reported as legacy, not as tampering", () => {
  const legacy = { fromStage: 6, toStage: 7, at: "2026-11-01T00:00:00.000Z", auditorName: "A", evidence: [], note: "old record" };
  const capa = advanceTo({ ...baseCapa(), currentStage: 7, history: [legacy] }, 1);
  const v = verifyAuditChain(capa.id, capa.history);
  assert.equal(v.valid, true);
  assert.equal(v.legacyCount, 1);
  assert.equal(v.checked, 1);
  assert.equal(capa.history[1].previousHash, GENESIS_HASH);
  assert.equal(sealAuditRecord(capa.id, { ...legacy, toStage: 7 }).previousHash, GENESIS_HASH);
});

// ---- Port & URN tariffs -----------------------------------------------------------------------

test("all 12 ingested ports are eligible and read without worldPortIndex", () => {
  assert.equal(INGESTED_PORTS.length, 12);
  const ranked = rankPortsByDistance(INGESTED_PORTS, { lat: 0, lon: 0 });
  assert.equal(ranked.length, 12);
  assert.ok(ranked.every((r) => r.eligible && Number.isFinite(r.distanceKm)));
  assert.ok(INGESTED_PORTS.every((p) => p.worldPortIndex === null));
});

test("ports are ranked by Haversine distance and the nearest is recommended", () => {
  const chennaiStation = { lat: 13.0827, lon: 80.3015 };
  const ranked = rankPortsByDistance(INGESTED_PORTS, chennaiStation);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].distanceKm <= ranked[i].distanceKm);
  const rec = recommendNearestPort(INGESTED_PORTS, chennaiStation);
  assert.equal(rec.port.portCode, "INMAA");
  assert.ok(rec.distanceKm < 5);
  const expected = Math.round(haversineKm(chennaiStation, INGESTED_PORTS.find((p) => p.portCode === "INMAA")) * 100) / 100;
  assert.equal(rec.distanceKm, expected);

  assert.equal(recommendNearestPort(INGESTED_PORTS, { lat: 42.38, lon: -70.31 }).port.portCode, "USBOS");
  assert.equal(recommendNearestPort(INGESTED_PORTS, { lat: 49.3, lon: -123.1 }).port.country, "Canada");
});

test("nearest-port selection handles a missing origin and ineligible ports", () => {
  assert.equal(recommendNearestPort(INGESTED_PORTS, null), null);
  const ranked = rankPortsByDistance(INGESTED_PORTS, null);
  assert.deepEqual(ranked.map((r) => r.port.portCode), INGESTED_PORTS.map((p) => p.portCode));
  assert.ok(ranked.every((r) => r.distanceKm === null));

  const chennai = INGESTED_PORTS.find((p) => p.portCode === "INMAA");
  const ennore = INGESTED_PORTS.find((p) => p.portCode === "INENR");
  const noProgram = { ...chennai, ecoIncentiveProgramName: "" };
  const rec = recommendNearestPort([noProgram, ennore], { lat: 13.0827, lon: 80.2707 });
  assert.equal(rec.port.portCode, "INENR");
});

test("rebate tier matching picks the highest reached tier", () => {
  const port = INGESTED_PORTS[0];
  assert.equal(matchRebateTier(port, 2.9), null);
  assert.equal(matchRebateTier(port, 3.0).tier, "Tier 1");
  assert.equal(matchRebateTier(port, 5.9).tier, "Tier 1");
  assert.equal(matchRebateTier(port, 6.0).tier, "Tier 2");
  assert.equal(matchRebateTier(port, 12).tier, "Tier 3");
  assert.equal(matchRebateTier(port, Number.NaN), null);
  assert.equal(matchRebateTier({ rebateTiers: [] }, 9), null);
});

test("rebate = GT x dues/GT x tier %, limited by the tier cap", () => {
  const chennai = INGESTED_PORTS.find((p) => p.portCode === "INMAA"); // 0.62 USD/GT; T1 5% cap 25k; T2 10% cap 75k; T3 15% cap 150k
  const t1 = calculatePortRebate({ port: chennai, grossTonnage: 40000, verifiedDbReduction: 3.5 });
  assert.equal(t1.duesUsd, 24800);
  assert.equal(t1.tier.tier, "Tier 1");
  assert.equal(t1.rebateUsd, 1240);
  assert.equal(t1.netDuesUsd, 23560);
  assert.equal(t1.capApplied, false);
  assert.equal(t1.nextTier.tier, "Tier 2");
  assert.equal(t1.dbToNextTier, 2.5);

  const none = calculatePortRebate({ port: chennai, grossTonnage: 40000, verifiedDbReduction: 1 });
  assert.equal(none.tier, null);
  assert.equal(none.rebateUsd, 0);
  assert.equal(none.netDuesUsd, none.duesUsd);

  const capped = calculatePortRebate({ port: chennai, grossTonnage: 1_000_000, verifiedDbReduction: 4 });
  assert.equal(capped.capApplied, true);
  assert.equal(capped.rebateUsd, 25000);

  const top = calculatePortRebate({ port: chennai, grossTonnage: 40000, verifiedDbReduction: 11 });
  assert.equal(top.nextTier, null);
  assert.equal(top.dbToNextTier, null);
  assert.equal(calculatePortRebate({ port: chennai, grossTonnage: -5, verifiedDbReduction: 11 }).rebateUsd, 0);
});

test("every ingested port yields a coherent rebate for the same vessel", () => {
  for (const port of INGESTED_PORTS) {
    const r = calculatePortRebate({ port, grossTonnage: 40000, verifiedDbReduction: 6.5 });
    assert.equal(r.duesUsd, Math.round(40000 * port.basePortDuesUsdPerGt * 100) / 100, port.portCode);
    assert.ok(r.tier && r.rebateUsd > 0 && r.rebateUsd <= r.tier.maxCapUsd, port.portCode);
  }
});

test("default gross tonnage prefers the vessel record, then DWT, then the reference value", () => {
  assert.deepEqual(defaultGrossTonnage({ grossTonnage: 51234.4 }).value, 51234);
  const fromDwt = defaultGrossTonnage({ dwt: 81600 });
  assert.equal(fromDwt.value, 44880);
  assert.match(fromDwt.source, /DWT/);
  assert.equal(defaultGrossTonnage(null).value, 40000);
});

test("getPortTariffOptions recommends the nearest port and lists all 12", async () => {
  const opts = await getPortTariffOptions({ origin: { lat: 13.0827, lon: 80.3015 }, vessel: { dwt: 81600 } });
  assert.equal(opts.ports.length, 12);
  assert.equal(opts.recommended, "INMAA");
  assert.equal(opts.grossTonnage.value, 44880);
  const none = await getPortTariffOptions({});
  assert.equal(none.recommended, null);
  assert.equal(none.origin, null);
});
