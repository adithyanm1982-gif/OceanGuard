import { createFileRoute } from "@tanstack/react-router";
import App from "../App.jsx";
import { OceanGuardProvider } from "../context/OceanGuardContext.jsx";
import { ToastProvider } from "../components/ui/Toast.jsx";
import {
  getAcousticPresets,
  getAuditBaseline,
  getCandidateVesselRecords,
  getCandidateVessels,
  getCapaWorkflowCatalog,
  getRegions,
} from "../services/oceanGuardApi.js";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [acousticPresets, auditBaseline, candidateVesselRecords, capaCatalog, regions] =
      await Promise.all([
        getAcousticPresets(),
        getAuditBaseline(),
        getCandidateVesselRecords(),
        getCapaWorkflowCatalog(),
        getRegions(),
      ]);
    const initialCandidates = await getCandidateVessels(
      acousticPresets[0],
      5,
      candidateVesselRecords,
    );

    return {
      acousticPresets,
      auditBaseline,
      candidateVesselRecords,
      capaCatalog,
      initialCandidates,
      regions,
    };
  },
  head: () => ({
    meta: [
      { title: "OceanGuard | Marine Acoustic Compliance" },
      {
        name: "description",
        content:
          "Region-aware marine acoustic intelligence, vessel correlation, ecological review, and verified corrective-action workflows.",
      },
      { property: "og:title", content: "OceanGuard | Marine Acoustic Compliance" },
      {
        property: "og:description",
        content:
          "A six-module marine acoustic compliance workflow for auditors and port authorities.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const initialData = Route.useLoaderData();

  return (
    <ToastProvider>
      <OceanGuardProvider initialData={initialData}>
        <App />
      </OceanGuardProvider>
    </ToastProvider>
  );
}
