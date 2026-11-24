import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vesselBearingDeg,
  polarToXY,
  radarRingsKm,
  estimateAcousticFootprintKm,
  pointInPolygon,
  formatLatLon,
} from "../geometry.js";
import { rankCandidateVessels } from "../aisCorrelation.js";
import { evaluateEcologicalOverlap } from "../ecologicalAndAudit.js";
import {
  AIS_CANDIDATE_VESSELS,
  ACOUSTIC_PRESETS,
  MARINE_SENSITIVE_ZONES,
  OBIS_SPECIES_RECORDS,
} from "../../data/mockDatasets.js";

test("bearing is derived from the plot position when no explicit bearing exists", () => {
  assert.equal(vesselBearingDeg({ xRel: 0.5, yRel: 0.2 }), 0); // due north
  assert.equal(vesselBearingDeg({ xRel: 0.8, yRel: 0.5 }), 90); // due east
  assert.equal(vesselBearingDeg({ xRel: 0.24, yRel: 0.76 }), 225); // FV OCEAN HARVESTER, south-west
  assert.equal(vesselBearingDeg({ bearingDeg: -10, xRel: 0.8, yRel: 0.5 }), 350); // explicit bearing wins
  assert.equal(vesselBearingDeg({}), null);
});

test("radar plots a vessel at CPA distance scaled to the selected radius", () => {
  const pxPerKm = 180 / 5; // 5 km radius on a 180 px ring
  const p = polarToXY(90, 2.5, pxPerKm, 200, 200);
  assert.ok(Math.abs(p.x - 290) < 1e-9);
  assert.ok(Math.abs(p.y - 200) < 1e-9);
  const p10 = polarToXY(90, 2.5, 180 / 10, 200, 200);
  assert.ok(Math.abs(p10.x - 245) < 1e-9); // same vessel sits closer to centre on a 10 km radar
});

test("range rings divide the selected radius into thirds", () => {
  assert.deepEqual(radarRingsKm(5), [1.67, 3.33, 5]);
  assert.deepEqual(radarRingsKm(10), [3.33, 6.67, 10]);
});

test("radius filter: only MV PACIFIC HORIZON is within 2.5 km, all three within 5 km", () => {
  const event = ACOUSTIC_PRESETS[0];
  assert.deepEqual(
    rankCandidateVessels(AIS_CANDIDATE_VESSELS, event, 2.5).map((v) => v.name),
    ["MV PACIFIC HORIZON"],
  );
  assert.equal(rankCandidateVessels(AIS_CANDIDATE_VESSELS, event, 5).length, 3);
});

test("acoustic footprint is 0.15 km per dB above ambient, bounded to 1–8 km", () => {
  assert.equal(estimateAcousticFootprintKm({ deltaAboveAmbient: 34.2 }), 5.1);
  assert.equal(estimateAcousticFootprintKm({ deltaAboveAmbient: 23.1 }), 3.5);
  assert.equal(estimateAcousticFootprintKm({ deltaAboveAmbient: 2 }), 1);
  assert.equal(estimateAcousticFootprintKm({ deltaAboveAmbient: 90 }), 8);
  assert.equal(estimateAcousticFootprintKm(null), null);
});

test("zones beyond the event footprint are not counted as overlapping", () => {
  const noaa = ACOUSTIC_PRESETS[1]; // +23.1 dB -> 3.5 km footprint excludes the 4.1 km right-whale habitat
  const r = evaluateEcologicalOverlap(
    noaa,
    MARINE_SENSITIVE_ZONES,
    OBIS_SPECIES_RECORDS,
    estimateAcousticFootprintKm(noaa),
    "noaa",
  );
  assert.equal(r.activeZonesCount, 2);
  const onc = ACOUSTIC_PRESETS[0]; // 5.1 km footprint includes all three Clayoquot zones
  assert.equal(
    evaluateEcologicalOverlap(
      onc,
      MARINE_SENSITIVE_ZONES,
      OBIS_SPECIES_RECORDS,
      estimateAcousticFootprintKm(onc),
      "clayoquot",
    ).activeZonesCount,
    3,
  );
});

test("point-in-polygon detects a vessel inside a zone", () => {
  const square = "0,0 10,0 10,10 0,10";
  assert.equal(pointInPolygon(5, 5, square), true);
  assert.equal(pointInPolygon(15, 5, square), false);
});

test("coordinates show the correct hemisphere", () => {
  assert.equal(formatLatLon({ lat: 13.0827, lon: 80.3015 }), "13.0827° N, 80.3015° E");
  assert.equal(formatLatLon({ lat: 48.6721, lon: -126.8492 }), "48.6721° N, 126.8492° W");
  assert.equal(formatLatLon(undefined), null);
});
