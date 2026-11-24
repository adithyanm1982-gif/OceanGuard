import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Compass,
  Ship,
  AlertCircle,
  ShieldAlert,
  Navigation,
  ArrowRightCircle,
  SlidersHorizontal,
  Radio,
  Maximize2,
  Database,
  Gauge,
} from "lucide-react";
import {
  vesselBearingDeg,
  polarToXY,
  radarRingsKm,
  formatKm,
  estimateAcousticFootprintKm,
} from "../algorithms/geometry";
import {
  AIS_DATASET_MODES,
  REAL_AIS_SOURCES,
  getVesselDataset,
  radiusConfigFor,
} from "../services/oceanGuardApi.js";
import { usePersistentState } from "../hooks/usePersistentState.js";
import { useOceanGuard } from "../context/OceanGuardContext.jsx";
import { Card, Badge, Button, StatTile } from "./ui";

// Radar SVG frame: 400×400 viewBox, hydrophone at the centre, outer ring = selected radius.
const RADAR = { size: 400, c: 200, outerPx: 180 };

const tierStyle = (pct) =>
  pct >= 72
    ? { color: "#f59e0b", badge: "warning", text: "text-warning" }
    : pct >= 45
      ? { color: "#38bdf8", badge: "info", text: "text-primary" }
      : { color: "#94a3b8", badge: "neutral", text: "text-muted-foreground" };

function EmptyEventState({ onNavigate }) {
  return (
    <Card tone="wash" className="max-w-2xl mx-auto text-center py-10 space-y-3">
      <Badge variant="warning" icon={Radio}>
        No acoustic event selected
      </Badge>
      <h2 className="text-base font-semibold text-ink">
        Pick a recording before correlating vessels
      </h2>
      <p className="text-sm text-muted-foreground">
        Vessel ranking needs a station location, timestamp and signal level from an acoustic event.
        Choose a recording or upload one in Acoustic analysis, then come back here.
      </p>
      {onNavigate && (
        <Button icon={ArrowRightCircle} onClick={() => onNavigate(1)}>
          Go to acoustic analysis
        </Button>
      )}
    </Card>
  );
}

export default function Module2AIS() {
  const { activeEvent, selectedVessel, setSelectedVessel, lockVessel, go } = useOceanGuard();
  const [datasetMode, setDatasetMode] = usePersistentState("m2DatasetMode", AIS_DATASET_MODES.REGIONAL);
  const [realSource, setRealSource] = usePersistentState("m2RealSource", REAL_AIS_SOURCES.USCG);
  const [radiusByConfig, setRadiusByConfig] = useState({});

  const radiusConfig = radiusConfigFor(datasetMode, realSource);
  const configKey = datasetMode === AIS_DATASET_MODES.REAL ? `real:${realSource}` : "regional";
  const searchRadiusKm = radiusByConfig[configKey] ?? radiusConfig.defaultKm;
  const setSearchRadiusKm = (km) => setRadiusByConfig((prev) => ({ ...prev, [configKey]: km }));

  const { data: dataset } = useQuery({
    queryKey: [
      "vessel-dataset",
      datasetMode,
      realSource,
      activeEvent?.id,
      activeEvent?.region,
      activeEvent?.coords?.lat,
      activeEvent?.coords?.lon,
      searchRadiusKm,
    ],
    queryFn: () =>
      getVesselDataset({
        event: activeEvent,
        mode: datasetMode,
        source: realSource,
        radiusKm: searchRadiusKm,
      }),
    enabled: Boolean(activeEvent),
  });
  const rankedVessels = dataset?.vessels ?? [];
  const anchorLabel = dataset?.anchor?.id ?? activeEvent?.stationId;

  const plotted = useMemo(() => {
    const pxPerKm = RADAR.outerPx / searchRadiusKm;
    return rankedVessels.map((v) => {
      const bearingDeg = vesselBearingDeg(v);
      const pos =
        bearingDeg === null
          ? null
          : polarToXY(bearingDeg, v.cpaDistanceKm, pxPerKm, RADAR.c, RADAR.c);
      return { ...v, bearingDeg, pos };
    });
  }, [rankedVessels, searchRadiusKm]);

  const rings = radarRingsKm(searchRadiusKm);
  const footprintKm = estimateAcousticFootprintKm(activeEvent);
  const footprintPx =
    footprintKm && footprintKm <= searchRadiusKm
      ? (footprintKm / searchRadiusKm) * RADAR.outerPx
      : null;

  const selectedInRange = plotted.find((v) => v.mmsi === selectedVessel?.mmsi) || null;
  const activeCandidate = selectedInRange || plotted[0] || null;
  const selectionOutOfRange = Boolean(selectedVessel && !selectedInRange && activeCandidate);
  const largerRadius = radiusConfig.options.find((r) => r > searchRadiusKm);

  if (!activeEvent) return <EmptyEventState onNavigate={go} />;

  return (
    <div className="space-y-6">
      <Card
        tone="wash"
        padded={false}
        className="p-4 flex items-start gap-3 border-l-4 border-l-sky-500"
      >
        <ShieldAlert className="w-5 h-5 text-info shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-xs text-foreground space-y-1">
          <div className="font-semibold text-info">
            Scientific Attribution Principle: AIS Proximity Does Not Prove Acoustic Causation
          </div>
          <p>
            AIS transponders report vessel kinematics, not underwater sound emission. Multiple
            ships, non-AIS small craft, port machinery, and oceanographic conditions may contribute
            simultaneously. OceanGuard ranks potential contributors with transparent supporting
            evidence rather than issuing automated accusations. Proximity, closest point of
            approach and the likelihood % indicate a vessel may have contributed; they do not
            prove it caused the recorded sound.
          </p>
        </div>
      </Card>

      <Card tone="wash" padded={false} className="p-3.5 space-y-2.5">
        <div
          role="group"
          aria-label="Vessel dataset"
          className="flex flex-wrap items-center gap-2"
        >
          <Button
            size="sm"
            icon={Ship}
            variant={datasetMode === AIS_DATASET_MODES.REGIONAL ? "selected" : "secondary"}
            aria-pressed={datasetMode === AIS_DATASET_MODES.REGIONAL}
            onClick={() => setDatasetMode(AIS_DATASET_MODES.REGIONAL)}
          >
            Co-Located Regional Vessels
          </Button>
          <Button
            size="sm"
            icon={Database}
            variant={datasetMode === AIS_DATASET_MODES.REAL ? "selected" : "secondary"}
            aria-pressed={datasetMode === AIS_DATASET_MODES.REAL}
            onClick={() => setDatasetMode(AIS_DATASET_MODES.REAL)}
          >
            USCG AIS 2024 / CSJ Tracks
          </Button>
          {datasetMode === AIS_DATASET_MODES.REAL && (
            <>
              <label htmlFor="real-ais-source" className="text-xs text-muted-foreground ml-1">
                Source:
              </label>
              <select
                id="real-ais-source"
                value={realSource}
                onChange={(e) => setRealSource(e.target.value)}
                className="bg-card border border-border rounded px-2 py-1.5 text-xs text-ink"
              >
                <option value={REAL_AIS_SOURCES.USCG}>USCG MarineCadastre 2024-01-01</option>
                <option value={REAL_AIS_SOURCES.CSJ}>CSJ tracks (2020)</option>
              </select>
            </>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {dataset?.notice}
          {dataset?.anchor && (
            <span className="font-mono">
              {" "}
              Radar centre: {dataset.anchor.id} ({dataset.anchor.lat.toFixed(4)},{" "}
              {dataset.anchor.lon.toFixed(4)}).
            </span>
          )}
        </p>
      </Card>

      <div className="grid lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-6 lg:self-start">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
                  <Compass className="w-4 h-4 text-primary" aria-hidden="true" />
                  Hydrophone CPA Spatial Correlation Radar
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Station {anchorLabel} &bull; Event Window {activeEvent.timestamp}
                </p>
              </div>

              <Card tone="wash" padded={false} className="flex items-center gap-2 px-3 py-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                <label htmlFor="radar-radius" className="text-xs text-muted-foreground">
                  Radius:
                </label>
                <select
                  id="radar-radius"
                  value={searchRadiusKm}
                  onChange={(e) => setSearchRadiusKm(Number(e.target.value))}
                  className="bg-transparent text-xs font-mono text-primary outline-none"
                >
                  {radiusConfig.options.map((r) => (
                    <option key={r} value={r} className="bg-card">
                      {formatKm(r)}
                    </option>
                  ))}
                </select>
              </Card>
            </div>

            {/* Geometry is derived from bearing, CPA distance and radius. */}
            <div className="relative aspect-square max-h-[380px] w-full mx-auto bg-ink border border-ink rounded-lg overflow-hidden flex items-center justify-center">
              <svg
                viewBox={`0 0 ${RADAR.size} ${RADAR.size}`}
                className="w-full h-full"
                role="group"
                aria-label={`Radar of ${plotted.length} AIS targets within ${formatKm(searchRadiusKm)} of ${anchorLabel}`}
              >
                {rings.map((km, i) => {
                  const r = ((i + 1) / rings.length) * RADAR.outerPx;
                  const outer = i === rings.length - 1;
                  return (
                    <g key={km}>
                      <circle
                        cx={RADAR.c}
                        cy={RADAR.c}
                        r={r}
                        fill="none"
                        stroke={outer ? "#587489" : "#3a566b"}
                        strokeDasharray={outer ? undefined : "4 4"}
                      />
                      <text
                        x={RADAR.c + 6}
                        y={RADAR.c - r + 14}
                        fill="#9fb3c2"
                        fontSize="10"
                        fontFamily="monospace"
                      >
                        {formatKm(km)}
                      </text>
                    </g>
                  );
                })}
                <line x1={RADAR.c} y1="15" x2={RADAR.c} y2="385" stroke="#1d3d54" />
                <line x1="15" y1={RADAR.c} x2="385" y2={RADAR.c} stroke="#1d3d54" />
                <text
                  x={RADAR.c}
                  y="12"
                  fill="#9fb3c2"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  N
                </text>

                {footprintPx && (
                  <circle
                    cx={RADAR.c}
                    cy={RADAR.c}
                    r={footprintPx}
                    fill="#f59e0b"
                    fillOpacity="0.06"
                    stroke="#f59e0b"
                    strokeOpacity="0.45"
                    strokeDasharray="2 4"
                  />
                )}

                <circle cx={RADAR.c} cy={RADAR.c} r="14" fill="#06b6d4" fillOpacity="0.18" />
                <circle cx={RADAR.c} cy={RADAR.c} r="5" fill="#22d3ee" />
                <text
                  x={RADAR.c}
                  y={RADAR.c + 22}
                  fill="#67e8f9"
                  fontSize="10"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {anchorLabel}
                </text>

                {plotted.length === 0 && (
                  <text
                    x={RADAR.c}
                    y={RADAR.c - 40}
                    fill="#9fb3c2"
                    fontSize="11"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    No AIS targets within {formatKm(searchRadiusKm)}
                  </text>
                )}

                {plotted
                  .filter((v) => v.pos)
                  .map((v) => {
                    const { x: cx, y: cy } = v.pos;
                    const isSelected = activeCandidate?.mmsi === v.mmsi;
                    const { color } = tierStyle(v.confidencePct);
                    const labelLeft = cx > RADAR.size * 0.65;
                    const lx = labelLeft ? cx - 10 : cx + 10;
                    const anchor = labelLeft ? "end" : "start";
                    return (
                      <g
                        key={v.mmsi}
                        onClick={() => setSelectedVessel(v)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedVessel(v);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        aria-label={`${v.name}, ${v.cpaDistanceKm} km at ${v.bearingDeg}°, ${v.confidencePct}% likelihood${v.speedAnomaly?.flagged ? ", speed anomaly" : ""}`}
                        className="cursor-pointer"
                      >
                        <line
                          x1={RADAR.c}
                          y1={RADAR.c}
                          x2={cx}
                          y2={cy}
                          stroke={color}
                          strokeOpacity={isSelected ? 0.75 : 0.25}
                          strokeWidth={isSelected ? 1.8 : 1}
                          strokeDasharray="3 3"
                        />
                        {isSelected && (
                          <circle
                            cx={cx}
                            cy={cy}
                            r="18"
                            fill="none"
                            stroke={color}
                            strokeWidth="1.5"
                          />
                        )}
                        {v.speedAnomaly?.flagged && (
                          <circle
                            cx={cx}
                            cy={cy}
                            r="11"
                            fill="none"
                            stroke="#f59e0b"
                            strokeWidth="1.5"
                            strokeDasharray="2 2"
                          />
                        )}
                        <circle cx={cx} cy={cy} r="7" fill={color} />
                        <text
                          x={lx}
                          y={cy - 6}
                          fill="#f8fafc"
                          fontSize="10"
                          fontWeight="bold"
                          fontFamily="monospace"
                          textAnchor={anchor}
                        >
                          {v.name}
                        </text>
                        <text
                          x={lx}
                          y={cy + 7}
                          fill={color}
                          fontSize="9.5"
                          fontFamily="monospace"
                          textAnchor={anchor}
                        >
                          {v.cpaDistanceKm} km &bull; {v.bearingDeg}° &bull; {v.confidencePct}%
                        </text>
                      </g>
                    );
                  })}
              </svg>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Detected AIS targets within {formatKm(searchRadiusKm)}: {plotted.length}
            </span>
            {footprintKm && (
              <span className="font-mono">
                Est. acoustic footprint {formatKm(footprintKm)}
                {!footprintPx && " (beyond radar)"}
              </span>
            )}
          </div>
        </Card>

        <div className="lg:col-span-6 space-y-4">
          <Card>
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2 mb-3">
              <Ship className="w-4 h-4 text-primary" aria-hidden="true" />
              Ranked Candidate Vessel Contributors
            </h2>
            <p className="text-[11px] text-muted-foreground -mt-1 mb-3">
              Likelihood % ranks potential contributors from AIS geometry only. It is not a
              probability of causation, and non-AIS sources may be missing.
            </p>

            {plotted.length === 0 ? (
              <Card tone="wash" className="text-center space-y-2">
                <Badge variant="neutral" icon={Ship}>
                  No AIS targets in range
                </Badge>
                <p className="text-xs text-muted-foreground">
                  No AIS-reporting vessel passed within {formatKm(searchRadiusKm)} of {anchorLabel}{" "}
                  in this dataset.
                  {dataset?.nearestKm != null &&
                    ` The nearest of ${dataset.totalCount} records is ${formatKm(dataset.nearestKm)} away.`}{" "}
                  Non-AIS craft or distant traffic may still contribute.
                </p>
                {largerRadius && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Maximize2}
                    onClick={() => setSearchRadiusKm(largerRadius)}
                  >
                    Widen radius to {formatKm(largerRadius)}
                  </Button>
                )}
              </Card>
            ) : (
              <div className="space-y-3">
                {plotted.map((vessel, index) => {
                  const isSelected = activeCandidate?.mmsi === vessel.mmsi;
                  const tier = tierStyle(vessel.confidencePct);
                  return (
                    <Card
                      key={vessel.mmsi}
                      as="button"
                      type="button"
                      tone={isSelected ? "surface" : "wash"}
                      padded={false}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedVessel(vessel)}
                      className={`w-full text-left p-4 transition ${isSelected ? "ring-2 ring-primary" : "hover:shadow-panel"}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="neutral" className="font-mono">
                              #{index + 1}
                            </Badge>
                            <span className="text-sm font-bold text-ink">{vessel.name}</span>
                            <span className="text-[11px] font-mono text-muted-foreground">
                              IMO {vessel.imo}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {vessel.vesselType} &bull;{" "}
                            {vessel.dwt
                              ? `${vessel.dwt.toLocaleString()} DWT`
                              : vessel.lengthM
                                ? `${vessel.lengthM} m`
                                : "size n/a"}{" "}
                            &bull; {vessel.navStatus}
                          </div>
                        </div>
                        <div className="ml-auto flex flex-col items-end gap-1 text-right">
                          <div className={`text-sm font-bold font-mono ${tier.text}`}>
                            {vessel.confidencePct}% Likelihood
                          </div>
                          <Badge variant={tier.badge}>{vessel.attributionTier}</Badge>
                          {vessel.speedAnomaly?.flagged && (
                            <Badge variant="warning" icon={Gauge}>
                              Speed anomaly:{" "}
                              {vessel.speedAnomaly.reasons
                                .map((r) => (r === "sog-zscore-spike" ? "SOG z-spike" : "over design"))
                                .join(" + ")}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-border">
                        <StatTile
                          compact
                          className="flex-col !gap-0"
                          label="CPA Prox."
                          value={`${vessel.cpaDistanceKm} km (${vessel.subScores.proximityPct}%)`}
                        />
                        <StatTile
                          compact
                          className="flex-col !gap-0"
                          label="Speed / Design"
                          value={`${vessel.observedSpeedKnots}/${vessel.designSpeedKnots ?? "n/a"}`}
                          unit="kn"
                        />
                        <StatTile
                          compact
                          className="flex-col !gap-0"
                          label="Time Offset"
                          value={vessel.timeOffsetSec === null ? "n/a" : `${vessel.timeOffsetSec}s`}
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs text-muted-foreground">Bearing / Course</span>
                          <span className="font-mono text-xs font-medium text-ink flex items-center gap-1">
                            {vessel.bearingDeg ?? "—"}° /{" "}
                            <Navigation
                              className="w-3 h-3 text-primary"
                              style={{ transform: `rotate(${(vessel.courseDeg ?? 0) - 45}deg)` }}
                              aria-hidden="true"
                            />
                            {vessel.courseDeg ?? "—"}&deg;
                          </span>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </Card>

          {activeCandidate && (
            <Card className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-primary">
                  Supporting Evidence &mdash; {activeCandidate.name}
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  MMSI {activeCandidate.mmsi}
                </span>
              </div>

              {selectionOutOfRange && (
                <Card
                  tone="wash"
                  padded={false}
                  className="p-3 flex flex-wrap items-center gap-2 text-xs text-foreground"
                >
                  <Badge variant="warning">Previous pick out of range</Badge>
                  <span>
                    {selectedVessel.name} is outside {formatKm(searchRadiusKm)}. Showing the
                    top-ranked vessel instead.
                  </span>
                </Card>
              )}

              <ul className="space-y-2">
                {(activeCandidate.evidence ?? []).map((item, idx) => (
                  <li key={idx} className="text-xs text-foreground flex items-start gap-2">
                    <AlertCircle
                      className="w-4 h-4 text-warning shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <Button size="lg" block onClick={() => lockVessel(activeCandidate)}>
                <span>Evaluate Marine-Sensitive-Area Overlap (Module 3)</span>
                <ArrowRightCircle className="w-4 h-4" aria-hidden="true" />
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
