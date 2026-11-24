import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Radio,
  Upload,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  ArrowRightCircle,
  Info,
  Volume2,
  Database,
  Loader2,
} from "lucide-react";
import { nearestRegionId } from "../algorithms/ecologicalAndAudit";
import { formatLatLon } from "../algorithms/geometry";
import {
  analyzeAcousticRecording,
  analyzeIngestedAudio,
  getIngestedAudioProfiles,
} from "../services/oceanGuardApi.js";
import { usePersistentState } from "../hooks/usePersistentState.js";
import { useOceanGuard } from "../context/OceanGuardContext.jsx";
import { Card, Badge, Button, StatTile } from "./ui";

// Spectrogram colour ramp (dark instrument panel). The legend below is generated from the same stops.
const SPECTRO_STOPS = [
  { max: 0.2, color: "#0f172a" },
  { max: 0.38, color: "#1e3a8a" },
  { max: 0.56, color: "#0284c7" },
  { max: 0.72, color: "#10b981" },
  { max: 0.86, color: "#f59e0b" },
  { max: Infinity, color: "#ef4444" },
];
const getSpectrogramColor = (val) => SPECTRO_STOPS.find((s) => val < s.max).color;

const CUSTOM_REGION = "custom";
const MODE_REGIONAL = "regional";
const MODE_WAV = "wav";

/** Places an analysed WAV in an app region ("noaa" / "chennai" / "clayoquot"; Module 2 maps noaa to stellwagen). */
function placeWavInRegion(analysis, region) {
  if (!region) return analysis;
  return {
    ...analysis,
    region: region.id,
    stationId: region.stationId,
    coords: { ...region.coords },
  };
}
const inRange = (text, min, max) =>
  text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max;

/**
 * Resolves the upload form into a deployment { region, stationId, coords } or an error message.
 * Preset regions use that region's reference position; custom coordinates are validated, and the
 * regional ecological dataset is attached only when they fall within range of a known region.
 */
function resolveDeployment(choice, latText, lonText, depthText, regions) {
  const depth = depthText.trim() === "" ? null : Number(depthText);
  if (depth !== null && !(Number.isFinite(depth) && depth >= 0))
    return { error: "Depth must be a number of metres, 0 or more (or leave it blank)." };
  if (choice === CUSTOM_REGION) {
    if (!inRange(latText, -90, 90))
      return { error: "Latitude must be a number between -90 and 90." };
    if (!inRange(lonText, -180, 180))
      return { error: "Longitude must be a number between -180 and 180." };
    const coords = { lat: Number(latText), lon: Number(lonText), depthM: depth };
    return {
      deployment: { region: nearestRegionId(coords), stationId: "LOCAL-UPLOAD-01", coords },
    };
  }
  const region = regions.find((r) => r.id === choice);
  if (!region) return { error: "Choose a valid recording region." };
  return {
    deployment: {
      region: region.id,
      stationId: "LOCAL-UPLOAD-01",
      coords: { lat: region.coords.lat, lon: region.coords.lon, depthM: depth },
    },
  };
}

export default function Module1Acoustic() {
  const { activeEvent, selectAcousticEvent, proceedToAIS, acousticPresets, regions } =
    useOceanGuard();
  const [customEvents, setCustomEvents] = useState([]);
  const [uploadCalibrated, setUploadCalibrated] = useState(false);
  const [uploadSensitivity, setUploadSensitivity] = useState(-165.4);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadRegion, setUploadRegion] = useState(regions[0]?.id ?? "");
  const [uploadLat, setUploadLat] = useState("");
  const [uploadLon, setUploadLon] = useState("");
  const [uploadDepth, setUploadDepth] = useState("");
  const [selectedSlice, setSelectedSlice] = useState(null);
  const fileInputRef = useRef(null);

  const [datasetMode, setDatasetMode] = usePersistentState("m1DatasetMode", MODE_REGIONAL);
  const [wavProfiles, setWavProfiles] = useState([]);
  const [wavAnalyses, setWavAnalyses] = useState({});
  const [wavLoading, setWavLoading] = useState(null);
  const [wavError, setWavError] = useState("");
  const [wavRegionChoice, setWavRegionChoice] = usePersistentState("m1WavRegion", null);

  useEffect(() => {
    let cancelled = false;
    getIngestedAudioProfiles().then((profiles) => {
      if (!cancelled) setWavProfiles(profiles);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const wavRegion =
    regions.find((r) => r.id === wavRegionChoice) ??
    regions.find((r) => r.id === activeEvent?.region) ??
    regions[0] ??
    null;

  const allRecordings = useMemo(() => {
    return [...customEvents, ...acousticPresets];
  }, [customEvents, acousticPresets]);

  const wavEvents = useMemo(
    () => Object.values(wavAnalyses).map((analysis) => placeWavInRegion(analysis, wavRegion)),
    [wavAnalyses, wavRegion],
  );

  const currentRecording = useMemo(() => {
    if (datasetMode === MODE_WAV) {
      return [...wavEvents, ...customEvents].find((r) => r.id === activeEvent?.id) ?? null;
    }
    return allRecordings.find((r) => r.id === activeEvent?.id) || allRecordings[0];
  }, [datasetMode, wavEvents, customEvents, allRecordings, activeEvent]);

  const sliceCount = currentRecording?.spectrogram.length ?? 0;
  // Default the cursor to the middle of whichever recording is active, and never past its last slice.
  const cursorSlice = Math.min(selectedSlice ?? Math.floor(sliceCount / 2), Math.max(0, sliceCount - 1));

  const deploymentCheck = useMemo(
    () => resolveDeployment(uploadRegion, uploadLat, uploadLon, uploadDepth, regions),
    [uploadRegion, uploadLat, uploadLon, uploadDepth, regions],
  );
  const matchedRegion = deploymentCheck.deployment
    ? regions.find((r) => r.id === deploymentCheck.deployment.region)
    : null;

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!deploymentCheck.deployment) {
      setUploadError(deploymentCheck.error);
      e.target.value = "";
      return;
    }
    setIsProcessing(true);
    setUploadError("");
    try {
      const processed = await analyzeAcousticRecording(
        file,
        uploadCalibrated,
        Number(uploadSensitivity) || -165.0,
        deploymentCheck.deployment,
      );
      setCustomEvents((prev) => [processed, ...prev]);
      setSelectedSlice(null);
      selectAcousticEvent(processed);
    } catch (err) {
      setUploadError(
        "Could not decode audio file in browser. Please upload a valid WAV, MP3, or OGG underwater recording.",
      );
    } finally {
      setIsProcessing(false);
      e.target.value = "";
    }
  };

  const selectRecording = (rec) => {
    setSelectedSlice(null);
    selectAcousticEvent(rec);
  };

  const selectWav = async (profile) => {
    setWavError("");
    setWavLoading(profile.fileName);
    try {
      let analysis = wavAnalyses[profile.fileName];
      if (!analysis) {
        analysis = await analyzeIngestedAudio(profile);
        setWavAnalyses((prev) => ({ ...prev, [profile.fileName]: analysis }));
      }
      setSelectedSlice(null);
      selectAcousticEvent(placeWavInRegion(analysis, wavRegion));
    } catch (err) {
      setWavError(`Could not load or decode ${profile.fileName}: ${err?.message ?? "unknown error"}`);
    } finally {
      setWavLoading(null);
    }
  };

  const changeWavRegion = (regionId) => {
    setWavRegionChoice(regionId);
    const nextRegion = regions.find((r) => r.id === regionId);
    if (currentRecording?.ingested && nextRegion) {
      selectAcousticEvent(placeWavInRegion(currentRecording, nextRegion));
    }
  };

  const unitLabel = currentRecording?.calibrated ? "dB re 1 µPa" : "dBFS (Relative)";
  const confidencePct = Math.round((currentRecording?.confidence ?? 0) * 100);

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-ink">
                Hydrophone Stream & Public Dataset Selector
              </h2>
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">
              {datasetMode === MODE_WAV
                ? "DS3500 / ShipsEar real WAVs"
                : "ONC / NOAA / UniqueShip Benchmark"}
            </span>
          </div>

          <div
            role="group"
            aria-label="Recording dataset"
            className="flex flex-wrap items-center gap-2 mb-3"
          >
            <Button
              size="sm"
              icon={Radio}
              variant={datasetMode === MODE_REGIONAL ? "selected" : "secondary"}
              aria-pressed={datasetMode === MODE_REGIONAL}
              onClick={() => setDatasetMode(MODE_REGIONAL)}
            >
              Regional Scenarios
            </Button>
            <Button
              size="sm"
              icon={Database}
              variant={datasetMode === MODE_WAV ? "selected" : "secondary"}
              aria-pressed={datasetMode === MODE_WAV}
              onClick={() => setDatasetMode(MODE_WAV)}
            >
              DS3500 &amp; ShipsEar Real WAVs
            </Button>
          </div>

          {datasetMode === MODE_WAV && (
            <div className="space-y-3">
              <Card tone="wash" padded={false} className="p-2.5 flex flex-wrap items-center gap-2">
                <label className="text-xs text-foreground font-medium" htmlFor="wav-region">
                  Treat these recordings as made in
                </label>
                <select
                  id="wav-region"
                  value={wavRegion?.id ?? ""}
                  onChange={(e) => changeWavRegion(e.target.value)}
                  className="bg-card border border-border rounded px-2 py-1.5 text-xs text-ink"
                >
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground">
                  The WAVs carry no location; this sets the region used by Modules 2 and 3.
                </span>
              </Card>

              {wavError && (
                <p role="alert" className="text-[11px] text-destructive">
                  {wavError}
                </p>
              )}

              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3" aria-busy={Boolean(wavLoading)}>
                {wavProfiles.map((profile) => {
                  const active = currentRecording?.fileName === profile.fileName;
                  const loading = wavLoading === profile.fileName;
                  return (
                    <Card
                      key={profile.fileName}
                      as="button"
                      type="button"
                      tone={active ? "surface" : "wash"}
                      padded={false}
                      aria-pressed={active}
                      disabled={Boolean(wavLoading)}
                      onClick={() => selectWav(profile)}
                      className={`text-left p-3 transition flex flex-col justify-between gap-2 disabled:opacity-60 ${
                        active ? "ring-2 ring-primary" : "hover:shadow-panel"
                      }`}
                    >
                      <div className="w-full">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <Badge variant="neutral">{profile.datasetSource}</Badge>
                          {loading ? (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                              Decoding…
                            </span>
                          ) : (
                            <Badge variant={profile.cavitationDetected ? "danger" : "success"}>
                              {profile.cavitationDetected ? "Cavitation" : "No cavitation"}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs font-mono font-semibold text-ink">
                          {profile.fileName}
                        </div>
                        <div className="text-xs text-foreground line-clamp-2">
                          {profile.predictedClass}
                        </div>
                      </div>
                      <div className="text-[11px] text-primary font-mono">
                        {Math.round(profile.confidenceScore * 100)}% conf
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {datasetMode === MODE_REGIONAL && (
          <div className="grid sm:grid-cols-3 gap-3">
            {allRecordings.map((rec) => {
              const active = rec.id === currentRecording.id;
              return (
                <Card
                  key={rec.id}
                  as="button"
                  type="button"
                  tone={active ? "surface" : "wash"}
                  padded={false}
                  aria-pressed={active}
                  onClick={() => selectRecording(rec)}
                  className={`text-left p-3.5 transition flex flex-col justify-between ${
                    active ? "ring-2 ring-primary" : "hover:shadow-panel"
                  }`}
                >
                  <div className="w-full">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <Badge variant={rec.calibrated ? "success" : "warning"}>
                        {rec.calibrated ? "Calibrated" : "Uncalibrated"}
                      </Badge>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {rec.durationSec}s
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-ink line-clamp-2">{rec.title}</div>
                  </div>
                  <div className="w-full mt-3 pt-2 border-t border-border flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{rec.stationId}</span>
                    <span className="text-primary font-mono shrink-0">
                      {Math.round(rec.confidence * 100)}% conf
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
          )}
        </Card>

        <Card className="flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Upload className="w-4 h-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-ink">Ingest Underwater Audio</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Runs real Web Audio API PCM decoding, Hann-windowed STFT, RMS, and Spectral Centroid
              extraction in-browser.
            </p>

            <Card
              tone="wash"
              padded={false}
              className="flex items-center justify-between gap-2 mb-3 p-2.5"
            >
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={uploadCalibrated}
                  onChange={(e) => setUploadCalibrated(e.target.checked)}
                  className="rounded border-border bg-card text-primary"
                />
                <span>Hydrophone Calibrated</span>
              </label>
              {uploadCalibrated && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    aria-label="Hydrophone sensitivity (dB re 1V/µPa)"
                    value={uploadSensitivity}
                    onChange={(e) => setUploadSensitivity(e.target.value)}
                    className="w-20 bg-card border border-border rounded px-2 py-1 text-xs font-mono text-primary text-right"
                  />
                  <span className="text-[10px] text-muted-foreground font-mono">dB</span>
                </div>
              )}
            </Card>
            <p className="text-[11px] text-muted-foreground mb-3">
              Leave unticked unless you hold the hydrophone&apos;s calibration sensitivity. Without
              it, levels are reported as relative dBFS, not calibrated sound-pressure levels.
            </p>

            <Card tone="wash" padded={false} className="p-2.5 mb-3 space-y-2">
              <label className="block text-xs text-foreground font-medium" htmlFor="upload-region">
                Where was it recorded?
              </label>
              <select
                id="upload-region"
                value={uploadRegion}
                onChange={(e) => setUploadRegion(e.target.value)}
                className="w-full bg-card border border-border rounded px-2 py-1.5 text-xs text-ink"
              >
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
                <option value={CUSTOM_REGION}>Custom coordinates…</option>
              </select>

              {uploadRegion === CUSTOM_REGION && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-muted-foreground">
                    Latitude (°, −90 to 90)
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder="e.g. 13.0827"
                      value={uploadLat}
                      onChange={(e) => setUploadLat(e.target.value)}
                      aria-invalid={!inRange(uploadLat, -90, 90)}
                      className="mt-0.5 w-full bg-card border border-border rounded px-2 py-1 text-xs font-mono text-ink"
                    />
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Longitude (°, −180 to 180)
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder="e.g. 80.3015"
                      value={uploadLon}
                      onChange={(e) => setUploadLon(e.target.value)}
                      aria-invalid={!inRange(uploadLon, -180, 180)}
                      className="mt-0.5 w-full bg-card border border-border rounded px-2 py-1 text-xs font-mono text-ink"
                    />
                  </label>
                </div>
              )}

              <label className="block text-[11px] text-muted-foreground">
                Hydrophone depth, m (optional)
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="blank = not stated"
                  value={uploadDepth}
                  onChange={(e) => setUploadDepth(e.target.value)}
                  className="mt-0.5 w-full bg-card border border-border rounded px-2 py-1 text-xs font-mono text-ink"
                />
              </label>

              {deploymentCheck.deployment ? (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="font-mono">
                    {formatLatLon(deploymentCheck.deployment.coords)}
                  </span>
                  <Badge variant={matchedRegion ? "accent" : "warning"}>
                    {matchedRegion
                      ? `${matchedRegion.short} ecological data`
                      : "No regional ecological data"}
                  </Badge>
                </div>
              ) : (
                <p role="alert" className="text-[11px] text-destructive">
                  {deploymentCheck.error}
                </p>
              )}
            </Card>
          </div>

          <div>
            <Button
              variant="secondary"
              block
              icon={Volume2}
              disabled={isProcessing || !deploymentCheck.deployment}
              onClick={() => fileInputRef.current?.click()}
            >
              {isProcessing ? "Computing STFT & Features..." : "Upload WAV / MP3 / OGG File"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileUpload}
              disabled={isProcessing}
              className="hidden"
              aria-label="Underwater audio file"
            />
            {uploadError && (
              <p role="alert" className="text-[11px] text-destructive mt-2">
                {uploadError}
              </p>
            )}
          </div>
        </Card>
      </div>

      {currentRecording ? (
        <>
          <Card
            tone="wash"
            padded={false}
            role="note"
            aria-label="Scientific guardrails and references"
            className="p-3.5 flex flex-wrap items-start gap-x-4 gap-y-2 border-l-4 border-l-sky-500"
          >
            <div className="flex-1 min-w-[260px] text-xs text-foreground space-y-1">
              <div className="font-semibold text-info">Acoustic observation, not ecological impact</div>
              <p>
                {currentRecording.calibrated
                  ? "Absolute levels (dB re 1 µPa) are only as valid as the user-supplied hydrophone sensitivity. Formal source-level measurement requires ISO 17208 procedures."
                  : "Uncalibrated recording: values are relative dBFS, not calibrated underwater sound-pressure levels (dB re 1 µPa)."}{" "}
                A detected sound does not by itself show that an animal was present or harmed;
                effects depend on frequency, level, duration, species sensitivity and spatial
                overlap. Classifications are candidates with confidence, not findings.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Reference standards">
              <Badge variant="info">IMO MEPC.1/Circ.906/Rev.1</Badge>
              <Badge variant="info">ISO 17208-1 (deep water)</Badge>
              <Badge variant="info">ISO 17208-3 (shallow water)</Badge>
            </div>
          </Card>

          {(!currentRecording.calibrated || currentRecording.clippingDetected) && (
            <Card
              tone="wash"
              padded={false}
              role="status"
              className="p-4 flex items-start gap-3 border-l-4 border-l-amber-500"
            >
              <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs text-foreground space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-warning">
                    Data-Quality & Calibration Limitation Notice
                  </span>
                  {!currentRecording.calibrated && <Badge variant="warning">Uncalibrated</Badge>}
                  {currentRecording.clippingDetected && (
                    <Badge variant="danger">Clipping detected</Badge>
                  )}
                </div>
                <p>
                  {!currentRecording.calibrated &&
                    "Hydrophone calibration metadata is unavailable for this recording. OceanGuard reports relative digital levels (dBFS) only; they are not calibrated underwater sound-pressure levels (dB re 1 µPa) and must not be compared with absolute thresholds or ISO 17208 results. "}
                  {currentRecording.clippingDetected &&
                    "Signal clipping/saturation detected in the waveform; peak acoustic energy may be underestimated."}
                </p>
              </div>
            </Card>
          )}

          <div className="grid lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-8 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" aria-hidden="true" />
                    Short-Time Fourier Transform (STFT) Time-Frequency Spectrogram
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Station {currentRecording.stationId} &bull;{" "}
                    {currentRecording.sampleRate.toLocaleString()} Hz &bull;{" "}
                    {currentRecording.timestamp}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                  <span>Low</span>
                  <div className="flex h-2.5 w-24 rounded overflow-hidden" aria-hidden="true">
                    {SPECTRO_STOPS.map((s) => (
                      <span key={s.color} className="flex-1" style={{ backgroundColor: s.color }} />
                    ))}
                  </div>
                  <span>High PSD</span>
                </div>
              </div>

              {/* The cursor can also be moved with the range input below. */}
              <div className="relative bg-ink border border-border rounded-md p-3">
                <div className="flex">
                  <div className="flex flex-col justify-between text-[10px] font-mono text-instrument-muted pr-2 py-1 select-none">
                    <span>10 kHz</span>
                    <span>2.5 kHz</span>
                    <span>600 Hz</span>
                    <span>150 Hz</span>
                    <span>20 Hz</span>
                  </div>

                  <div
                    className="flex-1 grid gap-[1px] h-56 cursor-crosshair"
                    style={{ gridTemplateColumns: `repeat(${sliceCount}, minmax(0, 1fr))` }}
                  >
                    {currentRecording.spectrogram.map((col, tIdx) => (
                      <div
                        key={tIdx}
                        onMouseEnter={() => setSelectedSlice(tIdx)}
                        className={`flex flex-col-reverse h-full ${cursorSlice === tIdx ? "ring-1 ring-instrument-foreground/90 z-10" : ""}`}
                      >
                        {col.map((mag, fIdx) => (
                          <div
                            key={fIdx}
                            style={{ backgroundColor: getSpectrogramColor(mag) }}
                            className="flex-1 w-full"
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-instrument-muted mt-2 pl-12">
                  <span>0.0s</span>
                  <span className="text-instrument-foreground">
                    Cursor Time:{" "}
                    {((cursorSlice / sliceCount) * currentRecording.durationSec).toFixed(2)}s
                  </span>
                  <span>{currentRecording.durationSec}s</span>
                </div>
              </div>

              <label className="block text-xs text-muted-foreground">
                Spectrogram time slice
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, sliceCount - 1)}
                  step="1"
                  value={cursorSlice}
                  onChange={(event) => setSelectedSlice(Number(event.target.value))}
                  aria-valuetext={`${((cursorSlice / sliceCount) * currentRecording.durationSec).toFixed(2)} seconds`}
                  className="block w-full"
                />
              </label>

              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                  <span className="font-medium text-foreground">Normalized Amplitude Envelope</span>
                  <span className="font-mono text-[11px]">
                    Dominant Band: {currentRecording.dominantBandHz}
                  </span>
                </div>
                <div className="h-16 bg-ink border border-border rounded-md px-3 py-2 flex items-center gap-[2px]">
                  {currentRecording.waveform.map((amp, idx) => (
                    <div key={idx} className="flex-1 flex flex-col items-center justify-center h-full">
                      <div
                        style={{ height: `${Math.max(8, amp * 100)}%` }}
                        className={`w-full rounded-full transition-all ${
                          amp > 0.92
                            ? "bg-instrument-alert"
                            : amp > 0.65
                              ? "bg-instrument-signal"
                              : "bg-instrument-secondary"
                        }`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {currentRecording.audioUrl && (
                <div>
                  <div className="text-xs font-medium text-foreground mb-1.5">
                    Source recording &bull; {currentRecording.fileName}
                  </div>
                  <audio
                    key={currentRecording.audioUrl}
                    controls
                    preload="metadata"
                    src={currentRecording.audioUrl}
                    aria-label={`Play ${currentRecording.fileName}`}
                    className="w-full"
                  >
                    Your browser does not support audio playback.
                  </audio>
                </div>
              )}
            </Card>

            <Card className="lg:col-span-4 flex flex-col justify-between space-y-5">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">Acoustic Event Record</span>
                  <Badge
                    variant={
                      currentRecording.qualityScore >= 85
                        ? "success"
                        : currentRecording.qualityScore >= 60
                          ? "warning"
                          : "danger"
                    }
                  >
                    Quality: {currentRecording.qualityScore}/100
                  </Badge>
                </div>

                <Card tone="wash" padded={false} className="p-3.5">
                  <div className="text-[11px] text-muted-foreground">Candidate Classification</div>
                  <div className="text-sm font-bold text-ink mt-0.5">
                    {currentRecording.classification}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div
                      className="flex-1 h-2 bg-muted rounded-full overflow-hidden"
                      role="meter"
                      aria-label="Classification confidence"
                      aria-valuenow={confidencePct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        style={{ width: `${confidencePct}%` }}
                        className="h-full bg-primary rounded-full"
                      />
                    </div>
                    <span className="text-xs font-mono text-primary">{confidencePct}%</span>
                  </div>
                </Card>

                {currentRecording.ingested && (
                  <Card tone="wash" padded={false} className="p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="accent" icon={Database}>
                        {currentRecording.datasetSource}
                      </Badge>
                      <Badge variant={currentRecording.cavitationDetected ? "danger" : "success"}>
                        {currentRecording.cavitationDetected
                          ? "Cavitation detected"
                          : "No cavitation detected"}
                      </Badge>
                      {currentRecording.synthetic && <Badge variant="neutral">Synthetic labels</Badge>}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <dt className="text-muted-foreground">Predicted class</dt>
                      <dd className="font-medium text-ink text-right">
                        {currentRecording.predictedClass}
                      </dd>
                      <dt className="text-muted-foreground">Confidence</dt>
                      <dd className="font-mono text-primary text-right">
                        {Math.round(currentRecording.confidenceScore * 100)}%
                      </dd>
                      <dt className="text-muted-foreground">Audit component</dt>
                      <dd className="font-medium text-ink text-right">
                        {currentRecording.recommendedAuditComponent}
                      </dd>
                      <dt className="text-muted-foreground">Profile peak</dt>
                      <dd className="font-mono text-ink text-right">
                        {currentRecording.dominantFreqHz} Hz
                      </dd>
                      <dt className="text-muted-foreground">Est. source level (dataset profile, not measured)</dt>
                      <dd className="font-mono text-ink text-right">
                        {currentRecording.estimatedSourceLevelDb} dB
                      </dd>
                    </dl>
                  </Card>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Broadband RMS" value={currentRecording.rmsLevel} hint={unitLabel} />
                  <StatTile
                    label="Excess vs Ambient"
                    value={`+${currentRecording.deltaAboveAmbient}`}
                    unit="dB"
                    tone="warning"
                    hint={`Baseline: ${currentRecording.ambientBaseline}`}
                  />
                  <StatTile
                    label="Spectral Centroid"
                    value={currentRecording.spectralCentroidHz}
                    unit="Hz"
                    hint={`BW: ${currentRecording.spectralBandwidthHz} Hz`}
                  />
                  <StatTile
                    label="Blade-Pass Rate"
                    value={currentRecording.fundamentalBladeRateHz}
                    unit="Hz"
                    tone="accent"
                    hint="DEMON Envelope"
                  />
                </div>

                <Card tone="wash" padded={false} className="p-3.5 space-y-2">
                  <div className="text-xs text-foreground font-medium flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                    Spectral Energy Split
                  </div>
                  <div className="space-y-1.5">
                    <StatTile
                      compact
                      className="justify-between"
                      label="Low (<250 Hz — Propulsion/Cavitation)"
                      value={`${currentRecording.bandBreakdown.lowPct}%`}
                    />
                    <StatTile
                      compact
                      className="justify-between"
                      label="Mid (250–2k Hz — Marine Mammals/Flow)"
                      value={`${currentRecording.bandBreakdown.midPct}%`}
                    />
                    <StatTile
                      compact
                      className="justify-between"
                      label="High (>2 kHz — Echolocation/Bubbles)"
                      value={`${currentRecording.bandBreakdown.highPct}%`}
                    />
                  </div>
                </Card>

                <Card
                  tone="wash"
                  padded={false}
                  className="p-3 text-xs text-muted-foreground flex items-start gap-2"
                >
                  <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{currentRecording.notes}</span>
                </Card>
              </div>

              <Button
                size="lg"
                block
                icon={CheckCircle2}
                onClick={() => proceedToAIS(currentRecording)}
              >
                <span>Correlate Event with AIS Traffic (Module 2)</span>
                <ArrowRightCircle className="w-4 h-4" aria-hidden="true" />
              </Button>
            </Card>
          </div>
        </>
      ) : (
        <Card tone="wash" className="text-center py-10 space-y-2">
          <Badge variant="info" icon={Database}>
            No WAV analysed yet
          </Badge>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            Choose one of the DS3500 or ShipsEar recordings above. It is fetched, decoded in the
            browser, and run through the STFT, RMS and spectral-centroid pipeline.
          </p>
        </Card>
      )}
    </div>
  );
}
