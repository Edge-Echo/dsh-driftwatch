import type { DriftReport, SessionFingerprint } from './drift.js';
/** Render the drift report as Markdown (for humans, PR comments, logs). */
export declare function renderMarkdown(report: DriftReport, a: SessionFingerprint, b: SessionFingerprint): string;
/** Render a compact single-line summary (for CLI stdout when not verbose). */
export declare function renderSummary(report: DriftReport): string;
/** Render a fingerprint as Markdown (for `fingerprint` command). */
export declare function renderFingerprint(fp: SessionFingerprint): string;
