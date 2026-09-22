# Changelog

## [0.1.0] - 2026-09-22

### Added

- **Behavior-drift reporting** for DSH sessions: compare two session logs and report tool-sequence alignment (LCS), tool-mix deltas, metric changes, and file-target differences.
- **Drift score** (0–100) with three tiers (`stable` / `moderate` / `significant`) and configurable CI threshold (`--fail-on-drift`).
- **Zero-dependency multi-frame zstd decoder** for append-only `session.jsonl.zstd` logs (self-healing frame-magic scan). Measured: 20 MB / 34 729 frames → 59 MB decoded in ~1.4 s.
- **CLI**: `compare`, `fingerprint`, `list` — with `--json` (machine-readable) and `--markdown <file>` output.
- **dsh plugin**: `drift_compare` and `drift_list` tools with structured output and UI cards.
- Smoke test suite (`scripts/verify.mjs`): 11 checks over synthetic multi-frame logs.
- Verified on real sessions: same-workspace pair scored 54/100, cross-workspace pair 69/100.
