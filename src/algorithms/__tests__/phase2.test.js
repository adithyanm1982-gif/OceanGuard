import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  haversineDistanceKm,
  initialBearingDeg,
  zScores,
  detectSogSpikes,
  assessSpeedAnomaly,
  toScenarioKey,
  toAppRegionId,
  scenarioForRegion,
  buildScenarioVessels,
  buildMarineCadastreVessels,
  buildCsjVessels,
  trackCentroid,
  rankCandidateVessels,
  referenceSpeedForAisType,
} from "../aisCorrelation.js";
import { haversineKm } from "../geometry.js";
import { decodeWavPcm, analyzeIngestedWav } from "../signalProcessing.js";
import {
  CO_LOCATED_SCENARIOS,
  CO_LOCATED_SCENARIOS_META,
  INGESTED_AIS_LOGS,
  INGESTED_AUDIO_PROFILES,
} from "../../data/ingestedDatasets.js";
import { REGIONS } from "../../data/mockDatasets.js";
import { getVesselDataset } from "../../services/oceanGuardApi.js";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("haversine: known city pair, symmetry, zero distance, antimeridian", () => {
  // London -> Paris is about 343.5 km
  close(haversineDistanceKm({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 }), 343.5, 1.5);
  const a = { lat: 13.15, lon: 80.35 };
  const b = { lat: 42.35, lon: -70.3 };
  assert.equal(haversineDistanceKm(a, b), haversineDistanceKm(b, a));
  assert.equal(haversineDistanceKm(a, a), 0);
  // 1 degree of latitude is about 111.2 km
  close(haversineDistanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111.19, 0.1);
  // crossing the antimeridian is the short way round
  close(haversineDistanceKm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 }), 111.19, 0.1);
  // agrees with the geometry.js implementation
  close(haversineDistanceKm(a, b), haversineKm(a, b), 1e-9);
});

test("initial bearing: cardinal directions and range", () => {
  const o = { lat: 10, lon: 20 };
  close(initialBearingDeg(o, { lat: 11, lon: 20 }), 0, 1e-6);
  close(initialBearingDeg(o, { lat: 10, lon: 21 }), 90, 0.5);
  close(initialBearingDeg(o, { lat: 9, lon: 20 }), 180, 1e-6);
  close(initialBearingDeg(o, { lat: 10, lon: 19 }), 270, 0.5);
  const b = initialBearingDeg(o, { lat: 10.5, lon: 19.5 });
  assert.ok(b >= 0 && b < 360);
});

test("zScores: floors std and handles empty input", () => {
  assert.deepEqual(zScores([]).z, []);
  const { z } = zScores([10, 10, 10, 10, 10, 10, 10, 10, 10, 20], 0);
  assert.ok(z[9] > 2.9);
  const floored = zScores([10, 10, 10, 10, 10.1], 0.5).z;
  assert.ok(Math.max(...floored) < 1);
});

test("detectSogSpikes flags a real spike and ignores a steady track", () => {
  const steady = Array.from({ length: 25 }, (_, i) => ({ timestamp: `t${i}`, sogKnots: 13 + (i % 2) * 0.1 }));
  assert.equal(detectSogSpikes(steady).flagged, false);

  const spiky = steady.map((p, i) => (i === 12 ? { ...p, sogKnots: 22 } : p));
  const r = detectSogSpikes(spiky);
  assert.equal(r.flagged, true);
  assert.deepEqual(r.spikes.map((s) => s.index), [12]);
  assert.ok(r.maxZ >= 2.5);

  // a speed DROP is not a spike
  const dip = steady.map((p, i) => (i === 12 ? { ...p, sogKnots: 4 } : p));
  assert.equal(detectSogSpikes(dip).flagged, false);
  // too few points
  assert.equal(detectSogSpikes([{ sogKnots: 5 }, { sogKnots: 50 }]).flagged, false);
});

test("assessSpeedAnomaly: observed > design, boundary, unknown design", () => {
  const over = assessSpeedAnomaly({ observedSogKnots: 15.1, designSpeedKnots: 12 });
  assert.equal(over.flagged, true);
  assert.deepEqual(over.reasons, ["over-design-speed"]);
  assert.equal(over.overDesign.excessKnots, 3.1);
  assert.equal(assessSpeedAnomaly({ observedSogKnots: 12, designSpeedKnots: 12 }).flagged, false);
  assert.equal(assessSpeedAnomaly({ observedSogKnots: 30, designSpeedKnots: null }).flagged, false);
  const both = assessSpeedAnomaly({
    observedSogKnots: 20,
    designSpeedKnots: 12,
    track: [...Array(24).fill({ sogKnots: 12 }), { sogKnots: 20 }],
  });
  assert.deepEqual(both.reasons, ["over-design-speed", "sog-zscore-spike"]);
});

test("region keys map noaa <-> stellwagen and every app region has a scenario", () => {
  assert.equal(toScenarioKey("noaa"), "stellwagen");
  assert.equal(toAppRegionId("stellwagen"), "noaa");
  assert.equal(toScenarioKey(toAppRegionId("stellwagen")), "stellwagen");
  assert.equal(toScenarioKey("chennai"), "chennai");
  assert.equal(toAppRegionId("clayoquot"), "clayoquot");
  for (const r of REGIONS) {
    assert.ok(scenarioForRegion(CO_LOCATED_SCENARIOS, r.id), `no scenario for ${r.id}`);
  }
  assert.equal(scenarioForRegion(CO_LOCATED_SCENARIOS, "stellwagen"), CO_LOCATED_SCENARIOS.stellwagen);
});

test("scenario vessels are placed by Haversine distance and bearing from the hydrophone", () => {
  const scenario = CO_LOCATED_SCENARIOS.stellwagen;
  const { anchor, vessels } = buildScenarioVessels(scenario, {
    regionId: "noaa",
    referenceTimestamp: CO_LOCATED_SCENARIOS_META.timestamp,
  });
  assert.equal(anchor.id, scenario.hydrophone.id);
  assert.equal(vessels.length, scenario.aisVessels.length);
  for (const v of vessels) {
    assert.equal(v.region, "noaa");
    close(v.cpaDistanceKm, haversineDistanceKm(scenario.hydrophone, v), 0.001);
    assert.ok(v.bearingDeg >= 0 && v.bearingDeg < 360);
  }
  // Bankline Passenger 01 sits due south of the hydrophone (same lon, lower lat)
  const first = vessels[0];
  assert.equal(first.bearingDeg, 180);
  assert.equal(first.speedAnomaly.flagged, true); // 17.2 kn vs 14 kn design
  assert.equal(first.timeOffsetSec, 60);
});

test("every ingested scenario vessel with SOG > design speed is flagged", () => {
  for (const [key, scenario] of Object.entries(CO_LOCATED_SCENARIOS)) {
    const { vessels } = buildScenarioVessels(scenario, { regionId: key });
    scenario.aisVessels.forEach((raw, i) => {
      assert.equal(vessels[i].speedAnomaly.flagged, raw.observedSogKnots > raw.designSpeedKnots, raw.mmsi);
    });
  }
});

test("real AIS builders: MarineCadastre uses type-reference speed, CSJ uses track CPA + z-score", () => {
  const anchor = { id: "NOAA-SB-02", lat: 42.3814, lon: -70.3125 };
  const mc = buildMarineCadastreVessels(INGESTED_AIS_LOGS.usMarineCadastre, anchor, { regionId: "noaa" });
  assert.equal(mc.vessels.length, new Set(INGESTED_AIS_LOGS.usMarineCadastre.map((r) => r.mmsi)).size);
  assert.equal(referenceSpeedForAisType(71), 14);
  assert.equal(referenceSpeedForAisType(undefined), null);
  const pilot = mc.vessels.find((v) => v.name === "PILOT BOAT SPRING PT");
  close(pilot.cpaDistanceKm, haversineDistanceKm(anchor, pilot), 0.001);

  const centre = trackCentroid(INGESTED_AIS_LOGS.csjTracks);
  const csj = buildCsjVessels(INGESTED_AIS_LOGS.csjTracks, centre, { regionId: "noaa" });
  assert.equal(csj.vessels.length, INGESTED_AIS_LOGS.csjTracks.length);
  for (const [i, t] of INGESTED_AIS_LOGS.csjTracks.entries()) {
    const min = Math.min(...t.track.map((p) => haversineDistanceKm(centre, p)));
    close(csj.vessels[i].cpaDistanceKm, min, 0.001);
  }
  // a synthetic spike injected into a real track is caught
  const tampered = structuredClone(INGESTED_AIS_LOGS.csjTracks.slice(0, 1));
  tampered[0].track[10].sogKnots += 12;
  const flagged = buildCsjVessels(tampered, centre).vessels[0];
  assert.equal(flagged.speedAnomaly.spike.flagged, true);
});

test("ranking tolerates vessels with no design speed and boosts flagged anomalies", () => {
  const base = {
    vesselType: "Unclassified (CSJ track)",
    cpaDistanceKm: 1,
    observedSpeedKnots: 13,
    designSpeedKnots: null,
    timeOffsetSec: null,
    overlapRatio: 0.5,
  };
  const [calm, spiky] = [
    rankCandidateVessels([{ ...base, mmsi: "a" }], { deltaAboveAmbient: 20 })[0],
    rankCandidateVessels([{ ...base, mmsi: "b", speedAnomaly: { flagged: true } }], { deltaAboveAmbient: 20 })[0],
  ];
  assert.ok(Number.isFinite(calm.confidencePct));
  assert.ok(spiky.confidencePct > calm.confidencePct);
});

test("getVesselDataset: noaa event resolves the stellwagen scenario; radius filters by Haversine km", async () => {
  const event = { id: "e", region: "noaa", deltaAboveAmbient: 20, coords: { lat: 42.3814, lon: -70.3125 }, stationId: "NOAA-SB-02" };
  const small = await getVesselDataset({ event, mode: "colocated", radiusKm: 2.5 });
  assert.equal(small.scenarioKey, "stellwagen");
  assert.equal(small.anchor.id, "OG-ST-HYD-01");
  assert.ok(small.vessels.every((v) => v.cpaDistanceKm <= 2.5));
  const wide = await getVesselDataset({ event, mode: "colocated", radiusKm: 10 });
  assert.ok(wide.vessels.length >= small.vessels.length);
  assert.equal(wide.totalCount, CO_LOCATED_SCENARIOS.stellwagen.aisVessels.length);

  const real = await getVesselDataset({ event, mode: "real", source: "usMarineCadastre", radiusKm: 250 });
  assert.ok(real.vessels.length > 0 && real.vessels.every((v) => v.cpaDistanceKm <= 250));
  const none = await getVesselDataset({ event: { ...event, region: "chennai", coords: { lat: 13.08, lon: 80.3 } }, mode: "real", source: "usMarineCadastre", radiusKm: 1000 });
  assert.equal(none.vessels.length, 0);
  assert.ok(none.nearestKm > 1000);
  assert.equal((await getVesselDataset({ event: null })).vessels.length, 0);
});

test("decodeWavPcm + analyzeIngestedWav handle all 16 real WAV files", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public");
  assert.equal(INGESTED_AUDIO_PROFILES.length, 16);
  for (const profile of INGESTED_AUDIO_PROFILES) {
    const buf = fs.readFileSync(path.join(root, profile.audioUrl));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const decoded = decodeWavPcm(ab);
    assert.equal(decoded.sampleRate, 16000);
    assert.ok(decoded.durationSec > 1);
    const event = await analyzeIngestedWav(profile, ab, { region: "noaa" });
    assert.equal(event.spectrogram.length, 64);
    assert.equal(event.spectrogram[0].length, 40);
    assert.ok(Number.isFinite(event.rmsLevel) && event.rmsLevel < 0); // dBFS
    assert.ok(event.spectralCentroidHz > 0);
    assert.equal(event.cavitationDetected, profile.cavitationDetected);
    assert.equal(event.recommendedAuditComponent, profile.recommendedAuditComponent);
    assert.equal(event.classification, profile.predictedClass);
  }
  assert.throws(() => decodeWavPcm(new ArrayBuffer(100)));
});
