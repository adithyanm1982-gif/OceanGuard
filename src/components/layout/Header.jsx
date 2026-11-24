import React from "react";
import { LogOut, RotateCcw } from "lucide-react";
import { Badge, Button, StatTile } from "../ui";
import { useOceanGuard } from "../../context/OceanGuardContext.jsx";

export default function Header({ module }) {
  const { activeEvent, selectedVessel, correctiveActions, setAuditor, resetDemoState } =
    useOceanGuard();
  return (
    <header className="bg-card border-b border-border px-4 sm:px-5 lg:px-8 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl min-w-0">
          <h1 className="text-xl font-semibold text-ink">{module.title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{module.blurb}</p>
        </div>
        {/* Below lg the sidebar footer is hidden, so session actions live here */}
        <div className="flex items-center gap-2 lg:hidden">
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={resetDemoState}>
            Reset demo
          </Button>
          <Button variant="secondary" size="sm" icon={LogOut} onClick={() => setAuditor(null)}>
            Sign out
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <StatTile compact label="Event" value={activeEvent?.stationId} className="max-w-[16rem]" />
        <StatTile compact label="Vessel" value={selectedVessel?.name} className="max-w-[16rem]" />
        <StatTile compact label="Open corrective actions" value={correctiveActions.length} />
        <Badge variant="warning">Demo data: vessel and audit records are simulated</Badge>
      </div>
    </header>
  );
}
