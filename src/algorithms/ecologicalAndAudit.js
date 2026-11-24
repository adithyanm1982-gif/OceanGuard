import { REGIONS, CAPA_EVIDENCE_OPTIONS } from "../data/mockDatasets.js";
import {
  distanceToPolygonKm,
  haversineKm,
  isPointInPolygon,
  polygonAreaKm2,
} from "./geometry.js";

// ---------------------------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------------------------

/** Region id of the reference deployment closest to `coords`, or null when none is within its match radius. */
export function nearestRegionId(coords) {
  if (!Number.isFinite(coords?.lat) || !Number.isFinite(coords?.lon)) return null;
  let best = null;
  for (const r of REGIONS) {
    const d = haversineKm(coords, r.coords);
    if (d <= r.matchRadiusKm && (!best || d < best.d)) best = { id: r.id, d };
  }
  return best ? best.id : null;
}

/** The region an acoustic event belongs to: its own `region` tag, else the nearest reference region, else null. */
export function resolveEventRegion(event) {
  if (event?.region && REGIONS.some((r) => r.id === event.region)) return event.region;
  return nearestRegionId(event?.coords);
}

/** Zones and species records that belong to the event's region (empty lists when the region is unknown). */
export function selectRegionalContext(event, zones, speciesList) {
  const regionId = resolveEventRegion(event);
  return {
    regionId,
    region: REGIONS.find((r) => r.id === regionId) || null,
    zones: regionId ? zones.filter((z) => z.region === regionId) : [],
    species: regionId ? speciesList.filter((sp) => sp.region === regionId) : [],
  };
}

/**
 * `footprintKm` is the estimated acoustic footprint of the active event (see geometry.js);
 * zones farther than that from the hydrophone are not counted as overlapping. Defaults to the
 * original fixed 5 km so existing callers behave the same. `region` (optional) restricts both lists to
 * records tagged for that region (see REGIONS in mockDatasets).
 */
export function evaluateEcologicalOverlap(
  acousticEvent,
  allZones,
  allSpecies,
  footprintKm = 5.0,
  region = null,
) {
  // When a region is given, only records tagged for it are considered.
  const zones = region ? allZones.filter((z) => z.region === region) : allZones;
  const speciesList = region ? allSpecies.filter((sp) => sp.region === region) : allSpecies;
  const deltaDb = acousticEvent?.deltaAboveAmbient || 20;
  const centroidHz = acousticEvent?.spectralCentroidHz || 250;
  const lowPct = acousticEvent?.bandBreakdown?.lowPct || 50;

  const activeZones = zones.filter((z) => z.distanceKm <= footprintKm);
  const seasonalActiveCount = activeZones.filter((z) => z.seasonMatch).length;

  const speciesEvaluations = speciesList.map((sp) => {
    const [minHz, maxHz] = sp.vocalBandHz;
    let spectralOverlap = 0.2;
    if (centroidHz >= minHz && centroidHz <= maxHz) {
      spectralOverlap = 0.92;
    } else if (minHz < 250 && lowPct > 50) {
      spectralOverlap = 0.86;
    } else if (Math.abs(centroidHz - minHz) < 400) {
      spectralOverlap = 0.55;
    }

    const intensityFactor = Math.min(1.0, deltaDb / 35);
    const maskingRiskPct = Math.min(95, Math.round(spectralOverlap * intensityFactor * 100));

    let riskLabel = "Low Spectral Overlap";
    if (maskingRiskPct >= 70) riskLabel = "Elevated Acoustic Masking Potential";
    else if (maskingRiskPct >= 40) riskLabel = "Moderate Spectral Overlap";

    return {
      ...sp,
      maskingRiskPct,
      riskLabel,
    };
  });

  const maxMasking = Math.max(...speciesEvaluations.map((s) => s.maskingRiskPct), 25);
  const compositeConcernScore = Math.min(
    96,
    Math.round(maxMasking * 0.55 + seasonalActiveCount * 16 + Math.min(20, deltaDb * 0.5)),
  );

  let concernTier = "Low Potential Ecological Concern";
  if (compositeConcernScore >= 72) concernTier = "High Potential Ecological Concern";
  else if (compositeConcernScore >= 45) concernTier = "Moderate Potential Ecological Concern";

  return {
    compositeConcernScore,
    concernTier,
    activeZonesCount: activeZones.length,
    seasonalActiveCount,
    speciesEvaluations,
  };
}

/** Achievable URN reduction (dB) per audit area for a properly executed remedy; `default` covers every other area. */
export const URN_REDUCTION_RANGES_DB = {
  propeller: [2.5, 4.5],
  hull: [1.0, 2.5],
  operational: [3.0, 6.0],
  default: [1.0, 3.0],
};
const rangeFor = (areaId) => URN_REDUCTION_RANGES_DB[areaId] || URN_REDUCTION_RANGES_DB.default;
const formatRangeDb = ([lo, hi]) => `${lo.toFixed(1)} – ${hi.toFixed(1)} dB`;

const COMPONENT_WEIGHTS = {
  propeller: 0.25,
  hull: 0.15,
  machinery: 0.15,
  propulsion: 0.15,
  noise_plan: 0.1,
  operational: 0.1,
  acoustic_perf: 0.1,
};

export function evaluateShipAudit(auditAreas, vessel) {
  let weightedSum = 0;
  let totalWeight = 0;

  auditAreas.forEach((area) => {
    const w = COMPONENT_WEIGHTS[area.id] || 0.12;
    weightedSum += area.score * w;
    totalWeight += w;
  });

  const overallScore = Math.round(weightedSum / Math.max(0.01, totalWeight));
  const nonCompliantCount = auditAreas.filter((a) => a.status === "Non-Compliant").length;
  const observationCount = auditAreas.filter((a) => a.status === "Observation").length;

  let auditRating = "Compliant — Low URN Profile";
  if (overallScore < 60 || nonCompliantCount >= 2) {
    auditRating = "Action Required — Elevated URN Risk";
  } else if (overallScore < 80 || nonCompliantCount === 1 || observationCount >= 2) {
    auditRating = "Conditional — Targeted Improvements Recommended";
  }

  const propType = vessel?.propellerType || "Fixed-Pitch Propeller";
  const isFPP = propType.toLowerCase().includes("fixed");

  const tailoredRecommendations = auditAreas
    .filter((a) => a.status !== "Compliant")
    .map((area) => {
      if (area.id === "propeller") {
        return {
          areaId: area.id,
          component: area.component,
          severity: area.status,
          recommendation: isFPP
            ? `Schedule underwater diver/ROV propeller polishing and trailing-edge cavitation pitting inspection tailored to ${propType}; avoid generic blade replacement unless severe erosion is confirmed.`
            : `Inspect controllable-pitch blade root seals and pitch-combinator schedule for ${propType}; perform targeted blade surface polishing.`,
          estimatedUrnReductionDb: formatRangeDb(rangeFor("propeller")),
          capexTier: "Low / Routine Dry-Dock or Afloat Maintenance",
        };
      }
      if (area.id === "hull") {
        return {
          areaId: area.id,
          component: area.component,
          severity: area.status,
          recommendation:
            "Perform targeted hull biofouling cleaning (especially bilge keels and stern bossing) to restore uniform wake inflow into the propeller disc.",
          estimatedUrnReductionDb: formatRangeDb(rangeFor("hull")),
          capexTier: "Low / Afloat Hull Cleaning",
        };
      }
      if (area.id === "operational") {
        return {
          areaId: area.id,
          component: area.component,
          severity: area.status,
          recommendation: `Establish vessel-specific cavitation-inception speed profile (${vessel?.designSpeedKnots || 14.2} kn baseline) when transiting MPAs or cetacean corridors.`,
          estimatedUrnReductionDb: formatRangeDb(rangeFor("operational")),
          capexTier: "Zero CapEx / Operational Trim & Speed Optimization",
        };
      }
      return {
        areaId: area.id,
        component: area.component,
        severity: area.status,
        recommendation: `Conduct engineering review of ${area.component.toLowerCase()} aligned with ${area.guidelineRef} and verify via repeat hydrophone measurement.`,
        estimatedUrnReductionDb: formatRangeDb(rangeFor(area.id)),
        capexTier: "Moderate / Technical Assessment",
      };
    });

  return {
    overallScore,
    auditRating,
    nonCompliantCount,
    observationCount,
    tailoredRecommendations,
  };
}

/**
 * Calculates voluntary Port & Government Incentive Eligibility from verified CAPA & Audit state
 */
export function calculateIncentiveEligibility(
  correctiveActions,
  auditScore,
  basePortCallFeeUsd = 48000,
) {
  // A CAPA only counts once it has passed independent review (stage 7+) AND carries a measured reduction.
  const verifiedActions = correctiveActions.filter(
    (ca) => ca.currentStage >= 7 && (ca.verifiedReductionDb || 0) > 0,
  );
  const totalVerifiedDbReduction = Number(
    verifiedActions.reduce((acc, ca) => acc + (ca.verifiedReductionDb || 0), 0).toFixed(1),
  );

  let tierName = "Participant — Baseline Audit Logged";
  let portDuesDiscountPct = 0;
  let fairwayFeeDiscountPct = 0;
  let greenLabelEligible = false;
  let greenFinancingEligible = false;
  let priorityBerthEligible = false;

  if (totalVerifiedDbReduction >= 5.0 && auditScore >= 75) {
    tierName = "Tier 1: Quiet Ocean Leader (Gold Verified)";
    portDuesDiscountPct = 20;
    fairwayFeeDiscountPct = 15;
    greenLabelEligible = true;
    greenFinancingEligible = true;
    priorityBerthEligible = true;
  } else if (totalVerifiedDbReduction >= 2.5 || verifiedActions.length >= 1) {
    tierName = "Tier 2: Verified URN Improver (Silver Verified)";
    portDuesDiscountPct = 12;
    fairwayFeeDiscountPct = 8;
    greenLabelEligible = true;
    greenFinancingEligible = totalVerifiedDbReduction >= 3.0;
    priorityBerthEligible = false;
  } else if (auditScore >= 60) {
    tierName = "Tier 3: Voluntary URN Management Plan Registered";
    portDuesDiscountPct = 5;
    fairwayFeeDiscountPct = 0;
  }

  const estimatedAnnualSavingsUsd = Math.round(
    basePortCallFeeUsd * 12 * ((portDuesDiscountPct * 0.65 + fairwayFeeDiscountPct * 0.35) / 100),
  );

  return {
    tierName,
    verifiedCount: verifiedActions.length,
    totalVerifiedDbReduction,
    portDuesDiscountPct,
    fairwayFeeDiscountPct,
    greenLabelEligible,
    greenFinancingEligible,
    priorityBerthEligible,
    estimatedAnnualSavingsUsd,
  };
}

// ---------------------------------------------------------------------------------------------
// Corrective actions (CAPA)
// ---------------------------------------------------------------------------------------------

/** Planning threshold: an event more than this many dB above ambient is treated as excess URN. */
export const URN_EXCESS_THRESHOLD_DB = 12;
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Sequential, zero-padded CAPA id for `year`: CAPA-2026-042 ... CAPA-2026-999, CAPA-2026-1000.
 * Continues from the highest number already used that year, so deleted or out-of-order records
 * never cause a duplicate; a new year restarts at 001.
 */
export function nextCapaId(existing = [], year = new Date().getFullYear()) {
  let max = 0;
  existing.forEach((ca) => {
    const m = /^CAPA-(\d{4})-(\d+)$/.exec(ca?.id || "");
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  });
  const nextNum = max + 1;
  return `CAPA-${year}-${String(nextNum).padStart(3, "0")}`;
}

/**
 * Target URN reduction (dB) for a new corrective action, derived from the vessel's excess level.
 *  - Operational findings with an over-design-speed vessel: the source-level penalty of the overspeed,
 *    60·log10(observed / design) dB, clamped to the achievable range for operational remedies.
 *  - Otherwise: the event's excess over URN_EXCESS_THRESHOLD_DB, mapped onto the component's achievable
 *    range (a 20 dB excess asks for the top of the range).
 *  - No acoustic evidence: the low end of the range.
 * A planning estimate for setting a verification target, not a prediction of the measured result.
 */
export function estimateCapaTargetReductionDb(area, vessel, event) {
  const [lo, hi] = rangeFor(area?.id);
  const clamp = (v) => round1(Math.min(hi, Math.max(lo, v)));

  const observed = Number(vessel?.observedSpeedKnots);
  const design = Number(vessel?.designSpeedKnots);
  const speedExcessDb = observed > design && design > 0 ? 60 * Math.log10(observed / design) : 0;
  if (area?.id === "operational" && speedExcessDb > 0) {
    return {
      targetDb: clamp(speedExcessDb),
      excessDb: round1(speedExcessDb),
      basis: `Transit at ${observed} kn vs ${design} kn design speed: about ${round1(speedExcessDb)} dB source-level penalty (60·log10 speed ratio).`,
    };
  }

  const delta = Number(event?.deltaAboveAmbient);
  if (Number.isFinite(delta)) {
    const excessDb = Math.max(0, delta - URN_EXCESS_THRESHOLD_DB);
    return {
      targetDb: clamp(lo + (hi - lo) * Math.min(1, excessDb / 20)),
      excessDb: round1(excessDb),
      basis: `Event +${delta} dB above ambient vs ${URN_EXCESS_THRESHOLD_DB} dB threshold: ${round1(excessDb)} dB excess, mapped to the ${formatRangeDb([lo, hi])} achievable range.`,
    };
  }
  return {
    targetDb: lo,
    excessDb: null,
    basis: `No acoustic event on file; minimum of the ${formatRangeDb([lo, hi])} achievable range.`,
  };
}

/** Builds a new CAPA at Stage 1 with nothing verified yet. Returns null when there is no vessel to attach it to. */
export function buildCorrectiveAction({
  area,
  vessel,
  event,
  existing = [],
  auditor,
  now = new Date(),
}) {
  if (!area || !vessel) return null;
  const target = estimateCapaTargetReductionDb(area, vessel, event);
  return {
    id: nextCapaId(existing, now.getFullYear()),
    areaId: area.id,
    component: area.component,
    vesselName: vessel.name,
    vesselImo: vessel.imo,
    finding: area.inspectorNote,
    recommendedAction: `Qualified technical remediation for ${area.component} per ${area.guidelineRef}.`,
    currentStage: 1,
    targetReductionDb: target.targetDb,
    targetBasis: target.basis,
    verifiedReductionDb: 0,
    history: [],
    createdBy: auditor?.name || "Accredited Auditor",
    createdAt: now.toISOString(),
  };
}

export const FINAL_CAPA_STAGE = 8;
const MIN_NOTE_CHARS = 10;
const MAX_MEASURED_REDUCTION_DB = 30;

/**
 * Checks whether a CAPA may move to its next stage. `input` = { evidence: string[], note: string, measuredReductionDb }.
 * Every transition needs at least one evidence item or a verification note. The last transition (into
 * stage 8, the repeat acoustic check) also needs "Acoustic Re-scan Verified" and a measured reduction.
 */
export function validateStageAdvance(capa, input = {}, auditor) {
  const errors = [];
  if (!capa) return { ok: false, errors: ["No corrective action selected."] };
  if (capa.currentStage >= FINAL_CAPA_STAGE)
    return { ok: false, errors: ["This corrective action is already closed."] };
  if (!auditor?.name) errors.push("An accredited auditor must be signed in to verify a stage.");

  const known = new Set(CAPA_EVIDENCE_OPTIONS.map((o) => o.id));
  const evidence = (input.evidence || []).filter((id) => known.has(id));
  const note = String(input.note || "").trim();
  if (evidence.length === 0 && note.length < MIN_NOTE_CHARS) {
    errors.push(
      `Select at least one evidence item or write a verification note (${MIN_NOTE_CHARS}+ characters).`,
    );
  }

  const toStage = capa.currentStage + 1;
  // Opt-in (the UI always sets it) so pre-2B callers that sign Stages 7-8 with the auditor alone still work.
  if (toStage >= FIRST_REVIEWER_STAGE && input.enforceRoleSeparation) {
    if (String(input.reviewerName || "").trim().length < 2)
      errors.push("Independent Reviewer / Port Authority name is required for Stages 7-8.");
    if (String(input.reviewerId || "").trim().length < 3)
      errors.push("Independent Reviewer / Port Authority ID is required for Stages 7-8.");
  }
  if (toStage === FINAL_CAPA_STAGE) {
    if (!evidence.includes("acoustic_rescan"))
      errors.push('Closing requires "Acoustic Re-scan Verified" to be checked.');
    const measured = Number(input.measuredReductionDb);
    if (!(measured > 0 && measured <= MAX_MEASURED_REDUCTION_DB)) {
      errors.push(
        `Enter the measured reduction from the repeat acoustic pass (greater than 0, up to ${MAX_MEASURED_REDUCTION_DB} dB).`,
      );
    }
  }
  return { ok: errors.length === 0, errors, evidence, note, toStage };
}

/** Applies a validated stage advance and appends the audit-trail entry. Returns { ok, errors, capa }. */
export function advanceCapaStage(capa, input, auditor, now = new Date()) {
  const check = validateStageAdvance(capa, input, auditor);
  if (!check.ok) return { ok: false, errors: check.errors, capa };
  const closing = check.toStage === FINAL_CAPA_STAGE;
  const reviewerName = String(input.reviewerName || "").trim();
  const reviewerId = String(input.reviewerId || "").trim();
  // Reviewer identity applies to Stages 7-8 once a reviewer is named (always the case when enforced).
  const reviewerStage = check.toStage >= FIRST_REVIEWER_STAGE && Boolean(reviewerName || input.enforceRoleSeparation);
  // Stages 7-8: the independent reviewer is the signer (their ID is the attestation accreditation).
  // Stages 1-6: the Field Auditor signs; the role is recorded when the caller supplies it
  // (older callers that pass no signerRole keep the exact Phase 4 entry shape).
  const signerRole = reviewerStage
    ? SIGNER_ROLE_INDEPENDENT_REVIEWER
    : input.signerRole === SIGNER_ROLE_FIELD_AUDITOR
      ? SIGNER_ROLE_FIELD_AUDITOR
      : null;
  const base = {
    fromStage: capa.currentStage,
    toStage: check.toStage,
    at: now.toISOString(),
    auditorName: reviewerStage ? reviewerName : auditor.name,
    accreditationId: (reviewerStage ? reviewerId : auditor.accreditationId) || null,
    evidence: check.evidence,
    note: check.note,
    ...(closing ? { measuredReductionDb: round1(Number(input.measuredReductionDb)) } : {}),
    ...(signerRole ? { signerRole } : {}),
    ...(reviewerStage ? { fieldAuditorName: auditor.name, fieldAuditorAccreditationId: auditor.accreditationId || null } : {}),
  };
  const entry = sealAuditRecord(capa.id, base, lastRecordHash(capa.history));
  return {
    ok: true,
    errors: [],
    capa: {
      ...capa,
      currentStage: check.toStage,
      verifiedReductionDb: closing ? entry.measuredReductionDb : capa.verifiedReductionDb || 0,
      history: [...(capa.history || []), entry],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Phase 3: protected-area intrusion (Point-in-Polygon), real OBIS/WDPA telemetry, USCG PSIX lookup
// ---------------------------------------------------------------------------------------------

const round2 = (n) => Math.round(n * 100) / 100;
const finite = (n) => (Number.isFinite(n) ? n : null);

/**
 * Checks a vessel position and the acoustic footprint against closed [lon, lat] protected-area polygons
 * (CO_LOCATED_SCENARIOS[...].wdpaPolygons).
 *  - vesselInside: Point-in-Polygon on the vessel's [lon, lat] (boundary counts as inside); null when the vessel has no position.
 *  - footprintOverlap: the footprint circle (radius `footprintKm` around `hydrophone`) touches the polygon.
 * Pure function: no I/O.
 */
export function evaluateProtectedAreaIntrusion({ vessel, hydrophone, footprintKm, polygons } = {}) {
  const hasVessel = Number.isFinite(vessel?.lat) && Number.isFinite(vessel?.lon);
  const hasHydrophone = Number.isFinite(hydrophone?.lat) && Number.isFinite(hydrophone?.lon);
  const radius = Number.isFinite(footprintKm) && footprintKm > 0 ? footprintKm : null;

  const results = (polygons || []).map((poly) => {
    const ring = poly.coordinates || [];
    const vesselInside = hasVessel ? isPointInPolygon([vessel.lon, vessel.lat], ring) : null;
    const vesselDistance = hasVessel ? distanceToPolygonKm(vessel, ring) : null;
    const hydroDistance = hasHydrophone ? distanceToPolygonKm(hydrophone, ring) : null;
    const areaKm2 = polygonAreaKm2(ring);
    return {
      siteId: poly.siteId,
      siteName: poly.siteName,
      iucnCategory: poly.iucnCategory ?? null,
      designation: poly.designation ?? null,
      activeSeason: poly.activeSeason ?? null,
      priorityTier: poly.priorityTier ?? null,
      areaKm2: areaKm2 === null ? null : round2(areaKm2),
      ring,
      vesselInside,
      vesselDistanceKm: vesselDistance === null ? null : round2(vesselDistance),
      hydrophoneInside: hasHydrophone ? isPointInPolygon([hydrophone.lon, hydrophone.lat], ring) : null,
      footprintOverlap: radius !== null && hydroDistance !== null ? hydroDistance <= radius : null,
      footprintDistanceKm: hydroDistance === null ? null : round2(hydroDistance),
    };
  });

  return {
    vesselPosition: hasVessel ? { lat: vessel.lat, lon: vessel.lon } : null,
    footprintKm: radius,
    results,
    intrusionCount: results.filter((r) => r.vesselInside === true).length,
    footprintOverlapCount: results.filter((r) => r.footprintOverlap === true).length,
  };
}

/**
 * Nearest real OBIS occurrences to a point, with the telemetry fields normalised to explicit units:
 * bathymetryM, sstC, salinityPsu (null when the record has none). `distanceKm` is great-circle distance.
 */
export function nearestBiodiversityOccurrences(occurrences, point, limit = 6) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return [];
  return (occurrences || [])
    .filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon))
    .map((o) => ({
      occurrenceId: o.occurrenceId ?? o.id,
      scientificName: o.scientificName,
      vernacularName: o.vernacularName ?? null,
      eventDate: o.eventDate ?? null,
      locality: o.locality ?? null,
      country: o.country ?? null,
      lat: o.lat,
      lon: o.lon,
      bathymetryM: finite(o.bathymetryM),
      sstC: finite(o.sstC),
      salinityPsu: finite(o.salinityPsu),
      distanceKm: round2(haversineKm(point, o)),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, Math.max(0, limit));
}

/** WDPA record metadata under its source column names (SITE_NAME / IUCN_CAT / GIS_AREA / GOV_TYPE). */
export function normaliseWdpaRecord(r) {
  return {
    siteId: r.siteId,
    SITE_NAME: r.nameEng || r.name || null,
    IUCN_CAT: r.iucnCat ?? null,
    GIS_AREA: finite(r.gisArea),
    GOV_TYPE: r.govType ?? null,
    realm: r.realm ?? null,
    designation: r.desigEng ?? r.desig ?? null,
    iso3: r.iso3 ?? null,
  };
}

/** Real WDPA records that are marine or coastal (the rest are terrestrial and irrelevant to hydrophone sites). */
export function marineWdpaRecords(protectedAreas) {
  return (protectedAreas || [])
    .filter((r) => r.realm === "Marine" || r.realm === "Coastal")
    .map(normaliseWdpaRecord);
}

// ---- Module 1 -> Module 4: acoustic classifier hint -------------------------------------------

const RECOMMENDED_COMPONENT_TO_AREA = {
  "propeller & shafting": "propeller",
  "main engine & mounts": "machinery",
  "operational speed": "operational",
  "hull biofouling": "hull",
};

/** Audit-area id for Module 1's `recommendedAuditComponent`; null for "None", empty or unrecognised values. */
export function auditAreaIdForRecommendedComponent(name) {
  const key = String(name ?? "")
    .trim()
    .toLowerCase();
  if (!key || key === "none") return null;
  return RECOMMENDED_COMPONENT_TO_AREA[key] ?? null;
}

// ---- USCG PSIX historical deficiency lookup ----------------------------------------------------

export function psixDatasetStats(psix) {
  const vessels = psix || [];
  return {
    vessels: vessels.length,
    inspections: vessels.reduce((n, v) => n + (v.inspections?.length || 0), 0),
    deficiencies: vessels.reduce((n, v) => n + (v.deficiencies?.length || 0), 0),
    operationalControls: vessels.reduce((n, v) => n + (v.operationalControls?.length || 0), 0),
  };
}

const normaliseName = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const digitsOnly = (s) => String(s ?? "").replace(/\D+/g, "");

/**
 * Vessels matching `query` by name (case/punctuation-insensitive substring) or IMO number (digits, optional
 * "IMO" prefix). Exact IMO matches rank first, then names that start with the query, then other matches.
 * An empty query returns every vessel, alphabetically.
 */
export function searchPsixVessels(psix, query) {
  const vessels = psix || [];
  const q = normaliseName(query);
  const qDigits = digitsOnly(query);
  if (!q) {
    return [...vessels].sort((a, b) => String(a.vesselName).localeCompare(String(b.vesselName)));
  }
  const imoQuery = /^(imo\s*)?\d+$/i.test(String(query).trim()) ? qDigits : "";
  const scored = [];
  for (const v of vessels) {
    const name = normaliseName(v.vesselName);
    const imo = String(v.imoNumber ?? "");
    let rank = null;
    if (imoQuery && imo === imoQuery) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else if (imoQuery && imo.includes(imoQuery)) rank = 3;
    if (rank !== null) scored.push({ v, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || String(a.v.vesselName).localeCompare(String(b.v.vesselName)))
    .map((s) => s.v);
}

/** Vessel by IMO number (accepts "IMO 9191228"); null when absent. */
export function findPsixVessel(psix, imo) {
  const wanted = digitsOnly(imo);
  if (!wanted) return null;
  return (psix || []).find((v) => String(v.imoNumber) === wanted) ?? null;
}

// First matching rule wins. Matches on the PSIX System / Subsystem text. A planning heuristic that only
// SUGGESTS an audit area: most PSIX deficiencies are general safety items with no URN relevance.
const PSIX_AREA_RULES = [
  { areaId: "propeller", test: (s) => /propeller|shafting/.test(s) },
  { areaId: "hull", test: (s) => /^construction\/loadline > hull$/.test(s) },
  { areaId: "propulsion", test: (s) => /thruster|diesel engine \(propulsion|steam turbine|steam boiler \(propulsion/.test(s) },
  {
    areaId: "machinery",
    test: (s) =>
      /diesel engine \(auxiliary|generator|engine controls|electric generation source|lubricating oil|sea-water system|freshwater system|compressed air/.test(
        s,
      ),
  },
];

/** Audit-area id suggested for a PSIX deficiency (`System`, `Subsystem`), or null when it has no URN link. */
export function suggestAuditAreaForDeficiency(def) {
  const key = `${def?.System ?? def?.system ?? ""} > ${def?.Subsystem ?? def?.subsystem ?? ""}`.toLowerCase();
  return PSIX_AREA_RULES.find((r) => r.test(key))?.areaId ?? null;
}

const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : null);

/** Clean display row for one PSIX deficiency. `deficiencyCode` is null in the source sheets, so it is optional. */
export function normalisePsixDeficiency(def, vessel) {
  return {
    key: `PSIX-${def.deficiencyId}`,
    deficiencyId: def.deficiencyId,
    activityId: def.activityId ?? null,
    deficiencyCode: def.deficiencyCode ?? null,
    system: def.System ?? null,
    subsystem: def.Subsystem ?? null,
    component: def.Component ?? null,
    deficiencyDescription: def["Deficiency Description"] ?? "",
    issuedDate: dateOnly(def.issuedDate),
    resolvedDate: dateOnly(def.resolvedDate),
    action: def.action ?? null,
    suggestedAreaId: suggestAuditAreaForDeficiency(def),
    vesselName: vessel?.vesselName ?? null,
    imoNumber: vessel?.imoNumber ?? null,
  };
}

/** Clean display row for one PSIX operational control (detention, no-sail or COTP order). */
export function normalisePsixControl(ctl, vessel) {
  return {
    key: `PSIX-CTRL-${ctl.activityId}-${String(ctl.type).replace(/\s+/g, "_")}`,
    activityId: ctl.activityId ?? null,
    type: ctl.type ?? null,
    category: ctl.category ?? null,
    reasonImposed: ctl.reasonImposed ?? null,
    dateImposed: dateOnly(ctl.dateImposed),
    dateRemoved: dateOnly(ctl.dateRemoved),
    suggestedAreaId: "operational",
    vesselName: vessel?.vesselName ?? null,
    imoNumber: vessel?.imoNumber ?? null,
  };
}

/** Full normalised profile for one PSIX vessel. */
export function buildPsixVesselProfile(vessel) {
  if (!vessel) return null;
  return {
    imoNumber: vessel.imoNumber,
    vesselName: vessel.vesselName,
    vesselType: vessel.vesselType,
    vesselClass: vessel.vesselClass,
    flag: vessel.flag,
    buildYear: vessel.buildYear ?? null,
    classSocieties: vessel.classSocieties || [],
    inspectionCount: vessel.inspections?.length || 0,
    deficiencies: (vessel.deficiencies || []).map((d) => normalisePsixDeficiency(d, vessel)),
    controls: (vessel.operationalControls || []).map((c) => normalisePsixControl(c, vessel)),
  };
}

const MAX_NOTE_CHARS = 2000;

const noteLine = (item) => {
  if (item.type !== undefined) {
    const when = item.dateImposed ? ` (${item.dateImposed})` : "";
    return `[${item.key}] USCG PSIX control — ${item.vesselName} (IMO ${item.imoNumber}): ${item.type}${item.category ? `, ${item.category}` : ""}${item.reasonImposed ? ` — ${item.reasonImposed}` : ""}${when}`;
  }
  const where = [item.system, item.subsystem, item.component].filter(Boolean).join(" / ");
  const when = item.issuedDate ? ` (${item.issuedDate})` : "";
  const text = String(item.deficiencyDescription || "")
    .replace(/\s+/g, " ")
    .trim();
  const short = text.length > 220 ? `${text.slice(0, 217)}...` : text;
  return `[${item.key}] USCG PSIX — ${item.vesselName} (IMO ${item.imoNumber}): ${where}${short ? `: ${short}` : ""}${when}`;
};

/** True when `area.inspectorNote` already contains the import marker for `item`. */
export const isPsixItemImported = (area, item) => String(area?.inspectorNote ?? "").includes(`[${item.key}]`);

/**
 * Appends PSIX findings to an audit area's inspector note. Existing note text is kept and findings already
 * imported (matched by their `[PSIX-…]` marker) are skipped. Returns { patch, added }; `patch` is null when
 * nothing new was added or the note would exceed the size limit.
 */
export function importPsixFindings(area, items) {
  const existing = String(area?.inspectorNote ?? "");
  const fresh = (items || []).filter((it) => !isPsixItemImported(area, it));
  if (!area || fresh.length === 0) return { patch: null, added: 0 };
  const next = [existing.trim(), ...fresh.map(noteLine)].filter(Boolean).join("\n");
  if (next.length > MAX_NOTE_CHARS) return { patch: null, added: 0, tooLong: true };
  return { patch: { inspectorNote: next }, added: fresh.length };
}

// ---------------------------------------------------------------------------------------------
// Phase 4: SHA-256 hash-chained CAPA verification log
// ---------------------------------------------------------------------------------------------

/** Genesis `previousHash` of every CAPA chain: 64 hex zeros (the width of a SHA-256 digest). */
export const GENESIS_HASH = "0".repeat(64);

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const utf8Bytes = (text) => new TextEncoder().encode(String(text));
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Synchronous, dependency-free SHA-256 of a UTF-8 string, returned as 64 lowercase hex characters.
 * Chain creation has to be synchronous (CAPA transitions are plain reducers and the Node tests run without
 * await), and `crypto.subtle` is async-only, so the chain is built with this implementation. The test suite
 * cross-checks it against Node's `crypto.createHash('sha256')`; `sha256HexAsync` cross-checks it in the
 * browser against Web Crypto.
 */
export function sha256Hex(text) {
  const msg = utf8Bytes(text);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array((((msg.length + 9 + 63) >> 6) << 6));
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

/** SHA-256 through Web Crypto (`crypto.subtle.digest`) when available, else the synchronous implementation. */
export async function sha256HexAsync(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256Hex(text);
  const digest = await subtle.digest("SHA-256", utf8Bytes(text));
  return toHex(new Uint8Array(digest));
}

/** Stable event id for a stage transition, e.g. CAPA-2026-041-EVT-07. */
export const capaEventId = (capaId, toStage) =>
  `${capaId}-EVT-${String(toStage).padStart(2, "0")}`;

/**
 * Canonical string that a record hash covers. Field order is fixed and values are JSON-encoded, so the same
 * record always hashes the same and any change to a covered field changes the hash.
 */
export function canonicalAuditPayload(capaId, record) {
  return JSON.stringify([
    capaId,
    record.eventId,
    record.previousHash,
    record.timestamp,
    record.auditorName ?? null,
    record.accreditationId ?? null,
    record.fromStage,
    record.toStage,
    record.evidence ?? [],
    record.note ?? "",
    record.measuredReductionDb ?? null,
  ]);
}

export const SIGNER_ROLE_FIELD_AUDITOR = "Field Auditor";
export const SIGNER_ROLE_INDEPENDENT_REVIEWER = "Independent Reviewer";
/** First stage transition (into stage 7) that needs an independent reviewer / port authority sign-off. */
export const FIRST_REVIEWER_STAGE = 7;

/** Role required to sign a transition INTO `toStage`: Stages 1-6 Field Auditor, Stages 7-8 Independent Reviewer. */
export const requiredSignerRole = (toStage) =>
  toStage >= FIRST_REVIEWER_STAGE ? SIGNER_ROLE_INDEPENDENT_REVIEWER : SIGNER_ROLE_FIELD_AUDITOR;

/**
 * Deterministic attestation: SHA-256 over eventId + recordHash + signerRole + accreditationId.
 * Fields are joined with "|" and a missing accreditationId is the empty string.
 */
export function computeAttestationSignature({ eventId, recordHash, signerRole, accreditationId }) {
  return sha256Hex([eventId, recordHash, signerRole, accreditationId ?? ""].join("|"));
}

/**
 * Adds eventId, timestamp, previousHash and recordHash to a transition record. Pure.
 * When the record carries a `signerRole`, it also gets an `attestationSignature` that binds the role and
 * accreditation id to the record hash. The attestation is computed AFTER recordHash and is not part of the
 * hashed payload, so entries without a role (legacy / Phase 4) hash and verify exactly as before.
 */
export function sealAuditRecord(capaId, record, previousHash = GENESIS_HASH) {
  const sealed = {
    ...record,
    eventId: capaEventId(capaId, record.toStage),
    timestamp: record.timestamp ?? record.at,
    previousHash,
  };
  const recordHash = sha256Hex(canonicalAuditPayload(capaId, sealed));
  const out = { ...sealed, recordHash };
  if (record.signerRole) {
    out.attestationSignature = computeAttestationSignature({
      eventId: out.eventId,
      recordHash,
      signerRole: record.signerRole,
      accreditationId: record.accreditationId,
    });
  }
  return out;
}

/** True when an entry's attestationSignature matches its eventId, recordHash, signerRole and accreditationId. Null if unattested. */
export function verifyAttestation(entry) {
  if (!entry?.attestationSignature) return null;
  return (
    computeAttestationSignature({
      eventId: entry.eventId,
      recordHash: entry.recordHash,
      signerRole: entry.signerRole,
      accreditationId: entry.accreditationId,
    }) === entry.attestationSignature
  );
}

/** `recordHash` of the newest hashed entry, or the genesis hash for an empty or fully legacy history. */
export function lastRecordHash(history = []) {
  for (let i = history.length - 1; i >= 0; i--) if (history[i]?.recordHash) return history[i].recordHash;
  return GENESIS_HASH;
}

/** Shortened hash for display: first 8 and last 6 characters. */
export const truncateHash = (hash, head = 8, tail = 6) =>
  !hash || hash.length <= head + tail + 1 ? hash || "" : `${hash.slice(0, head)}…${hash.slice(-tail)}`;

/**
 * Recomputes a CAPA's chain. Entries recorded before Phase 4 carry no hash and are reported as `legacyCount`
 * (they cannot be verified) rather than failing the chain. Each hashed entry must (1) link to the previous
 * hashed entry's recordHash (genesis for the first) and (2) match the hash of its own contents.
 * Returns { valid, checked, legacyCount, headHash, brokenAt (index | null), reason (string | null),
 * entries: [{ index, linkOk, hashOk }] }.
 */
export function verifyAuditChain(capaId, history = []) {
  let expectedPrev = GENESIS_HASH;
  let checked = 0;
  let legacyCount = 0;
  let brokenAt = null;
  let reason = null;
  const entries = [];
  history.forEach((entry, index) => {
    if (!entry?.recordHash) {
      legacyCount += 1;
      entries.push({ index, linkOk: null, hashOk: null });
      return;
    }
    const linkOk = entry.previousHash === expectedPrev;
    const hashOk = sha256Hex(canonicalAuditPayload(capaId, entry)) === entry.recordHash;
    entries.push({ index, linkOk, hashOk });
    checked += 1;
    if (brokenAt === null && !linkOk) {
      brokenAt = index;
      reason = `Entry ${index + 1} does not link to the previous record.`;
    } else if (brokenAt === null && !hashOk) {
      brokenAt = index;
      reason = `Entry ${index + 1} contents do not match its recorded hash.`;
    }
    expectedPrev = entry.recordHash;
  });
  return {
    valid: brokenAt === null,
    checked,
    legacyCount,
    headHash: lastRecordHash(history),
    brokenAt,
    reason,
    entries,
  };
}

/** Same check as verifyAuditChain, but hashing through Web Crypto; resolves true when every hash matches. */
export async function verifyAuditChainAsync(capaId, history = []) {
  let prev = GENESIS_HASH;
  for (const entry of history) {
    if (!entry?.recordHash) continue;
    if (entry.previousHash !== prev) return false;
    if ((await sha256HexAsync(canonicalAuditPayload(capaId, entry))) !== entry.recordHash) return false;
    prev = entry.recordHash;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Phase 4: Port & URN tariff selection and rebate calculation (INGESTED_PORTS)
// ---------------------------------------------------------------------------------------------

/** Default gross tonnage when a vessel record has neither `grossTonnage` nor `dwt` (a mid-size merchant ship). */
export const DEFAULT_GROSS_TONNAGE = 40000;

/**
 * Gross tonnage for a vessel: its own `grossTonnage`, else an estimate of 0.55 x deadweight (typical for bulk
 * carriers and tankers; an assumption, so `source` says which was used), else DEFAULT_GROSS_TONNAGE.
 */
export function defaultGrossTonnage(vessel) {
  const gt = Number(vessel?.grossTonnage);
  if (gt > 0) return { value: Math.round(gt), source: "vessel record" };
  const dwt = Number(vessel?.dwt);
  if (dwt > 0) return { value: Math.round(dwt * 0.55), source: "estimated from deadweight (0.55 x DWT)" };
  return { value: DEFAULT_GROSS_TONNAGE, source: "default merchant-ship reference" };
}

/** A port is eligible when it publishes an incentive programme with at least one valid rebate tier. */
export function isPortEligible(port) {
  return (
    Boolean(port?.ecoIncentiveProgramName) &&
    Array.isArray(port?.rebateTiers) &&
    port.rebateTiers.length > 0 &&
    Number.isFinite(port.lat) &&
    Number.isFinite(port.lon)
  );
}

/**
 * Every port with its great-circle distance (km) from `origin`, nearest first. Without a usable origin the
 * distance is null and the original order is kept. Does not read `worldPortIndex` (null for all ingested ports).
 */
export function rankPortsByDistance(ports, origin) {
  const hasOrigin = Number.isFinite(origin?.lat) && Number.isFinite(origin?.lon);
  const rows = (ports || []).map((port, i) => ({
    port,
    eligible: isPortEligible(port),
    distanceKm: hasOrigin && Number.isFinite(port.lat) && Number.isFinite(port.lon) ? round2(haversineKm(origin, port)) : null,
    i,
  }));
  return rows
    .sort((a, b) =>
      a.distanceKm === null || b.distanceKm === null ? a.i - b.i : a.distanceKm - b.distanceKm || a.i - b.i,
    )
    .map(({ i, ...row }) => row);
}

/** Nearest eligible port to `origin` as { port, distanceKm }, or null when there is no origin or no eligible port. */
export function recommendNearestPort(ports, origin) {
  const best = rankPortsByDistance(ports, origin).find((r) => r.eligible && r.distanceKm !== null);
  return best ? { port: best.port, distanceKm: best.distanceKm } : null;
}

/** Highest tier whose minDbReduction the verified reduction reaches; null when below the lowest tier. */
export function matchRebateTier(port, verifiedDbReduction) {
  const db = Number(verifiedDbReduction);
  if (!Number.isFinite(db)) return null;
  const reached = (port?.rebateTiers || []).filter((t) => db >= t.minDbReduction);
  return reached.length ? reached.reduce((a, b) => (b.minDbReduction > a.minDbReduction ? b : a)) : null;
}

/**
 * Estimated port-dues rebate for one call: dues = grossTonnage x basePortDuesUsdPerGt; rebate = dues x tier percent,
 * limited to the tier's maxCapUsd. Also reports the next tier and the dB still needed. Decision support only.
 */
export function calculatePortRebate({ port, grossTonnage, verifiedDbReduction } = {}) {
  const gt = Number(grossTonnage);
  const db = Number(verifiedDbReduction) || 0;
  const validGt = gt > 0 ? gt : 0;
  const duesUsd = round2(validGt * (Number(port?.basePortDuesUsdPerGt) || 0));
  const tier = matchRebateTier(port, db);
  const uncapped = tier ? round2((duesUsd * tier.rebatePercent) / 100) : 0;
  const rebateUsd = tier ? Math.min(uncapped, tier.maxCapUsd) : 0;
  const sorted = [...(port?.rebateTiers || [])].sort((a, b) => a.minDbReduction - b.minDbReduction);
  const next = sorted.find((t) => t.minDbReduction > db) ?? null;
  return {
    grossTonnage: validGt,
    verifiedDbReduction: round1(db),
    duesUsd,
    tier,
    rebatePercent: tier ? tier.rebatePercent : 0,
    capApplied: Boolean(tier) && uncapped > tier.maxCapUsd,
    rebateUsd: round2(rebateUsd),
    netDuesUsd: round2(duesUsd - rebateUsd),
    nextTier: next,
    dbToNextTier: next ? round1(next.minDbReduction - db) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Government & Port Authority aggregate view
// ---------------------------------------------------------------------------------------------

/**
 * Fleet-level roll-up for authorities. Pure.
 *  - auditedVesselsCount: distinct vessels (by IMO) with a corrective action. Audit areas carry no vessel id,
 *    so when no CAPA exists yet but the current audit has areas, that one audit counts as 1 vessel.
 *  - verifiedCapasCount: CAPAs at Stage >= 7 with a verified reduction > 0 dB.
 *  - meanVerifiedDbReduction: mean of those verified reductions, 1 decimal; null when none.
 *  - activePortSchemesCount: ports that publish an eco-incentive programme with at least one rebate tier.
 */
export function computeAuthorityAggregateMetrics(correctiveActions = [], auditAreas = [], ports = []) {
  const capas = Array.isArray(correctiveActions) ? correctiveActions : [];
  const imos = new Set(capas.map((c) => c?.vesselImo).filter(Boolean));
  const auditedVesselsCount =
    imos.size > 0 ? imos.size : Array.isArray(auditAreas) && auditAreas.length > 0 ? 1 : 0;

  const verified = capas.filter((c) => c?.currentStage >= 7 && c?.verifiedReductionDb > 0);
  const meanVerifiedDbReduction = verified.length
    ? Math.round((verified.reduce((sum, c) => sum + c.verifiedReductionDb, 0) / verified.length) * 10) / 10
    : null;

  const activePortSchemesCount = (Array.isArray(ports) ? ports : []).filter(
    (p) => p?.ecoIncentiveProgramName && Array.isArray(p.rebateTiers) && p.rebateTiers.length > 0,
  ).length;

  return {
    auditedVesselsCount,
    verifiedCapasCount: verified.length,
    meanVerifiedDbReduction,
    activePortSchemesCount,
  };
}
