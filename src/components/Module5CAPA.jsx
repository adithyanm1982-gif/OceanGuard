import React, { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Wrench,
  CheckCircle2,
  ShieldCheck,
  UploadCloud,
  BarChart3,
  ArrowRightCircle,
  FileCheck2,
  History,
  Hourglass,
  Link2,
  ShieldAlert,
  FileDown,
  Printer,
} from "lucide-react";
import { exportComplianceDossier, validateCapaTransition, verifyCapaChain } from "../services/oceanGuardApi.js";
import {
  GENESIS_HASH,
  truncateHash,
  requiredSignerRole,
  verifyAttestation,
  SIGNER_ROLE_FIELD_AUDITOR,
  SIGNER_ROLE_INDEPENDENT_REVIEWER,
} from "../algorithms/ecologicalAndAudit.js";
import { useOceanGuard } from "../context/OceanGuardContext.jsx";
import { Card, Badge, Button, StatTile } from "./ui";

const evidenceLabel = (id, options) => options.find((option) => option.id === id)?.label || id;
const formatWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const dossierSlug = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "report";

function downloadTextFile(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** One-click evidence dossier export (JSON package and printable HTML) with a confirmation toast. */
function EvidenceDossierBar({ label, slugSource, buildState }) {
  const { notify } = useOceanGuard();
  const [busy, setBusy] = useState(null);

  const run = async (kind) => {
    setBusy(kind);
    try {
      const { report, html } = await exportComplianceDossier(buildState());
      const base = `oceanguard-dossier-${dossierSlug(slugSource)}`;
      if (kind === "json") {
        downloadTextFile(`${base}.json`, JSON.stringify(report, null, 2), "application/json");
        notify("Dossier exported", `${base}.json downloaded.`);
      } else {
        downloadTextFile(`${base}.html`, html, "text/html");
        notify("Dossier exported", `${base}.html downloaded. Open it and use Print / Save as PDF.`);
      }
    } catch (error) {
      notify("Export failed", error?.message ?? "The dossier could not be generated.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Export Evidence Dossier</h2>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={FileDown} disabled={busy !== null} onClick={() => run("json")}>
          Download JSON Package
        </Button>
        <Button variant="primary" size="sm" icon={Printer} disabled={busy !== null} onClick={() => run("html")}>
          Download Printable Report (HTML)
        </Button>
      </div>
    </Card>
  );
}

/**
 * Auditor sign-off for one stage transition. Advancing needs an evidence selection or a verification
 * note (and, for the final stage, a re-scan and a measured reduction). Remounted per stage via `key`.
 */
function VerificationGate({ capa, completedStage }) {
  const { auditor, advanceCapaStage, capaCatalog } = useOceanGuard();
  const [evidence, setEvidence] = useState([]);
  const [note, setNote] = useState("");
  const [measured, setMeasured] = useState("");
  const [refusal, setRefusal] = useState([]);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerId, setReviewerId] = useState("");

  const toStage = completedStage + 1;
  const closing = toStage === capaCatalog.finalStage;
  const signerRole = requiredSignerRole(toStage);
  const isReviewerStage = signerRole === SIGNER_ROLE_INDEPENDENT_REVIEWER;
  const input = {
    evidence,
    note,
    measuredReductionDb: measured === "" ? null : Number(measured),
    signerRole,
    enforceRoleSeparation: true,
    ...(isReviewerStage ? { reviewerName, reviewerId } : {}),
  };
  const { data: check } = useQuery({
    queryKey: [
      "capa-transition-check",
      capa.id,
      capa.currentStage,
      evidence,
      note,
      measured,
      auditor?.name,
      reviewerName,
      reviewerId,
    ],
    queryFn: () => validateCapaTransition(capa, input, auditor),
  });

  const toggle = (id) =>
    setEvidence((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const submit = async () => {
    const result = await advanceCapaStage(capa.id, input);
    if (!result?.ok) setRefusal(result?.errors || []);
  };

  return (
    <Card tone="wash" padded={false} className="mt-2 p-4 space-y-3 border-l-4 border-l-cyan-500">
      <div>
        <div className="text-xs font-semibold text-ink">
          {isReviewerStage ? "Independent review" : "Auditor verification"} &mdash; stage{" "}
          {completedStage} &rarr; {toStage}
          <Badge variant={isReviewerStage ? "warning" : "neutral"} className="ml-2">
            Sign-off: {signerRole}
            {isReviewerStage && " / Port Authority"}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {isReviewerStage
            ? "Stages 7–8 require an Independent Reviewer / Port Authority, separate from the Field Auditor who signed Stages 1–6. Confirm the reviewer's name and ID below."
            : "Stages 1–6 record Field Auditor sign-off. Select the evidence you have checked, or record a verification note. This is logged with your name and a timestamp."}
        </p>
      </div>

      {isReviewerStage && (
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-[11px] font-medium text-foreground space-y-1">
            Reviewer name
            <input
              type="text"
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              autoComplete="off"
              className="block w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </label>
          <label className="text-[11px] font-medium text-foreground space-y-1">
            Reviewer / authority ID
            <input
              type="text"
              value={reviewerId}
              onChange={(e) => setReviewerId(e.target.value)}
              autoComplete="off"
              className="block w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </label>
        </div>
      )}

      <fieldset className="space-y-1.5">
        <legend className="text-[11px] font-medium text-foreground mb-1">Evidence checklist</legend>
        {capaCatalog.evidenceOptions.map((opt) => (
          <label
            key={opt.id}
            className="flex items-center gap-2 text-xs text-foreground cursor-pointer"
          >
            <input
              type="checkbox"
              checked={evidence.includes(opt.id)}
              onChange={() => toggle(opt.id)}
              className="rounded border-border bg-card text-primary"
            />
            <span>{opt.label}</span>
            {opt.suggestedFor.includes(completedStage) && <Badge variant="accent">Suggested</Badge>}
          </label>
        ))}
      </fieldset>

      <div>
        <label htmlFor={`note-${capa.id}`} className="text-[11px] font-medium text-foreground">
          Verification note
        </label>
        <textarea
          id={`note-${capa.id}`}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you check, and what did you find?"
          className="mt-1 w-full bg-card border border-border focus:border-primary rounded-md p-2 text-xs text-foreground outline-none"
        />
      </div>

      {closing && (
        <div>
          <label
            htmlFor={`measured-${capa.id}`}
            className="text-[11px] font-medium text-foreground"
          >
            Measured reduction from the repeat acoustic pass (dB)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id={`measured-${capa.id}`}
              type="number"
              min="0"
              step="0.1"
              value={measured}
              onChange={(e) => setMeasured(e.target.value)}
              className="w-24 bg-card border border-border rounded-md px-2 py-1 text-xs font-mono text-ink"
            />
            {Number.isFinite(capa.targetReductionDb) && (
              <span className="text-[11px] text-muted-foreground">
                Target was −{capa.targetReductionDb.toFixed(1)} dB
              </span>
            )}
          </div>
        </div>
      )}

      {check && !check.ok && (
        <ul
          className="text-[11px] text-muted-foreground list-disc list-inside space-y-0.5"
          aria-live="polite"
        >
          {check.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {refusal.length > 0 && (
        <p role="alert" className="text-[11px] text-destructive">
          {refusal.join(" ")}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {isReviewerStage ? (
            <>
              Signing as <span className="text-foreground">{reviewerName.trim() || "—"}</span>
              {reviewerId.trim() && (
                <>
                  {" "}
                  (<span className="font-mono">{reviewerId.trim()}</span>)
                </>
              )}{" "}
              &middot; {SIGNER_ROLE_INDEPENDENT_REVIEWER}
            </>
          ) : (
            <>
              Signing as <span className="text-foreground">{auditor?.name}</span>
              {auditor?.accreditationId && (
                <>
                  {" "}
                  (<span className="font-mono">{auditor.accreditationId}</span>)
                </>
              )}{" "}
              &middot; {SIGNER_ROLE_FIELD_AUDITOR}
            </>
          )}
        </span>
        <Button size="sm" icon={ShieldCheck} disabled={!check?.ok} onClick={submit}>
          {completedStage === 6
            ? `Sign Independent Verification → stage ${toStage}`
            : `Verify & advance to stage ${toStage}`}
        </Button>
      </div>
    </Card>
  );
}

/** Accepts a string, an object, or a list of either; returns display strings. */
const flagText = (f) =>
  typeof f === "string" ? f : f?.message || f?.label || f?.reason || f?.code || f?.type || "";

/**
 * Vessel-specific COI declaration and audit anomaly flags (written by the Phase 2A audit). Reads the CAPA
 * (fields `coiDeclaration` / `anomalyFlags`); renders "none on file" when Phase 2A data is absent.
 */
function CapaIntegrityPanel({ capa }) {
  const coi = capa.coiDeclaration ?? capa.coi ?? null;
  const rawFlags = capa.anomalyFlags ?? capa.auditAnomalyFlags ?? [];
  const flags = (Array.isArray(rawFlags) ? rawFlags : [rawFlags]).map(flagText).filter(Boolean);
  const coiText =
    typeof coi === "string"
      ? coi
      : coi
        ? coi.statement || coi.summary || (coi.declared === false ? "No conflict declared" : "Conflict of interest declared")
        : "";
  const coiDeclared = coi && typeof coi === "object" ? coi.declared !== false : Boolean(coi);

  return (
    <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">COI declaration ({capa.vesselName}):</span>
        {coiText ? (
          <Badge variant={coiDeclared ? "warning" : "success"}>{coiText}</Badge>
        ) : (
          <Badge variant="neutral">None on file</Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">Audit anomaly flags:</span>
        {flags.length === 0 ? (
          <Badge variant="success">None</Badge>
        ) : (
          flags.map((f) => (
            <Badge key={f} variant="danger" icon={ShieldAlert}>
              {f}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

export default function Module5CAPA() {
  const { correctiveActions, go, capaCatalog, activeEvent, selectedVessel, auditAreas, auditor } =
    useOceanGuard();
  const [selectedCapaId, setSelectedCapaId] = useState(correctiveActions[0]?.id || "");
  const [uploadedDocs, setUploadedDocs] = useState({});
  const evidenceFileRef = useRef(null);
  const newestCapaId = correctiveActions[0]?.id;

  useEffect(() => {
    if (newestCapaId) {
      setSelectedCapaId(newestCapaId);
    }
  }, [newestCapaId]);

  const activeCapa = correctiveActions.find((c) => c.id === selectedCapaId) || correctiveActions[0];
  const { data: chain } = useQuery({
    queryKey: ["capa-chain", activeCapa?.id, activeCapa?.history],
    queryFn: () => verifyCapaChain(activeCapa),
    enabled: Boolean(activeCapa),
  });

  const handleEvidenceUpload = (e) => {
    const f = e.target.files?.[0];
    if (f && activeCapa) setUploadedDocs((prev) => ({ ...prev, [activeCapa.id]: f.name }));
  };

  if (!activeCapa) {
    return (
      <Card tone="wash" className="max-w-2xl mx-auto text-center py-10 space-y-3">
        <Badge variant="warning" icon={Wrench}>
          No corrective actions yet
        </Badge>
        <h2 className="text-base font-semibold text-ink">Nothing to track</h2>
        <p className="text-sm text-muted-foreground">
          Flag a non-compliant or observation finding in Ship audit to open a corrective action.
        </p>
      </Card>
    );
  }

  const history = activeCapa.history || [];
  const closed = activeCapa.currentStage >= capaCatalog.finalStage;
  const target = Number.isFinite(activeCapa.targetReductionDb)
    ? activeCapa.targetReductionDb
    : null;
  const measured = activeCapa.verifiedReductionDb > 0 ? activeCapa.verifiedReductionDb : null;
  const uploadedDocName = uploadedDocs[activeCapa.id];

  // Illustrative band profile scaled so its mean reduction equals the measured reduction.
  const meanSample =
    capaCatalog.octaveBands.reduce((a, b) => a + (b.beforeDb - b.afterDb), 0) /
    capaCatalog.octaveBands.length;
  const bands = capaCatalog.octaveBands.map((b) => ({
    ...b,
    afterDb: measured
      ? Number((b.beforeDb - (b.beforeDb - b.afterDb) * (measured / meanSample)).toFixed(1))
      : b.afterDb,
  }));

  return (
    <div className="space-y-6">
      <EvidenceDossierBar
        label={`Compiles ${activeCapa.id} and its SHA-256 verification chain with the event, ecology and audit evidence.`}
        slugSource={activeCapa.id}
        buildState={() => ({
          event: activeEvent,
          vessel:
            selectedVessel && selectedVessel.imo === activeCapa.vesselImo
              ? selectedVessel
              : { name: activeCapa.vesselName, imo: activeCapa.vesselImo },
          auditAreas,
          auditor,
          correctiveActions: correctiveActions.filter((c) => c.vesselImo === activeCapa.vesselImo),
        })}
      />
      <div className="grid md:grid-cols-3 gap-4">
        {correctiveActions.map((capa) => {
          const isSelected = capa.id === activeCapa.id;
          const isVerified = capa.currentStage >= 7 && capa.verifiedReductionDb > 0;
          return (
            <Card
              key={capa.id}
              as="button"
              type="button"
              tone={isSelected ? "surface" : "wash"}
              padded={false}
              aria-pressed={isSelected}
              onClick={() => setSelectedCapaId(capa.id)}
              className={`text-left p-4 transition flex flex-col justify-between ${isSelected ? "ring-2 ring-primary" : "hover:shadow-panel"}`}
            >
              <div className="w-full">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-mono text-primary">{capa.id}</span>
                  <Badge variant={isVerified ? "success" : "warning"} className="font-mono">
                    {isVerified ? "Verified" : `Stage ${capa.currentStage}/8`}
                  </Badge>
                </div>
                <div className="text-sm font-bold text-ink">{capa.component} Remediation</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {capa.vesselName} (IMO {capa.vesselImo})
                </div>
              </div>
              <div className="w-full mt-3 pt-2.5 border-t border-border space-y-1">
                <StatTile
                  compact
                  className="justify-between"
                  label="Target reduction"
                  value={
                    Number.isFinite(capa.targetReductionDb)
                      ? `−${capa.targetReductionDb.toFixed(1)}`
                      : "—"
                  }
                  unit="dB"
                />
                <StatTile
                  compact
                  className="justify-between"
                  label="Verified reduction"
                  value={
                    capa.verifiedReductionDb > 0
                      ? `−${capa.verifiedReductionDb.toFixed(1)}`
                      : "Pending"
                  }
                  unit={capa.verifiedReductionDb > 0 ? "dB" : undefined}
                  tone={capa.verifiedReductionDb > 0 ? "success" : "default"}
                />
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-7 space-y-5 lg:self-start">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
                <Wrench className="w-4 h-4 text-primary" aria-hidden="true" />
                8-Stage Corrective Action & Independent Verification Lifecycle
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Record {activeCapa.id} &bull; Initiated by {activeCapa.createdBy}
                {activeCapa.createdAt && <> &bull; {formatWhen(activeCapa.createdAt)}</>}
              </p>
              <CapaIntegrityPanel capa={activeCapa} />
            </div>
            <Badge variant="accent" className="font-mono">
              Stage {activeCapa.currentStage} of 8
            </Badge>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <Card tone="wash" padded={false} className="p-3.5">
              <div className="text-[11px] text-muted-foreground">Audit Finding</div>
              <div className="text-xs text-foreground mt-1">{activeCapa.finding}</div>
            </Card>
            <Card tone="wash" padded={false} className="p-3.5">
              <div className="text-[11px] text-muted-foreground">Qualified Recommendation</div>
              <div className="text-xs text-primary mt-1">{activeCapa.recommendedAction}</div>
            </Card>
          </div>

          <ol className="space-y-2.5">
            {capaCatalog.stages.map((st) => {
              const done = activeCapa.currentStage >= st.step;
              const current = activeCapa.currentStage === st.step;
              return (
                <li key={st.step} aria-current={current ? "step" : undefined}>
                  <Card
                    tone="wash"
                    padded={false}
                    className={`p-3 flex items-center justify-between gap-3 transition ${
                      current
                        ? "ring-2 ring-primary bg-card"
                        : done
                          ? "border-success/40"
                          : "opacity-65"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-mono font-bold ${
                          done
                            ? "bg-success-wash text-success border border-success/40"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {done ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : st.step}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-ink">
                          {st.step}. {st.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{st.desc}</div>
                      </div>
                    </div>
                    {current && !closed && (
                      <Badge variant="warning" icon={Hourglass}>
                        Awaiting verification
                      </Badge>
                    )}
                    {st.step === capaCatalog.finalStage && done && (
                      <Badge variant="success" icon={ShieldCheck}>
                        Closed & verified
                      </Badge>
                    )}
                  </Card>
                  {current && !closed && (
                    <VerificationGate
                      key={`${activeCapa.id}-${activeCapa.currentStage}`}
                      capa={activeCapa}
                      completedStage={st.step}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </Card>

        <Card className="lg:col-span-5 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="text-xs font-semibold text-primary">
              Verification Evidence & Repeat Acoustic Pass
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Target reduction"
                value={target !== null ? `−${target.toFixed(1)}` : "—"}
                unit="dB"
                tone="accent"
                hint="Planning estimate"
              />
              <StatTile
                label="Verified reduction"
                value={measured ? `−${measured.toFixed(1)}` : "Pending"}
                unit={measured ? "dB" : undefined}
                tone={measured ? "success" : "default"}
                hint={measured ? "Repeat acoustic pass" : "Set at stage 8"}
              />
            </div>
            {activeCapa.targetBasis && (
              <p className="text-[11px] text-muted-foreground">{activeCapa.targetBasis}</p>
            )}

            <Card tone="wash" padded={false} className="p-3.5 space-y-2.5">
              <div className="text-xs text-foreground font-medium flex items-center gap-1.5">
                <FileCheck2 className="w-4 h-4 text-success" aria-hidden="true" />
                Attached Completion Record
              </div>
              <div className="text-xs font-mono text-primary bg-card px-3 py-2 rounded-md border border-border truncate">
                {uploadedDocName || "No file attached"}
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={UploadCloud}
                onClick={() => evidenceFileRef.current?.click()}
              >
                Attach Dry-Dock / Diver Evidence PDF
              </Button>
              <input
                ref={evidenceFileRef}
                type="file"
                accept="application/pdf,.pdf"
                aria-label="Completion evidence PDF"
                onChange={handleEvidenceUpload}
                className="hidden"
              />
              <p className="text-[11px] text-muted-foreground">
                Demo: the file name is recorded; the file itself is not stored.
              </p>
            </Card>

            {measured ? (
              <Card tone="wash" padded={false} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink flex items-center gap-1.5">
                    <BarChart3 className="w-4 h-4 text-primary" aria-hidden="true" />
                    ISO 17208 Repeat Acoustic Comparison
                  </span>
                  <Badge variant="success" className="font-mono">
                    −{measured.toFixed(1)} dB mean
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Illustrative 1/3-octave profile (dB re 1 µPa @ 1 m), scaled so its mean equals the
                  reduction recorded at stage 8.
                </p>
                <div className="space-y-2 pt-1">
                  {bands.map((band) => {
                    const beforePct = Math.min(
                      100,
                      Math.max(20, ((band.beforeDb - 140) / 45) * 100),
                    );
                    const afterPct = Math.min(100, Math.max(20, ((band.afterDb - 140) / 45) * 100));
                    return (
                      <div key={band.freq} className="space-y-1">
                        <div className="flex justify-between text-[10px] font-mono">
                          <span className="text-muted-foreground">{band.freq}</span>
                          <span>
                            <span className="text-warning">{band.beforeDb}</span>
                            <span className="text-muted-foreground"> &rarr; </span>
                            <span className="text-success">{band.afterDb} dB</span>
                          </span>
                        </div>
                        <div className="space-y-1">
                          <div className="h-1.5 bg-card rounded-full overflow-hidden border border-border">
                            <div
                              style={{ width: `${beforePct}%` }}
                              className="h-full bg-warning/80 rounded-full"
                            />
                          </div>
                          <div className="h-1.5 bg-card rounded-full overflow-hidden border border-border">
                            <div
                              style={{ width: `${afterPct}%` }}
                              className="h-full bg-success rounded-full"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-warning" aria-hidden="true" />{" "}
                    Pre-Maintenance
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-success" aria-hidden="true" />{" "}
                    Post-Verification
                  </span>
                </div>
              </Card>
            ) : (
              <Card
                tone="wash"
                padded={false}
                className="p-4 text-xs text-muted-foreground space-y-1.5"
              >
                <Badge variant="neutral" icon={BarChart3}>
                  Repeat acoustic comparison pending
                </Badge>
                <p>
                  The before/after comparison appears once stage 8 is verified with a measured
                  reduction from a comparable hydrophone pass.
                </p>
              </Card>
            )}

            <Card tone="wash" padded={false} className="p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-ink flex items-center gap-1.5">
                  <History className="w-4 h-4 text-primary" aria-hidden="true" />
                  Verification log
                </div>
                {chain && (
                  <Badge
                    variant={chain.valid ? "success" : "danger"}
                    icon={chain.valid ? ShieldCheck : ShieldAlert}
                  >
                    {chain.valid
                      ? chain.legacyCount > 0 && chain.checked === 0
                        ? "Legacy entries (unhashed)"
                        : "Chain Verified"
                      : "Tamper detected"}
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground border-l-2 border-border pl-2.5 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Link2 className="w-3 h-3" aria-hidden="true" />
                  <span className="font-semibold text-foreground">Genesis</span>
                </div>
                <div className="font-mono break-all" title={GENESIS_HASH}>
                  {truncateHash(GENESIS_HASH)}
                </div>
              </div>
              {chain && !chain.valid && (
                <p role="alert" className="text-[11px] text-destructive">
                  {chain.reason} The log has been altered since it was signed.
                </p>
              )}
              {chain?.valid && chain.checked > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {chain.checked} record{chain.checked === 1 ? "" : "s"} re-hashed with SHA-256
                  {chain.webCryptoVerified ? "; Web Crypto cross-check matched" : ""}
                  {chain.legacyCount > 0 ? `; ${chain.legacyCount} earlier unhashed entr${chain.legacyCount === 1 ? "y" : "ies"} not covered` : ""}.
                </p>
              )}
              {history.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  No stage verifications recorded yet. The first signed stage links to the genesis
                  hash.
                </p>
              ) : (
                <ul className="space-y-2">
                  {history.map((h, idx) => {
                    const status = chain?.entries?.[idx];
                    const broken = status && (status.linkOk === false || status.hashOk === false);
                    return (
                      <li
                        key={`${h.toStage}-${h.at}`}
                        className={`text-[11px] text-muted-foreground border-l-2 pl-2.5 space-y-1 ${broken ? "border-destructive" : "border-primary"}`}
                      >
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="font-semibold text-ink">
                            Stage {h.fromStage} → {h.toStage}
                          </span>
                          <span className="text-muted-foreground">{formatWhen(h.at)}</span>
                        </div>
                        <div>
                          {h.auditorName}
                          {h.accreditationId && (
                            <span className="font-mono text-muted-foreground">
                              {" "}
                              ({h.accreditationId})
                            </span>
                          )}
                        </div>
                        {h.signerRole && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant={
                                h.signerRole === SIGNER_ROLE_INDEPENDENT_REVIEWER
                                  ? "warning"
                                  : "neutral"
                              }
                            >
                              {h.signerRole}
                            </Badge>
                            {h.attestationSignature && (
                              <span className="font-mono" title={h.attestationSignature}>
                                <span className="text-muted-foreground">sig </span>
                                <span className="text-foreground">
                                  {truncateHash(h.attestationSignature)}
                                </span>
                                {verifyAttestation(h) === false && (
                                  <Badge variant="danger" icon={ShieldAlert} className="ml-1">
                                    Signature mismatch
                                  </Badge>
                                )}
                              </span>
                            )}
                          </div>
                        )}
                        {h.evidence?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {h.evidence.map((id) => (
                              <Badge key={id} variant="success">
                                {evidenceLabel(id, capaCatalog.evidenceOptions)}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {h.note && <p className="text-foreground">&ldquo;{h.note}&rdquo;</p>}
                        {Number.isFinite(h.measuredReductionDb) && (
                          <div className="font-mono text-success">
                            Measured −{h.measuredReductionDb.toFixed(1)} dB
                          </div>
                        )}
                        {h.recordHash ? (
                          <div className="font-mono space-y-0.5">
                            <div className="text-muted-foreground">{h.eventId}</div>
                            <div title={h.recordHash}>
                              <span className="text-muted-foreground">hash </span>
                              <span className="text-foreground">{truncateHash(h.recordHash)}</span>
                            </div>
                            <div title={h.previousHash}>
                              <span className="text-muted-foreground">prev </span>
                              {truncateHash(h.previousHash)}
                            </div>
                            <Badge
                              variant={broken ? "danger" : "success"}
                              icon={broken ? ShieldAlert : ShieldCheck}
                            >
                              {broken ? "Hash mismatch" : "Link verified"}
                            </Badge>
                          </div>
                        ) : (
                          <Badge variant="neutral">Recorded before hash chain (unverified)</Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Button size="lg" block icon={ArrowRightCircle} onClick={() => go(6)}>
            Evaluate Port & Government Incentives (Module 6)
          </Button>
        </Card>
      </div>
    </div>
  );
}
