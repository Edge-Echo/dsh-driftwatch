# Changelog

## [0.1.1] - 2026-09-23

### Changed

- **The multi-frame zstd decoder now comes from `@edge-echo/dsh-ledger`** instead of being
  implemented here. That library parses the RFC 8878 frame structure, so frame boundaries are
  exact rather than recovered by scanning for the magic and retrying; this repo no longer imports
  `zstdDecompressSync` at all.
- The swap was verified rather than assumed: on a frozen 20 MiB log the superseded decoder and the
  new one produce the identical 62,037,223-character payload, the same 34,729 frames, and the
  same 53,671 records. The existing 11-check suite still passes with an unchanged drift score.
- A per-frame parsing variant was also written and measured, on the theory that it would lower
  peak memory. It did not (peak 137 → 160 MiB, retained 135 → 127 MiB), so the simpler form was
  kept and the measurement is recorded in the source.
- Wording updated from "zero dependencies" to "no third-party dependencies", which is what is now
  true: the one dependency is this project's own, and it is itself dependency-free.

## [0.1.0] - 2026-09-22

### Added

- **Behavior-drift reporting** for DSH sessions: compare two session logs and report tool-sequence alignment (LCS), tool-mix deltas, metric changes, and file-target differences.
- **Drift score** (0–100) with three tiers (`stable` / `moderate` / `significant`) and configurable CI threshold (`--fail-on-drift`).
- **Zero-dependency multi-frame zstd decoder** for append-only `session.jsonl.zstd` logs (self-healing frame-magic scan). Measured: 20 MB / 34 729 frames → 59 MB decoded in ~1.4 s.
- **CLI**: `compare`, `fingerprint`, `list` — with `--json` (machine-readable) and `--markdown <file>` output.
- **dsh plugin**: `drift_compare` and `drift_list` tools with structured output and UI cards.
- Smoke test suite (`scripts/verify.mjs`): 11 checks over synthetic multi-frame logs.
- Verified on real sessions: same-workspace pair scored 54/100, cross-workspace pair 69/100.
