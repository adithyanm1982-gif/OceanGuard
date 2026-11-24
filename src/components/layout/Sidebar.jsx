import React from "react";
import { Anchor, Check, LogOut, RotateCcw } from "lucide-react";
import { Button } from "../ui";
import { useOceanGuard } from "../../context/OceanGuardContext.jsx";

const GROUPS = ["Evidence", "Action", "Outcome"];

export default function Sidebar({ modules }) {
  const { activeTab, visited, go, auditor, setAuditor, resetDemoState } = useOceanGuard();
  return (
    <aside className="bg-ink text-instrument-muted sticky top-0 z-30 lg:h-dvh flex flex-col">
      <div className="flex items-center gap-3 px-4 lg:px-5 py-3 lg:py-4 border-b border-instrument-foreground/10">
        <div className="w-8 h-8 rounded-md bg-buoy flex items-center justify-center text-instrument-foreground shrink-0">
          <Anchor className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-instrument-foreground leading-tight">OceanGuard</div>
          <div className="text-[11px] text-instrument-muted leading-tight">
            Quieter shipping, verified
          </div>
        </div>
      </div>

      <nav
        aria-label="Workflow"
        className="flex lg:block overflow-x-auto lg:overflow-y-auto px-2 lg:px-4 py-2 lg:py-5 gap-1 lg:flex-1"
      >
        {GROUPS.map((g) => (
          <div key={g} className="flex lg:block gap-1 lg:mb-5">
            <div className="hidden lg:block px-2 pb-2 text-[11px] font-medium text-instrument-muted">
              {g}
            </div>
            <ol className="flex lg:block gap-1">
              {modules
                .filter((m) => m.group === g)
                .map((m, i, arr) => {
                  const Icon = m.icon;
                  const active = activeTab === m.id;
                  const done = visited.includes(m.id) && !active;
                  return (
                    <li key={m.id} className="relative shrink-0">
                      {i < arr.length - 1 && (
                        <span
                          aria-hidden="true"
                          className="hidden lg:block absolute left-[19px] top-9 bottom-[-4px] w-px bg-instrument-foreground/15"
                        />
                      )}
                      <Button
                        variant="onDark"
                        onClick={() => go(m.id)}
                        aria-current={active ? "page" : undefined}
                        className={`w-full flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition ${active ? "bg-instrument-foreground/10 text-instrument-foreground" : "hover:bg-instrument-foreground/5 hover:text-instrument-foreground"}`}
                      >
                        <span
                          className={`relative z-10 w-5 h-5 shrink-0 rounded-full flex items-center justify-center border ${active ? "bg-buoy border-buoy text-instrument-foreground" : done ? "bg-primary border-cyan-400 text-instrument-foreground" : "border-instrument-foreground/40 text-instrument-muted"}`}
                        >
                          {done ? (
                            <Check className="w-3 h-3" aria-hidden="true" />
                          ) : (
                            <Icon className="w-3 h-3" aria-hidden="true" />
                          )}
                          {done && <span className="sr-only">Visited</span>}
                        </span>
                        <span className="whitespace-nowrap">{m.short}</span>
                      </Button>
                    </li>
                  );
                })}
            </ol>
          </div>
        ))}
      </nav>

      <div className="hidden lg:block px-4 py-4 border-t border-instrument-foreground/10 text-xs">
        <div className="px-2">
          <div className="text-instrument-foreground font-medium truncate">{auditor.name}</div>
          <div className="text-instrument-muted font-mono truncate">{auditor.accreditationId}</div>
        </div>
        <div className="mt-3 space-y-1">
          <Button
            variant="onDark"
            size="sm"
            icon={RotateCcw}
            onClick={resetDemoState}
            className="w-full justify-start"
          >
            Reset demo state
          </Button>
          <Button
            variant="onDark"
            size="sm"
            icon={LogOut}
            onClick={() => setAuditor(null)}
            className="w-full justify-start"
          >
            Sign out
          </Button>
        </div>
      </div>
    </aside>
  );
}
