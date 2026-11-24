import {
  ACOUSTIC_PRESETS,
  AIS_CANDIDATE_VESSELS,
  CAPA_8_STAGES,
  CAPA_EVIDENCE_OPTIONS,
  INITIAL_AUDIT_AREAS,
  MARINE_SENSITIVE_ZONES,
  OBIS_SPECIES_RECORDS,
  ONE_THIRD_OCTAVE_BANDS,
  REGIONS,
} from "../data/mockDatasets.js";
import {
  CO_LOCATED_SCENARIOS,
  CO_LOCATED_SCENARIOS_META,
  INGESTED_AIS_LOGS,
  INGESTED_AUDIO_PROFILES,
  INGESTED_BIODIVERSITY,
  INGESTED_PORTS,
  INGESTED_USCG_PSIX,
} from "../data/ingestedDatasets.js";
import {
  buildCsjVessels,
  buildMarineCadastreVessels,
  buildScenarioVessels,
  rankCandidateVessels,
  scenarioForRegion,
  toScenarioKey,
  trackCentroid,
} from "../algorithms/aisCorrelation.js";
import {
  advanceCapaStage,
  buildCorrectiveAction,
  buildPsixVesselProfile,
  evaluateProtectedAreaIntrusion,
  findPsixVessel,
  marineWdpaRecords,
  nearestBiodiversityOccurrences,
  psixDatasetStats,
  searchPsixVessels,
  calculateIncentiveEligibility,
  calculatePortRebate,
  defaultGrossTonnage,
  rankPortsByDistance,
  recommendNearestPort,
  verifyAuditChain,
  verifyAuditChainAsync,
  evaluateEcologicalOverlap,
  evaluateShipAudit,
  estimateCapaTargetReductionDb,
  resolveEventRegion,
  selectRegionalContext,
  validateStageAdvance,
} from "../algorithms/ecologicalAndAudit.js";
import { estimateAcousticFootprintKm } from "../algorithms/geometry.js";
import {
  analyzeAudioFile,
  analyzeIngestedWav,
  synthesizePresetMatrices,
} from "../algorithms/signalProcessing.js";
import { buildComplianceDossierReport, renderComplianceDossierHtml } from "../algorithms/reportExport.js";

export async function getAcousticPresets() {
  return ACOUSTIC_PRESETS.map((preset) => ({
    ...preset,
    ...synthesizePresetMatrices(preset),
  }));
}

export async function getCandidateVesselRecords() {
  return AIS_CANDIDATE_VESSELS.map((vessel) => ({ ...vessel }));
}

export async function getCandidateVessels(
  event,
  radiusKm = 5,
  vesselRecords = AIS_CANDIDATE_VESSELS,
) {
  const regionId = resolveEventRegion(event);
  if (!event || !regionId) return [];

  const regionalVessels = vesselRecords.filter((vessel) => vessel.region === regionId);
  return rankCandidateVessels(regionalVessels, event, radiusKm);
}

export async function getRegionalEcology(event) {
  const regional = selectRegionalContext(event, MARINE_SENSITIVE_ZONES, OBIS_SPECIES_RECORDS);
  const footprintKm = estimateAcousticFootprintKm(event);
  const assessment = regional.regionId
    ? evaluateEcologicalOverlap(
        event,
        regional.zones,
        regional.species,
        footprintKm ?? 0,
        regional.regionId,
      )
    : null;

  return { ...regional, footprintKm, assessment };
}

export async function getAuditBaseline() {
  return INITIAL_AUDIT_AREAS.map((area) => ({ ...area }));
}

export async function getCapaWorkflowCatalog() {
  return {
    stages: CAPA_8_STAGES.map((stage) => ({ ...stage })),
    evidenceOptions: CAPA_EVIDENCE_OPTIONS.map((option) => ({
      ...option,
      suggestedFor: [...option.suggestedFor],
    })),
    octaveBands: ONE_THIRD_OCTAVE_BANDS.map((band) => ({ ...band })),
    finalStage: 8,
  };
}

export async function calculateAuditSummary(auditAreas, vessel) {
  return evaluateShipAudit(auditAreas, vessel);
}

export async function calculateCapaTargets(auditAreas, vessel, event) {
  return Object.fromEntries(
    auditAreas.map((area) => [area.id, estimateCapaTargetReductionDb(area, vessel, event)]),
  );
}

export async function createCorrectiveAction(input) {
  return buildCorrectiveAction(input);
}

export async function submitCapaTransition(capaId, input, correctiveActions, auditor) {
  const capa = correctiveActions.find((action) => action.id === capaId);
  return advanceCapaStage(capa, input, auditor);
}

export async function validateCapaTransition(capa, input, auditor) {
  return validateStageAdvance(capa, input, auditor);
}

export async function calculateIncentives(
  correctiveActions,
  auditScore,
  basePortCallFeeUsd = 48000,
) {
  return calculateIncentiveEligibility(correctiveActions, auditScore, basePortCallFeeUsd);
}

export async function analyzeAcousticRecording(file, isCalibrated, sensitivityDb, deployment) {
  return analyzeAudioFile(file, isCalibrated, sensitivityDb, deployment);
}

export function retainVesselForEvent(vessel, event, vesselRecords = AIS_CANDIDATE_VESSELS) {
  if (!vessel) return null;
  const eventRegion = resolveEventRegion(event);
  const storedVessel = vesselRecords.find((candidate) => candidate.mmsi === vessel.mmsi);
  const vesselRegion = vessel.region ?? storedVessel?.region;

  if (!eventRegion || !vesselRegion) return null;
  return vesselRegion === eventRegion ? { ...vessel, region: vesselRegion } : null;
}

export async function getRegions() {
  return REGIONS.map((region) => ({ ...region, coords: { ...region.coords } }));
}

// TODO: Connect FastAPI/PostGIS endpoint (replace the bundled ingested datasets with a backend query)
export async function getIngestedDatasets() {
  return structuredClone({
    audioProfiles: INGESTED_AUDIO_PROFILES,
    aisLogs: INGESTED_AIS_LOGS,
    biodiversity: INGESTED_BIODIVERSITY,
    uscgPsix: INGESTED_USCG_PSIX,
    ports: INGESTED_PORTS,
  });
}

// TODO: Connect FastAPI/PostGIS endpoint (co-located hydrophone, MPA polygon and AIS scenarios per region)
export async function getCoLocatedScenarios() {
  return structuredClone(CO_LOCATED_SCENARIOS);
}

// ---------------------------------------------------------------------------------------------
// Phase 2
// ---------------------------------------------------------------------------------------------

/** The 16 ingested WAV profiles (DS3500 + ShipsEar), in file order. */
export async function getIngestedAudioProfiles() {
  return structuredClone(INGESTED_AUDIO_PROFILES);
}

/**
 * Fetches a profile's real `audioUrl`, decodes the bytes in signalProcessing.js and returns the acoustic event
 * (real STFT spectrogram, RMS, spectral centroid + the profile's classification metadata).
 * `deployment` = { region, stationId, coords } places the recording in an app region ("noaa", not "stellwagen").
 */
export async function analyzeIngestedAudio(profile, deployment = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(profile.audioUrl);
  if (!response.ok) throw new Error(`Could not load ${profile.audioUrl} (HTTP ${response.status})`);
  const arrayBuffer = await response.arrayBuffer();
  return analyzeIngestedWav(profile, arrayBuffer, deployment);
}

export const AIS_DATASET_MODES = { REGIONAL: "colocated", REAL: "real" };
export const REAL_AIS_SOURCES = { USCG: "usMarineCadastre", CSJ: "csjTracks" };

/** Radar radius choices (km) and default for a vessel dataset configuration. */
export function radiusConfigFor(mode, source) {
  if (mode !== AIS_DATASET_MODES.REAL) return { options: [2.5, 5, 10], defaultKm: 5 };
  return source === REAL_AIS_SOURCES.CSJ
    ? { options: [10, 25, 50, 100], defaultKm: 50 }
    : { options: [100, 250, 500, 1000], defaultKm: 250 };
}

/**
 * Vessel dataset for Module 2, ranked and placed by Haversine distance/bearing from the dataset's anchor.
 *  - mode "colocated": CO_LOCATED_SCENARIOS for the event's region ("noaa" resolves to the "stellwagen" key),
 *    anchored on the scenario hydrophone.
 *  - mode "real": INGESTED_AIS_LOGS. USCG MarineCadastre is anchored on the event's station position;
 *    CSJ tracks are anchored on the centroid of their own points (they are in a different ocean to every station).
 * Returns { anchor, vessels (ranked, within radius), totalCount, nearestKm, regionId, scenarioKey, notice }.
 */
export async function getVesselDataset({
  event,
  mode = AIS_DATASET_MODES.REGIONAL,
  source = REAL_AIS_SOURCES.USCG,
  radiusKm,
}) {
  const regionId = resolveEventRegion(event);
  if (!event || !regionId) return { anchor: null, vessels: [], totalCount: 0, nearestKm: null, regionId: null };
  const scenarioKey = toScenarioKey(regionId);
  const scenario = scenarioForRegion(CO_LOCATED_SCENARIOS, regionId);
  const radius = radiusKm ?? radiusConfigFor(mode, source).defaultKm;

  let built;
  let notice;
  if (mode === AIS_DATASET_MODES.REGIONAL) {
    built = buildScenarioVessels(scenario, {
      regionId,
      referenceTimestamp: CO_LOCATED_SCENARIOS_META.timestamp,
    });
    notice = CO_LOCATED_SCENARIOS_META.notice;
  } else if (source === REAL_AIS_SOURCES.CSJ) {
    const anchor = trackCentroid(INGESTED_AIS_LOGS.csjTracks);
    built = buildCsjVessels(INGESTED_AIS_LOGS.csjTracks, anchor, { regionId });
    notice =
      "CSJ tracks are 2020 historical tracks recorded far from every OceanGuard station. They are plotted around the centroid of their own points (a virtual station), not around your hydrophone.";
  } else {
    const c = event.coords ?? scenario?.hydrophone;
    const anchor = c
      ? { id: event.stationId ?? scenario?.hydrophone?.id ?? "STATION", name: "Event station", lat: c.lat, lon: c.lon }
      : null;
    built = anchor
      ? buildMarineCadastreVessels(INGESTED_AIS_LOGS.usMarineCadastre, anchor, { regionId })
      : { anchor: null, vessels: [] };
    notice =
      "USCG MarineCadastre reports are 2024-01-01 positions across US waters, not aligned in time with the acoustic event. Design speed is an assumed ship-type reference.";
  }

  const nearestKm = built.vessels.length
    ? Math.min(...built.vessels.map((v) => v.cpaDistanceKm))
    : null;
  return {
    anchor: built.anchor,
    vessels: rankCandidateVessels(built.vessels, event, radius),
    totalCount: built.vessels.length,
    nearestKm,
    regionId,
    scenarioKey,
    notice,
  };
}

// ---------------------------------------------------------------------------------------------
// Phase 3
// ---------------------------------------------------------------------------------------------

/**
 * Point-in-Polygon intrusion check for Module 3. Looks up the event region's wdpaPolygons in CO_LOCATED_SCENARIOS
 * ("noaa" resolves to the "stellwagen" key) and tests the vessel's [lon, lat] and the acoustic footprint
 * (centred on the scenario hydrophone) against each polygon.
 */
export async function getProtectedAreaAssessment({ event, vessel, footprintKm } = {}) {
  const regionId = resolveEventRegion(event);
  const scenario = regionId ? scenarioForRegion(CO_LOCATED_SCENARIOS, regionId) : null;
  if (!scenario) {
    return { regionId, scenarioKey: regionId ? toScenarioKey(regionId) : null, hydrophone: null, ...evaluateProtectedAreaIntrusion({}) };
  }
  const assessment = evaluateProtectedAreaIntrusion({
    vessel,
    hydrophone: scenario.hydrophone,
    footprintKm,
    polygons: scenario.wdpaPolygons,
  });
  return {
    regionId,
    scenarioKey: toScenarioKey(regionId),
    hydrophone: { ...scenario.hydrophone },
    notice: CO_LOCATED_SCENARIOS_META.notice,
    ...assessment,
  };
}

/**
 * Real OBIS occurrence telemetry (scientificName, bathymetryM, sstC, salinityPsu) nearest to the region's hydrophone,
 * plus the real WDPA marine/coastal reference records (SITE_NAME, IUCN_CAT, GIS_AREA, GOV_TYPE).
 * The ingested OBIS/WDPA files are global samples, so `nearestKm` is usually far from the hydrophone.
 */
export async function getBiodiversityTelemetry({ event, limit = 6 } = {}) {
  const regionId = resolveEventRegion(event);
  const scenario = regionId ? scenarioForRegion(CO_LOCATED_SCENARIOS, regionId) : null;
  const point = scenario?.hydrophone ?? event?.coords ?? null;
  const nearest = nearestBiodiversityOccurrences(INGESTED_BIODIVERSITY.occurrences, point, limit);
  return {
    regionId,
    origin: point ? { lat: point.lat, lon: point.lon } : null,
    totalOccurrences: INGESTED_BIODIVERSITY.occurrences.length,
    nearestKm: nearest.length ? nearest[0].distanceKm : null,
    nearest,
    protectedAreaRecords: marineWdpaRecords(INGESTED_BIODIVERSITY.protectedAreas),
  };
}

/** USCG PSIX vessels matching a name or IMO query (all vessels for an empty query), as lightweight list rows. */
export async function searchUscgPsixVessels(query = "") {
  return {
    stats: psixDatasetStats(INGESTED_USCG_PSIX),
    vessels: searchPsixVessels(INGESTED_USCG_PSIX, query).map((v) => ({
      imoNumber: v.imoNumber,
      vesselName: v.vesselName,
      vesselType: v.vesselType,
      flag: v.flag,
      buildYear: v.buildYear ?? null,
      deficiencyCount: v.deficiencies?.length || 0,
      controlCount: v.operationalControls?.length || 0,
    })),
  };
}

/** Full normalised PSIX history (deficiencies + operational controls) for one IMO number; null when unknown. */
export async function getUscgPsixVesselProfile(imo) {
  return buildPsixVesselProfile(findPsixVessel(INGESTED_USCG_PSIX, imo));
}

// ---------------------------------------------------------------------------------------------
// Phase 4
// ---------------------------------------------------------------------------------------------

/** Integrity check of one CAPA's SHA-256 verification chain (synchronous recompute + Web Crypto cross-check). */
export async function verifyCapaChain(capa) {
  const result = verifyAuditChain(capa?.id, capa?.history || []);
  const webCrypto = await verifyAuditChainAsync(capa?.id, capa?.history || []);
  return { ...result, webCryptoVerified: webCrypto && result.valid };
}

// TODO: Connect FastAPI/PostGIS endpoint (replace the bundled INGESTED_PORTS with a port-authority tariff query)
/**
 * Port & URN tariff selector data: all ingested ports ranked by Haversine distance from `origin`
 * ({ lat, lon } of the vessel or recording), the nearest eligible port as the recommendation, and a default gross tonnage.
 */
export async function getPortTariffOptions({ origin, vessel } = {}) {
  const ranked = rankPortsByDistance(INGESTED_PORTS, origin);
  return {
    origin: Number.isFinite(origin?.lat) && Number.isFinite(origin?.lon) ? { lat: origin.lat, lon: origin.lon } : null,
    ports: structuredClone(ranked),
    recommended: recommendNearestPort(INGESTED_PORTS, origin)?.port.portCode ?? null,
    grossTonnage: defaultGrossTonnage(vessel),
  };
}

export async function calculatePortRebateEstimate(portCode, grossTonnage, verifiedDbReduction) {
  const port = INGESTED_PORTS.find((p) => p.portCode === portCode);
  return port ? calculatePortRebate({ port, grossTonnage, verifiedDbReduction }) : null;
}

// ---------------------------------------------------------------------------------------------
// Phase 4A: compliance dossier export
// ---------------------------------------------------------------------------------------------

/**
 * Builds the compliance dossier for the current app state. Any section the caller did not supply is derived from the
 * event with the existing services (candidates, ecology, protected area, OBIS, port).
 * state = { event, vessel, candidateVessels?, ecology?, protectedArea?, biodiversity?, auditAreas, auditor,
 *           correctiveActions, portCode?, grossTonnage?, now? }
 * Returns { report, html, filename }.
 */
export async function exportComplianceDossier(state = {}) {
  const event = state.event ?? null;
  const vessel = state.vessel ?? null;
  const origin = event?.coords ?? vessel ?? null;
  const correctiveActions = state.correctiveActions ?? [];

  const candidateVessels = state.candidateVessels ?? (await getCandidateVessels(event, 5));
  const ecology = state.ecology ?? (event ? await getRegionalEcology(event) : null);
  const protectedArea =
    state.protectedArea ??
    (event ? await getProtectedAreaAssessment({ event, vessel, footprintKm: ecology?.footprintKm }) : null);
  const biodiversity = state.biodiversity ?? (event ? await getBiodiversityTelemetry({ event }) : null);

  const tariff = await getPortTariffOptions({ origin, vessel });
  const portCode = state.portCode ?? tariff.recommended;
  const port = state.port ?? tariff.ports.find((p) => (p.port ?? p).portCode === portCode) ?? null;

  const report = buildComplianceDossierReport({
    ...state,
    candidateVessels,
    ecology,
    protectedArea,
    biodiversity,
    correctiveActions,
    port: port?.port ?? port,
    grossTonnage: state.grossTonnage ?? tariff.grossTonnage?.value ?? tariff.grossTonnage,
  });
  const html = renderComplianceDossierHtml(report);
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  return { report, html, filename: `oceanguard-dossier-${stamp}.html` };
}
