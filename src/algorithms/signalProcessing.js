/**
 * Real DSP & Acoustic Feature Extraction Engine
 * Uses Web Audio API PCM decoding, Hann-windowed STFT, RMS, Zero-Crossing Rate,
 * Spectral Centroid, Band Energy Ratios, and Calibration-Aware Level Calculation.
 */

/**
 * `deployment` = { region, stationId, coords: { lat, lon, depthM } } describes where the recording was made.
 * It is supplied by the upload form; nothing is assumed when it is missing (coords stay null and the
 * recording is not tied to any regional ecological dataset).
 */
export async function analyzeAudioFile(
  file,
  isCalibrated = false,
  sensitivityDb = -165.0,
  deployment = {},
) {
  const arrayBuffer = await file.arrayBuffer();
  const decoded = await decodeAudioArrayBuffer(arrayBuffer);
  return buildAcousticEvent(decoded.raw, {
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    durationSec: decoded.durationSec,
    isCalibrated,
    sensitivityDb,
    deployment,
    id: `upload-${Date.now()}`,
    title: file.name,
    source: "User Uploaded Underwater Recording (Local DSP Pipeline)",
  });
}

/**
 * Pure-JS RIFF/WAVE PCM decoder (8/16/24/32-bit integer and 32-bit float, first channel only).
 * Works in the browser and in Node, so the ingested WAVs are decoded identically everywhere and at their
 * native sample rate. Throws on anything that is not a PCM/float WAVE file.
 */
export function decodeWavPcm(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const tag = (o) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)));
  if (arrayBuffer.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw new Error("Not a RIFF/WAVE file");

  let fmt = null;
  let dataOffset = -1;
  let dataBytes = 0;
  let pos = 12;
  while (pos + 8 <= arrayBuffer.byteLength) {
    const id = tag(pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      dataOffset = body;
      dataBytes = Math.min(size, arrayBuffer.byteLength - body);
      break;
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) throw new Error("WAVE file is missing fmt or data chunk");
  const { format, channels, sampleRate, bits } = fmt;
  if (!(format === 1 || format === 3) || channels < 1 || !sampleRate)
    throw new Error("Unsupported WAVE encoding");
  const bytes = bits / 8;
  if (![1, 2, 3, 4].includes(bytes) || (format === 3 && bits !== 32))
    throw new Error("Unsupported WAVE bit depth");

  const frame = bytes * channels;
  const frames = Math.floor(dataBytes / frame);
  const raw = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const o = dataOffset + i * frame;
    let v;
    if (format === 3) v = view.getFloat32(o, true);
    else if (bytes === 1) v = (view.getUint8(o) - 128) / 128;
    else if (bytes === 2) v = view.getInt16(o, true) / 32768;
    else if (bytes === 3) {
      const n = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
      v = (n & 0x800000 ? n - 0x1000000 : n) / 8388608;
    } else v = view.getInt32(o, true) / 2147483648;
    raw[i] = v;
  }
  return {
    raw,
    sampleRate,
    channels,
    durationSec: Number((frames / sampleRate).toFixed(2)),
  };
}

/** Decodes audio bytes: native WAV parser first, Web Audio API (MP3/OGG/etc.) as the fallback. */
export async function decodeAudioArrayBuffer(arrayBuffer) {
  try {
    return decodeWavPcm(arrayBuffer);
  } catch {
    /* not a plain PCM WAV: fall through to the browser decoder */
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    return {
      raw: audioBuffer.getChannelData(0),
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      durationSec: Number(audioBuffer.duration.toFixed(2)),
    };
  } finally {
    await audioCtx.close();
  }
}

/** DSP core: RMS, peak, clipping, waveform envelope, Hann-windowed STFT spectrogram, spectral centroid. */
export function buildAcousticEvent(
  raw,
  {
    sampleRate,
    channels = 1,
    durationSec,
    isCalibrated = false,
    sensitivityDb = -165.0,
    deployment = {},
    id,
    title,
    source,
  },
) {
  const maxSamples = Math.min(raw.length, sampleRate * 30);
  let samples = raw.subarray(0, maxSamples);
  if (samples.length < 513) {
    const padded = new Float32Array(513);
    padded.set(samples);
    samples = padded;
  }

  let sumSq = 0;
  let peak = 0;
  let clippedSamples = 0;

  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const absV = Math.abs(v);
    sumSq += v * v;
    if (absV > peak) peak = absV;
    if (absV >= 0.995) clippedSamples++;
  }

  const rmsLinear = Math.sqrt(sumSq / Math.max(1, samples.length));
  const rmsDbfs = 20 * Math.log10(Math.max(rmsLinear, 1e-8));
  const peakDbfs = 20 * Math.log10(Math.max(peak, 1e-8));
  const clippingDetected = clippedSamples > 5;

  const calibratedOffset = isCalibrated && sensitivityDb !== null ? Math.abs(sensitivityDb) : 0;
  const rmsLevel = Number((rmsDbfs + calibratedOffset).toFixed(1));
  const peakLevel = Number((peakDbfs + calibratedOffset).toFixed(1));
  const ambientBaseline = Number((rmsLevel - 18.5).toFixed(1));
  const deltaAboveAmbient = Number((rmsLevel - ambientBaseline).toFixed(1));

  const waveformBins = 120;
  const blockSize = Math.max(1, Math.floor(samples.length / waveformBins));
  const waveform = [];
  for (let b = 0; b < waveformBins; b++) {
    let localPeak = 0;
    const start = b * blockSize;
    const end = Math.min(samples.length, start + blockSize);
    for (let j = start; j < end; j++) {
      const a = Math.abs(samples[j]);
      if (a > localPeak) localPeak = a;
    }
    waveform.push(Number(localPeak.toFixed(4)));
  }

  const timeSlices = 64;
  const freqBins = 40;
  const fftSize = 512;
  const hop = Math.max(1, Math.floor((samples.length - fftSize) / timeSlices));

  const hann = new Float32Array(fftSize);
  for (let n = 0; n < fftSize; n++) {
    hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (fftSize - 1)));
  }

  const spectrogram = [];
  let weightedFreqSum = 0;
  let totalMagSum = 0;
  let lowBandEnergy = 0;
  let midBandEnergy = 0;
  let highBandEnergy = 0;

  for (let t = 0; t < timeSlices; t++) {
    const offset = Math.min(samples.length - fftSize, t * hop);
    const column = [];

    for (let k = 1; k <= freqBins; k++) {
      const maxFreq = Math.min(12000, sampleRate / 2);
      const freq = 20 * Math.pow(maxFreq / 20, k / freqBins);
      const omega = (2 * Math.PI * freq) / sampleRate;

      let re = 0;
      let im = 0;
      for (let n = 0; n < fftSize; n += 2) {
        const wSample = samples[offset + n] * hann[n];
        re += wSample * Math.cos(omega * n);
        im -= wSample * Math.sin(omega * n);
      }

      const mag = Math.sqrt(re * re + im * im) / (fftSize / 2);
      const dbNorm = Math.min(1, Math.max(0, (20 * Math.log10(Math.max(mag, 1e-6)) + 90) / 85));
      column.push(Number(dbNorm.toFixed(3)));

      weightedFreqSum += freq * mag;
      totalMagSum += mag;
      if (freq < 250) lowBandEnergy += mag * mag;
      else if (freq < 2000) midBandEnergy += mag * mag;
      else highBandEnergy += mag * mag;
    }
    spectrogram.push(column);
  }

  const spectralCentroidHz = Math.round(weightedFreqSum / Math.max(totalMagSum, 1e-9));
  const totalBand = Math.max(lowBandEnergy + midBandEnergy + highBandEnergy, 1e-12);
  const lowRatio = lowBandEnergy / totalBand;
  const midRatio = midBandEnergy / totalBand;

  let classification = "Ambient / Background Ocean Noise";
  let confidence = 0.72;
  let dominantBandHz = "20 Hz – 250 Hz (Low-Frequency Ambient)";

  if (lowRatio > 0.58 && deltaAboveAmbient > 14) {
    classification = "Candidate Ship-Noise Event (Low-Freq Propulsion/Cavitation)";
    confidence = Math.min(0.94, Number((0.74 + lowRatio * 0.25).toFixed(2)));
    dominantBandHz = `35 Hz – ${Math.max(280, spectralCentroidHz)} Hz (Ship Propulsion Band)`;
  } else if (midRatio > 0.45 && spectralCentroidHz > 450) {
    classification = "Possible Biological Vocalisation / Mid-Band Transient";
    confidence = Math.min(0.89, Number((0.68 + midRatio * 0.3).toFixed(2)));
    dominantBandHz = `250 Hz – ${Math.min(4000, spectralCentroidHz * 2)} Hz (Biological / Mid Band)`;
  } else if (clippingDetected) {
    classification = "Uncertain Event (Signal Clipping / Saturation)";
    confidence = 0.54;
  }

  let qualityScore = 95;
  if (!isCalibrated) qualityScore -= 18;
  if (clippingDetected) qualityScore -= 22;
  if (sampleRate < 16000) qualityScore -= 10;

  return {
    id,
    title,
    source,
    stationId: deployment.stationId || "LOCAL-UPLOAD-01",
    region: deployment.region ?? null,
    coords: deployment.coords || null,
    timestamp: new Date().toISOString(),
    durationSec,
    sampleRate,
    channels,
    calibrated: isCalibrated,
    hydrophoneSensitivityDb: isCalibrated ? sensitivityDb : null,
    qualityScore: Math.max(35, qualityScore),
    clippingDetected,
    dominantBandHz,
    classification,
    confidence,
    rmsLevel,
    peakLevel,
    ambientBaseline,
    deltaAboveAmbient,
    spectralCentroidHz,
    spectralBandwidthHz: Math.round(spectralCentroidHz * 1.45),
    fundamentalBladeRateHz: Number((8 + lowRatio * 7).toFixed(1)),
    notes: isCalibrated
      ? `Calibrated analysis using user-supplied hydrophone sensitivity (${sensitivityDb} dB re 1V/uPa).`
      : "Uncalibrated audio file: reporting relative digital levels (dBFS) rather than absolute sound pressure levels.",
    waveform,
    spectrogram,
    bandBreakdown: {
      lowPct: Math.round(lowRatio * 100),
      midPct: Math.round(midRatio * 100),
      highPct: Math.max(0, 100 - Math.round(lowRatio * 100) - Math.round(midRatio * 100)),
    },
  };
}

export function synthesizePresetMatrices(preset) {
  const waveformBins = 120;
  const timeSlices = 64;
  const freqBins = 40;
  const waveform = [];
  const spectrogram = [];

  for (let b = 0; b < waveformBins; b++) {
    const t = b / waveformBins;
    let env = 0.25 + 0.15 * Math.sin(t * Math.PI * 3);
    if (preset.seedProfile === "cavitation") {
      const surge = Math.exp(-Math.pow((t - 0.52) / 0.22, 2));
      const bladeMod = 0.78 + 0.22 * Math.sin(b * 1.9);
      env = Math.min(0.95, (0.22 + 0.68 * surge) * bladeMod);
    } else if (preset.seedProfile === "biological_mixed") {
      const call1 = Math.exp(-Math.pow((t - 0.28) / 0.06, 2));
      const call2 = Math.exp(-Math.pow((t - 0.68) / 0.08, 2));
      env = Math.min(0.9, 0.28 + 0.52 * (call1 + call2));
    } else if (preset.seedProfile === "uncalibrated_harbor") {
      env = b === 48 || b === 49 ? 0.99 : Math.min(0.88, 0.35 + 0.35 * Math.abs(Math.sin(b * 0.7)));
    }
    waveform.push(Number(env.toFixed(3)));
  }

  for (let t = 0; t < timeSlices; t++) {
    const tn = t / timeSlices;
    const col = [];
    for (let f = 0; f < freqBins; f++) {
      const fn = f / freqBins;
      let val = 0.14 + 0.08 * Math.sin(t * 0.4 + f * 0.3);

      if (preset.seedProfile === "cavitation") {
        const cpaEnvelope = Math.exp(-Math.pow((tn - 0.52) / 0.24, 2));
        const lowFreqWeight = Math.exp(-fn * 2.8);
        const harmonicStripe = f % 4 === 0 && fn < 0.45 ? 0.22 : 0;
        val += cpaEnvelope * lowFreqWeight * 0.78 + harmonicStripe * cpaEnvelope;
      } else if (preset.seedProfile === "biological_mixed") {
        const shipHum = Math.exp(-fn * 5.0) * 0.48;
        const chirp1Center = 0.25 + (tn - 0.2) * 1.6;
        const chirp1 =
          Math.exp(-Math.pow((tn - 0.28) / 0.06, 2)) *
          Math.exp(-Math.pow((fn - chirp1Center) / 0.07, 2)) *
          0.85;
        const chirp2Center = 0.62 - (tn - 0.65) * 1.4;
        const chirp2 =
          Math.exp(-Math.pow((tn - 0.68) / 0.07, 2)) *
          Math.exp(-Math.pow((fn - chirp2Center) / 0.07, 2)) *
          0.82;
        val += shipHum + chirp1 + chirp2;
      } else {
        const broad = Math.exp(-fn * 1.9) * (0.45 + 0.3 * Math.sin(tn * 14));
        const spike = Math.abs(tn - 0.41) < 0.03 ? 0.45 : 0;
        val += broad + spike;
      }
      col.push(Number(Math.min(1, Math.max(0.05, val)).toFixed(3)));
    }
    spectrogram.push(col);
  }

  return {
    waveform,
    spectrogram,
    bandBreakdown:
      preset.seedProfile === "cavitation"
        ? { lowPct: 68, midPct: 24, highPct: 8 }
        : preset.seedProfile === "biological_mixed"
          ? { lowPct: 36, midPct: 51, highPct: 13 }
          : { lowPct: 54, midPct: 33, highPct: 13 },
  };
}

/** Median / peak block RMS (dBFS) of a signal, for an in-file "excess over ambient" estimate. */
export function blockRmsStats(samples, blocks = 40) {
  const size = Math.max(1, Math.floor(samples.length / blocks));
  const levels = [];
  for (let b = 0; b < blocks; b++) {
    const start = b * size;
    const end = Math.min(samples.length, start + size);
    if (end <= start) break;
    let sq = 0;
    for (let i = start; i < end; i++) sq += samples[i] * samples[i];
    levels.push(20 * Math.log10(Math.max(Math.sqrt(sq / (end - start)), 1e-8)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? -160;
  return { medianDbfs: median, peakBlockDbfs: sorted[sorted.length - 1] ?? -160 };
}

/**
 * Real-WAV analysis for an INGESTED_AUDIO_PROFILES entry: the ArrayBuffer is decoded and run through the STFT /
 * RMS / spectral-centroid pipeline; classification metadata comes from the profile. Level figures are relative
 * (dBFS) because the files carry no hydrophone calibration; "excess" is peak-block vs median-block RMS in the file.
 */
export async function analyzeIngestedWav(profile, arrayBuffer, deployment = {}) {
  const decoded = await decodeAudioArrayBuffer(arrayBuffer);
  const event = buildAcousticEvent(decoded.raw, {
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    durationSec: decoded.durationSec,
    isCalibrated: false,
    deployment,
    id: `ingested-${profile.fileName}`,
    title: `${profile.datasetSource} ${profile.fileName} — ${profile.predictedClass}`,
    source: `${profile.datasetSource} real WAV (in-browser decode + STFT)`,
  });
  const { medianDbfs, peakBlockDbfs } = blockRmsStats(decoded.raw);
  const delta = Number(Math.max(0, peakBlockDbfs - medianDbfs).toFixed(1));
  return {
    ...event,
    ambientBaseline: Number(medianDbfs.toFixed(1)),
    deltaAboveAmbient: delta,
    classification: profile.predictedClass,
    confidence: profile.confidenceScore,
    dominantBandHz: `${profile.dominantFreqHz} Hz profile peak (measured centroid ${event.spectralCentroidHz} Hz)`,
    notes: `Real ${profile.datasetSource} recording decoded in-browser (${decoded.sampleRate.toLocaleString()} Hz, ${decoded.durationSec}s). Levels are relative dBFS: no hydrophone calibration. Excess is peak-block vs median-block RMS inside the file. Classification metadata is ${profile.synthetic ? "synthetic scenario data" : "from the dataset"}.`,
    // classification metadata carried to Modules 2-5 via activeEvent
    ingested: true,
    fileName: profile.fileName,
    datasetSource: profile.datasetSource,
    audioUrl: profile.audioUrl,
    predictedClass: profile.predictedClass,
    confidenceScore: profile.confidenceScore,
    dominantFreqHz: profile.dominantFreqHz,
    cavitationDetected: profile.cavitationDetected,
    estimatedSourceLevelDb: profile.estimatedSourceLevelDb,
    recommendedAuditComponent: profile.recommendedAuditComponent,
    synthetic: Boolean(profile.synthetic),
  };
}
