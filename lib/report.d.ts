import type { DriftReport, SessionFingerprint } from './drift.js';
/** Render the drift report as Markdown (for humans, PR comments, logs). */
export declare function renderMarkdown(report: DriftReport, a: SessionFingerprint, b: SessionFingerprint): string;
/**
 * Render a self-contained HTML report.
 *
 * No scripts and no external assets: it can be attached to a PR, opened from disk, or archived with
 * the session it describes. Every value that originates in session data is escaped — tool names and
 * file paths are attacker-influenced in the general case, and a report that renders arbitrary markup
 * is a report nobody should open.
 */
export declare function renderHtml(report: DriftReport, a: SessionFingerprint, b: SessionFingerprint): string;
/** Render a compact single-line summary (for CLI stdout when not verbose). */ export declare function renderSummary(report: DriftReport): string;
/** Render a fingerprint as Markdown (for `fingerprint` command). */
export declare function renderFingerprint(fp: SessionFingerprint): string;
