# OceanGuard K! Hacks 4.0 - final release (Dossier Traceability)

## Changelog

### Phase 5 (final tests and packaging)
- **Tests:** new `src/algorithms/__tests__/phase5-dossier.test.js` (18 tests), registered in `package.json`'s `npm test` script.
  - `sealAuditRecord`: `signerRole` recorded, deterministic 64-hex `attestationSignature`, no attestation without a role, role / accreditation id / record hash binding, empty accreditation id, Stage 1-6 Field Auditor vs Stage 7-8 Independent Reviewer through `advanceCapaStage`, refusal of Stage 7 without reviewer details.
  - `computeAuthorityAggregateMetrics`: empty and malformed inputs, distinct-vessel count, verified CAPA count (Stage 7+ with measured dB), mean to 1 decimal, active port schemes (all 12 bundled ports), single-audit fallback.
  - `buildComplianceDossierReport` / `renderComplianceDossierHtml`: schema version and timestamp, all six sections, intact and tampered chain reporting, empty-state safety, script-free self-contained HTML, every safety caveat present, calibrated-event caveat removal, HTML escaping of untrusted text.
- **Docs:** README gains the Dossier Traceability summary, the full test table, and the four local commands; the earlier "Phase 5 release changes" heading is renamed "v1 hardening changes (earlier release)" to avoid a clash.
- No source files other than `package.json` (test script only) and docs were changed. No dependency was added or changed.

### Carried forward (Phases 4 / 4A / 4B)
- SHA-256 hash-chained CAPA log; role-separated sign-off with attestation signatures (Stages 7-8 need an Independent Reviewer); Port & URN tariff selector; Authority & Port aggregate overview; one-click compliance dossier export (JSON and printable HTML) from Module 6.

## Verification
- `node --test src/algorithms/__tests__/*.test.js`: **84 passed, 0 failed** (66 earlier + 18 new).
- Not run in this environment (no `node_modules`, no network): Vitest (10 cases by static count), `npm run lint`, `npm run build`, `npm run dev`, and any browser check. Run `npm install && npm test && npm run lint -- --max-warnings=0 && npm run build` locally before release.

## Known gaps
- `detectAuditAnomalies()` is not present in this codebase, so it has no tests. Module 5 reads `anomalyFlags` / `auditAnomalyFlags` from a CAPA, but nothing in the source writes them.
- The dossier export does not re-verify attestation signatures (Module 5 does).

## Boundaries
Browser-only demo. The hash chain and attestations are client-side integrity checks, not tamper-proof storage or digital signatures. Port tariffs, scenarios and AIS positions are illustrative or historical, not live.
