import { describe, expect, it } from "vitest";
import {
  calculateIncentives,
  getAcousticPresets,
  getAuditBaseline,
  getCandidateVessels,
  getRegionalEcology,
  retainVesselForEvent,
  submitCapaTransition,
} from "../../services/oceanGuardApi.js";

async function presetFor(region: string) {
  const preset = (await getAcousticPresets()).find((record) => record.region === region);
  if (!preset) throw new Error(`No acoustic preset found for ${region}`);
  return preset;
}

describe("OceanGuard Phase 4 service layer", () => {
  it("returns synthesized regional presets and the seven-area audit baseline", async () => {
    const [presets, baseline] = await Promise.all([getAcousticPresets(), getAuditBaseline()]);

    expect(presets.map((record) => record.region)).toEqual(["clayoquot", "noaa", "chennai"]);
    expect(presets.every((record) => record.spectrogram.length === 64)).toBe(true);
    expect(baseline).toHaveLength(7);
    expect(baseline[0]?.status).toBe("Non-Compliant");
  });

  it("ranks candidates only for their tagged region", async () => {
    const clayoquot = await presetFor("clayoquot");
    const noaa = await presetFor("noaa");

    expect(
      (await getCandidateVessels(clayoquot, 5)).map((vessel: { name: string }) => vessel.name),
    ).toHaveLength(3);
    expect(await getCandidateVessels(noaa, 5)).toEqual([]);
  });

  it("clears a vessel selection when the acoustic event changes regions", async () => {
    const clayoquot = await presetFor("clayoquot");
    const noaa = await presetFor("noaa");
    const vessel = (await getCandidateVessels(clayoquot, 5))[0];
    if (!vessel) throw new Error("Expected a Clayoquot candidate vessel");

    expect(retainVesselForEvent(vessel, clayoquot)?.region).toBe("clayoquot");
    expect(retainVesselForEvent(vessel, noaa)).toBeNull();
  });

  it("returns ecological records for the active region only", async () => {
    const noaa = await getRegionalEcology(await presetFor("noaa"));
    const chennai = await getRegionalEcology(await presetFor("chennai"));

    expect(noaa.regionId).toBe("noaa");
    expect(noaa.zones.every((zone: { region: string }) => zone.region === "noaa")).toBe(true);
    expect(
      noaa.species.some(
        (species: { commonName: string }) => species.commonName === "Olive Ridley Sea Turtle",
      ),
    ).toBe(false);
    expect(
      chennai.species.some(
        (species: { commonName: string }) => species.commonName === "Olive Ridley Sea Turtle",
      ),
    ).toBe(true);
  });

  it("records a successful CAPA transition and counts only reviewed measured reductions", async () => {
    const capa = { id: "CAPA-2026-100", currentStage: 1, verifiedReductionDb: 0, history: [] };
    const auditor = { name: "Dr. Elena Rostova", accreditationId: "AUD-IMO-2026-8841" };
    const transition = await submitCapaTransition(
      capa.id,
      { evidence: ["hull_prop_inspection"], note: "ROV inspection record checked." },
      [capa],
      auditor,
    );
    const incentives = await calculateIncentives(
      [{ currentStage: 7, verifiedReductionDb: 3.5 }],
      70,
    );

    expect(transition.ok).toBe(true);
    expect(transition.capa.currentStage).toBe(2);
    expect(transition.capa.history[0].auditorName).toBe(auditor.name);
    expect(incentives.verifiedCount).toBe(1);
    expect(incentives.totalVerifiedDbReduction).toBe(3.5);
  });
});
