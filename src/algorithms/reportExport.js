// Phase 4A: compliance dossier report generator (Section 5.1 & Section 10 Step 8). Pure functions, no I/O,
// no dependencies. The caller supplies already-computed module state; this file only compiles and renders it.
import {
  calculateIncentiveEligibility,
  calculatePortRebate,
  evaluateShipAudit,
  verifyAuditChain,
} from "./ecologicalAndAudit.js";

export const REPORT_SCHEMA_VERSION = "oceanguard.compliance-dossier/1.0";

export const NON_CAUSATION_CAVEAT =
  "AIS correlation identifies candidate vessels only. Proximity, speed and timing are circumstantial evidence and do not establish that any vessel caused the acoustic event.";
export const OBIS_CAVEAT =
  "OBIS records are historical presence observations, not real-time detections. Absence of a record does not indicate absence of a species, and recorded positions may be far from the hydrophone.";
export const ECOLOGY_CAVEAT =
  "Ecological overlap is a screening indicator of potential spectral overlap and masking, not a measured biological impact.";
export const UNCALIBRATED_CAVEAT =
  "Levels are relative digital dBFS (no hydrophone calibration) and are not absolute sound pressure levels in dB re 1 µPa.";
export const REBATE_CAVEAT =
  "The rebate figure is a decision-support estimate from bundled tariff data, not an invoice or a commitment by any port authority.";

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
const r1 = (v) => (num(v) === null ? null : Math.round(Number(v) * 10) / 10);
const arr = (v) => (Array.isArray(v) ? v : []);

function summariseEvent(event) {
  if (!event) return null;
  const calibrated = Boolean(event.calibrated ?? event.isCalibrated);
  return {
    id: event.id ?? null,
    title: event.title ?? null,
    source: event.source ?? null,
    stationId: event.stationId ?? null,
    region: event.region ?? null,
    coords: event.coords ? { lat: event.coords.lat, lon: event.coords.lon } : null,
    eventTimestamp: event.timestamp ?? null,
    durationSec: num(event.durationSec),
    sampleRate: num(event.sampleRate),
    classification: event.classification ?? null,
    confidence: num(event.confidence),
    qualityScore: num(event.qualityScore),
    clippingDetected: Boolean(event.clippingDetected),
    dominantBandHz: event.dominantBandHz ?? null,
    spectralCentroidHz: num(event.spectralCentroidHz),
    levelStatus: calibrated ? "calibrated" : "relative-dBFS",
    levelUnit: calibrated ? "dB re 1 µPa (calibrated)" : "dBFS (relative, uncalibrated)",
    hydrophoneSensitivityDb: calibrated ? num(event.hydrophoneSensitivityDb) : null,
    rmsLevel: num(event.rmsLevel),
    peakLevel: num(event.peakLevel),
    ambientBaseline: num(event.ambientBaseline),
    deltaAboveAmbient: num(event.deltaAboveAmbient),
    notes: event.notes ?? null,
    caveats: calibrated ? [] : [UNCALIBRATED_CAVEAT],
  };
}

function summariseVessels(candidates, event) {
  const list = arr(candidates).map((v) => ({
    name: v.name ?? v.vesselName ?? null,
    mmsi: v.mmsi ?? null,
    imo: v.imo ?? v.imoNumber ?? null,
    vesselType: v.vesselType ?? null,
    cpaDistanceKm: r1(v.cpaDistanceKm),
    observedSpeedKnots: r1(v.observedSpeedKnots),
    designSpeedKnots: r1(v.designSpeedKnots),
    timeOffsetSec: num(v.timeOffsetSec),
    confidencePct: num(v.confidencePct),
    attributionTier: v.attributionTier ?? null,
    speedAnomalyFlagged: Boolean(v.speedAnomaly?.flagged),
  }));
  return {
    eventRegion: event?.region ?? null,
    candidateCount: list.length,
    candidates: list,
    caveats: [NON_CAUSATION_CAVEAT],
  };
}

function summariseEcology(ecology, protectedArea, biodiversity) {
  const a = ecology?.assessment ?? null;
  return {
    footprintKm: r1(ecology?.footprintKm ?? protectedArea?.footprintKm),
    assessment: a && {
      compositeConcernScore: a.compositeConcernScore,
      concernTier: a.concernTier,
      activeZonesCount: a.activeZonesCount,
      seasonalActiveCount: a.seasonalActiveCount,
      species: arr(a.speciesEvaluations).map((s) => ({
        name: s.commonName ?? s.name ?? s.scientificName ?? null,
        maskingRiskPct: s.maskingRiskPct,
        riskLabel: s.riskLabel,
      })),
    },
    protectedArea: protectedArea && {
      intrusionCount: protectedArea.intrusionCount ?? 0,
      footprintOverlapCount: protectedArea.footprintOverlapCount ?? 0,
      areas: arr(protectedArea.results).map((r) => ({
        siteId: r.siteId ?? null,
        siteName: r.siteName ?? null,
        designation: r.designation ?? null,
        iucnCategory: r.iucnCategory ?? null,
        vesselInside: r.vesselInside,
        footprintOverlap: r.footprintOverlap,
        footprintDistanceKm: r.footprintDistanceKm,
      })),
    },
    obis: biodiversity && {
      totalOccurrences: biodiversity.totalOccurrences ?? null,
      nearestKm: r1(biodiversity.nearestKm),
      nearest: arr(biodiversity.nearest).slice(0, 6).map((o) => ({
        scientificName: o.scientificName ?? null,
        distanceKm: r1(o.distanceKm),
        bathymetryM: o.bathymetryM ?? null,
        sstC: o.sstC ?? null,
        salinityPsu: o.salinityPsu ?? null,
      })),
    },
    caveats: [ECOLOGY_CAVEAT, OBIS_CAVEAT],
  };
}

function summariseAudit(auditAreas, vessel, auditor) {
  const areas = arr(auditAreas);
  const summary = areas.length ? evaluateShipAudit(areas, vessel) : null;
  return {
    vessel: vessel ? { name: vessel.name ?? null, mmsi: vessel.mmsi ?? null } : null,
    overallScore: summary?.overallScore ?? null,
    auditRating: summary?.auditRating ?? null,
    nonCompliantCount: summary?.nonCompliantCount ?? 0,
    observationCount: summary?.observationCount ?? 0,
    findings: areas.map((a) => ({
      id: a.id,
      component: a.component ?? null,
      status: a.status ?? null,
      score: num(a.score),
      guidelineRef: a.guidelineRef ?? null,
      inspectorNote: a.inspectorNote ?? null,
    })),
    recommendations: arr(summary?.tailoredRecommendations).map((r) => ({
      component: r.component,
      severity: r.severity,
      recommendation: r.recommendation,
      estimatedUrnReductionDb: r.estimatedUrnReductionDb,
    })),
    auditor: auditor
      ? { name: auditor.name ?? null, accreditationId: auditor.accreditationId ?? null }
      : null,
    coiAttestation: {
      declared: auditor ? auditor.conflictDeclared === true : false,
      statement: auditor?.conflictDeclared
        ? "Auditor declared no undisclosed financial or operational conflict of interest at sign-in."
        : "No conflict-of-interest declaration on file.",
    },
  };
}

function summariseCapas(correctiveActions) {
  const log = arr(correctiveActions).map((capa) => {
    const history = arr(capa.history);
    const chain = verifyAuditChain(capa.id, history);
    return {
      id: capa.id,
      vesselName: capa.vesselName ?? null,
      component: capa.component ?? null,
      currentStage: capa.currentStage ?? null,
      verifiedReductionDb: r1(capa.verifiedReductionDb) ?? 0,
      chainStatus: !history.length
        ? "empty"
        : chain.valid
          ? "intact"
          : "broken",
      chainValid: chain.valid,
      chainChecked: chain.checked,
      legacyEntries: chain.legacyCount,
      brokenAt: chain.brokenAt,
      brokenReason: chain.reason,
      headHash: chain.headHash ?? null,
      entries: history.map((h, i) => ({
        index: i + 1,
        fromStage: h.fromStage,
        toStage: h.toStage,
        at: h.at,
        auditorName: h.auditorName ?? null,
        accreditationId: h.accreditationId ?? null,
        signerRole: h.signerRole ?? null,
        note: h.note ?? null,
        measuredReductionDb: h.measuredReductionDb ?? null,
        previousHash: h.previousHash ?? null,
        recordHash: h.recordHash ?? null,
        hashOk: chain.entries[i]?.hashOk ?? null,
        linkOk: chain.entries[i]?.linkOk ?? null,
      })),
    };
  });
  return {
    algorithm: "SHA-256 hash chain",
    allChainsIntact: log.every((c) => c.chainStatus !== "broken"),
    capas: log,
  };
}

function summariseRebate(state, capas, auditScore) {
  const verifiedDb = capas.reduce(
    (s, c) => (c.currentStage >= 7 ? s + (c.verifiedReductionDb || 0) : s),
    0,
  );
  const port = state.port ?? null;
  const estimate = port
    ? calculatePortRebate({
        port,
        grossTonnage: state.grossTonnage,
        verifiedDbReduction: state.verifiedDbReduction ?? verifiedDb,
      })
    : null;
  const incentive = calculateIncentiveEligibility(
    arr(state.correctiveActions),
    auditScore ?? 0,
    state.basePortCallFeeUsd,
  );
  return {
    port: port ? { portCode: port.portCode ?? null, name: port.portName ?? port.name ?? null } : null,
    estimate,
    incentiveTier: incentive.tierName,
    totalVerifiedDbReduction: incentive.totalVerifiedDbReduction,
    caveats: [REBATE_CAVEAT],
  };
}

/**
 * Compiles module state into a structured, timestamped dossier object.
 * state = { event, candidateVessels, vessel, ecology, protectedArea, biodiversity, auditAreas, auditor,
 *           correctiveActions, port, grossTonnage, verifiedDbReduction, basePortCallFeeUsd, now }
 */
export function buildComplianceDossierReport(state = {}) {
  const now = state.now instanceof Date ? state.now : new Date(state.now ?? Date.now());
  const audit = summariseAudit(state.auditAreas, state.vessel, state.auditor);
  const capaLog = summariseCapas(state.correctiveActions);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    title: "OceanGuard Compliance Dossier",
    disclaimer:
      "Decision-support output. Findings are indicative and must be reviewed by a qualified, accredited auditor before regulatory or commercial use.",
    acousticEvent: summariseEvent(state.event),
    aisCorrelation: summariseVessels(state.candidateVessels, state.event),
    ecology: summariseEcology(state.ecology, state.protectedArea, state.biodiversity),
    audit,
    capaVerificationLog: capaLog,
    portRebate: summariseRebate(state, arr(state.correctiveActions), audit.overallScore),
  };
}

const esc = (v) =>
  String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const val = (v, unit = "") => (v === null || v === undefined ? "—" : `${esc(v)}${unit}`);
const usd = (v) => (num(v) === null ? "—" : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const row = (cells, tag = "td") => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
const table = (head, rows) =>
  rows.length
    ? `<table><thead>${row(head, "th")}</thead><tbody>${rows.map((r) => row(r)).join("")}</tbody></table>`
    : `<p class="muted">None on record.</p>`;
const kv = (pairs) =>
  `<dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
const caveats = (list) =>
  arr(list).length ? `<div class="caveat">${arr(list).map((c) => `<p>${esc(c)}</p>`).join("")}</div>` : "";

const CSS = `
:root{--ink:#14202b;--muted:#5b6b7a;--line:#cfd8e0;--accent:#0b5c7a;--warn:#8a5a00;--bad:#9b1c1c;--ok:#1b6b3a}
*{box-sizing:border-box}
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);background:#fff;margin:0 auto;max-width:900px;padding:24px}
h1{font-size:24px;margin:0 0 4px;color:var(--accent)} h2{font-size:17px;margin:26px 0 8px;padding-bottom:4px;border-bottom:2px solid var(--accent);color:var(--accent)}
h3{font-size:14px;margin:14px 0 6px}
.muted{color:var(--muted)} .meta{color:var(--muted);font-size:12px;margin-bottom:12px}
dl{display:grid;grid-template-columns:200px 1fr;gap:3px 12px;margin:6px 0} dt{color:var(--muted)} dd{margin:0}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12.5px} th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
th{background:#eef3f6} .hash{font:11px ui-monospace,Menlo,Consolas,monospace;word-break:break-all}
.caveat{border-left:4px solid var(--warn);background:#fff8e6;padding:6px 10px;margin:8px 0;font-size:12.5px} .caveat p{margin:2px 0}
.ok{color:var(--ok);font-weight:600} .bad{color:var(--bad);font-weight:600} .warn{color:var(--warn);font-weight:600}
section{break-inside:avoid-page}
@media print{body{padding:0;max-width:none}h2{break-after:avoid}tr{break-inside:avoid}.caveat{background:#fff}}
@page{margin:16mm}`;

/** Renders a report object as one self-contained printable HTML document (no external resources, no scripts). */
export function renderComplianceDossierHtml(report) {
  const r = report ?? {};
  const ev = r.acousticEvent;
  const ais = r.aisCorrelation;
  const eco = r.ecology;
  const au = r.audit;
  const capa = r.capaVerificationLog;
  const pr = r.portRebate;

  const evHtml = ev
    ? kv([
        ["Event", `${val(ev.title)} (${val(ev.id)})`],
        ["Station / region", `${val(ev.stationId)} / ${val(ev.region)}`],
        ["Position", ev.coords ? `${esc(ev.coords.lat)}, ${esc(ev.coords.lon)}` : "—"],
        ["Event time", val(ev.eventTimestamp)],
        ["Classification", `${val(ev.classification)} (confidence ${val(ev.confidence)})`],
        ["Level status", `<span class="${ev.levelStatus === "calibrated" ? "ok" : "warn"}">${esc(ev.levelStatus)}</span> — ${esc(ev.levelUnit)}`],
        ["RMS / peak level", `${val(ev.rmsLevel)} / ${val(ev.peakLevel)}`],
        ["Ambient / Δ above ambient", `${val(ev.ambientBaseline)} / ${val(ev.deltaAboveAmbient)} dB`],
        ["Spectral centroid", val(ev.spectralCentroidHz, " Hz")],
        ["Quality score", `${val(ev.qualityScore)}${ev.clippingDetected ? " (clipping detected)" : ""}`],
      ]) + caveats(ev.caveats)
    : `<p class="muted">No acoustic event selected.</p>`;

  const aisHtml =
    table(
      ["Vessel", "MMSI", "Type", "CPA km", "SOG kn", "Design kn", "Confidence", "Tier"],
      arr(ais?.candidates).map((c) => [
        val(c.name), val(c.mmsi), val(c.vesselType), val(c.cpaDistanceKm), val(c.observedSpeedKnots),
        val(c.designSpeedKnots), val(c.confidencePct, "%"), val(c.attributionTier) + (c.speedAnomalyFlagged ? " ⚑" : ""),
      ]),
    ) + caveats(ais?.caveats ?? [NON_CAUSATION_CAVEAT]);

  const a = eco?.assessment;
  const pa = eco?.protectedArea;
  const ecoHtml =
    (a
      ? kv([
          ["Acoustic footprint", val(eco.footprintKm, " km")],
          ["Concern tier", `${val(a.concernTier)} (score ${val(a.compositeConcernScore)})`],
          ["Zones in footprint", `${val(a.activeZonesCount)} (${val(a.seasonalActiveCount)} seasonally active)`],
        ])
      : `<p class="muted">No ecological assessment available.</p>`) +
    table(["Species", "Masking risk", "Label"], arr(a?.species).map((s) => [val(s.name), val(s.maskingRiskPct, "%"), val(s.riskLabel)])) +
    (pa
      ? `<h3>Marine protected areas</h3><p>Vessel intrusions: <b>${esc(pa.intrusionCount)}</b> · Footprint overlaps: <b>${esc(pa.footprintOverlapCount)}</b></p>` +
        table(["Site", "Designation", "IUCN", "Vessel inside", "Footprint overlap"], arr(pa.areas).map((x) => [
          val(x.siteName), val(x.designation), val(x.iucnCategory),
          x.vesselInside === null ? "—" : x.vesselInside ? "Yes" : "No",
          x.footprintOverlap === null ? "—" : x.footprintOverlap ? "Yes" : "No",
        ]))
      : "") +
    (eco?.obis
      ? `<h3>Nearest OBIS historical records</h3><p class="muted">Nearest: ${val(eco.obis.nearestKm, " km")} of ${val(eco.obis.totalOccurrences)} records.</p>` +
        table(["Scientific name", "Distance km", "Depth m", "SST °C", "Salinity PSU"], arr(eco.obis.nearest).map((o) => [
          val(o.scientificName), val(o.distanceKm), val(o.bathymetryM), val(o.sstC), val(o.salinityPsu),
        ]))
      : "") +
    caveats(eco?.caveats);

  const auHtml =
    (au
      ? kv([
          ["Vessel", au.vessel ? `${val(au.vessel.name)} (MMSI ${val(au.vessel.mmsi)})` : "—"],
          ["Overall score / rating", `${val(au.overallScore)} / ${val(au.auditRating)}`],
          ["Non-compliant / observations", `${val(au.nonCompliantCount)} / ${val(au.observationCount)}`],
          ["Auditor", au.auditor ? `${val(au.auditor.name)} (${val(au.auditor.accreditationId)})` : "—"],
          ["COI attestation", `<span class="${au.coiAttestation.declared ? "ok" : "bad"}">${au.coiAttestation.declared ? "Declared" : "Not on file"}</span> — ${esc(au.coiAttestation.statement)}`],
        ])
      : "") +
    table(["Component", "Status", "Score", "Guideline", "Inspector note"], arr(au?.findings).map((f) => [
      val(f.component), val(f.status), val(f.score), val(f.guidelineRef), val(f.inspectorNote),
    ]));

  const capaHtml = arr(capa?.capas).length
    ? `<p>Overall chain status: <span class="${capa.allChainsIntact ? "ok" : "bad"}">${capa.allChainsIntact ? "All chains intact" : "CHAIN BROKEN"}</span> (${esc(capa.algorithm)})</p>` +
      capa.capas
        .map(
          (c) =>
            `<h3>${esc(c.id)} — ${esc(c.vesselName ?? "")} ${esc(c.component ?? "")}</h3>` +
            `<p>Stage ${val(c.currentStage)} · verified reduction ${val(c.verifiedReductionDb, " dB")} · chain <span class="${c.chainStatus === "intact" ? "ok" : c.chainStatus === "broken" ? "bad" : "warn"}">${esc(c.chainStatus)}</span> (${esc(c.chainChecked)} hashed, ${esc(c.legacyEntries)} legacy)` +
            (c.brokenReason ? ` — <span class="bad">${esc(c.brokenReason)}</span>` : "") +
            `</p><p>Head hash: <span class="hash">${val(c.headHash)}</span></p>` +
            table(["#", "Stage", "Time", "Signer", "Role", "Record hash", "Check"], c.entries.map((e) => [
              val(e.index), `${val(e.fromStage)}→${val(e.toStage)}`, val(e.at), `${val(e.auditorName)} (${val(e.accreditationId)})`, val(e.signerRole),
              `<span class="hash">${val(e.recordHash)}</span>`,
              e.hashOk === null ? "legacy" : e.hashOk && e.linkOk ? '<span class="ok">OK</span>' : '<span class="bad">FAIL</span>',
            ])),
        )
        .join("")
    : `<p class="muted">No corrective actions recorded.</p>`;

  const est = pr?.estimate;
  const prHtml =
    kv([
      ["Port", pr?.port ? `${val(pr.port.name)} (${val(pr.port.portCode)})` : "—"],
      ["Incentive tier", val(pr?.incentiveTier)],
      ["Verified reduction", val(pr?.totalVerifiedDbReduction, " dB")],
      ...(est
        ? [
            ["Gross tonnage", val(est.grossTonnage)],
            ["Port dues", usd(est.duesUsd)],
            ["Rebate tier", est.tier ? `${val(est.rebatePercent, "%")}${est.capApplied ? " (cap applied)" : ""}` : "No tier reached"],
            ["Estimated rebate", `<b>${usd(est.rebateUsd)}</b> (net dues ${usd(est.netDuesUsd)})`],
          ]
        : [["Rebate estimate", "No port selected."]]),
    ]) + caveats(pr?.caveats);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title ?? "OceanGuard Compliance Dossier")}</title><style>${CSS}</style></head><body>
<h1>${esc(r.title ?? "OceanGuard Compliance Dossier")}</h1>
<div class="meta">Generated ${esc(r.generatedAt)} · Schema ${esc(r.schemaVersion)}</div>
<div class="caveat"><p>${esc(r.disclaimer)}</p></div>
<section><h2>1. Acoustic event summary</h2>${evHtml}</section>
<section><h2>2. Candidate AIS vessel correlation</h2>${aisHtml}</section>
<section><h2>3. Ecological &amp; protected-area overlap</h2>${ecoHtml}</section>
<section><h2>4. Audit findings &amp; COI attestation</h2>${auHtml}</section>
<section><h2>5. CAPA verification log (SHA-256 hash chain)</h2>${capaHtml}</section>
<section><h2>6. Port URN rebate estimate</h2>${prHtml}</section>
</body></html>`;
}
