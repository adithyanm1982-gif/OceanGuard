import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Landmark,
  Award,
  BadgeDollarSign,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Sliders,
  Sparkles,
  Wrench,
  Anchor,
  MapPin,
  BookOpen,
  ChevronRight,
  FileDown,
  Printer,
} from "lucide-react";
import {
  exportComplianceDossier,
  calculateAuditSummary,
  calculateIncentives,
  calculatePortRebateEstimate,
  getPortTariffOptions,
} from "../services/oceanGuardApi.js";
import { computeAuthorityAggregateMetrics } from "../algorithms/ecologicalAndAudit.js";
import { useOceanGuard } from "../context/OceanGuardContext.jsx";
import { Card, Badge, Button, StatTile } from "./ui";

const POLICY_FRAMEWORKS = [
  {
    ref: "IMO MEPC.1/Circ.906/Rev.1",
    role: "International guidelines for reducing underwater radiated noise from commercial shipping.",
  },
  {
    ref: "AMSA Marine Notice 2025/02",
    role: "Australian Maritime Safety Authority notice on underwater noise from vessels.",
  },
  {
    ref: "Harit Sagar Green Port Guidelines",
    role: "India's green port guidelines, the domestic basis for port-level incentives.",
  },
];

const INCENTIVE_LIFECYCLE = [
  "Criteria Published",
  "Evidence Recorded",
  "Independent Audit",
  "Authority Review",
  "Port Rebate Applied",
  "Periodic Reassessment",
];

/** Steps OceanGuard supports with verified evidence; the rest belong to the government or port authority. */
const OCEANGUARD_STEPS = new Set([1, 2]);


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

export default function Module6Incentives() {
  const { selectedVessel, activeEvent, auditAreas, correctiveActions, auditor, go } = useOceanGuard();
  const [basePortFeeUsd, setBasePortFeeUsd] = useState(48000);
  const [policyFramework, setPolicyFramework] = useState("AMSA 2025 / IMO MEPC.1/Circ.906");
  const [chosenPortCode, setChosenPortCode] = useState(null);
  const [grossTonnageInput, setGrossTonnageInput] = useState(null);

  const { data: auditSummary } = useQuery({
    queryKey: ["incentive-audit-summary", auditAreas, selectedVessel],
    queryFn: () => calculateAuditSummary(auditAreas, selectedVessel),
  });

  // Incentives follow the selected vessel's own corrective actions only.
  const vesselActions = useMemo(
    () =>
      selectedVessel ? correctiveActions.filter((ca) => ca.vesselImo === selectedVessel.imo) : [],
    [correctiveActions, selectedVessel],
  );

  const { data: calculatedIncentives } = useQuery({
    queryKey: ["incentive-calculation", vesselActions, auditSummary?.overallScore, basePortFeeUsd],
    queryFn: () =>
      calculateIncentives(vesselActions, auditSummary?.overallScore ?? 0, basePortFeeUsd),
    enabled: Boolean(auditSummary),
  });
  const auditResult = auditSummary ?? { overallScore: 0 };
  const incentiveResult = calculatedIncentives ?? {
    tierName: "Calculating eligibility",
    totalVerifiedDbReduction: 0,
    verifiedCount: 0,
    portDuesDiscountPct: 0,
    fairwayFeeDiscountPct: 0,
    greenLabelEligible: false,
    greenFinancingEligible: false,
    priorityBerthEligible: false,
    estimatedAnnualSavingsUsd: 0,
  };

  // Port & URN tariff selector: origin is the vessel position, else the active recording's station.
  const origin = useMemo(() => {
    if (Number.isFinite(selectedVessel?.lat) && Number.isFinite(selectedVessel?.lon))
      return { lat: selectedVessel.lat, lon: selectedVessel.lon, label: "vessel position" };
    if (Number.isFinite(activeEvent?.coords?.lat) && Number.isFinite(activeEvent?.coords?.lon))
      return { lat: activeEvent.coords.lat, lon: activeEvent.coords.lon, label: "recording station" };
    return null;
  }, [selectedVessel, activeEvent]);

  const { data: portOptions } = useQuery({
    queryKey: ["port-options", origin?.lat, origin?.lon, selectedVessel?.imo],
    queryFn: () => getPortTariffOptions({ origin, vessel: selectedVessel }),
  });
  const grossTonnage = grossTonnageInput ?? portOptions?.grossTonnage?.value ?? 40000;
  const selectedPortCode = chosenPortCode ?? portOptions?.recommended ?? portOptions?.ports?.[0]?.port.portCode;
  const selectedPortRow = portOptions?.ports.find((r) => r.port.portCode === selectedPortCode);
  const selectedPort = selectedPortRow?.port;

  const { data: portRebate } = useQuery({
    queryKey: ["port-rebate", selectedPortCode, grossTonnage, incentiveResult.totalVerifiedDbReduction],
    queryFn: () =>
      calculatePortRebateEstimate(selectedPortCode, grossTonnage, incentiveResult.totalVerifiedDbReduction),
    enabled: Boolean(selectedPortCode),
  });
  const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const inProgress = vesselActions.filter(
    (ca) => !(ca.currentStage >= 7 && ca.verifiedReductionDb > 0),
  ).length;

  const incentiveCatalog = [
    {
      title: "Port Dues Discount",
      value: `${incentiveResult.portDuesDiscountPct}% Rebate`,
      active: incentiveResult.portDuesDiscountPct > 0,
      desc: "Proposed reduction on standard port call tonnage dues upon verified URN improvement.",
    },
    {
      title: "Fairway & Channel Fee Discount",
      value: `${incentiveResult.fairwayFeeDiscountPct}% Rebate`,
      active: incentiveResult.fairwayFeeDiscountPct > 0,
      desc: "Applicable in coastal sensitive-area transit corridors under port authority scheme rules.",
    },
    {
      title: "Voluntary Environmental Label",
      value: incentiveResult.greenLabelEligible
        ? "Eligible (Quiet Ship Class)"
        : "Pending Verification",
      active: incentiveResult.greenLabelEligible,
      desc: "Transparent public recognition badge linked to independently verified acoustic records.",
    },
    {
      title: "Priority Berth & Port Services",
      value: incentiveResult.priorityBerthEligible
        ? "Eligible (Tier 1)"
        : "Requires ≥ 5.0 dB Verified",
      active: incentiveResult.priorityBerthEligible,
      desc: "Preferential scheduling and shore-power hookup priority for top-tier quiet vessels.",
    },
    {
      title: "Green Financing & ESG Linked Loans",
      value: incentiveResult.greenFinancingEligible
        ? "Documentation Ready"
        : "Requires ≥ 3.0 dB Verified",
      active: incentiveResult.greenFinancingEligible,
      desc: "Auditable KPI evidence package for Poseidon Principles / sustainability-linked maritime loans.",
    },
    {
      title: "National Green Port Recognition",
      value: incentiveResult.verifiedCount > 0 ? "Active Nominee" : "In Progress",
      active: incentiveResult.verifiedCount > 0,
      desc: "Aligned with IMO MEPC.1/Circ.906, AMSA Marine Notice 2025/02, and Harit Sagar Green Port frameworks.",
    },
  ];

  // Fleet-wide roll-up: all corrective actions and all ports, not just the selected vessel.
  const aggregate = computeAuthorityAggregateMetrics(
    correctiveActions,
    auditAreas,
    portOptions?.ports?.map((r) => r.port),
  );

  return (
    <div className="space-y-6">
      <EvidenceDossierBar
        label={`Compiles the evidence dossier${selectedVessel ? ` for ${selectedVessel.name}` : ""} with the CAPA verification log and port rebate estimate${selectedPort ? ` (${selectedPort.portName})` : ""}.`}
        slugSource={selectedVessel?.name ?? activeEvent?.id ?? "fleet"}
        buildState={() => ({
          event: activeEvent,
          vessel: selectedVessel,
          auditAreas,
          auditor,
          correctiveActions: vesselActions,
          portCode: selectedPortCode,
          port: selectedPort,
          grossTonnage,
          basePortCallFeeUsd: basePortFeeUsd,
        })}
      />
      <Card className="space-y-3" aria-labelledby="authority-aggregate-title">
        <div>
          <h2 id="authority-aggregate-title" className="text-sm font-semibold text-ink flex items-center gap-2">
            <Landmark className="w-4 h-4 text-primary" aria-hidden="true" />
            Authority & Port Aggregate Overview
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Fleet-wide view for governments and port authorities, across all vessels and ports. The
            single-vessel Port URN Tariff Calculator is further down this page.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Audited vessels" value={aggregate.auditedVesselsCount} />
          <StatTile
            label="Verified CAPAs"
            value={aggregate.verifiedCapasCount}
            tone={aggregate.verifiedCapasCount > 0 ? "success" : "default"}
          />
          <StatTile
            label="Mean verified reduction"
            value={
              aggregate.meanVerifiedDbReduction === null
                ? "—"
                : `−${aggregate.meanVerifiedDbReduction.toFixed(1)}`
            }
            unit={aggregate.meanVerifiedDbReduction === null ? undefined : "dB"}
          />
          <StatTile label="Active port schemes" value={aggregate.activePortSchemesCount} />
        </div>
      </Card>

      <Card
        tone="wash"
        padded={false}
        className="p-4 flex items-start gap-3 border-l-4 border-l-amber-500"
      >
        <ShieldAlert className="w-5 h-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-xs text-foreground space-y-1">
          <div className="font-semibold text-warning">
            Governance & Regulatory Authority Boundary
          </div>
          <p>
            The incentive tiers and fee discounts displayed below are proposed decision-support
            mechanisms based on verified technical audit records. OceanGuard does not independently
            grant financial rebates or issue statutory certificates; only the relevant national
            maritime administration or port authority can establish and approve an official
            incentive programme.
          </p>
          <p className="font-medium">
            OceanGuard evaluates technical eligibility from verified acoustic and CAPA evidence.
            Only the relevant government or port authority establishes schemes and grants actual
            rebates.
          </p>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" aria-hidden="true" />
          Policy framework references
        </h2>
        <div className="flex flex-wrap gap-2">
          {POLICY_FRAMEWORKS.map((f) => (
            <Badge key={f.ref} variant="accent">
              {f.ref}
            </Badge>
          ))}
        </div>
        <ul className="grid md:grid-cols-3 gap-3 text-[11px] text-muted-foreground">
          {POLICY_FRAMEWORKS.map((f) => (
            <li key={f.ref}>
              <span className="font-semibold text-foreground">{f.ref}.</span> {f.role}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Incentive lifecycle</h2>
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[11px]">
          {INCENTIVE_LIFECYCLE.map((label, i) => {
            const n = i + 1;
            const supported = OCEANGUARD_STEPS.has(n);
            return (
              <li key={label} className="flex items-center gap-1">
                <Badge variant={supported ? "success" : "neutral"}>
                  {n}. {label}
                </Badge>
                {n < INCENTIVE_LIFECYCLE.length && (
                  <ChevronRight className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
        <p className="text-[11px] text-muted-foreground">
          Green steps are supported by OceanGuard records; Independent Audit onward depends on the
          independent reviewer and the government or port authority.
        </p>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={selectedVessel ? "accent" : "warning"}>
            {selectedVessel ? selectedVessel.name : "No vessel selected"}
          </Badge>
          <span>
            {vesselActions.length} corrective action{vesselActions.length === 1 ? "" : "s"}
            {inProgress > 0 && ` (${inProgress} not yet verified)`}. Only CAPAs past independent
            review with a measured reduction count.
          </span>
        </div>
        <Button variant="secondary" size="sm" icon={Wrench} onClick={() => go(5)}>
          Review corrective actions
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="text-xs text-muted-foreground">Assigned Incentive Tier</div>
          <div className="text-sm font-bold text-primary mt-1">{incentiveResult.tierName}</div>
          <div className="text-[11px] text-muted-foreground mt-2">
            Vessel: {selectedVessel?.name || "none selected"}
          </div>
        </Card>
        <StatTile
          className="p-5 bg-card shadow-panel"
          label="Verified URN Reduction"
          value={`-${incentiveResult.totalVerifiedDbReduction}`}
          unit="dB"
          tone="success"
          hint={`From ${incentiveResult.verifiedCount} independently verified CAPA(s)`}
        />
        <StatTile
          className="p-5 bg-card shadow-panel"
          label="Est. Annual Port Fee Savings"
          value={`$${incentiveResult.estimatedAnnualSavingsUsd.toLocaleString()}`}
          hint={`12 port calls/yr @ $${basePortFeeUsd.toLocaleString()}/call`}
        />
        <StatTile
          className="p-5 bg-card shadow-panel"
          label="Audit Compliance Score"
          value={`${auditResult.overallScore}/100`}
          tone="accent"
          hint="Independent Auditor & COI Verified"
        />
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-4 space-y-4 lg:self-start">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sliders className="w-4 h-4 text-primary" aria-hidden="true" />
            <span>Port Authority Scheme Simulator</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Adjust baseline port call dues or reference policy precedent to model ship-operator ROI
            for acoustic maintenance.
          </p>

          <div className="space-y-3 pt-1">
            <div>
              <label htmlFor="policy-framework" className="block text-xs text-foreground mb-1">
                Reference Policy Precedent
              </label>
              <select
                id="policy-framework"
                value={policyFramework}
                onChange={(e) => setPolicyFramework(e.target.value)}
                className="w-full bg-wash border border-border rounded-md px-3 py-2 text-xs text-ink outline-none"
              >
                <option>AMSA 2025 / IMO MEPC.1/Circ.906</option>
                <option>Harit Sagar Green Port Guidelines (Adapted URN)</option>
                <option>Vancouver Fraser Port EcoAction Model</option>
              </select>
            </div>

            <div>
              <label htmlFor="port-dues" className="block text-xs text-foreground mb-1">
                Average Port Call Dues (USD)
              </label>
              <input
                id="port-dues"
                type="number"
                step="1000"
                min="5000"
                value={basePortFeeUsd}
                onChange={(e) => setBasePortFeeUsd(Math.max(0, Number(e.target.value)))}
                className="w-full bg-wash border border-border rounded-md px-3 py-2 text-xs font-mono text-primary outline-none"
              />
            </div>
          </div>

          <Card
            tone="wash"
            padded={false}
            className="p-3.5 space-y-2 text-[11px] text-muted-foreground"
          >
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <Landmark className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
              <span>6-Step Incentive Lifecycle</span>
            </div>
            <ol className="list-decimal list-inside space-y-1">
              <li>Authority publishes URN scheme criteria</li>
              <li>OceanGuard records criteria & evidence</li>
              <li>Independent auditor submits signed report</li>
              <li>Authority reviews vessel eligibility</li>
              <li>Port applies approved fee rebate/label</li>
              <li>Periodic acoustic reassessment</li>
            </ol>
          </Card>
        </Card>

        <Card className="lg:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
              <Award className="w-4 h-4 text-primary" aria-hidden="true" />
              Proposed Voluntary Incentive Mechanisms ({policyFramework})
            </h2>
            <Badge variant="accent" icon={Sparkles}>
              Live from Module 5
            </Badge>
          </div>

          <div className="grid sm:grid-cols-2 gap-3.5">
            {incentiveCatalog.map((item) => (
              <Card
                key={item.title}
                tone="wash"
                padded={false}
                className={`p-4 flex flex-col justify-between space-y-2.5 ${item.active ? "border-success/50" : "opacity-75"}`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                      <BadgeDollarSign className="w-4 h-4 text-primary" aria-hidden="true" />
                      {item.title}
                    </span>
                    <Badge
                      variant={item.active ? "success" : "neutral"}
                      icon={item.active ? CheckCircle2 : XCircle}
                    >
                      {item.active ? "Active" : "Not yet"}
                    </Badge>
                  </div>
                  <div
                    className={`text-sm font-mono font-bold mt-1.5 ${item.active ? "text-success" : "text-muted-foreground"}`}
                  >
                    {item.value}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
              </Card>
            ))}
          </div>
        </Card>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Anchor className="w-4 h-4 text-primary" aria-hidden="true" />
            Port & URN Tariff Selector
          </h2>
          <Badge variant="neutral">Illustrative scheme data</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {origin
            ? `Ports are ranked by great-circle (Haversine) distance from the ${origin.label} (${origin.lat.toFixed(3)}, ${origin.lon.toFixed(3)}). The nearest eligible port is recommended; any of the ${portOptions?.ports.length ?? 12} ports can be chosen.`
            : "No vessel or recording position is available, so distances are not shown. Choose a port manually."}
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label htmlFor="port-select" className="block text-xs text-foreground mb-1">
                Port
              </label>
              <select
                id="port-select"
                value={selectedPortCode ?? ""}
                onChange={(e) => setChosenPortCode(e.target.value)}
                className="w-full bg-wash border border-border rounded-md px-3 py-2 text-xs text-ink outline-none"
              >
                {portOptions?.ports.map(({ port, distanceKm, eligible }) => (
                  <option key={port.portCode} value={port.portCode}>
                    {port.portName} ({port.portCode})
                    {distanceKm !== null ? ` — ${distanceKm.toLocaleString()} km` : ""}
                    {port.portCode === portOptions.recommended ? " — recommended" : ""}
                    {eligible ? "" : " — not eligible"}
                  </option>
                ))}
              </select>
              {selectedPortCode && selectedPortCode === portOptions?.recommended && (
                <div className="mt-1.5">
                  <Badge variant="success" icon={MapPin}>
                    Nearest eligible port
                  </Badge>
                </div>
              )}
              {chosenPortCode && chosenPortCode !== portOptions?.recommended && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-1.5"
                  onClick={() => setChosenPortCode(null)}
                >
                  Use recommended port
                </Button>
              )}
            </div>
            <div>
              <label htmlFor="gross-tonnage" className="block text-xs text-foreground mb-1">
                Vessel gross tonnage (GT)
              </label>
              <input
                id="gross-tonnage"
                type="number"
                min="100"
                step="500"
                value={grossTonnage}
                onChange={(e) => setGrossTonnageInput(Math.max(0, Number(e.target.value)))}
                className="w-full bg-wash border border-border rounded-md px-3 py-2 text-xs font-mono text-primary outline-none"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Default: {portOptions?.grossTonnage?.source ?? "reference value"}. Overwrite with the
                vessel&apos;s registered GT.
              </p>
            </div>
          </div>

          {selectedPort && (
            <Card tone="wash" padded={false} className="p-4">
              <div className="text-xs font-bold text-ink">
                {selectedPort.portName}{" "}
                <span className="font-mono text-primary">{selectedPort.portCode}</span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                {[
                  ["Country", selectedPort.country],
                  ["Harbor size", selectedPort.harborSize],
                  ["Annual temp", `${selectedPort.annualTempC} °C`],
                  ["Salinity", `${selectedPort.salinityPsu} PSU`],
                  ["Base dues", `${usd(selectedPort.basePortDuesUsdPerGt)} / GT`],
                  [
                    "Distance",
                    selectedPortRow.distanceKm !== null ? `${selectedPortRow.distanceKm.toLocaleString()} km` : "—",
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-mono text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[11px] text-muted-foreground mt-2">
                Programme: <span className="text-foreground">{selectedPort.ecoIncentiveProgramName}</span>
              </p>
            </Card>
          )}
        </div>

        {selectedPort && portRebate && (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <caption className="sr-only">Rebate tiers for {selectedPort.portName}</caption>
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th scope="col" className="py-1.5 pr-3">Tier</th>
                    <th scope="col" className="py-1.5 pr-3">Min dB reduction</th>
                    <th scope="col" className="py-1.5 pr-3">Rebate</th>
                    <th scope="col" className="py-1.5 pr-3">Max cap</th>
                    <th scope="col" className="py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPort.rebateTiers.map((t) => {
                    const matched = portRebate.tier?.tier === t.tier;
                    return (
                      <tr key={t.tier} className={`border-b border-border ${matched ? "font-semibold text-ink" : "text-muted-foreground"}`}>
                        <td className="py-1.5 pr-3">{t.tier}</td>
                        <td className="py-1.5 pr-3 font-mono">≥ {t.minDbReduction.toFixed(1)} dB</td>
                        <td className="py-1.5 pr-3 font-mono">{t.rebatePercent}%</td>
                        <td className="py-1.5 pr-3 font-mono">{usd(t.maxCapUsd)}</td>
                        <td className="py-1.5">{matched ? <Badge variant="success">Matched</Badge> : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile
                label="Port dues per call"
                value={usd(portRebate.duesUsd)}
                hint={`${portRebate.grossTonnage.toLocaleString()} GT × ${usd(selectedPort.basePortDuesUsdPerGt)}`}
              />
              <StatTile
                label="Matched tier"
                value={portRebate.tier ? portRebate.tier.tier : "None"}
                tone={portRebate.tier ? "accent" : "default"}
                hint={`From −${portRebate.verifiedDbReduction} dB verified`}
              />
              <StatTile
                label="Est. rebate per call"
                value={usd(portRebate.rebateUsd)}
                tone={portRebate.rebateUsd > 0 ? "success" : "default"}
                hint={
                  portRebate.tier
                    ? `${portRebate.rebatePercent}%${portRebate.capApplied ? `, capped at ${usd(portRebate.tier.maxCapUsd)}` : ""}`
                    : "Below the lowest tier"
                }
              />
              <StatTile label="Net dues per call" value={usd(portRebate.netDuesUsd)} />
            </div>
            {portRebate.nextTier && (
              <p className="text-[11px] text-muted-foreground">
                {portRebate.dbToNextTier} dB more verified reduction reaches {portRebate.nextTier.tier} (
                {portRebate.nextTier.rebatePercent}%).
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Illustrative scheme data; the port authority alone sets and approves any rebate.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
