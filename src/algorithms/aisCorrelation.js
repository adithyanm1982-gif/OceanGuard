const VESSEL_CLASS_WEIGHTS = {
  "Bulk Carrier": 0.92,
  "Container Ship": 0.95,
  "Chemical/Products Tanker": 0.86,
  "Crude Oil Tanker": 0.88,
  "Commercial Trawler": 0.65,
  "Passenger / Ro-Ro": 0.8,
};

/** Fallback class weight for vessel-type labels outside VESSEL_CLASS_WEIGHTS (ingested datasets). */
function classWeightFor(vesselType) {
  if (VESSEL_CLASS_WEIGHTS[vesselType] !== undefined) return VESSEL_CLASS_WEIGHTS[vesselType];
  const t = String(vesselType || "").toLowerCase();
  if (/container|bulk|cargo/.test(t)) return 0.9;
  if (/tanker/.test(t)) return 0.87;
  if (/passenger|ferry|ro-ro/.test(t)) return 0.8;
  if (/fishing|trawler/.test(t)) return 0.65;
  if (/tug|tow/.test(t)) return 0.6;
  return 0.7;
}

export function rankCandidateVessels(vessels, acousticEvent, maxRadiusKm = 5.0) {
  const eventIntensityFactor = Math.min(
    1.15,
    Math.max(0.75, (acousticEvent?.deltaAboveAmbient || 20) / 25),
  );

  return vessels
    .filter((v) => v.cpaDistanceKm <= maxRadiusKm)
    .map((vessel) => {
      const proximityScore = Math.exp(-0.42 * vessel.cpaDistanceKm);
      const hasDesign = Number.isFinite(vessel.designSpeedKnots) && vessel.designSpeedKnots > 0;
      const speedRatio = vessel.observedSpeedKnots / Math.max(1, vessel.designSpeedKnots);
      let cavitationScore = !hasDesign
        ? 0.3
        : speedRatio > 1.0
          ? Math.min(1.0, 0.65 + (speedRatio - 1.0) * 1.8)
          : Math.max(0.15, speedRatio * 0.6);
      // A statistical SOG spike (or an over-design flag) raises the cavitation evidence to at least 0.6.
      if (vessel.speedAnomaly?.flagged) cavitationScore = Math.max(cavitationScore, 0.6);
      const timePenalty = Math.exp(-Math.abs(vessel.timeOffsetSec) / 120);
      const temporalScore = vessel.overlapRatio * timePenalty;
      const classWeight = classWeightFor(vessel.vesselType);

      const rawWeighted =
        proximityScore * 0.4 + cavitationScore * 0.3 + temporalScore * 0.2 + classWeight * 0.1;

      const confidencePct = Math.min(
        93,
        Math.max(12, Math.round(rawWeighted * eventIntensityFactor * 100)),
      );

      let attributionTier = "Low / Background Contributor";
      if (confidencePct >= 72) attributionTier = "High Candidate Contributor";
      else if (confidencePct >= 45) attributionTier = "Moderate Candidate Contributor";

      return {
        ...vessel,
        confidencePct,
        attributionTier,
        subScores: {
          proximityPct: Math.round(proximityScore * 100),
          cavitationPct: Math.round(cavitationScore * 100),
          temporalPct: Math.round(temporalScore * 100),
          classPct: Math.round(classWeight * 100),
        },
      };
    })
    .sort((a, b) => b.confidencePct - a.confidencePct);
}

// ---------------------------------------------------------------------------------------------
// Phase 2: region-key mapping, Haversine geometry, speed-anomaly detection, dataset builders.
// All functions are pure (datasets are passed in) so they run under `node --test`.
// ---------------------------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** App region ids (REGIONS in mockDatasets) that differ from the CO_LOCATED_SCENARIOS keys. */
export const APP_TO_SCENARIO_KEY = { noaa: "stellwagen" };
export const SCENARIO_TO_APP_KEY = { stellwagen: "noaa" };

/** "noaa" -> "stellwagen"; any other id passes through unchanged. Idempotent. */
export const toScenarioKey = (regionId) => APP_TO_SCENARIO_KEY[regionId] ?? regionId;
/** "stellwagen" -> "noaa"; any other id passes through unchanged. Idempotent. */
export const toAppRegionId = (scenarioKey) => SCENARIO_TO_APP_KEY[scenarioKey] ?? scenarioKey;

/** Scenario block for an app region id (or scenario key); null when none exists. */
export function scenarioForRegion(scenarios, regionId) {
  return scenarios?.[toScenarioKey(regionId)] ?? null;
}

/** Great-circle distance in km between two { lat, lon } points (Haversine, mean Earth radius). */
export function haversineDistanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle compass bearing (0 = N, clockwise) from `from` to `to`, in [0, 360). */
export function initialBearingDeg(from, to) {
  const phi1 = toRad(from.lat);
  const phi2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Population z-scores. A std below `minStd` is floored so near-constant series do not produce huge z. */
export function zScores(values, minStd = 0) {
  if (!values.length) return { mean: 0, std: 0, z: [] };
  const m = mean(values);
  const std = Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
  const denom = Math.max(std, minStd, 1e-9);
  return { mean: m, std, z: values.map((v) => (v - m) / denom) };
}

export const SOG_Z_THRESHOLD = 2.5;
export const SOG_MIN_STD_KNOTS = 0.5;

/**
 * Flags SOG spikes across a track: points whose z-score vs the track's own SOG distribution is >= threshold
 * (positive direction only: a speed-up). std is floored at SOG_MIN_STD_KNOTS so a 0.1 kn wobble on a steady
 * track is not called a spike.
 */
export function detectSogSpikes(track, { zThreshold = SOG_Z_THRESHOLD, minStd = SOG_MIN_STD_KNOTS } = {}) {
  const pts = (track || []).filter((p) => Number.isFinite(p?.sogKnots));
  if (pts.length < 3) return { flagged: false, maxZ: 0, meanSog: null, stdSog: null, spikes: [], n: pts.length };
  const { mean: m, std, z } = zScores(
    pts.map((p) => p.sogKnots),
    minStd,
  );
  const spikes = pts
    .map((p, index) => ({ index, timestamp: p.timestamp, sogKnots: p.sogKnots, z: z[index] }))
    .filter((p) => p.z >= zThreshold);
  return {
    flagged: spikes.length > 0,
    maxZ: Number(Math.max(...z).toFixed(2)),
    meanSog: Number(m.toFixed(2)),
    stdSog: Number(std.toFixed(2)),
    spikes,
    n: pts.length,
  };
}

/**
 * Speed-anomaly assessment for one vessel.
 *  - overDesign: observedSogKnots > designSpeedKnots (only when a design speed is known)
 *  - spike: statistical SOG z-score spike across `track` points (only when a track is supplied)
 */
export function assessSpeedAnomaly({ observedSogKnots, designSpeedKnots, track } = {}, opts) {
  const hasDesign = Number.isFinite(designSpeedKnots) && designSpeedKnots > 0;
  const overDesign = {
    flagged: hasDesign && Number.isFinite(observedSogKnots) && observedSogKnots > designSpeedKnots,
    excessKnots:
      hasDesign && Number.isFinite(observedSogKnots)
        ? Number((observedSogKnots - designSpeedKnots).toFixed(2))
        : null,
    ratio:
      hasDesign && Number.isFinite(observedSogKnots)
        ? Number((observedSogKnots / designSpeedKnots).toFixed(3))
        : null,
  };
  const spike = track ? detectSogSpikes(track, opts) : null;
  const reasons = [];
  if (overDesign.flagged) reasons.push("over-design-speed");
  if (spike?.flagged) reasons.push("sog-zscore-spike");
  return { flagged: reasons.length > 0, reasons, overDesign, spike };
}

/** Typical transit speed by AIS ship-type code. An ASSUMPTION used only where a record has no design speed. */
export function referenceSpeedForAisType(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return null;
  if (c >= 70 && c <= 79) return 14;
  if (c >= 80 && c <= 89) return 13;
  if (c >= 60 && c <= 69) return 18;
  if (c === 30) return 10;
  if (c === 31 || c === 32 || c === 52) return 10;
  if (c === 33 || c === 34 || c === 36) return 8;
  if (c === 37) return 15;
  if (c === 50) return 18;
  if (c >= 90 && c <= 99) return 12;
  return null;
}

export function aisTypeLabel(code) {
  const c = Number(code);
  if (c >= 70 && c <= 79) return `Cargo (AIS ${c})`;
  if (c >= 80 && c <= 89) return `Tanker (AIS ${c})`;
  if (c >= 60 && c <= 69) return `Passenger (AIS ${c})`;
  if (c === 30) return "Fishing vessel";
  if (c === 31 || c === 32) return "Towing vessel";
  if (c === 52) return "Tug";
  if (c === 50) return "Pilot vessel";
  if (c === 36) return "Sailing vessel";
  if (c === 37) return "Pleasure craft";
  return Number.isFinite(c) ? `Other (AIS ${c})` : "Unknown";
}

const placement = (anchor, point) => ({
  cpaDistanceKm: Number(haversineDistanceKm(anchor, point).toFixed(3)),
  bearingDeg: Math.round(initialBearingDeg(anchor, point)) % 360,
});

function speedEvidence(anomaly, observed, design, designBasis) {
  const out = [];
  if (anomaly.overDesign.flagged)
    out.push(
      `SOG ${observed} kn exceeds ${designBasis} ${design} kn by ${anomaly.overDesign.excessKnots} kn, raising cavitation likelihood.`,
    );
  if (anomaly.spike?.flagged)
    out.push(
      `SOG z-score spike (max z = ${anomaly.spike.maxZ}) across ${anomaly.spike.n} track points; track mean ${anomaly.spike.meanSog} kn.`,
    );
  return out;
}

const offsetSec = (ts, ref) => {
  const a = Date.parse(ts);
  const b = Date.parse(ref);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / 1000) : null;
};
const overlapFromOffset = (off) =>
  off === null ? 0.5 : Math.min(1, Math.max(0.2, 1 - Math.abs(off) / 900));

/** Co-located regional scenario vessels, placed by Haversine distance/bearing from the scenario hydrophone. */
export function buildScenarioVessels(scenario, { regionId, referenceTimestamp } = {}) {
  if (!scenario?.hydrophone) return { anchor: null, vessels: [] };
  const anchor = {
    id: scenario.hydrophone.id,
    name: scenario.hydrophone.name,
    lat: scenario.hydrophone.lat,
    lon: scenario.hydrophone.lon,
  };
  const vessels = (scenario.aisVessels || []).map((v) => {
    const place = placement(anchor, v);
    const off = offsetSec(v.timestamp, referenceTimestamp);
    const speedAnomaly = assessSpeedAnomaly({
      observedSogKnots: v.observedSogKnots,
      designSpeedKnots: v.designSpeedKnots,
    });
    return {
      mmsi: v.mmsi,
      region: regionId ?? null,
      imo: v.imo,
      name: v.vesselName,
      flag: v.flag,
      vesselType: v.vesselType,
      lengthM: v.lengthM,
      dwt: null,
      navStatus: "Under Way (scenario)",
      designSpeedKnots: v.designSpeedKnots,
      designSpeedBasis: "scenario design speed",
      observedSpeedKnots: v.observedSogKnots,
      observedSogKnots: v.observedSogKnots,
      courseDeg: v.cogDeg,
      lat: v.lat,
      lon: v.lon,
      timeOffsetSec: off,
      overlapRatio: overlapFromOffset(off),
      speedAnomaly,
      source: "co-located",
      synthetic: true,
      ...place,
      evidence: [
        `Haversine distance ${place.cpaDistanceKm} km at bearing ${place.bearingDeg}° from ${anchor.id}.`,
        ...speedEvidence(speedAnomaly, v.observedSogKnots, v.designSpeedKnots, "design speed"),
        "Synthetic scenario record: not live AIS and not compliance evidence.",
      ],
    };
  });
  return { anchor, vessels };
}

/** USCG MarineCadastre position reports; one report per MMSI, placed relative to `anchor`. */
export function buildMarineCadastreVessels(records, anchor, { regionId } = {}) {
  const seen = new Set();
  const vessels = [];
  for (const r of records || []) {
    if (seen.has(r.mmsi) || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    seen.add(r.mmsi);
    const design = referenceSpeedForAisType(r.vesselTypeCode);
    const speedAnomaly = assessSpeedAnomaly({ observedSogKnots: r.sogKnots, designSpeedKnots: design });
    const place = placement(anchor, r);
    vessels.push({
      mmsi: r.mmsi,
      region: regionId ?? null,
      imo: r.imo ?? `MMSI ${r.mmsi}`,
      name: r.vesselName || `MMSI ${r.mmsi}`,
      flag: null,
      vesselType: aisTypeLabel(r.vesselTypeCode),
      lengthM: r.lengthM,
      dwt: null,
      navStatus: r.navStatusCode === null || r.navStatusCode === undefined ? "Not reported" : `AIS nav status ${r.navStatusCode}`,
      designSpeedKnots: design,
      designSpeedBasis: "assumed AIS ship-type reference speed",
      observedSpeedKnots: r.sogKnots,
      observedSogKnots: r.sogKnots,
      courseDeg: r.cogDeg,
      lat: r.lat,
      lon: r.lon,
      timeOffsetSec: null,
      overlapRatio: 0.5,
      speedAnomaly,
      source: "usMarineCadastre",
      ...place,
      evidence: [
        `Haversine distance ${place.cpaDistanceKm} km at bearing ${place.bearingDeg}° from the reference position.`,
        ...speedEvidence(speedAnomaly, r.sogKnots, design, "assumed type-reference speed"),
        `Historical report (${r.timestamp}); not time-aligned with the acoustic event.`,
      ],
    });
  }
  return { anchor, vessels };
}

/** Centroid of every track point: the virtual station used to anchor the CSJ tracks. */
export function trackCentroid(tracks) {
  const pts = (tracks || []).flatMap((t) => t.track || []);
  if (!pts.length) return null;
  return {
    id: "CSJ-VIRTUAL-STATION",
    name: "Centroid of CSJ track points (virtual reference station)",
    lat: Number(mean(pts.map((p) => p.lat)).toFixed(5)),
    lon: Number(mean(pts.map((p) => p.lon)).toFixed(5)),
  };
}

/** CSJ tracks: CPA = closest track point (Haversine); SOG z-score spike detection over the track. */
export function buildCsjVessels(tracks, anchor, { regionId } = {}) {
  const vessels = [];
  for (const t of tracks || []) {
    const pts = (t.track || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (!pts.length) continue;
    let best = pts[0];
    let bestD = Infinity;
    for (const p of pts) {
      const d = haversineDistanceKm(anchor, p);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    const speedAnomaly = assessSpeedAnomaly({ observedSogKnots: best.sogKnots, track: pts });
    const place = placement(anchor, best);
    vessels.push({
      mmsi: t.vesselId,
      region: regionId ?? null,
      imo: t.vesselId,
      name: t.vesselId,
      flag: null,
      vesselType: "Unclassified (CSJ track)",
      lengthM: null,
      dwt: null,
      navStatus: "Track (no nav status)",
      designSpeedKnots: null,
      designSpeedBasis: "unknown",
      observedSpeedKnots: best.sogKnots,
      observedSogKnots: best.sogKnots,
      courseDeg: best.cogDeg,
      lat: best.lat,
      lon: best.lon,
      timeOffsetSec: null,
      overlapRatio: 0.5,
      speedAnomaly,
      source: "csjTracks",
      trackPoints: pts.length,
      ...place,
      evidence: [
        `Closest of ${pts.length} track points is ${place.cpaDistanceKm} km (Haversine) at bearing ${place.bearingDeg}° from the virtual station.`,
        ...speedEvidence(speedAnomaly, best.sogKnots, null, ""),
        `Historical track (${t.startTime}); not time-aligned with the acoustic event.`,
      ],
    });
  }
  return { anchor, vessels };
}
