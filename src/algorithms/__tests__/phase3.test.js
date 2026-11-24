import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distanceToPolygonKm,
  isPointInPolygon,
  isPointOnSegment,
  lonLatToXY,
  polygonAreaKm2,
  ringToSvgPoints,
} from "../geometry.js";
import { scenarioForRegion, toAppRegionId, toScenarioKey } from "../aisCorrelation.js";
import {
  auditAreaIdForRecommendedComponent,
  evaluateProtectedAreaIntrusion,
  findPsixVessel,
  importPsixFindings,
  isPsixItemImported,
  marineWdpaRecords,
  nearestBiodiversityOccurrences,
  normalisePsixDeficiency,
  psixDatasetStats,
  searchPsixVessels,
  suggestAuditAreaForDeficiency,
} from "../ecologicalAndAudit.js";
import {
  CO_LOCATED_SCENARIOS,
  INGESTED_BIODIVERSITY,
  INGESTED_USCG_PSIX,
} from "../../data/ingestedDatasets.js";
import { getBiodiversityTelemetry, getProtectedAreaAssessment } from "../../services/oceanGuardApi.js";

const SQUARE = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0], // closed ring
];

// ---- Point-in-Polygon -------------------------------------------------------------------------

test("isPointInPolygon: inside, outside, concave and invalid input", () => {
  assert.equal(isPointInPolygon([5, 5], SQUARE), true);
  assert.equal(isPointInPolygon([11, 5], SQUARE), false);
  assert.equal(isPointInPolygon([-0.001, 5], SQUARE), false);
  assert.equal(isPointInPolygon([5, 10.001], SQUARE), false);
  // L-shape: the notch is outside
  const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10], [0, 0]];
  assert.equal(isPointInPolygon([2, 8], L), true);
  assert.equal(isPointInPolygon([8, 8], L), false);
  assert.equal(isPointInPolygon([NaN, 1], SQUARE), false);
  assert.equal(isPointInPolygon([1, 1], [[0, 0], [1, 1]]), false);
  assert.equal(isPointInPolygon("x", SQUARE), false);
});

test("isPointInPolygon: boundary (edge and vertex) counts as inside", () => {
  assert.equal(isPointInPolygon([5, 0], SQUARE), true); // bottom edge
  assert.equal(isPointInPolygon([10, 5], SQUARE), true); // right edge
  assert.equal(isPointInPolygon([0, 0], SQUARE), true); // vertex
  assert.equal(isPointInPolygon([10, 10], SQUARE), true); // vertex
  assert.equal(isPointOnSegment([5, 5], [0, 0], [10, 10]), true);
  assert.equal(isPointOnSegment([5, 6], [0, 0], [10, 10]), false);
  // the same result with an open (unclosed) ring
  assert.equal(isPointInPolygon([5, 5], SQUARE.slice(0, -1)), true);
});

test("wdpaPolygons: every region has closed 6-point rings and hydrophone/vessel results match geometry", () => {
  for (const [key, scenario] of Object.entries(CO_LOCATED_SCENARIOS)) {
    assert.equal(scenario.wdpaPolygons.length, 2, key);
    for (const poly of scenario.wdpaPolygons) {
      assert.equal(poly.coordinates.length, 6, `${key} ${poly.siteId}`);
      assert.deepEqual(poly.coordinates[0], poly.coordinates[5]);
    }
    const [first, second] = scenario.wdpaPolygons;
    const h = scenario.hydrophone;
    assert.equal(isPointInPolygon([h.lon, h.lat], first.coordinates), true, `${key} hydrophone in MPA-01`);
    assert.equal(isPointInPolygon([h.lon, h.lat], second.coordinates), false, `${key} hydrophone not in MPA-02`);
    // vessel 01 and 02 are inside MPA-01; vessel 03 is outside both; vessel 05 is inside MPA-02
    const byIndex = scenario.aisVessels;
    assert.equal(isPointInPolygon([byIndex[0].lon, byIndex[0].lat], first.coordinates), true);
    assert.equal(isPointInPolygon([byIndex[1].lon, byIndex[1].lat], first.coordinates), true);
    assert.equal(isPointInPolygon([byIndex[2].lon, byIndex[2].lat], first.coordinates), false);
    assert.equal(isPointInPolygon([byIndex[2].lon, byIndex[2].lat], second.coordinates), false);
    assert.equal(isPointInPolygon([byIndex[4].lon, byIndex[4].lat], second.coordinates), true);
  }
});

test("a polygon vertex of a real wdpaPolygon is treated as inside (boundary)", () => {
  const ring = CO_LOCATED_SCENARIOS.chennai.wdpaPolygons[0].coordinates;
  assert.equal(isPointInPolygon(ring[2], ring), true);
});

test("noaa resolves to the stellwagen scenario key for the polygon lookup", () => {
  assert.equal(toScenarioKey("noaa"), "stellwagen");
  assert.equal(toAppRegionId("stellwagen"), "noaa");
  assert.equal(scenarioForRegion(CO_LOCATED_SCENARIOS, "noaa"), CO_LOCATED_SCENARIOS.stellwagen);
});

test("distanceToPolygonKm, polygonAreaKm2 and projection helpers", () => {
  const h = CO_LOCATED_SCENARIOS.clayoquot.hydrophone;
  const ring = CO_LOCATED_SCENARIOS.clayoquot.wdpaPolygons[0].coordinates;
  assert.equal(distanceToPolygonKm(h, ring), 0);
  const far = distanceToPolygonKm({ lat: h.lat + 1, lon: h.lon }, ring);
  assert.ok(far > 105 && far < 111, `${far}`);
  assert.equal(distanceToPolygonKm({ lat: NaN, lon: 0 }, ring), null);
  const area = polygonAreaKm2(ring);
  assert.ok(area > 20 && area < 35, `${area}`);
  // 1 degree square at the equator is about 12,364 km2
  const sq = polygonAreaKm2([[0, 0], [1, 0], [1, 1], [0, 1]]);
  assert.ok(Math.abs(sq - 12364) < 100, `${sq}`);
  const origin = { lat: 13.15, lon: 80.35 };
  const centre = lonLatToXY([80.35, 13.15], origin, 15, 185, 155);
  assert.deepEqual(centre, { x: 185, y: 155 });
  const east = lonLatToXY([80.36, 13.15], origin, 15, 185, 155);
  assert.ok(east.x > 185 && east.y === 155);
  const north = lonLatToXY([80.35, 13.16], origin, 15, 185, 155);
  assert.ok(north.y < 155);
  assert.equal(ringToSvgPoints(ring, h, 15, 185, 155).split(" ").length, 5);
});

// ---- Intrusion evaluation -----------------------------------------------------------------------

test("evaluateProtectedAreaIntrusion: vessel inside / outside / no position, footprint overlap", () => {
  const sc = CO_LOCATED_SCENARIOS.stellwagen;
  const base = { hydrophone: sc.hydrophone, polygons: sc.wdpaPolygons };
  const inside = evaluateProtectedAreaIntrusion({ ...base, vessel: sc.aisVessels[0], footprintKm: 3 });
  assert.equal(inside.intrusionCount, 1);
  assert.equal(inside.results[0].vesselInside, true);
  assert.equal(inside.results[1].vesselInside, false);
  assert.equal(inside.results[0].footprintOverlap, true);
  assert.equal(inside.results[1].footprintOverlap, false); // MPA-02 is ~5.6 km away

  const wide = evaluateProtectedAreaIntrusion({ ...base, vessel: sc.aisVessels[0], footprintKm: 8 });
  assert.equal(wide.footprintOverlapCount, 2);

  const outside = evaluateProtectedAreaIntrusion({ ...base, vessel: sc.aisVessels[2], footprintKm: 3 });
  assert.equal(outside.intrusionCount, 0);
  assert.ok(outside.results[0].vesselDistanceKm > 4);

  const noVessel = evaluateProtectedAreaIntrusion({ ...base, vessel: { name: "x" }, footprintKm: 3 });
  assert.equal(noVessel.vesselPosition, null);
  assert.equal(noVessel.results[0].vesselInside, null);
  assert.equal(noVessel.intrusionCount, 0);

  const noFootprint = evaluateProtectedAreaIntrusion({ ...base, vessel: sc.aisVessels[0], footprintKm: null });
  assert.equal(noFootprint.results[0].footprintOverlap, null);
  assert.equal(evaluateProtectedAreaIntrusion().results.length, 0);
});

test("getProtectedAreaAssessment uses the noaa -> stellwagen scenario and reports an intrusion", async () => {
  const event = { region: "noaa", coords: { lat: 42.3814, lon: -70.3125 } };
  const vessel = CO_LOCATED_SCENARIOS.stellwagen.aisVessels[4]; // inside MPA-02
  const a = await getProtectedAreaAssessment({ event, vessel, footprintKm: 2 });
  assert.equal(a.scenarioKey, "stellwagen");
  assert.equal(a.intrusionCount, 1);
  assert.equal(a.results.find((r) => r.vesselInside).siteId, "OG-SYN-ST-MPA-02");
  const none = await getProtectedAreaAssessment({ event: { coords: { lat: 0, lon: 0 } }, vessel, footprintKm: 2 });
  assert.equal(none.results.length, 0);
});

// ---- Biodiversity -----------------------------------------------------------------------------

test("nearestBiodiversityOccurrences sorts by distance and exposes OBIS telemetry fields", async () => {
  const origin = CO_LOCATED_SCENARIOS.chennai.hydrophone;
  const near = nearestBiodiversityOccurrences(INGESTED_BIODIVERSITY.occurrences, origin, 5);
  assert.equal(near.length, 5);
  for (let i = 1; i < near.length; i++) assert.ok(near[i].distanceKm >= near[i - 1].distanceKm);
  for (const key of ["scientificName", "bathymetryM", "sstC", "salinityPsu", "distanceKm"]) {
    assert.ok(key in near[0], key);
  }
  assert.deepEqual(nearestBiodiversityOccurrences([], origin), []);
  assert.deepEqual(nearestBiodiversityOccurrences(INGESTED_BIODIVERSITY.occurrences, null), []);

  const t = await getBiodiversityTelemetry({ event: { region: "chennai" }, limit: 3 });
  assert.equal(t.nearest.length, 3);
  assert.equal(t.totalOccurrences, INGESTED_BIODIVERSITY.occurrences.length);
});

test("marineWdpaRecords keeps marine/coastal records under WDPA column names", () => {
  const recs = marineWdpaRecords(INGESTED_BIODIVERSITY.protectedAreas);
  assert.equal(recs.length, 5);
  assert.ok(recs.every((r) => r.realm === "Marine" || r.realm === "Coastal"));
  const diamond = recs.find((r) => r.SITE_NAME === "Diamond Reef and Salt Fish Tail Reef");
  assert.equal(diamond.IUCN_CAT, "Ia");
  assert.ok(Math.abs(diamond.GIS_AREA - 14.5878) < 0.001);
  assert.equal(diamond.GOV_TYPE, "Federal or national ministry or agency");
});

// ---- Module 1 -> Module 4 ---------------------------------------------------------------------

test("auditAreaIdForRecommendedComponent maps classifier output to checklist rows", () => {
  assert.equal(auditAreaIdForRecommendedComponent("Propeller & Shafting"), "propeller");
  assert.equal(auditAreaIdForRecommendedComponent("Main Engine & Mounts"), "machinery");
  assert.equal(auditAreaIdForRecommendedComponent("Operational Speed"), "operational");
  assert.equal(auditAreaIdForRecommendedComponent("Hull Biofouling"), "hull");
  assert.equal(auditAreaIdForRecommendedComponent("None"), null);
  assert.equal(auditAreaIdForRecommendedComponent(null), null);
  assert.equal(auditAreaIdForRecommendedComponent("Something else"), null);
});

// ---- USCG PSIX --------------------------------------------------------------------------------

test("psixDatasetStats matches the ingested dataset", () => {
  assert.deepEqual(psixDatasetStats(INGESTED_USCG_PSIX), {
    vessels: 25,
    inspections: 40,
    deficiencies: 288,
    operationalControls: 29,
  });
});

test("searchPsixVessels: by name, by IMO, case/prefix handling and empty results", () => {
  assert.equal(searchPsixVessels(INGESTED_USCG_PSIX, "").length, 25);
  assert.equal(searchPsixVessels(INGESTED_USCG_PSIX, "   ").length, 25);
  const byName = searchPsixVessels(INGESTED_USCG_PSIX, "commodore");
  assert.equal(byName.length, 1);
  assert.equal(byName[0].imoNumber, "9191228");
  assert.equal(searchPsixVessels(INGESTED_USCG_PSIX, "C-DISCOVERY")[0].imoNumber, "9203215");
  assert.equal(searchPsixVessels(INGESTED_USCG_PSIX, "IMO 9191228")[0].vesselName, "C  COMMODORE");
  assert.equal(searchPsixVessels(INGESTED_USCG_PSIX, "9191228").length, 1);
  assert.ok(searchPsixVessels(INGESTED_USCG_PSIX, "9191").length >= 1); // IMO substring
  assert.equal(searchPsixVessels(INGESTED_USCG_PSIX, "no such vessel").length, 0);
  assert.equal(searchPsixVessels(null, "x").length, 0);
  // name prefix ranks ahead of a plain substring match
  const lady = searchPsixVessels(INGESTED_USCG_PSIX, "lady");
  assert.deepEqual(lady.map((v) => v.vesselName), ["LADY ELIZABETH", "LADY PHILOMENA"]);
  assert.equal(findPsixVessel(INGESTED_USCG_PSIX, "IMO 9191228").vesselName, "C  COMMODORE");
  assert.equal(findPsixVessel(INGESTED_USCG_PSIX, "0000000"), null);
});

test("normalisePsixDeficiency shows system/subsystem/component/description without deficiencyCode", () => {
  const vessel = INGESTED_USCG_PSIX[0];
  const row = normalisePsixDeficiency(vessel.deficiencies[0], vessel);
  assert.equal(row.deficiencyCode, null);
  assert.equal(row.system, "Engineering");
  assert.equal(row.subsystem, "Generator (propulsion-electric)");
  assert.equal(row.component, "Generator Voltage Regulator Circuitry");
  assert.match(row.deficiencyDescription, /emergency generator/);
  assert.equal(row.issuedDate, "2015-03-17");
  assert.equal(row.key, "PSIX-2045062");
  assert.equal(row.suggestedAreaId, "machinery");
  // every ingested deficiency has a null code, so display must not depend on it
  assert.ok(INGESTED_USCG_PSIX.every((v) => v.deficiencies.every((d) => d.deficiencyCode === null)));
});

test("suggestAuditAreaForDeficiency maps URN-relevant systems only", () => {
  assert.equal(suggestAuditAreaForDeficiency({ System: "Engineering", Subsystem: "Shafting/Propeller Arrangements" }), "propeller");
  assert.equal(suggestAuditAreaForDeficiency({ System: "Construction/Loadline", Subsystem: "Hull" }), "hull");
  assert.equal(suggestAuditAreaForDeficiency({ System: "Engineering", Subsystem: "Thrusters" }), "propulsion");
  assert.equal(suggestAuditAreaForDeficiency({ System: "Engineering", Subsystem: "Diesel Engine (auxiliary)" }), "machinery");
  assert.equal(suggestAuditAreaForDeficiency({ System: "Lifesaving", Subsystem: "Lifebuoys" }), null);
  assert.equal(suggestAuditAreaForDeficiency({}), null);
});

test("importPsixFindings appends once, keeps the existing note and skips duplicates", () => {
  const vessel = INGESTED_USCG_PSIX[0];
  const item = normalisePsixDeficiency(vessel.deficiencies[0], vessel);
  const area = { id: "machinery", inspectorNote: "Existing auditor note." };

  const first = importPsixFindings(area, [item]);
  assert.equal(first.added, 1);
  assert.ok(first.patch.inspectorNote.startsWith("Existing auditor note.\n"));
  assert.match(first.patch.inspectorNote, /\[PSIX-2045062\]/);
  assert.match(first.patch.inspectorNote, /Engineering \/ Generator \(propulsion-electric\) \/ Generator Voltage Regulator Circuitry/);

  const updated = { ...area, ...first.patch };
  assert.equal(isPsixItemImported(updated, item), true);
  const again = importPsixFindings(updated, [item]);
  assert.equal(again.patch, null);
  assert.equal(again.added, 0);
  assert.equal(importPsixFindings(null, [item]).patch, null);

  // an oversized note is refused instead of truncating the auditor's text
  const huge = { id: "x", inspectorNote: "a".repeat(1990) };
  assert.equal(importPsixFindings(huge, [item]).patch, null);
});
