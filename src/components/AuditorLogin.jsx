import React, { useState } from "react";
import {
  ShieldCheck,
  Lock,
  UserCheck,
  Anchor,
  Building2,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { Badge, Button, Card } from "./ui";

const PRESET_ACCOUNTS = [
  {
    name: "Dr. Elena Rostova",
    role: "Lead Marine Acoustic & URN Auditor",
    org: "DNV / Accredited ISO 17208 Verifier",
    accreditationId: "AUD-IMO-2026-8841",
  },
  {
    name: "Capt. Arjun Nair",
    role: "Port Environmental Compliance Officer",
    org: "Maritime Port Sustainability Authority",
    accreditationId: "GOV-HARIT-2026-109",
  },
];

export default function AuditorLogin({ onLogin }) {
  const [fullName, setFullName] = useState(PRESET_ACCOUNTS[0]?.name ?? "");
  const [accreditationId, setAccreditationId] = useState(PRESET_ACCOUNTS[0]?.accreditationId ?? "");
  const [organization, setOrganization] = useState(PRESET_ACCOUNTS[0]?.org ?? "");
  const [role, setRole] = useState(PRESET_ACCOUNTS[0]?.role ?? "");
  const [conflictDeclared, setConflictDeclared] = useState(true);
  const [error, setError] = useState("");

  const handleSelectPreset = (acc) => {
    setFullName(acc.name);
    setAccreditationId(acc.accreditationId);
    setOrganization(acc.org);
    setRole(acc.role);
    setError("");
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!fullName.trim() || !accreditationId.trim() || !organization.trim()) {
      setError(
        "Auditor identity, accreditation ID, and organization are mandatory for audit-trail integrity.",
      );
      return;
    }
    if (!conflictDeclared) {
      setError(
        "You must confirm the Conflict-of-Interest declaration before accessing OceanGuard audit controls.",
      );
      return;
    }

    onLogin({
      name: fullName.trim(),
      accreditationId: accreditationId.trim().toUpperCase(),
      organization: organization.trim(),
      role: role.trim(),
      conflictDeclared: true,
      sessionSignedAt: new Date().toISOString(),
    });
  };

  const field =
    "w-full bg-wash border border-border focus:border-primary rounded-md px-3 py-2.5 text-sm text-ink outline-none";

  return (
    <div className="min-h-dvh bg-chart text-foreground flex flex-col justify-between p-4 sm:p-6">
      <header className="max-w-5xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-buoy flex items-center justify-center text-instrument-foreground">
            <Anchor className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-lg text-ink">OceanGuard</span>
            <Badge variant="warning">Demo</Badge>
          </div>
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          IMO MEPC.1/Circ.906 &bull; ISO 17208 decision support
        </div>
      </header>

      <div className="max-w-4xl w-full mx-auto grid md:grid-cols-5 gap-6 my-8">
        <Card className="md:col-span-2 p-6 flex flex-col justify-between">
          <div>
            <Badge variant="accent" icon={ShieldCheck} className="mb-4">
              Audit integrity and traceability
            </Badge>
            <h1 className="text-2xl font-semibold text-ink leading-snug mb-3">
              Sign in to start an evidence-logged audit session
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Every acoustic inspection, vessel correlation review, and corrective-action
              verification is timestamped and signed to an accredited auditor profile.
            </p>

            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">
                Quick-fill accredited profiles
              </p>
              {PRESET_ACCOUNTS.map((acc) => {
                const selected = accreditationId === acc.accreditationId;
                return (
                  <Button
                    key={acc.accreditationId}
                    type="button"
                    onClick={() => handleSelectPreset(acc)}
                    aria-pressed={selected}
                    variant={selected ? "selected" : "secondary"}
                    className="w-full flex-col items-start text-left p-3"
                  >
                    <div className="text-sm font-semibold text-ink">{acc.name}</div>
                    <div className="text-xs text-primary font-mono mt-0.5">
                      {acc.accreditationId}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{acc.org}</div>
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-border text-[11px] text-muted-foreground">
            Demo sign-in runs in the browser only. In production, ship operators, auditors, and
            authorities would have separate permissions.
          </div>
        </Card>

        <Card
          as="form"
          onSubmit={handleSubmit}
          className="md:col-span-3 p-6 md:p-8 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-2 text-ink font-semibold text-lg mb-1">
              <Lock className="w-4 h-4 text-primary" aria-hidden="true" />
              Auditor and verifier sign-in
            </div>
            <p className="text-xs text-muted-foreground mb-6">
              Enter your credentials to start a session across all six OceanGuard modules.
            </p>

            {error && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-md bg-danger-wash border border-destructive/40 text-destructive text-xs flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="og-name"
                  className="block text-xs font-medium text-foreground mb-1.5"
                >
                  Auditor full name
                </label>
                <div className="relative">
                  <UserCheck
                    className="w-4 h-4 text-muted-foreground absolute left-3 top-3"
                    aria-hidden="true"
                  />
                  <input
                    id="og-name"
                    name="auditorName"
                    autoComplete="name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={`${field} pl-10`}
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="og-id"
                    className="block text-xs font-medium text-foreground mb-1.5"
                  >
                    Accreditation or licence ID
                  </label>
                  <input
                    id="og-id"
                    name="accreditationId"
                    autoComplete="off"
                    spellCheck={false}
                    type="text"
                    value={accreditationId}
                    onChange={(e) => setAccreditationId(e.target.value)}
                    className={`${field} font-mono`}
                  />
                </div>
                <div>
                  <label
                    htmlFor="og-role"
                    className="block text-xs font-medium text-foreground mb-1.5"
                  >
                    Role
                  </label>
                  <select
                    id="og-role"
                    name="auditorRole"
                    autoComplete="organization-title"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className={field}
                  >
                    <option>Lead Marine Acoustic & URN Auditor</option>
                    <option>Independent Technical Verifier</option>
                    <option>Port Environmental Compliance Officer</option>
                    <option>Marine Bioacoustics Researcher</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="og-org"
                  className="block text-xs font-medium text-foreground mb-1.5"
                >
                  Accredited organization or classification society
                </label>
                <div className="relative">
                  <Building2
                    className="w-4 h-4 text-muted-foreground absolute left-3 top-3"
                    aria-hidden="true"
                  />
                  <input
                    id="og-org"
                    name="organization"
                    autoComplete="organization"
                    type="text"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    className={`${field} pl-10`}
                  />
                </div>
              </div>

              <label className="flex items-start gap-3 p-3 rounded-md bg-wash border border-border cursor-pointer">
                <input
                  type="checkbox"
                  checked={conflictDeclared}
                  onChange={(e) => setConflictDeclared(e.target.checked)}
                  className="mt-0.5 rounded border-border bg-card text-primary focus:ring-primary"
                />
                <span className="text-xs text-foreground leading-relaxed">
                  <strong>Conflict-of-interest declaration:</strong> I hold no undisclosed financial
                  interest in the vessel operators inspected during this session.
                </span>
              </label>
            </div>
          </div>

          <Button type="submit" size="lg" block icon={ArrowRight} className="mt-6 flex-row-reverse">
            Start audit session
          </Button>
        </Card>
      </div>

      <footer className="text-center text-xs text-muted-foreground pb-1">
        OceanGuard: making quieter shipping measurable, verifiable, and worth adopting.
      </footer>
    </div>
  );
}
