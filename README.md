# OceanGuard v2.0 (real-data integration)

Marine acoustic compliance decision support for auditors and port authorities. Built with React 19, TanStack Start, TanStack Query, Vite, and Tailwind CSS. The existing dependency set is unchanged.

## Local commands

Use Node.js 22.12+ (or a newer supported LTS) and npm. Extract the release, open a terminal in its root, and run:

```sh
npm install      # install dependencies
npm test         # Vitest suite, then the Node test suites
npm run build    # client bundle and server/Worker output
npm run dev      # local dev server (Vite prints the address)
```

Optional quality gate before release: `npm run lint -- --max-warnings=0`.

`npm test` runs the Vitest routing, service, and persistence tests, then the Node geometry, workflow, real-data, hash-chain and dossier tests (`node --test src/algorithms/__tests__/*.test.js` runs the 84 Node tests directly). `npm run build` produces the client bundle and server/Worker deployment output; it is not a plain static-only app. Generated output is excluded from the source release. Use the configured hosting provider to deploy the generated Worker output, or publish through Lovable; no production deployment is performed by these commands.

## Architecture

```text
src/
  routes/              TanStack root layout and index loader
  App.jsx              Six-module workspace composition
  context/             OceanGuardProvider: shared workflow state
  services/            oceanGuardApi.js: asynchronous data/calculation boundary
  algorithms/          DSP, vessel ranking, geometry, ecology, audit and CAPA rules
    __tests__/         Geometry, workflow and service regression tests
  data/                Tagged, illustrative regional datasets
  hooks/               SSR-safe browser persistence and mobile helper
  components/
    AuditorLogin.jsx   Demo auditor profile entry
    Module1–6*.jsx     Evidence, action and outcome views
    layout/            Header and keyboard-accessible sidebar
    ui/                Shared controls, surfaces, status badges and toast
  test/                Routing and persistence tests; test setup
  styles.css           Semantic theme, contrast, focus and motion tokens
  router.tsx           Per-request QueryClient and route configuration
  server.ts            Server-rendering error boundary
  start.ts             Request error handling and CSRF middleware
```

The index loader obtains initial data exclusively through `oceanGuardApi.js`. `OceanGuardProvider` owns the auditor profile, navigation, vessel selection, audit edits and corrective actions; modules read that context and call the service layer, never importing mock datasets. TanStack Query caches subsequent asynchronous module calculations. Algorithms remain pure except the browser audio decoder, which runs only after an upload.

Backend integration replaces service implementations rather than component imports. There is **no connected backend, real authentication, server-side authorization, tamper-proof audit storage, or live AIS/OBIS feed** (the hash chain is client-side integrity checking only). Demo profiles and claims about verified roles are illustrative, not security guarantees. A production integration must enforce identities, role separation and audit integrity on the server.

## v2.0 real-data integration

v2.0 replaces most illustrative inputs with bundled real or scenario datasets (`src/data/ingestedDatasets.js`, read only through `oceanGuardApi.js`). No dependency was added.

| Area | Data and behaviour |
| --- | --- |
| Acoustics (Module 1) | 16 real DS3500 and ShipsEar WAVs under `public/audio/`, decoded in `signalProcessing.js` into a real STFT spectrogram, RMS and spectral centroid, with each file's classifier metadata. |
| Co-located scenarios | Per-region hydrophone, MPA polygons and AIS scenarios (`CO_LOCATED_SCENARIOS`). Scenario data is synthetic and labelled as such. |
| AIS (Module 2) | USCG MarineCadastre positions and CSJ tracks, ranked by Haversine distance and bearing. USCG reports are 2024 positions and CSJ tracks are 2020 tracks, so neither aligns in time with a recording. |
| Protected areas and biodiversity (Module 3) | Point-in-Polygon vessel and footprint checks against MPA polygons; real OBIS occurrences (bathymetry, SST, salinity) and WDPA marine records (SITE_NAME, IUCN_CAT, GIS_AREA, GOV_TYPE). The OBIS/WDPA files are global samples, so the nearest record is often far from the hydrophone. |
| Ship audit (Module 4) | USCG PSIX lookup by name or IMO: deficiencies and operational controls, with a heuristic suggested audit area, importable into an audit note. |
| Corrective action (Module 5) | SHA-256 hash-chained verification log (below). |
| Incentives (Module 6) | Port & URN tariff selector over 12 ports (below). |

### SHA-256 audit chain (Module 5)

Every CAPA stage transition is sealed with `eventId`, `previousHash`, `recordHash`, `timestamp`, `auditorName` and `accreditationId`. The first record links to the genesis hash (64 zeros). Each `recordHash` is the SHA-256 of a fixed-order encoding of the record's fields and its CAPA id, so changing a note, auditor, timestamp or evidence list, or removing or reordering a record, is detected. The Verification Log shows each truncated hash, a "Chain Verified" or "Tamper detected" badge, and a Web Crypto (`crypto.subtle.digest`) cross-check.

The chain itself is built with a synchronous, dependency-free SHA-256 (`sha256Hex`), because CAPA transitions are synchronous and Web Crypto is async-only; tests compare it with Node's `crypto.createHash('sha256')`. Entries saved before v2.0 have no hash and are shown as "Recorded before hash chain (unverified)"; they are not treated as tampering. `localStorage` persistence under `correctiveActions-v2` is unchanged.

**Limit:** the chain is held in the browser and a person with access to local storage can rebuild a consistent chain. It detects accidental or partial edits; it is not tamper-proof storage. Production needs a server-side append-only store and identity.

### Port & URN tariffs (Module 6)

`INGESTED_PORTS` supplies 12 ports. Distances use Haversine from the vessel position, else the recording station; the nearest port with an incentive programme is recommended and any port can be chosen. The panel shows `portCode`, `portName`, `country`, `harborSize`, `annualTempC`, `salinityPsu`, `basePortDuesUsdPerGt` and `ecoIncentiveProgramName`, matches the highest reached `rebateTier`, and estimates the rebate per port call as `gross tonnage x dues per GT x rebatePercent`, limited by `maxCapUsd`. Verified dB comes from CAPAs closed with a measured reduction. Default GT is the vessel's own value, else 0.55 x DWT (an assumption), else 40,000, and can be overwritten. `worldPortIndex` is null for all 12 ports and is not used. URN tariffs are illustrative scheme data, not published port tariffs.

## Six-module workflow

1. **Acoustic analysis:** select a tagged demo recording or decode local audio; review calibration, spectrogram and extracted features.
2. **Vessel correlation:** rank regional AIS candidates within the chosen radius and lock a vessel; proximity is not proof of causation.
3. **Sensitive areas:** overlay the event region’s protected-area and historical species records; occurrence is not confirmed animal presence.
4. **Ship audit:** record seven component assessments, calculate weighted results and create vessel-specific corrective actions.
5. **Corrective action:** advance an eight-stage evidence/note-gated workflow with a SHA-256 hash-chained verification log; closure requires a repeat acoustic scan and measured reduction.
6. **Incentives:** simulate proposed eligibility and fee savings from the selected vessel’s reviewed, measured corrective actions, and estimate a per-call rebate at the nearest or chosen port; authorities alone approve rebates.

## Browser persistence and accessibility

Saved state uses the `oceanguard:v1:` localStorage namespace, including `correctiveActions-v2` for CAPA records. Defaults render identically on the server and first client render; effects restore stored values before writing. Corrupt JSON or blocked storage falls back to in-memory state. Sign-out clears the demo profile but retains progress; reset returns workflow data to its initial state while keeping the current profile.

The active recording, uploaded audio, completion-file names, temporary evidence form entries, map layers, search radius and simulator settings are session/view state, not durable storage. Uploaded PDF content is not stored. Do not use real confidential audit data in this browser-only demo.

The release adds persistent polite toast announcements, labelled inputs and ranges, visible keyboard focus, 44px control targets, keyboard-accessible file attachment and spectrogram navigation, and reduced-motion support. Reset uses the browser’s native confirmation dialog (Escape cancels). No custom modal traps are present. Manual desktop/mobile checks complement tests; these are not a formal accessibility certification.

## K! Hacks 4.0: Dossier Traceability (final release)

The final release adds an end-to-end evidence trail from acoustic event to port rebate, all computed in the browser with pure functions and no new dependencies.

| Capability | Where | What it does |
| --- | --- | --- |
| Role-separated sign-off | `sealAuditRecord`, `requiredSignerRole`, `advanceCapaStage` | Stages 2-6 are signed by a Field Auditor; Stages 7-8 by an Independent Reviewer / Port Authority (name and ID required). |
| Attestation signature | `computeAttestationSignature`, `verifyAttestation` | SHA-256 over `eventId`, `recordHash`, `signerRole` and `accreditationId`. Changing the role, accreditation id or record hash makes verification fail. Entries without a role carry no attestation (Module 5 shows no role badge for them; this is not treated as tampering). Module 5 flags a "Signature mismatch"; the exported dossier lists each entry's role and hash check but does not re-verify attestation signatures. |
| Hash-chained CAPA log | `verifyAuditChain` | Unchanged from v2.0; the dossier reports each chain as intact, broken or empty. |
| Authority overview | `computeAuthorityAggregateMetrics` (Module 6) | Distinct audited vessels, verified CAPAs (Stage 7+ with a measured reduction), mean verified dB reduction, ports with an active scheme. |
| Compliance dossier | `buildComplianceDossierReport`, `renderComplianceDossierHtml` (`reportExport.js`) | Six-section evidence package exported from Module 6 as JSON and as printable, script-free HTML (use Print / Save as PDF). |

Safety statements carried in every dossier: it is decision-support output to be reviewed by a qualified, accredited auditor; AIS correlation does not establish causation; uncalibrated levels are relative dBFS, not dB re 1 µPa; ecological overlap is a screening indicator, and OBIS records are historical; the rebate is an estimate, not an invoice. All report text is HTML-escaped.

### Test summary

`node --test src/algorithms/__tests__/*.test.js`: **84 passed, 0 failed.**

| File | Tests |
| --- | --- |
| `geometry.test.js` | 8 |
| `phase2.test.js` | 12 |
| `phase3.test.js` | 16 |
| `phase3b.test.js` | 13 |
| `phase4-realdata.test.js` | 17 |
| `phase5-dossier.test.js` | 18 (role and attestation signing, authority metrics, dossier structure, disclaimers, escaping, tamper reporting) |

The Vitest suite (`src/test/*` and `src/algorithms/__tests__/phase4.test.ts`, 10 test cases by static count) runs under `npm test` after `npm install`.

**Limits:** the hash chain and attestation are client-side integrity checks, not digital signatures or tamper-proof storage; a person with local-storage access can rebuild a consistent chain. Demo reviewer identities are not authenticated. Production use needs server-side identity, role enforcement and append-only storage.

## v1 hardening changes (earlier release)

- Removed the unreferenced persistence-clearing export, stale integration TODO comments, and unnecessary context memoization.
- Normalized login defaults, field names and autocomplete; preserved hydration-safe restoration.
- Corrected low-contrast status/profile text and heading levels; retained instrument visuals.
- Expanded lint coverage to JavaScript/JSX and enforced the component-to-service boundary.
- Added persistence regression coverage without new dependencies.

The ZIP excludes dependency folders, generated bundles, repository metadata, environment secrets and temporary audit output. `bun.lock` preserves the supplied dependency resolution; npm users can generate their own npm lockfile with `npm install`.
