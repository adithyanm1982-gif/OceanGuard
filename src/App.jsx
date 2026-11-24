import React from "react";
import { ClipboardCheck, Compass, Globe2, Landmark, Radio, Wrench } from "lucide-react";
import AuditorLogin from "./components/AuditorLogin.jsx";
import Sidebar from "./components/layout/Sidebar.jsx";
import Header from "./components/layout/Header.jsx";
import Module1Acoustic from "./components/Module1Acoustic.jsx";
import Module2AIS from "./components/Module2AIS.jsx";
import Module3Ecological from "./components/Module3Ecological.jsx";
import Module4Audit from "./components/Module4Audit.jsx";
import Module5CAPA from "./components/Module5CAPA.jsx";
import Module6Incentives from "./components/Module6Incentives.jsx";
import { useOceanGuard } from "./context/OceanGuardContext.jsx";

const MODULES = [
  {
    id: 1,
    short: "Acoustic analysis",
    group: "Evidence",
    title: "Marine acoustic intelligence",
    blurb: "Analyse a hydrophone recording and see what the signal shows.",
    icon: Radio,
  },
  {
    id: 2,
    short: "Vessel correlation",
    group: "Evidence",
    title: "Vessel intelligence & correlation",
    blurb: "Rank vessels that may have contributed. Proximity is not proof.",
    icon: Compass,
  },
  {
    id: 3,
    short: "Sensitive areas",
    group: "Evidence",
    title: "Marine-sensitive-area intelligence",
    blurb: "Check overlap with protected areas and species records.",
    icon: Globe2,
  },
  {
    id: 4,
    short: "Ship audit",
    group: "Action",
    title: "Ship audit & compliance",
    blurb: "Record inspection findings for the selected vessel.",
    icon: ClipboardCheck,
  },
  {
    id: 5,
    short: "Corrective action",
    group: "Action",
    title: "Corrective action & verification",
    blurb: "Track each finding through repair and independent verification.",
    icon: Wrench,
  },
  {
    id: 6,
    short: "Incentives",
    group: "Outcome",
    title: "Government & incentive dashboard",
    blurb: "See participation and possible incentive eligibility.",
    icon: Landmark,
  },
];

export default function App() {
  const { auditor, activeTab, setAuditor } = useOceanGuard();

  if (!auditor) return <AuditorLogin onLogin={setAuditor} />;

  const current = MODULES.find((module) => module.id === activeTab) ?? MODULES[0];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <Sidebar modules={MODULES} />
      <div className="min-w-0 flex flex-col">
        <Header module={current} />
        <div className="flex-1 px-4 py-6 sm:px-5 lg:px-8">
          <div className="w-full max-w-[1400px]">
            {current.id === 1 && <Module1Acoustic />}
            {current.id === 2 && <Module2AIS />}
            {current.id === 3 && <Module3Ecological />}
            {current.id === 4 && <Module4Audit />}
            {current.id === 5 && <Module5CAPA />}
            {current.id === 6 && <Module6Incentives />}
          </div>
        </div>
      </div>
    </div>
  );
}
