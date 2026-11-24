import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardCheck,
  Wrench,
  CheckCircle2,
  FileSignature,
  PlusCircle,
  Ship,
  ArrowRightCircle,
  Radio,
  Search,
  ChevronDown,
  ChevronRight,
  History,
  Download,
} from "lucide-react";
import {
  auditAreaIdForRecommendedComponent,
  importPsixFindings,
  isPsixItemImported,
} from "../algorithms/ecologicalAndAudit.js";
import {
  calculateAuditSummary,
  calculateCapaTargets,
  getUscgPsixVesselProfile,
  searchUscgPsixVessels,
} from "../services/oceanGuardApi.js";
import { useOceanGuard } from "../context/OceanGuardContext.jsx";
import { Card, Badge, Button, StatTile } from "./ui";

const statusBadge = (status) =>
  status === "Compliant" ? "success" : status === "Observation" ? "warning" : "danger";
const scoreTone = (score) => (score >= 80 ? "success" : score >= 60 ? "warning" : "danger");
const STATUS_SELECT_STYLE = {
  Compliant: "bg-success-wash border-success/40 text-success",
  Observation: "bg-warning-wash border-warning/40 text-warning",
  "Non-Compliant": "bg-danger-wash border-destructive/40 text-destructive",
};

const MAX_PSIX_ROWS = 60;

const EMPTY_AUDIT_SUMMARY = {
  overallScore: 0,
  auditRating: "Calculating audit score",
  nonCompliantCount: 0,
  observationCount: 0,
  tailoredRecommendations: [],
};

/** Collapsible USCG PSIX historical lookup: search a vessel, inspect its history, import findings into the checklist. */
function PsixLookupPanel({ auditAreas, updateAuditArea, selectedVessel }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [imo, setImo] = useState(null);
  const [urnOnly, setUrnOnly] = useState(true);
  const [areaChoice, setAreaChoice] = useState({});

  const { data: search } = useQuery({
    queryKey: ["psix-search", query],
    queryFn: () => searchUscgPsixVessels(query),
    enabled: open,
  });
  const { data: profile } = useQuery({
    queryKey: ["psix-profile", imo],
    queryFn: () => getUscgPsixVesselProfile(imo),
    enabled: open && Boolean(imo),
  });

  const areaById = useMemo(() => Object.fromEntries(auditAreas.map((a) => [a.id, a])), [auditAreas]);
  const stats = search?.stats;
  const sameVesselInDataset =
    selectedVessel?.imo && search?.vessels.some((v) => v.imoNumber === String(selectedVessel.imo));

  const deficiencies = (profile?.deficiencies ?? []).filter((d) => !urnOnly || d.suggestedAreaId);
  const shownDeficiencies = deficiencies.slice(0, MAX_PSIX_ROWS);
  const targetFor = (item) => areaChoice[item.key] ?? item.suggestedAreaId ?? "";

  const importOne = (item) => {
    const area = areaById[targetFor(item)];
    const { patch } = importPsixFindings(area, [item]);
    if (patch) updateAuditArea(area.id, patch);
  };

  // Several findings for the same area are merged into one update so none overwrites another.
  const importMany = (items) => {
    const byArea = {};
    items.forEach((item) => {
      const id = targetFor(item);
      if (id) (byArea[id] ||= []).push(item);
    });
    Object.entries(byArea).forEach(([areaId, list]) => {
      const { patch } = importPsixFindings(areaById[areaId], list);
      if (patch) updateAuditArea(areaId, patch);
    });
  };

  const renderAreaSelect = (item) => (
    <select
      aria-label={`Audit area for ${item.key}`}
      value={targetFor(item)}
      onChange={(e) => setAreaChoice((c) => ({ ...c, [item.key]: e.target.value }))}
      className="rounded-md px-2 py-1.5 text-xs border border-border bg-wash text-foreground"
    >
      <option value="">Choose area…</option>
      {auditAreas.map((a) => (
        <option key={a.id} value={a.id}>
          {a.component}
        </option>
      ))}
    </select>
  );

  const renderImportButton = (item) => {
    const area = areaById[targetFor(item)];
    const done = area ? isPsixItemImported(area, item) : false;
    return (
      <Button
        size="sm"
        variant={done ? "secondary" : "primary"}
        icon={done ? CheckCircle2 : Download}
        disabled={!area || done}
        onClick={() => importOne(item)}
      >
        {done ? "Imported" : "Import"}
      </Button>
    );
  };

  return (
    <Card padded={false} className="overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="psix-panel"
        onClick={() => setOpen((v) => !v)}
        className="w-full p-5 flex flex-wrap items-center justify-between gap-2 text-left hover:bg-wash/60 transition"
      >
        <span>
          <span className="text-sm font-semibold text-ink flex items-center gap-2">
            <History className="w-4 h-4 text-primary" aria-hidden="true" />
            USCG PSIX Historical Deficiency Lookup
          </span>
          <span className="block text-xs text-muted-foreground mt-0.5">
            25 real vessels, 40 inspections, 288 deficiencies, 29 operational controls (2015 PSIX exports).
          </span>
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div id="psix-panel" className="border-t border-border p-5 space-y-4">
          <div className="grid lg:grid-cols-12 gap-4">
            <div className="lg:col-span-4 space-y-2">
              <label className="relative block">
                <span className="sr-only">Search vessel by name or IMO number</span>
                <Search
                  className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Vessel name or IMO number"
                  className="w-full bg-wash border border-border rounded-md pl-8 pr-2 py-2 text-xs text-ink"
                />
              </label>
              {stats && (
                <p className="text-[11px] text-muted-foreground">
                  {search.vessels.length} of {stats.vessels} vessels
                  {sameVesselInDataset ? " (the selected vessel is in this dataset)" : ""}
                </p>
              )}
              <ul className="max-h-72 overflow-y-auto divide-y divide-border border border-border rounded-md">
                {(search?.vessels ?? []).map((v) => (
                  <li key={v.imoNumber}>
                    <button
                      type="button"
                      aria-pressed={imo === v.imoNumber}
                      onClick={() => setImo(v.imoNumber)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-wash ${imo === v.imoNumber ? "bg-wash" : ""}`}
                    >
                      <span className="font-semibold text-ink">{v.vesselName}</span>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        IMO {v.imoNumber} &bull; {v.deficiencyCount} deficiencies &bull; {v.controlCount}{" "}
                        controls
                      </span>
                    </button>
                  </li>
                ))}
                {search && search.vessels.length === 0 && (
                  <li className="px-3 py-3 text-xs text-muted-foreground">No vessel matches.</li>
                )}
              </ul>
            </div>

            <div className="lg:col-span-8 space-y-4">
              {!profile ? (
                <p className="text-xs text-muted-foreground">
                  Select a vessel to see its historical deficiencies and operational controls.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="accent" className="font-mono">
                      IMO {profile.imoNumber}
                    </Badge>
                    <h3 className="text-sm font-bold text-ink">{profile.vesselName}</h3>
                    <Badge variant="neutral">{profile.vesselType}</Badge>
                    <Badge variant="neutral">{profile.flag}</Badge>
                    {profile.buildYear && <Badge variant="neutral">Built {profile.buildYear}</Badge>}
                    <Badge variant="neutral">{profile.inspectionCount} inspections</Badge>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={urnOnly}
                        onChange={(e) => setUrnOnly(e.target.checked)}
                      />
                      URN-related only (propeller, hull, engines, generators, thrusters)
                    </label>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Download}
                      disabled={!deficiencies.some((d) => targetFor(d))}
                      onClick={() => importMany(deficiencies)}
                    >
                      Import all shown with an area
                    </Button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <caption className="sr-only">Historical deficiencies</caption>
                      <thead>
                        <tr className="bg-wash border-b border-border text-[11px] font-semibold text-muted-foreground">
                          <th scope="col" className="py-2 px-3">System / Subsystem / Component</th>
                          <th scope="col" className="py-2 px-3">Deficiency</th>
                          <th scope="col" className="py-2 px-3">Audit area</th>
                          <th scope="col" className="py-2 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border text-xs">
                        {shownDeficiencies.map((d) => (
                          <tr key={d.key} className="align-top">
                            <td className="py-2 px-3">
                              <div className="font-semibold text-ink">{d.system}</div>
                              <div className="text-foreground">{d.subsystem}</div>
                              <div className="text-muted-foreground">{d.component}</div>
                              {d.deficiencyCode && (
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {d.deficiencyCode}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-3 max-w-sm">
                              <p className="line-clamp-4 text-foreground">{d.deficiencyDescription}</p>
                              <div className="font-mono text-[10px] text-muted-foreground mt-1">
                                Issued {d.issuedDate ?? "—"}
                                {d.resolvedDate ? ` • resolved ${d.resolvedDate}` : " • unresolved"}
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              {renderAreaSelect(d)}
                            </td>
                            <td className="py-2 px-3 text-right">
                              {renderImportButton(d)}
                            </td>
                          </tr>
                        ))}
                        {shownDeficiencies.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-4 px-3 text-muted-foreground">
                              {urnOnly
                                ? "No URN-related deficiencies recorded. Untick the filter to see all."
                                : "No deficiencies recorded for this vessel."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {deficiencies.length > MAX_PSIX_ROWS && (
                    <p className="text-[11px] text-muted-foreground">
                      Showing the first {MAX_PSIX_ROWS} of {deficiencies.length}.
                    </p>
                  )}

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-foreground">
                      Operational controls ({profile.controls.length})
                    </h4>
                    {profile.controls.length === 0 && (
                      <p className="text-xs text-muted-foreground">None recorded.</p>
                    )}
                    {profile.controls.map((c) => (
                      <Card
                        key={c.key}
                        tone="wash"
                        padded={false}
                        className="p-3 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="text-xs space-y-0.5">
                          <div className="font-semibold text-ink">
                            {c.type}
                            {c.category ? ` • ${c.category}` : ""}
                          </div>
                          <div className="text-muted-foreground">{c.reasonImposed}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            Imposed {c.dateImposed ?? "—"}
                            {c.dateRemoved ? ` • removed ${c.dateRemoved}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {renderAreaSelect(c)}
                          {renderImportButton(c)}
                        </div>
                      </Card>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Imported findings are appended to the chosen area&apos;s technical findings note with a
                    PSIX reference. Suggested areas are a heuristic: PSIX deficiencies are general
                    safety items, not URN measurements.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function Module4Audit() {
  const {
    auditor,
    activeEvent,
    selectedVessel,
    auditAreas,
    updateAuditArea,
    raiseCorrectiveAction,
    go,
    correctiveActions,
  } = useOceanGuard();
  const { data: auditSummary = EMPTY_AUDIT_SUMMARY } = useQuery({
    queryKey: ["audit-summary", auditAreas, selectedVessel],
    queryFn: () => calculateAuditSummary(auditAreas, selectedVessel),
  });
  const { data: capaTargets = {} } = useQuery({
    queryKey: ["capa-targets", auditAreas, selectedVessel, activeEvent],
    queryFn: () => calculateCapaTargets(auditAreas, selectedVessel, activeEvent),
  });

  const handleStatusChange = (id, newStatus) => {
    const defaultScore = newStatus === "Compliant" ? 90 : newStatus === "Observation" ? 65 : 40;
    updateAuditArea(id, { status: newStatus, score: defaultScore });
  };

  const classifierAreaId = auditAreaIdForRecommendedComponent(activeEvent?.recommendedAuditComponent);
  const classifierHint = activeEvent?.recommendedAuditComponent;
  const hasClassifierHint = Boolean(classifierHint) && classifierHint !== "None";

  const flagged = (areaId) =>
    correctiveActions.some((ca) => ca.areaId === areaId && ca.vesselImo === selectedVessel?.imo);
  const targetFor = (areaId) => {
    return capaTargets[areaId] ?? null;
  };

  return (
    <div className="space-y-6">
      {!selectedVessel && (
        <Card
          tone="wash"
          padded={false}
          role="status"
          className="p-4 flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-amber-500"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-foreground">
            <Badge variant="warning" icon={Ship}>
              No vessel selected
            </Badge>
            <span>
              Corrective actions are raised against a specific vessel. Pick one in Vessel
              correlation first.
            </span>
          </div>
          <Button variant="secondary" size="sm" icon={ArrowRightCircle} onClick={() => go(2)}>
            Go to vessel correlation
          </Button>
        </Card>
      )}

      <div className="grid lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedVessel?.imo && (
                <Badge variant="accent" className="font-mono">
                  IMO {selectedVessel.imo}
                </Badge>
              )}
              <h2 className="text-base font-bold text-ink">
                {selectedVessel?.name || "No vessel selected"}
              </h2>
            </div>
            {selectedVessel && (
              <p className="text-xs text-muted-foreground mt-1">
                {selectedVessel.vesselType} &bull; {Number(selectedVessel.dwt).toLocaleString()} DWT
                &bull; Propulsion:{" "}
                <span className="text-foreground">{selectedVessel.propellerType}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <StatTile
              label="Weighted URN Audit Score"
              value={`${auditSummary.overallScore}/100`}
              tone={scoreTone(auditSummary.overallScore)}
              hint={auditSummary.auditRating}
              className="min-w-[210px]"
            />
          </div>
        </Card>

        <Card className="lg:col-span-4 flex flex-col justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-success">
            <FileSignature className="w-4 h-4" aria-hidden="true" />
            <span>Tamper-Evident Audit Trail Active</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2 space-y-1">
            <div>
              Auditor: <span className="text-foreground">{auditor?.name}</span> (
              <span className="font-mono text-primary">{auditor?.accreditationId}</span>)
            </div>
            <div>COI declaration recorded at sign-in &bull; Role separation: prototype simulation</div>
          </div>
        </Card>
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="p-5 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-primary" aria-hidden="true" />
              7-Area Technical & Operational URN Compliance Assessment
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Assess ship-specific components per IMO MEPC.1/Circ.906/Rev.1 and ISO 17208
              procedures. Adjust status or score to recalculate recommendations live.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2" aria-label="Reference standards">
              <Badge variant="info">IMO MEPC.1/Circ.906/Rev.1</Badge>
              <Badge variant="info">ISO 17208-1 (deep water)</Badge>
              <Badge variant="info">ISO 17208-3 (shallow water)</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Guidance references only: OceanGuard is a decision-support tool and does not certify
              vessels. Acoustic performance claims need ISO 17208 measurements; measures are
              ship-specific, not one-size-fits-all.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="danger">{auditSummary.nonCompliantCount} non-compliant</Badge>
            <Badge variant="warning">{auditSummary.observationCount} observation</Badge>
          </div>
        </div>

        {hasClassifierHint && (
          <div
            role="status"
            className="px-5 py-3 border-b border-border bg-info-wash text-xs text-foreground flex flex-wrap items-center gap-2"
          >
            <Badge variant="accent" icon={Radio}>
              Flagged by Acoustic Classifier
            </Badge>
            <span>
              Module 1 recommends auditing <strong>{classifierHint}</strong>
              {classifierAreaId
                ? "."
                : ", which has no matching row in this checklist; assess it under the closest area."}
              {activeEvent?.cavitationDetected ? " Cavitation was detected in the recording." : ""}
            </span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-wash border-b border-border text-[11px] font-semibold text-muted-foreground">
                <th scope="col" className="py-3 px-4">
                  Ship Component
                </th>
                <th scope="col" className="py-3 px-4">
                  What Should Be Assessed
                </th>
                <th scope="col" className="py-3 px-4">
                  Status
                </th>
                <th scope="col" className="py-3 px-4">
                  Score
                </th>
                <th scope="col" className="py-3 px-4">
                  Technical Findings & Evidence
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {auditAreas.map((area) => {
                const alreadyFlagged = flagged(area.id);
                const byClassifier = hasClassifierHint && area.id === classifierAreaId;
                return (
                  <tr
                    key={area.id}
                    className={`hover:bg-wash/60 transition ${byClassifier ? "bg-info-wash/60 outline outline-1 -outline-offset-1 outline-primary/40" : ""}`}
                  >
                    <td className="py-3.5 px-4 font-semibold text-ink align-top whitespace-nowrap">
                      {area.component}
                      {byClassifier && (
                        <div className="mt-1">
                          <Badge variant="accent" icon={Radio}>
                            Flagged by Acoustic Classifier
                          </Badge>
                        </div>
                      )}
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {area.guidelineRef}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-foreground align-top max-w-xs">
                      {area.assessmentCriteria}
                    </td>
                    <td className="py-3.5 px-4 align-top">
                      <select
                        aria-label={`${area.component} status`}
                        value={area.status}
                        onChange={(e) => handleStatusChange(area.id, e.target.value)}
                        className={`rounded-md px-2.5 py-1.5 text-xs font-medium border outline-none ${STATUS_SELECT_STYLE[area.status]}`}
                      >
                        <option value="Compliant" className="bg-card">
                          Compliant
                        </option>
                        <option value="Observation" className="bg-card">
                          Observation
                        </option>
                        <option value="Non-Compliant" className="bg-card">
                          Non-Compliant
                        </option>
                      </select>
                    </td>
                    <td className="py-3.5 px-4 align-top font-mono">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        aria-label={`${area.component} score`}
                        value={area.score}
                        onChange={(e) =>
                          updateAuditArea(area.id, {
                            score: Math.min(100, Math.max(0, Number(e.target.value))),
                          })
                        }
                        className="w-16 bg-wash border border-border rounded-md px-2 py-1 text-center text-ink"
                      />
                    </td>
                    <td className="py-3.5 px-4 align-top max-w-md">
                      <textarea
                        rows={2}
                        aria-label={`${area.component} inspector note`}
                        value={area.inspectorNote}
                        onChange={(e) =>
                          updateAuditArea(area.id, { inspectorNote: e.target.value })
                        }
                        className="w-full bg-wash border border-border focus:border-primary rounded-md p-2 text-xs text-foreground outline-none"
                      />
                    </td>
                    <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                      {area.status === "Compliant" ? (
                        <Badge variant="neutral">No CAPA needed</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant={alreadyFlagged ? "secondary" : "primary"}
                          icon={alreadyFlagged ? CheckCircle2 : PlusCircle}
                          disabled={!selectedVessel}
                          onClick={() => raiseCorrectiveAction(area)}
                        >
                          {alreadyFlagged ? "CAPA Active" : "Flag & Create CAPA"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <PsixLookupPanel
        auditAreas={auditAreas}
        updateAuditArea={updateAuditArea}
        selectedVessel={selectedVessel}
      />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
              <Wrench className="w-4 h-4 text-primary" aria-hidden="true" />
              Tailored Engineering & Operational Recommendations
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {selectedVessel
                ? `Generated specifically for ${selectedVessel.name} (${selectedVessel.propellerType}), avoiding one-size-fits-all hardware mandates.`
                : "Select a vessel to tailor these recommendations to its propulsion type."}
            </p>
          </div>
          <Badge variant="neutral" className="font-mono">
            {auditSummary.tailoredRecommendations.length} active recommendations
          </Badge>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {auditSummary.tailoredRecommendations.map((rec) => {
            const target = targetFor(rec.areaId);
            return (
              <Card
                key={rec.areaId}
                tone="wash"
                padded={false}
                className="p-4 flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-bold text-ink">{rec.component}</span>
                    <Badge variant={statusBadge(rec.severity)}>{rec.severity}</Badge>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed">{rec.recommendation}</p>
                </div>
                <div className="pt-2.5 border-t border-border space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-muted-foreground">{rec.capexTier}</span>
                    <Badge variant="success" className="font-mono">
                      Achievable: {rec.estimatedUrnReductionDb}
                    </Badge>
                  </div>
                  {target && (
                    <StatTile
                      compact
                      className="justify-between"
                      label="CAPA target for this vessel"
                      value={`−${target.targetDb.toFixed(1)}`}
                      unit="dB"
                      tone="accent"
                    />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
