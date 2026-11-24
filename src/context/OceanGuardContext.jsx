import { createContext, useContext, useState } from "react";
import { usePersistentState } from "../hooks/usePersistentState.js";
import {
  createCorrectiveAction as createCapa,
  retainVesselForEvent,
  submitCapaTransition,
} from "../services/oceanGuardApi.js";
import { useToast } from "../components/ui/Toast.jsx";

const OceanGuardContext = createContext(null);

const SEED_CAPAS = [
  {
    id: "CAPA-2026-041",
    areaId: "propeller",
    component: "Propeller",
    vesselName: "MV PACIFIC HORIZON",
    vesselImo: "9741825",
    finding:
      "Trailing-edge roughness and marine bio-calcareous buildup causing tip-vortex cavitation.",
    recommendedAction:
      "Afloat ROV/diver propeller polishing and blade-edge inspection per IMO MEPC.1/Circ.906.",
    currentStage: 6,
    targetReductionDb: 4.0,
    targetBasis:
      "Seed record: planning target for a polished fixed-pitch propeller (2.5 – 4.5 dB achievable range).",
    verifiedReductionDb: 0,
    history: [],
    createdBy: "Dr. Elena Rostova",
    createdAt: "2026-11-18T09:00:00.000Z",
  },
];

export function OceanGuardProvider({ initialData, children }) {
  const { notify } = useToast();
  const initialEvent = initialData.acousticPresets[0] ?? null;
  const initialVessel = initialData.initialCandidates[0] ?? null;
  const [auditor, setAuditor] = usePersistentState("auditor", null);
  const [activeTab, setActiveTab] = usePersistentState("activeTab", 1);
  const [visited, setVisited] = usePersistentState("visited", [1]);
  const [selectedVessel, setSelectedVessel] = usePersistentState("selectedVessel", initialVessel);
  const [auditAreas, setAuditAreas] = usePersistentState("auditAreas", initialData.auditBaseline);
  const [correctiveActions, setCorrectiveActions] = usePersistentState(
    "correctiveActions-v2",
    SEED_CAPAS,
  );
  const [activeEvent, setActiveEvent] = useState(initialEvent);

  const go = (id) => {
    setActiveTab(id);
    setVisited((current) => (current.includes(id) ? current : [...current, id]));
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  const selectAcousticEvent = (event) => {
    const compatibleVessel = retainVesselForEvent(
      selectedVessel,
      event,
      initialData.candidateVesselRecords,
    );
    const vesselChangedRegion = Boolean(selectedVessel && !compatibleVessel);

    if (vesselChangedRegion) {
      const oldRegion = initialData.regions.find((region) => region.id === selectedVessel.region);
      const nextRegion = initialData.regions.find((region) => region.id === event?.region);
      notify(
        "Vessel selection cleared",
        `${selectedVessel.name} is linked to ${oldRegion?.short ?? "another region"}. Choose a vessel for ${nextRegion?.short ?? "the selected recording"}. ${event?.title ?? "The selected recording"} is ready for review.`,
        "warning",
      );
      setSelectedVessel(null);
    } else if (compatibleVessel && compatibleVessel !== selectedVessel) {
      setSelectedVessel(compatibleVessel);
    }

    // Phase 2: carry the audit hint and cavitation flag on activeEvent for Modules 4 and 5
    // (null for recordings that have no classifier metadata).
    setActiveEvent(
      event
        ? {
            ...event,
            cavitationDetected: event.cavitationDetected ?? null,
            recommendedAuditComponent: event.recommendedAuditComponent ?? null,
          }
        : event,
    );
    if (!vesselChangedRegion) {
      notify("Recording analyzed", event?.title ?? "The acoustic event is ready for review.");
    }
  };

  const proceedToAIS = (event) => {
    selectAcousticEvent(event);
    go(2);
  };

  const lockVessel = (vessel) => {
    setSelectedVessel(vessel);
    notify("Vessel locked", `${vessel.name} is selected for the downstream audit workflow.`);
    go(3);
  };

  const updateAuditArea = (areaId, patch) => {
    setAuditAreas((current) =>
      current.map((area) => (area.id === areaId ? { ...area, ...patch } : area)),
    );
  };

  const raiseCorrectiveAction = async (area) => {
    if (!selectedVessel) {
      notify("Select a vessel first", "Corrective actions must be tied to a vessel.", "warning");
      go(2);
      return null;
    }

    const existing = correctiveActions.some(
      (action) => action.areaId === area.id && action.vesselImo === selectedVessel.imo,
    );
    if (existing) {
      notify(
        "CAPA already active",
        `${area.component} already has an open action for ${selectedVessel.name}.`,
      );
      go(5);
      return null;
    }

    const newCapa = await createCapa({
      area,
      vessel: selectedVessel,
      event: activeEvent,
      existing: correctiveActions,
      auditor,
    });
    if (newCapa) {
      setCorrectiveActions((current) => [newCapa, ...current]);
      notify("CAPA created", `${newCapa.id} was opened for ${area.component}.`);
    }
    go(5);
    return newCapa;
  };

  const advanceCapaStage = async (capaId, input) => {
    const result = await submitCapaTransition(capaId, input, correctiveActions, auditor);
    if (result.ok) {
      setCorrectiveActions((current) =>
        current.map((action) => (action.id === capaId ? result.capa : action)),
      );
      notify("Stage verified", `${result.capa.id} advanced to stage ${result.capa.currentStage}.`);
    }
    return result;
  };

  const resetDemoState = () => {
    if (typeof window === "undefined") return;
    const confirmed = window.confirm(
      "Reset the demo? Progress, audit edits and corrective actions return to their starting values. You stay signed in.",
    );
    if (!confirmed) return;

    setActiveTab(1);
    setVisited([1]);
    setSelectedVessel(initialVessel);
    setAuditAreas(initialData.auditBaseline.map((area) => ({ ...area })));
    setCorrectiveActions(SEED_CAPAS.map((action) => ({ ...action, history: [] })));
    setActiveEvent(initialEvent);
    notify(
      "Demo state reset",
      "Progress, audit edits and corrective actions are back to their starting values.",
    );
    window.scrollTo({ top: 0 });
  };

  const value = {
    auditor,
    setAuditor,
    activeTab,
    visited,
    go,
    activeEvent,
    selectedVessel,
    setSelectedVessel,
    selectAcousticEvent,
    proceedToAIS,
    lockVessel,
    auditAreas,
    updateAuditArea,
    correctiveActions,
    raiseCorrectiveAction,
    advanceCapaStage,
    resetDemoState,
    notify,
    acousticPresets: initialData.acousticPresets,
    regions: initialData.regions,
    capaCatalog: initialData.capaCatalog,
  };

  return <OceanGuardContext.Provider value={value}>{children}</OceanGuardContext.Provider>;
}

export function useOceanGuard() {
  const context = useContext(OceanGuardContext);
  if (!context) throw new Error("useOceanGuard must be used within an OceanGuardProvider");
  return context;
}
