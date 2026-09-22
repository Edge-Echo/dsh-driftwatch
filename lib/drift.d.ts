import type { SessionLog } from './session-log.js';
/** One tool invocation extracted from the log. */
export interface ToolCall {
    name: string;
    turn: number;
    step: number;
    callId: string;
    /** Short preview of the JSON arguments. */
    argsPreview: string;
    /** File path touched by this call, when the arguments name one. */
    path?: string;
    /** Whether the matching tool/result was an error. */
    isError: boolean;
}
/** A structured summary of one session's behavior. */
export interface SessionFingerprint {
    id: string;
    path: string;
    workspace?: string;
    records: number;
    turns: number;
    steps: number;
    userMessages: number;
    assistantMessages: number;
    /** Wall-clock span covered by the log (ms). */
    durationMs: number;
    toolCalls: ToolCall[];
    /** Tool name → invocation count. */
    toolHistogram: Record<string, number>;
    toolErrors: number;
    /** File paths touched, with the operation kind. */
    fileOps: {
        path: string;
        op: string;
        turn: number;
    }[];
    reasoningChunks: number;
    reasoningChars: number;
    compactions: number;
    retries: number;
    /** turn/end reason kind → count. */
    completionReasons: Record<string, number>;
    /** Longest tool chain without a turn boundary. */
    maxToolsPerTurn: number;
}
/** Build a behavioral fingerprint from a decoded session log. */
export declare function fingerprint(log: SessionLog, opts?: {
    maxToolCalls?: number;
}): SessionFingerprint;
/** LCS-based alignment summary of two sequences. */
export interface SequenceDiff {
    kept: number;
    added: number;
    removed: number;
    /** 0–1: fraction of the longer sequence that is NOT on the common subsequence. */
    divergence: number;
    /** Whether the DP ran exactly (false = sequences were too long and we fell back). */
    exact: boolean;
}
/** Align two string sequences and report how they diverge. */
export declare function sequenceDiff(a: string[], b: string[]): SequenceDiff;
/** One metric compared across two sessions. */
export interface MetricDelta {
    name: string;
    a: number;
    b: number;
    delta: number;
    /** Percent change vs A (null when A is 0). */
    pct: number | null;
}
/** One tool whose usage changed. */
export interface ToolUsageDelta {
    name: string;
    a: number;
    b: number;
    delta: number;
}
/** The drift verdict tiers. */
export type DriftVerdict = 'stable' | 'moderate' | 'significant';
/** The full comparison result. */
export interface DriftReport {
    generatedAt: string;
    a: {
        id: string;
        path: string;
        records: number;
        turns: number;
        durationMs: number;
        toolCalls: number;
    };
    b: {
        id: string;
        path: string;
        records: number;
        turns: number;
        durationMs: number;
        toolCalls: number;
    };
    /** 0–100 drift score (higher = more behavioral change). */
    score: number;
    verdict: DriftVerdict;
    toolSequence: SequenceDiff;
    toolUsage: ToolUsageDelta[];
    metrics: MetricDelta[];
    files: {
        onlyInA: string[];
        onlyInB: string[];
        common: string[];
    };
    /** Tool names present in one run only. */
    toolNamesOnlyInA: string[];
    toolNamesOnlyInB: string[];
}
/** Compare two fingerprints into a drift report. */
export declare function compareFingerprints(a: SessionFingerprint, b: SessionFingerprint): DriftReport;
