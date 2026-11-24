import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GENESIS_HASH,
  FIRST_REVIEWER_STAGE,
  SIGNER_ROLE_FIELD_AUDITOR,
  SIGNER_ROLE_INDEPENDENT_REVIEWER,
  advanceCapaStage,
  computeAttestationSignature,
  computeAuthorityAggregateMetrics,
  requiredSignerRole,
  sealAuditRecord,
  sha256Hex,
  verifyAttestation,
  verifyAuditChain,
} from "../ecologicalAndAudit.js";
import {
  NON_CAUSATION_CAVEAT,
  OBIS_CAVEAT,
  ECOLOGY_CAVEAT,
  REBATE_CAVEAT,
  REPORT_SCHEMA_VERSION,
  UNCALIBRATED_CAVEAT,
  buildComplianceDossierReport,
  renderComplianceDossierHtml,
} from "../reportExport.js";
import { INITIAL_AUDIT_AREAS } from "../../data/mockDatasets.js";
import { INGESTED_PORTS } from "../../data/ingestedDatasets.js";

const NOW = new Date(Date.UTC(2026, 10, 24, 12, 0, 0));
const auditor = { name: "Dr. Elena Rostova", accreditationId: "ACC-1042", conflictDeclared: true };
const CAPA_ID = "CAPA-2026-041";
const baseCapa = (over = {}) => ({
  id: CAPA_ID,
  vesselName: "MV Pacific Dawn",
  component: "Propeller",
  currentStage: 1,
  verifiedReductionDb: 0,
  history: [],
  ...over,
});

/** Advances a CAPA through `stages` transitions with role separation on for Stages 7-8. */
function advanceTo(capa, stages) {
  let c = capa;
  for (let i = 0; i < stages; i++) {
    const toStage = c.currentStage + 1;
    const closing = toStage === 8;
    const r = advanceCapaStage(
      c,
      {
        evidence: closing ? ["acoustic_rescan"] : [],
        note: `Checked stage ${c.currentStage} evidence`,
        measuredReductionDb: closing ? 4.2 : null,
        signerRole: SIGNER_ROLE_FIELD_AUDITOR,
        enforceRoleSeparation: true,
        reviewerName: "Capt. R. Menon",
        reviewerId: "PA-7781",
      },
      auditor,
      new Date(Date.UTC(2026, 10, 24, 10, i)),
    );
    assert.ok(r.ok, r.errors.join(" "));
    c = r.capa;
  }
  return c;
}

const record = (over = {}) => ({
  fromStage: 1,
  toStage: 2,
  at: "2026-11-24T10:00:00.000Z",
  auditorName: auditor.name,
  accreditationId: auditor.accreditationId,
  evidence: [],
  note: "Verified hull inspection report",
  ...over,
});

// ------------------------------------------------------------------ sealAuditRecord: signerRole / attestation
test("requiredSignerRole splits Stages 1-6 (Field Auditor) from 7-8 (Independent Reviewer)", () => {
  assert.equal(FIRST_REVIEWER_STAGE, 7);
  for (const s of [2, 3, 4, 5, 6]) assert.equal(requiredSignerRole(s), SIGNER_ROLE_FIELD_AUDITOR);
  for (const s of [7, 8]) assert.equal(requiredSignerRole(s), SIGNER_ROLE_INDEPENDENT_REVIEWER);
});

test("sealAuditRecord with a signerRole adds a deterministic 64-hex attestationSignature", () => {
  const sealed = sealAuditRecord(CAPA_ID, record({ signerRole: SIGNER_ROLE_FIELD_AUDITOR }));
  assert.equal(sealed.signerRole, SIGNER_ROLE_FIELD_AUDITOR);
  assert.match(sealed.attestationSignature, /^[0-9a-f]{64}$/);
  assert.equal(sealed.eventId, "CAPA-2026-041-EVT-02");
  assert.equal(sealed.previousHash, GENESIS_HASH);
  assert.equal(
    sealed.attestationSignature,
    sha256Hex([sealed.eventId, sealed.recordHash, SIGNER_ROLE_FIELD_AUDITOR, auditor.accreditationId].join("|")),
  );
  assert.equal(
    sealed.attestationSignature,
    computeAttestationSignature({
      eventId: sealed.eventId,
      recordHash: sealed.recordHash,
      signerRole: sealed.signerRole,
      accreditationId: sealed.accreditationId,
    }),
  );
  // deterministic: sealing the same input again yields the identical signature
  assert.equal(
    sealAuditRecord(CAPA_ID, record({ signerRole: SIGNER_ROLE_FIELD_AUDITOR })).attestationSignature,
    sealed.attestationSignature,
  );
  assert.equal(verifyAttestation(sealed), true);
});

test("sealAuditRecord without a signerRole leaves no attestation and verifyAttestation returns null", () => {
  const sealed = sealAuditRecord(CAPA_ID, record());
  assert.equal("attestationSignature" in sealed, false);
  assert.equal(verifyAttestation(sealed), null);
  assert.equal(verifyAttestation(undefined), null);
  assert.match(sealed.recordHash, /^[0-9a-f]{64}$/);
});

test("the attestation binds role, accreditation id and record hash", () => {
  const field = sealAuditRecord(CAPA_ID, record({ signerRole: SIGNER_ROLE_FIELD_AUDITOR }));
  const reviewer = sealAuditRecord(CAPA_ID, record({ signerRole: SIGNER_ROLE_INDEPENDENT_REVIEWER }));
  // the role is outside the hashed payload, so the record hash is unchanged but the attestation differs
  assert.equal(field.recordHash, reviewer.recordHash);
  assert.notEqual(field.attestationSignature, reviewer.attestationSignature);

  for (const edit of [
    (e) => (e.signerRole = SIGNER_ROLE_INDEPENDENT_REVIEWER),
    (e) => (e.accreditationId = "ACC-9999"),
    (e) => (e.recordHash = sha256Hex("forged")),
    (e) => (e.eventId = "CAPA-2026-041-EVT-03"),
  ]) {
    const forged = structuredClone(field);
    edit(forged);
    assert.equal(verifyAttestation(forged), false);
  }
});

test("a missing accreditationId is signed as the empty string", () => {
  const sealed = sealAuditRecord(CAPA_ID, record({ accreditationId: null, signerRole: SIGNER_ROLE_FIELD_AUDITOR }));
  assert.equal(sealed.attestationSignature, sha256Hex([sealed.eventId, sealed.recordHash, SIGNER_ROLE_FIELD_AUDITOR, ""].join("|")));
  assert.equal(verifyAttestation(sealed), true);
});

test("advanceCapaStage signs Stages 1-6 as Field Auditor and 7-8 as Independent Reviewer", () => {
  const capa = advanceTo(baseCapa(), 7);
  assert.equal(capa.currentStage, 8);
  capa.history.forEach((h, i) => {
    const expected = h.toStage >= 7 ? SIGNER_ROLE_INDEPENDENT_REVIEWER : SIGNER_ROLE_FIELD_AUDITOR;
    assert.equal(h.signerRole, expected, `entry ${i + 1}`);
    assert.equal(verifyAttestation(h), true, `entry ${i + 1} attestation`);
  });
  const [, , , , , toSeven, toEight] = capa.history;
  assert.equal(toSeven.auditorName, "Capt. R. Menon");
  assert.equal(toSeven.accreditationId, "PA-7781");
  assert.equal(toSeven.fieldAuditorName, auditor.name);
  assert.equal(toEight.measuredReductionDb, 4.2);
  assert.equal(verifyAuditChain(CAPA_ID, capa.history).valid, true);
});

test("Stages 7-8 are refused when role separation is enforced without reviewer details", () => {
  const capa = advanceTo(baseCapa(), 5); // now at stage 6
  const r = advanceCapaStage(
    capa,
    { evidence: [], note: "Reviewer sign-off attempted", enforceRoleSeparation: true },
    auditor,
    NOW,
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Independent Reviewer/.test(e)));
  assert.equal(r.capa.currentStage, 6);
});

// ------------------------------------------------------------------ computeAuthorityAggregateMetrics
test("aggregate metrics: empty and malformed inputs are safe", () => {
  assert.deepEqual(computeAuthorityAggregateMetrics(), {
    auditedVesselsCount: 0,
    verifiedCapasCount: 0,
    meanVerifiedDbReduction: null,
    activePortSchemesCount: 0,
  });
  assert.deepEqual(computeAuthorityAggregateMetrics(null, null, null), {
    auditedVesselsCount: 0,
    verifiedCapasCount: 0,
    meanVerifiedDbReduction: null,
    activePortSchemesCount: 0,
  });
});

test("aggregate metrics: counts distinct vessels, verified CAPAs, mean reduction and port schemes", () => {
  const capas = [
    { id: "A", vesselImo: "IMO1", currentStage: 8, verifiedReductionDb: 4.2 },
    { id: "B", vesselImo: "IMO1", currentStage: 7, verifiedReductionDb: 3.1 },
    { id: "C", vesselImo: "IMO2", currentStage: 8, verifiedReductionDb: 5.0 },
    { id: "D", vesselImo: "IMO3", currentStage: 6, verifiedReductionDb: 9.9 }, // below stage 7: not verified
    { id: "E", vesselImo: "IMO4", currentStage: 8, verifiedReductionDb: 0 }, // no measured reduction
    { id: "F", currentStage: 3 }, // no IMO: not counted as a vessel
  ];
  const ports = [
    { ecoIncentiveProgramName: "Scheme", rebateTiers: [{ tier: "T1" }] },
    { ecoIncentiveProgramName: "No tiers", rebateTiers: [] },
    { rebateTiers: [{ tier: "T1" }] },
    null,
  ];
  const m = computeAuthorityAggregateMetrics(capas, [], ports);
  assert.equal(m.auditedVesselsCount, 4);
  assert.equal(m.verifiedCapasCount, 3);
  assert.equal(m.meanVerifiedDbReduction, 4.1); // (4.2 + 3.1 + 5.0) / 3 = 4.1
  assert.equal(m.activePortSchemesCount, 1);
});

test("aggregate metrics: a current audit with no CAPA counts as one vessel; all 12 bundled ports run a scheme", () => {
  assert.equal(computeAuthorityAggregateMetrics([], INITIAL_AUDIT_AREAS, []).auditedVesselsCount, 1);
  assert.equal(computeAuthorityAggregateMetrics([], [], []).auditedVesselsCount, 0);
  assert.equal(computeAuthorityAggregateMetrics([], [], INGESTED_PORTS).activePortSchemesCount, INGESTED_PORTS.length);
  assert.equal(INGESTED_PORTS.length, 12);
});

// ------------------------------------------------------------------ dossier report + HTML
const port = INGESTED_PORTS[0];
const event = {
  id: "EVT-1",
  title: "Transit <b>event</b>",
  stationId: "ST-1",
  region: "pacific",
  coords: { lat: 36.6, lon: -121.9 },
  timestamp: "2026-11-24T08:00:00Z",
  classification: "Cargo vessel",
  confidence: 0.82,
  rmsLevel: -31.2,
  peakLevel: -12.4,
  ambientBaseline: -45,
  deltaAboveAmbient: 13.8,
  calibrated: false,
};
const candidate = {
  name: "MV Pacific Dawn",
  mmsi: "366999001",
  vesselType: "Cargo",
  cpaDistanceKm: 3.44,
  observedSpeedKnots: 17.26,
  designSpeedKnots: 14.2,
  confidencePct: 78,
  attributionTier: "Probable",
  speedAnomaly: { flagged: true },
};

function fullState(over = {}) {
  const capa = advanceTo(baseCapa(), 7);
  return {
    event,
    candidateVessels: [candidate],
    vessel: { name: "MV Pacific Dawn", mmsi: "366999001" },
    auditAreas: INITIAL_AUDIT_AREAS,
    auditor,
    correctiveActions: [capa],
    port,
    grossTonnage: 40000,
    now: NOW,
    ...over,
  };
}

test("buildComplianceDossierReport returns a timestamped, versioned structure with every section", () => {
  const r = buildComplianceDossierReport(fullState());
  assert.equal(r.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(r.schemaVersion, "oceanguard.compliance-dossier/1.0");
  assert.equal(r.generatedAt, NOW.toISOString());
  assert.equal(r.title, "OceanGuard Compliance Dossier");
  for (const key of ["acousticEvent", "aisCorrelation", "ecology", "audit", "capaVerificationLog", "portRebate"]) {
    assert.ok(key in r, `section ${key}`);
  }
  assert.match(r.disclaimer, /Decision-support output/);
  assert.match(r.disclaimer, /qualified, accredited auditor/);
  assert.equal(r.acousticEvent.levelStatus, "relative-dBFS");
  assert.deepEqual(r.acousticEvent.caveats, [UNCALIBRATED_CAVEAT]);
  assert.equal(r.aisCorrelation.candidateCount, 1);
  assert.equal(r.aisCorrelation.candidates[0].cpaDistanceKm, 3.4);
  assert.equal(r.aisCorrelation.candidates[0].speedAnomalyFlagged, true);
  assert.deepEqual(r.aisCorrelation.caveats, [NON_CAUSATION_CAVEAT]);
  assert.deepEqual(r.ecology.caveats, [ECOLOGY_CAVEAT, OBIS_CAVEAT]);
  assert.deepEqual(r.portRebate.caveats, [REBATE_CAVEAT]);
  assert.equal(r.audit.findings.length, INITIAL_AUDIT_AREAS.length);
  assert.equal(r.audit.nonCompliantCount, 2);
  assert.equal(r.audit.coiAttestation.declared, true);
});

test("dossier CAPA log carries the intact chain, role and per-entry check", () => {
  const r = buildComplianceDossierReport(fullState());
  const log = r.capaVerificationLog;
  assert.equal(log.algorithm, "SHA-256 hash chain");
  assert.equal(log.allChainsIntact, true);
  const c = log.capas[0];
  assert.equal(c.chainStatus, "intact");
  assert.equal(c.chainChecked, 7);
  assert.equal(c.legacyEntries, 0);
  assert.match(c.headHash, /^[0-9a-f]{64}$/);
  assert.equal(c.entries.length, 7);
  assert.equal(c.entries[0].signerRole, SIGNER_ROLE_FIELD_AUDITOR);
  assert.equal(c.entries[6].signerRole, SIGNER_ROLE_INDEPENDENT_REVIEWER);
  assert.ok(c.entries.every((e) => e.hashOk === true && e.linkOk === true));
  // stage 8 reached with 4.2 dB verified: rebate is estimated from that
  assert.equal(r.portRebate.totalVerifiedDbReduction, 4.2);
  assert.ok(r.portRebate.estimate.rebateUsd > 0);
});

test("a tampered CAPA entry marks the dossier chain as broken", () => {
  const state = fullState();
  state.correctiveActions[0].history[2].note = "Edited after signing";
  const r = buildComplianceDossierReport(state);
  assert.equal(r.capaVerificationLog.allChainsIntact, false);
  const c = r.capaVerificationLog.capas[0];
  assert.equal(c.chainStatus, "broken");
  assert.equal(c.brokenAt, 2);
  assert.match(c.brokenReason, /do not match its recorded hash/);
  const html = renderComplianceDossierHtml(r);
  assert.match(html, /CHAIN BROKEN/);
  assert.match(html, /class="bad">FAIL</);
});

test("an empty state still builds a safe dossier with the disclaimer", () => {
  const r = buildComplianceDossierReport({ now: NOW });
  assert.equal(r.acousticEvent, null);
  assert.equal(r.audit.coiAttestation.declared, false);
  assert.match(r.audit.coiAttestation.statement, /No conflict-of-interest declaration on file/);
  assert.equal(r.capaVerificationLog.capas.length, 0);
  assert.equal(r.portRebate.estimate, null);
  const html = renderComplianceDossierHtml(r);
  assert.match(html, /No acoustic event selected/);
  assert.match(html, /No corrective actions recorded/);
  assert.match(html, /No port selected/);
  assert.match(html, /Decision-support output/);
});

test("renderComplianceDossierHtml is a self-contained document with six numbered sections", () => {
  const html = renderComplianceDossierHtml(buildComplianceDossierReport(fullState()));
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>OceanGuard Compliance Dossier<\/title>/);
  assert.match(html, /Schema oceanguard\.compliance-dossier\/1\.0/);
  const headings = [...html.matchAll(/<h2>([^<]*(?:&amp;[^<]*)?)<\/h2>/g)].map((m) => m[1]);
  assert.equal(headings.length, 6);
  headings.forEach((h, i) => assert.ok(h.startsWith(`${i + 1}. `), h));
  assert.match(html, /SHA-256 hash chain/);
  assert.match(html, /All chains intact/);
  assert.match(html, /Independent Reviewer/);
  // self-contained: no scripts, no external resources
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /\bsrc=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /@media print/);
});

test("the rendered dossier carries every safety disclaimer", () => {
  const html = renderComplianceDossierHtml(buildComplianceDossierReport(fullState()));
  const text = html.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  for (const caveat of [NON_CAUSATION_CAVEAT, UNCALIBRATED_CAVEAT, ECOLOGY_CAVEAT, OBIS_CAVEAT, REBATE_CAVEAT]) {
    assert.ok(text.includes(caveat), caveat.slice(0, 50));
  }
  assert.match(html, /Decision-support output/);
  assert.match(html, /do not establish that any vessel caused the acoustic event/);
  assert.match(html, /not absolute sound pressure levels/);
  assert.match(html, /not an invoice or a commitment/);
});

test("a calibrated event drops the uncalibrated caveat", () => {
  const r = buildComplianceDossierReport(
    fullState({ event: { ...event, calibrated: true, hydrophoneSensitivityDb: -165 } }),
  );
  assert.equal(r.acousticEvent.levelStatus, "calibrated");
  assert.deepEqual(r.acousticEvent.caveats, []);
  assert.doesNotMatch(renderComplianceDossierHtml(r), /relative digital dBFS/);
});

test("untrusted text is HTML-escaped in the rendered dossier", () => {
  const html = renderComplianceDossierHtml(
    buildComplianceDossierReport(
      fullState({
        event: { ...event, title: '<img src=x onerror="alert(1)">' },
        candidateVessels: [{ ...candidate, name: "<script>alert(2)</script>" }],
      }),
    ),
  );
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
});
