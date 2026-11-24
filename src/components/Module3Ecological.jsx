import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Globe2,
  Layers,
  ShieldAlert,
  Fish,
  MapPin,
  ArrowRightCircle,
  AlertTriangle,
  Radio,
  Ship,
  Database,
} from "lucide-react";
import {
  vesselBearingDeg,
  polarToXY,
  pointInPolygon,
  estimateAcousticFootprintKm,
  formatKm,
  formatLatLon,
  lonLatToXY,
  ringToSvgPoints,
} from "../algorithms/geometry";
import {
  getBiodiversityTelemetry,
  getProtectedAreaAssessment,
  getRegionalEcology,
} from "../services/oceanGuardApi.js";
import { useOceanGuard } from "../context/OceanGuardContext.jsx";
import { Card, Badge, Button, StatTile } from "./ui";

// Map frame for the zone polygons and OBIS points in mockDatasets: 400×360 viewBox,
// hydrophone at MAP.anchor, MAP.pxPerKm screen pixels per kilometre.
const MAP = { w: 400, h: 360, anchor: { x: 185, y: 155 }, pxPerKm: 15 };
// Per-layer stroke style, keyed by zone id prefix. Fill colour comes from each zone record.
const LAYER_STYLE = {
  mpa: { dash: "5 3", label: "MPAs" },
  mig: { dash: undefined, label: "Migration" },
  feed: { dash: "3 3", label: "Foraging" },
};
const layerKeyOf = (zone) => zone.id.split("-")[0];
const kmBetween = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / MAP.pxPerKm;
const clampToMap = ({ x, y }) => ({
  x: Math.min(MAP.w - 8, Math.max(8, x)),
  y: Math.min(MAP.h - 8, Math.max(8, y)),
});

const fmt = (n, digits = 1) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";

const maskingBadge = (pct) => (pct >= 70 ? "warning" : pct >= 40 ? "accent" : "neutral");
const priorityBadge = (p) => (p === "Critical" ? "danger" : p === "High" ? "warning" : "neutral");

function EmptyState({ icon, badge, title, body, actionLabel, onAction }) {
  return (
    <Card tone="wash" className="max-w-2xl mx-auto text-center py-10 space-y-3">
      <Badge variant="warning" icon={icon}>
        {badge}
      </Badge>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {onAction && (
        <Button icon={ArrowRightCircle} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Card>
  );
}

export default function Module3Ecological() {
  const { activeEvent, selectedVessel, go } = useOceanGuard();
  const [visibleLayers, setVisibleLayers] = useState({
    mpa: true,
    mig: true,
    feed: true,
    wdpa: true,
    obis: true,
  });
  const [bioSource, setBioSource] = useState("real");

  const { data: regional, isPending } = useQuery({
    queryKey: ["regional-ecology", activeEvent?.id],
    queryFn: () => getRegionalEcology(activeEvent),
    enabled: Boolean(activeEvent),
  });
  const footprintKm = regional?.footprintKm ?? estimateAcousticFootprintKm(activeEvent);
  const ecoAssessment = regional?.assessment;

  // Phase 3: Point-in-Polygon intrusion check against the region's WDPA-style scenario polygons.
  const { data: protectedAssessment } = useQuery({
    queryKey: [
      "protected-area-assessment",
      activeEvent?.id,
      selectedVessel?.mmsi ?? null,
      selectedVessel?.lat ?? null,
      selectedVessel?.lon ?? null,
      footprintKm,
    ],
    queryFn: () =>
      getProtectedAreaAssessment({ event: activeEvent, vessel: selectedVessel, footprintKm }),
    enabled: Boolean(activeEvent),
  });
  const { data: biodiversity } = useQuery({
    queryKey: ["biodiversity-telemetry", activeEvent?.id],
    queryFn: () => getBiodiversityTelemetry({ event: activeEvent }),
    enabled: Boolean(activeEvent),
  });

  // Polygons projected into the map frame around the scenario hydrophone (same frame as the vessel marker).
  const wdpaPolygons = useMemo(() => {
    const origin = protectedAssessment?.hydrophone;
    if (!origin) return [];
    return protectedAssessment.results.map((r) => {
      const open = r.ring.slice(0, -1);
      const centre = [
        open.reduce((sum, p) => sum + p[0], 0) / Math.max(1, open.length),
        open.reduce((sum, p) => sum + p[1], 0) / Math.max(1, open.length),
      ];
      return {
        ...r,
        points: ringToSvgPoints(r.ring, origin, MAP.pxPerKm, MAP.anchor.x, MAP.anchor.y),
        label: lonLatToXY(centre, origin, MAP.pxPerKm, MAP.anchor.x, MAP.anchor.y),
      };
    });
  }, [protectedAssessment]);

  // Vessel position on the map: same bearing/CPA geometry as the Module 2 radar.
  const vesselMarker = useMemo(() => {
    if (!selectedVessel) return null;
    const bearingDeg = vesselBearingDeg(selectedVessel);
    if (bearingDeg === null || !Number.isFinite(selectedVessel.cpaDistanceKm)) return null;
    const raw = polarToXY(
      bearingDeg,
      selectedVessel.cpaDistanceKm,
      MAP.pxPerKm,
      MAP.anchor.x,
      MAP.anchor.y,
    );
    return { ...clampToMap(raw), raw, bearingDeg };
  }, [selectedVessel]);

  const zones = useMemo(
    () =>
      (regional?.zones ?? []).map((z) => ({
        ...z,
        layerKey: layerKeyOf(z),
        inFootprint: footprintKm !== null && z.distanceKm <= footprintKm,
        vesselInside: Boolean(
          vesselMarker && pointInPolygon(vesselMarker.raw.x, vesselMarker.raw.y, z.polygonPoints),
        ),
      })),
    [regional, footprintKm, vesselMarker],
  );

  const species = useMemo(
    () =>
      (ecoAssessment?.speciesEvaluations || []).map((sp) => {
        const fromHydrophoneKm = kmBetween(sp, MAP.anchor);
        return {
          ...sp,
          fromHydrophoneKm,
          inFootprint: footprintKm !== null && fromHydrophoneKm <= footprintKm,
          fromVesselKm: vesselMarker ? kmBetween(sp, vesselMarker.raw) : null,
        };
      }),
    [ecoAssessment, footprintKm, vesselMarker],
  );

  if (activeEvent && isPending) {
    return (
      <Card tone="wash" role="status" className="text-sm text-muted-foreground">
        Loading regional ecological records…
      </Card>
    );
  }

  if (activeEvent && !regional?.regionId) {
    const coordText = formatLatLon(activeEvent.coords);
    return (
      <EmptyState
        icon={Globe2}
        badge="No regional ecological dataset"
        title="OceanGuard has no sensitive-area data for this location"
        body={`${coordText ? `The recording at ${coordText}` : "This recording has no coordinates, and it"} is not within range of the Clayoquot, Stellwagen Bank or Chennai reference regions, so no protected-area or species records are shown. Showing another region's data would be misleading. Re-upload with a region or coordinates inside one of those areas.`}
        actionLabel="Go to acoustic analysis"
        onAction={() => go(1)}
      />
    );
  }

  if (!activeEvent) {
    return (
      <EmptyState
        icon={Radio}
        badge="No acoustic event selected"
        title="Pick a recording before checking sensitive areas"
        body="Overlap with protected areas and species records is measured from the hydrophone that captured the event. Choose a recording in Acoustic analysis first."
        actionLabel="Go to acoustic analysis"
        onAction={() => go(1)}
      />
    );
  }

  const toggleLayer = (key) => setVisibleLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  const layerButtons = [
    ...Object.entries(LAYER_STYLE).map(([key, s]) => ({
      key,
      label: s.label,
      color: regional.zones.find((z) => layerKeyOf(z) === key)?.fill || "#94a3b8",
    })),
    { key: "wdpa", label: "WDPA scenario MPAs", color: "#38bdf8" },
    { key: "obis", label: "OBIS Records", color: "#fbbf24" },
  ];
  const coordLabel = formatLatLon(activeEvent.coords);
  const footprintPx = footprintKm ? footprintKm * MAP.pxPerKm : null;
  const vesselZones = zones.filter((z) => z.vesselInside);
  const speciesInFootprint = species.filter((s) => s.inFootprint).length;
  const intrudedSites = wdpaPolygons.filter((p) => p.vesselInside);
  const vesselHasPosition = Boolean(protectedAssessment?.vesselPosition);

  return (
    <div className="space-y-6">
      <Card
        tone="wash"
        padded={false}
        className="p-4 flex items-start gap-3 border-l-4 border-l-emerald-500"
      >
        <ShieldAlert className="w-5 h-5 text-success shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-xs text-foreground space-y-1">
          <div className="font-semibold text-success">
            Ecological Context vs. Confirmed Animal Presence
          </div>
          <p>
            OBIS records reflect historical occurrence context, not live animal presence. They
            and protected-area boundaries indicate regional conservation sensitivity and possible
            spatial overlap with acoustic activity. OceanGuard never claims an individual marine mammal or fish is physically present at the exact
            instant of ship passage without direct biological confirmation.
          </p>
        </div>
      </Card>

      {!selectedVessel && (
        <Card
          tone="wash"
          padded={false}
          className="p-4 flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-amber-500"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-foreground">
            <Badge variant="warning" icon={Ship}>
              No vessel selected
            </Badge>
            <span>
              Zones and species below reflect the acoustic event only. Pick a candidate vessel to
              see its track overlap.
            </span>
          </div>
          <Button variant="secondary" size="sm" icon={ArrowRightCircle} onClick={() => go(2)}>
            Go to vessel correlation
          </Button>
        </Card>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-7 lg:self-start space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-primary" aria-hidden="true" />
                Marine Protected Areas & Biodiversity GIS Overlay
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {regional.region?.short} region &bull; {activeEvent.stationId}
                {coordLabel && <> &bull; {coordLabel}</>}
                {Number.isFinite(activeEvent.coords?.depthM) && (
                  <> &bull; Depth {activeEvent.coords.depthM} m</>
                )}
              </p>
            </div>

            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Map layers"
            >
              {layerButtons.map((l) => (
                <Button
                  key={l.key}
                  size="sm"
                  variant={visibleLayers[l.key] ? "secondary" : "ghost"}
                  aria-pressed={visibleLayers[l.key]}
                  onClick={() => toggleLayer(l.key)}
                  className={visibleLayers[l.key] ? "" : "text-muted-foreground"}
                >
                  <Layers className="w-3 h-3" aria-hidden="true" />
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: l.color, opacity: visibleLayers[l.key] ? 1 : 0.35 }}
                    aria-hidden="true"
                  />
                  <span>{l.label}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Overlay geometry follows the active event and selected vessel. */}
          <div className="relative bg-ink border border-ink rounded-lg overflow-hidden h-[360px]">
            {selectedVessel && wdpaPolygons.length > 0 && visibleLayers.wdpa && (
              <div className="absolute top-2 left-2 z-10 max-w-[85%]" role="status">
                {!vesselHasPosition ? (
                  <Badge variant="neutral" icon={Ship}>
                    Vessel has no lat/lon: intrusion not evaluated
                  </Badge>
                ) : intrudedSites.length ? (
                  <Badge variant="danger" icon={AlertTriangle}>
                    INTRUSION: {selectedVessel.name} inside{" "}
                    {intrudedSites.map((p) => p.siteName).join(", ")}
                  </Badge>
                ) : (
                  <Badge variant="success" icon={Ship}>
                    {selectedVessel.name} outside all scenario protected areas
                  </Badge>
                )}
              </div>
            )}
            <svg
              viewBox={`0 0 ${MAP.w} ${MAP.h}`}
              className="w-full h-full"
              role="img"
              aria-label={`Sensitive-area map around ${activeEvent.stationId}`}
            >
              <defs>
                <pattern id="bathymetry" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1d3d54" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width={MAP.w} height={MAP.h} fill="url(#bathymetry)" />

              {zones
                .filter((z) => visibleLayers[z.layerKey])
                .map((z) => (
                  <polygon
                    key={z.id}
                    points={z.polygonPoints}
                    fill={z.fill}
                    fillOpacity={z.inFootprint ? 0.2 : 0.07}
                    stroke={z.fill}
                    strokeOpacity={z.inFootprint ? 1 : 0.5}
                    strokeWidth={z.vesselInside ? 2.2 : 1.5}
                    strokeDasharray={LAYER_STYLE[z.layerKey]?.dash}
                  />
                ))}

              {visibleLayers.wdpa &&
                wdpaPolygons.map((p) => {
                  const colour = p.vesselInside ? "#f43f5e" : p.footprintOverlap ? "#f59e0b" : "#38bdf8";
                  return (
                    <g key={p.siteId}>
                      <polygon
                        points={p.points}
                        fill={colour}
                        fillOpacity={p.vesselInside ? 0.3 : 0.12}
                        stroke={colour}
                        strokeWidth={p.vesselInside ? 2.6 : 1.5}
                        strokeDasharray={p.vesselInside ? undefined : "6 3"}
                      >
                        <title>
                          {p.siteName}
                          {p.vesselInside ? " (vessel inside)" : ""}
                        </title>
                      </polygon>
                      <text
                        x={p.label.x}
                        y={p.label.y}
                        fill={colour}
                        fontSize="8.5"
                        fontFamily="monospace"
                        textAnchor="middle"
                      >
                        {p.siteId.replace("OG-SYN-", "")}
                      </text>
                    </g>
                  );
                })}

              {footprintPx && (
                <>
                  <circle
                    cx={MAP.anchor.x}
                    cy={MAP.anchor.y}
                    r={footprintPx}
                    fill="#f59e0b"
                    fillOpacity="0.08"
                    stroke="#f59e0b"
                    strokeOpacity="0.5"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={MAP.anchor.x}
                    y={
                      MAP.anchor.y - footprintPx > 16
                        ? MAP.anchor.y - footprintPx - 6
                        : MAP.anchor.y + footprintPx + 14
                    }
                    fill="#fbbf24"
                    fontSize="9.5"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    Est. {formatKm(footprintKm)} Acoustic Footprint
                  </text>
                </>
              )}

              {visibleLayers.obis &&
                species.map((sp) => (
                  <g key={sp.id}>
                    <circle
                      cx={sp.x}
                      cy={sp.y}
                      r={sp.inFootprint ? 6 : 4}
                      fill="#fbbf24"
                      fillOpacity={sp.inFootprint ? 0.9 : 0.45}
                    />
                    <text
                      x={sp.x + 8}
                      y={sp.y + 3}
                      fill="#fde68a"
                      fillOpacity={sp.inFootprint ? 1 : 0.65}
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {sp.commonName} ({sp.recordCount})
                    </text>
                  </g>
                ))}

              <circle cx={MAP.anchor.x} cy={MAP.anchor.y} r="5" fill="#22d3ee" />
              <text
                x={MAP.anchor.x + 8}
                y={MAP.anchor.y + 13}
                fill="#67e8f9"
                fontSize="9.5"
                fontFamily="monospace"
              >
                {activeEvent.stationId}
              </text>

              {vesselMarker && (
                <g>
                  <line
                    x1={MAP.anchor.x}
                    y1={MAP.anchor.y}
                    x2={vesselMarker.x}
                    y2={vesselMarker.y}
                    stroke="#f43f5e"
                    strokeOpacity="0.6"
                    strokeDasharray="3 3"
                  />
                  {intrudedSites.length > 0 && (
                    <circle
                      cx={vesselMarker.x}
                      cy={vesselMarker.y}
                      r="9"
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth="1.5"
                    />
                  )}
                  <circle cx={vesselMarker.x} cy={vesselMarker.y} r="5" fill="#f43f5e" />
                  <text
                    x={vesselMarker.x < MAP.anchor.x ? vesselMarker.x - 8 : vesselMarker.x + 8}
                    y={vesselMarker.y - 8}
                    fill="#fda4af"
                    fontSize="9.5"
                    fontWeight="bold"
                    fontFamily="monospace"
                    textAnchor={vesselMarker.x < MAP.anchor.x ? "end" : "start"}
                  >
                    {selectedVessel.name}
                  </text>
                </g>
              )}
            </svg>
          </div>

          <div className="grid sm:grid-cols-3 gap-2.5">
            {zones.map((z) => (
              <Card
                key={z.id}
                tone="wash"
                padded={false}
                className={`p-3 space-y-1.5 ${z.inFootprint ? "" : "opacity-75"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={priorityBadge(z.conservationPriority)}>
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: z.fill }}
                      aria-hidden="true"
                    />
                    {z.conservationPriority}
                  </Badge>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {z.distanceKm} km
                  </span>
                </div>
                <div className="text-xs font-semibold text-ink line-clamp-1" title={z.name}>
                  {z.name}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant={z.inFootprint ? "warning" : "neutral"}>
                    {z.inFootprint ? "Inside footprint" : "Outside footprint"}
                  </Badge>
                  {z.seasonMatch && <Badge variant="accent">Season active</Badge>}
                  {z.vesselInside && (
                    <Badge variant="danger" icon={Ship}>
                      Vessel inside
                    </Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {wdpaPolygons.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-primary" aria-hidden="true" />
                Protected-area intrusion check (Point-in-Polygon)
              </h3>
              <div className="grid sm:grid-cols-2 gap-2.5">
                {wdpaPolygons.map((p) => (
                  <Card
                    key={p.siteId}
                    tone="wash"
                    padded={false}
                    className={`p-3 space-y-1.5 ${p.vesselInside ? "border-destructive" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-muted-foreground">{p.siteId}</span>
                      <Badge variant="neutral">IUCN {p.iucnCategory}</Badge>
                    </div>
                    <div className="text-xs font-semibold text-ink">{p.siteName}</div>
                    <div className="flex flex-wrap gap-1">
                      {p.vesselInside === true && (
                        <Badge variant="danger" icon={AlertTriangle}>
                          Vessel intrusion
                        </Badge>
                      )}
                      {p.vesselInside === false && (
                        <Badge variant="success">
                          Vessel outside &bull; {fmt(p.vesselDistanceKm, 2)} km to boundary
                        </Badge>
                      )}
                      {p.vesselInside === null && <Badge variant="neutral">Vessel position unknown</Badge>}
                      <Badge variant={p.footprintOverlap ? "warning" : "neutral"}>
                        {p.footprintOverlap ? "Footprint overlaps" : "Footprint clear"}
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Scenario polygons are synthetic (not official WDPA boundaries). The vessel is tested by
                its [lon, lat]; the estimated footprint is centred on the scenario hydrophone. Points on
                a boundary count as inside.
              </p>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-5 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary">Ecological Overlap Summary</span>
              <Badge
                variant={
                  ecoAssessment.compositeConcernScore >= 72
                    ? "danger"
                    : ecoAssessment.compositeConcernScore >= 45
                      ? "warning"
                      : "success"
                }
              >
                Index: {ecoAssessment.compositeConcernScore}/100
              </Badge>
            </div>

            <Card tone="wash" padded={false} className="p-3.5">
              <div className="text-[11px] text-muted-foreground">Estimated Ecological Concern</div>
              <div className="text-sm font-bold text-ink mt-0.5">{ecoAssessment.concernTier}</div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {ecoAssessment.seasonalActiveCount} of {ecoAssessment.activeZonesCount} sensitive
                zones inside the estimated {footprintKm ? formatKm(footprintKm) : ""} footprint are
                in an active seasonal migration/protection window.
              </p>
            </Card>

            <div className="grid grid-cols-3 gap-2">
              <StatTile
                label="Footprint"
                value={footprintKm ? footprintKm.toFixed(1) : "—"}
                unit="km"
                hint={`+${activeEvent.deltaAboveAmbient} dB`}
              />
              <StatTile
                label="Zones hit"
                value={`${ecoAssessment.activeZonesCount}/${zones.length}`}
                tone={ecoAssessment.activeZonesCount ? "warning" : "default"}
                hint="by footprint"
              />
              <StatTile
                label="Vessel in"
                value={selectedVessel ? vesselZones.length : "—"}
                tone={vesselZones.length ? "danger" : "default"}
                hint={selectedVessel ? "zones" : "no vessel"}
              />
            </div>

            <div>
              <h2 className="text-xs font-semibold text-foreground flex flex-wrap items-center gap-1.5 mb-2.5">
                <Fish className="w-4 h-4 text-primary" aria-hidden="true" />
                {regional.region?.short} Species Vocalisation vs. Event Frequency Overlap
                <span className="ml-auto shrink-0 whitespace-nowrap font-normal text-muted-foreground">
                  {speciesInFootprint}/{species.length} in footprint
                </span>
              </h2>

              <div className="space-y-3">
                {species.map((sp) => (
                  <Card key={sp.id} tone="wash" padded={false} className="p-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-ink">{sp.commonName}</div>
                        <div className="text-[11px] italic text-muted-foreground">
                          {sp.scientificName}
                        </div>
                      </div>
                      <Badge variant={maskingBadge(sp.maskingRiskPct)} className="font-mono">
                        {sp.maskingRiskPct}% Masking
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      <Badge variant={sp.inFootprint ? "warning" : "neutral"}>
                        {sp.inFootprint ? "In footprint" : "Outside footprint"} &bull;{" "}
                        {formatKm(sp.fromHydrophoneKm)}
                      </Badge>
                      {sp.fromVesselKm !== null && (
                        <Badge variant="neutral" icon={Ship}>
                          {formatKm(sp.fromVesselKm)} from vessel
                        </Badge>
                      )}
                    </div>

                    <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                      <span>
                        {sp.bandKind === "hearing" ? "Hearing" : "Vocal"} Band: {sp.vocalBandHz[0]}–
                        {sp.vocalBandHz[1]} Hz &bull; Event centroid{" "}
                        {activeEvent.spectralCentroidHz} Hz
                      </span>
                      <span className="font-mono text-muted-foreground">
                        OBIS n={sp.recordCount} (historical)
                      </span>
                    </div>

                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        style={{ width: `${sp.maskingRiskPct}%` }}
                        className={`h-full rounded-full ${sp.maskingRiskPct >= 70 ? "bg-warning" : "bg-primary"}`}
                      />
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            <Card
              tone="wash"
              padded={false}
              className="p-3 text-[11px] text-muted-foreground flex items-start gap-2"
            >
              <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Datasets integrated: EMODnet / DFO MPA Polygons &bull; OBIS Historical Occurrence
                Records (context only, not live presence) &bull; Regional Cetacean Migration Calendars.
              </span>
            </Card>
          </div>

          <div className="space-y-2">
            <Button
              size="lg"
              block
              icon={AlertTriangle}
              disabled={!selectedVessel}
              onClick={() => go(4)}
            >
              <span>Initiate Ship Technical Audit (Module 4)</span>
              <ArrowRightCircle className="w-4 h-4" aria-hidden="true" />
            </Button>
            {!selectedVessel && (
              <p className="text-[11px] text-muted-foreground text-center">
                Select a candidate vessel in Module 2 to start an audit.
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" aria-hidden="true" />
              Biodiversity &amp; Protected-Area Telemetry
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ingested OBIS occurrence records alongside WDPA protected-area metadata.
            </p>
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Biodiversity source">
            <Button
              size="sm"
              variant={bioSource === "real" ? "selected" : "secondary"}
              aria-pressed={bioSource === "real"}
              onClick={() => setBioSource("real")}
            >
              Real OBIS telemetry
            </Button>
            <Button
              size="sm"
              variant={bioSource === "mock" ? "selected" : "secondary"}
              aria-pressed={bioSource === "mock"}
              onClick={() => setBioSource("mock")}
            >
              Regional species records
            </Button>
          </div>
        </div>

        {bioSource === "real" ? (
          <div className="space-y-2">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-wash border-b border-border text-[11px] font-semibold text-muted-foreground">
                    <th scope="col" className="py-2 px-3">scientificName</th>
                    <th scope="col" className="py-2 px-3">Distance</th>
                    <th scope="col" className="py-2 px-3">bathymetry (m)</th>
                    <th scope="col" className="py-2 px-3">sst (°C)</th>
                    <th scope="col" className="py-2 px-3">sss (PSU)</th>
                    <th scope="col" className="py-2 px-3">Observed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-xs">
                  {(biodiversity?.nearest ?? []).map((o) => (
                    <tr key={o.occurrenceId}>
                      <td className="py-2 px-3 italic text-ink">{o.scientificName}</td>
                      <td className="py-2 px-3 font-mono">{fmt(o.distanceKm, 0)} km</td>
                      <td className="py-2 px-3 font-mono">{fmt(o.bathymetryM, 1)}</td>
                      <td className="py-2 px-3 font-mono">{fmt(o.sstC, 2)}</td>
                      <td className="py-2 px-3 font-mono">{fmt(o.salinityPsu, 2)}</td>
                      <td className="py-2 px-3 font-mono">{o.eventDate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The {biodiversity?.totalOccurrences ?? "—"} ingested OBIS records are a global sample; the
              nearest to this hydrophone is {fmt(biodiversity?.nearestKm, 0)} km away. They show real
              occurrence telemetry for reference, not animals present at this site. &quot;sss&quot; is the
              record&apos;s salinity (PSU).
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {species.map((sp) => (
              <Card key={sp.id} tone="wash" padded={false} className="p-3 space-y-1">
                <div className="text-xs font-bold text-ink">{sp.commonName}</div>
                <div className="text-[11px] italic text-muted-foreground">{sp.scientificName}</div>
                <div className="text-[11px] font-mono text-muted-foreground">OBIS n={sp.recordCount}</div>
              </Card>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-foreground">Protected-area metadata</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-wash border-b border-border text-[11px] font-semibold text-muted-foreground">
                  <th scope="col" className="py-2 px-3">SITE_NAME</th>
                  <th scope="col" className="py-2 px-3">IUCN_CAT</th>
                  <th scope="col" className="py-2 px-3">GIS_AREA (km²)</th>
                  <th scope="col" className="py-2 px-3">GOV_TYPE</th>
                  <th scope="col" className="py-2 px-3">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {wdpaPolygons.map((p) => (
                  <tr key={p.siteId}>
                    <td className="py-2 px-3 text-ink">{p.siteName}</td>
                    <td className="py-2 px-3 font-mono">{p.iucnCategory}</td>
                    <td className="py-2 px-3 font-mono">{fmt(p.areaKm2, 1)}</td>
                    <td className="py-2 px-3 text-muted-foreground">Not recorded (scenario)</td>
                    <td className="py-2 px-3">
                      <Badge variant="info">Scenario polygon</Badge>
                    </td>
                  </tr>
                ))}
                {(biodiversity?.protectedAreaRecords ?? []).map((r) => (
                  <tr key={`wdpa-${r.siteId}`}>
                    <td className="py-2 px-3 text-ink">{r.SITE_NAME}</td>
                    <td className="py-2 px-3 font-mono">{r.IUCN_CAT ?? "—"}</td>
                    <td className="py-2 px-3 font-mono">{fmt(r.GIS_AREA, 1)}</td>
                    <td className="py-2 px-3 text-foreground">{r.GOV_TYPE ?? "—"}</td>
                    <td className="py-2 px-3">
                      <Badge variant="neutral">WDPA record &bull; {r.iso3}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Scenario GIS_AREA is computed from the polygon ring. Real WDPA records have no geometry in
            the ingested file, so they cannot be used for Point-in-Polygon and are listed for reference.
          </p>
        </div>
      </Card>
    </div>
  );
}
