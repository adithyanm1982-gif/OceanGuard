import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateEcologicalOverlap,
  evaluateShipAudit,
  calculateIncentiveEligibility,
  nearestRegionId,
  resolveEventRegion,
  selectRegionalContext,
  nextCapaId,
  estimateCapaTargetReductionDb,
  buildCorrectiveAction,
  validateStageAdvance,
  advanceCapaStage,
} from "../ecologicalAndAudit.js";
import { estimateAcousticFootprintKm } from "../geometry.js";
import {
  ACOUSTIC_PRESETS,
  AIS_CANDIDATE_VESSELS,
  INITIAL_AUDIT_AREAS,
  MARINE_SENSITIVE_ZONES,
  OBIS_SPECIES_RECORDS,
  REGION_IDS,
} from "../../data/mockDatasets.js";

const auditor = { name: "Dr. Elena Rostova", accreditationId: "ACC-1" };
const area = (id) => INITIAL_AUDIT_AREAS.find((a) => a.id === id);
const pacific = AIS_CANDIDATE_VESSELS[0];

// ---------------------------------------------------------------- region tagging
test("every preset, zone and species record carries a known region tag", () => {
  [...ACOUSTIC_PRESETS, ...MARINE_SENSITIVE_ZONES, ...OBIS_SPECIES_RECORDS].forEach((r) =>
    assert.ok(REGION_IDS.includes(r.region), `${r.id} has region ${r.region}`),
  );
  REGION_IDS.forEach((id) => {
    assert.ok(MARINE_SENSITIVE_ZONES.filter((z) => z.region === id).length >= 3, `${id} zones`);
    assert.ok(OBIS_SPECIES_RECORDS.filter((s) => s.region === id).length >= 3, `${id} species`);
  });
});

test("each preset sees only its own region: no Clayoquot data for NOAA or Chennai", () => {
  ACOUSTIC_PRESETS.forEach((preset) => {
    const ctx = selectRegionalContext(preset, MARINE_SENSITIVE_ZONES, OBIS_SPECIES_RECORDS);
    assert.equal(ctx.regionId, preset.region);
    assert.ok(ctx.zones.length > 0 && ctx.species.length > 0);
    ctx.zones.concat(ctx.species).forEach((r) => assert.equal(r.region, preset.region));
  });
});

test("the three presets give different, region-specific overlap results", () => {
  const summaries = ACOUSTIC_PRESETS.map((p) => {
    const ctx = selectRegionalContext(p, MARINE_SENSITIVE_ZONES, OBIS_SPECIES_RECORDS);
    const r = evaluateEcologicalOverlap(p, ctx.zones, ctx.species, estimateAcousticFootprintKm(p));
    return {
      region: p.region,
      zones: r.activeZonesCount,
      names: r.speciesEvaluations.map((s) => s.commonName).join("|"),
    };
  });
  assert.equal(new Set(summaries.map((s) => s.names)).size, 3);
  assert.deepEqual(
    summaries.map((s) => s.zones),
    [3, 2, 1],
  ); // Clayoquot, Stellwagen, Chennai footprints
  assert.ok(summaries[2].names.includes("Olive Ridley"));
  assert.ok(summaries[1].names.includes("Right Whale"));
});

test("custom coordinates resolve to the nearest region, or to none when far away", () => {
  assert.equal(nearestRegionId({ lat: 13.2, lon: 80.4 }), "chennai");
  assert.equal(nearestRegionId({ lat: 42.1, lon: -70.5 }), "noaa");
  assert.equal(nearestRegionId({ lat: 48.0, lon: -127.0 }), "clayoquot");
  assert.equal(nearestRegionId({ lat: -33.9, lon: 151.2 }), null); // Sydney
  assert.equal(nearestRegionId(null), null);
  assert.equal(resolveEventRegion({ region: "noaa", coords: { lat: 13, lon: 80 } }), "noaa"); // explicit tag wins
  const none = selectRegionalContext(
    { coords: { lat: -33.9, lon: 151.2 } },
    MARINE_SENSITIVE_ZONES,
    OBIS_SPECIES_RECORDS,
  );
  assert.deepEqual([none.regionId, none.zones.length, none.species.length], [null, 0, 0]);
});

// ---------------------------------------------------------------- CAPA ids and targets
test("CAPA ids are zero-padded and sequential past 9 and past 99", () => {
  assert.equal(nextCapaId([{ id: "CAPA-2026-041" }], 2026), "CAPA-2026-042");
  assert.equal(nextCapaId([{ id: "CAPA-2026-049" }], 2026), "CAPA-2026-050"); // old `0${42+n}` broke here
  assert.equal(nextCapaId([{ id: "CAPA-2026-099" }], 2026), "CAPA-2026-100");
  assert.equal(
    nextCapaId([{ id: "CAPA-2026-998" }, { id: "CAPA-2026-041" }], 2026),
    "CAPA-2026-999",
  );
  assert.equal(nextCapaId([{ id: "CAPA-2026-999" }], 2026), "CAPA-2026-1000");
  assert.equal(nextCapaId([], 2026), "CAPA-2026-001");
  assert.equal(nextCapaId([{ id: "CAPA-2026-041" }], 2027), "CAPA-2027-001");
});

test("target reduction is computed from the vessel / event excess, not hard-coded", () => {
  const clay = estimateCapaTargetReductionDb(area("propeller"), pacific, ACOUSTIC_PRESETS[0]); // +34.2 dB
  const chennai = estimateCapaTargetReductionDb(area("propeller"), pacific, ACOUSTIC_PRESETS[2]); // +17.6 dB
  assert.equal(clay.targetDb, 4.5);
  assert.equal(chennai.targetDb, 3.1);
  assert.ok(clay.targetDb > chennai.targetDb);
  const ops = estimateCapaTargetReductionDb(area("operational"), pacific, ACOUSTIC_PRESETS[0]); // 16.4 vs 14.2 kn
  assert.equal(ops.targetDb, 3.8);
  assert.equal(estimateCapaTargetReductionDb(area("hull"), pacific, null).targetDb, 1.0);
  [clay, chennai, ops].forEach((t) => assert.notEqual(t.targetDb, 2.6));
});

test("new CAPAs start at Stage 1 with nothing verified and a unique padded id", () => {
  const seed = [{ id: "CAPA-2026-041" }];
  const capa = buildCorrectiveAction({
    area: area("propeller"),
    vessel: pacific,
    event: ACOUSTIC_PRESETS[0],
    existing: seed,
    auditor,
    now: new Date("2026-11-24T10:00:00Z"),
  });
  assert.equal(capa.id, "CAPA-2026-042");
  assert.equal(capa.currentStage, 1);
  assert.equal(capa.verifiedReductionDb, 0);
  assert.equal(capa.targetReductionDb, 4.5);
  assert.deepEqual(capa.history, []);
  assert.equal(
    buildCorrectiveAction({ area: area("hull"), vessel: null, existing: [], auditor }),
    null,
  );
});

// ---------------------------------------------------------------- evidence gate
const stageN = (n) => ({
  ...buildCorrectiveAction({
    area: area("propeller"),
    vessel: pacific,
    event: ACOUSTIC_PRESETS[0],
    existing: [],
    auditor,
  }),
  currentStage: n,
});

test("a stage cannot advance without evidence or a note", () => {
  const c = stageN(1);
  assert.equal(validateStageAdvance(c, {}, auditor).ok, false);
  assert.equal(validateStageAdvance(c, { evidence: [], note: "ok" }, auditor).ok, false); // note too short
  assert.equal(advanceCapaStage(c, { evidence: [], note: "" }, auditor).capa.currentStage, 1);
  assert.equal(validateStageAdvance(c, { evidence: ["not_a_real_item"] }, auditor).ok, false);
  assert.equal(validateStageAdvance(c, { evidence: ["hull_prop_inspection"] }, null).ok, false); // needs an auditor
});

test("advancing logs auditor, accreditation, timestamp and evidence", () => {
  const at = new Date("2026-11-24T09:30:00Z");
  const r = advanceCapaStage(
    stageN(1),
    { evidence: ["hull_prop_inspection"], note: " Prop inspected by ROV " },
    auditor,
    at,
  );
  assert.equal(r.ok, true);
  assert.equal(r.capa.currentStage, 2);
  assert.deepEqual(r.capa.history[0], {
    fromStage: 1,
    toStage: 2,
    at: "2026-11-24T09:30:00.000Z",
    auditorName: auditor.name,
    accreditationId: "ACC-1",
    evidence: ["hull_prop_inspection"],
    note: "Prop inspected by ROV",
    // Phase 4 hash-chain fields (full chain behaviour is covered in phase4-realdata.test.js).
    eventId: `${r.capa.id}-EVT-02`,
    timestamp: "2026-11-24T09:30:00.000Z",
    previousHash: "0".repeat(64),
    recordHash: r.capa.history[0].recordHash,
  });
  assert.match(r.capa.history[0].recordHash, /^[0-9a-f]{64}$/);
  const noteOnly = advanceCapaStage(
    stageN(3),
    { evidence: [], note: "Operator confirmed by email." },
    auditor,
  );
  assert.equal(noteOnly.ok, true);
});

test("closing at stage 8 needs an acoustic re-scan and a measured reduction, which becomes the verified value", () => {
  const c = stageN(7);
  assert.equal(
    validateStageAdvance(c, { evidence: ["third_party_review"], measuredReductionDb: 3 }, auditor)
      .ok,
    false,
  ); // no re-scan
  assert.equal(validateStageAdvance(c, { evidence: ["acoustic_rescan"] }, auditor).ok, false); // no measurement
  assert.equal(
    validateStageAdvance(c, { evidence: ["acoustic_rescan"], measuredReductionDb: 0 }, auditor).ok,
    false,
  );
  const r = advanceCapaStage(
    c,
    { evidence: ["acoustic_rescan"], measuredReductionDb: 3.46 },
    auditor,
  );
  assert.equal(r.ok, true);
  assert.equal(r.capa.currentStage, 8);
  assert.equal(r.capa.verifiedReductionDb, 3.5);
  assert.equal(
    advanceCapaStage(r.capa, { evidence: ["acoustic_rescan"], measuredReductionDb: 3 }, auditor).ok,
    false,
  ); // already closed
});

test("legacy records without history still advance", () => {
  const legacy = { id: "CAPA-2026-041", currentStage: 6, verifiedReductionDb: 0 };
  const r = advanceCapaStage(legacy, { evidence: ["maintenance_receipts"] }, auditor);
  assert.equal(r.capa.history.length, 1);
});

// ---------------------------------------------------------------- incentives
test("incentives need independent review plus a measured reduction", () => {
  const unmeasured = [{ currentStage: 7, verifiedReductionDb: 0 }];
  assert.equal(calculateIncentiveEligibility(unmeasured, 70).verifiedCount, 0);
  assert.equal(
    calculateIncentiveEligibility([{ currentStage: 6, verifiedReductionDb: 4 }], 70).verifiedCount,
    0,
  );
  const done = calculateIncentiveEligibility([{ currentStage: 8, verifiedReductionDb: 3.5 }], 70);
  assert.equal(done.verifiedCount, 1);
  assert.match(done.tierName, /Tier 2/);
});

test("audit recommendations still quote the achievable range", () => {
  const s = evaluateShipAudit(INITIAL_AUDIT_AREAS, pacific);
  assert.equal(
    s.tailoredRecommendations.find((r) => r.areaId === "propeller").estimatedUrnReductionDb,
    "2.5 – 4.5 dB",
  );
});
