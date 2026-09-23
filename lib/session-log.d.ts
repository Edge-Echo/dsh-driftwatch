/** One session-log record: every entry has a `type`, most carry `seq`/`time`/`data`. */
export interface SessionRecord {
    type: string;
    seq?: number;
    time?: number;
    data?: unknown;
    [key: string]: unknown;
}
/** Decoded session log: raw records plus the header record when present. */
export interface SessionLog {
    path: string;
    /** File size on disk (compressed). */
    compressedBytes: number;
    /** Decoded payload size. */
    decodedBytes: number;
    /** zstd frames found. */
    frames: number;
    /** Every record in file order. */
    records: SessionRecord[];
    /** The `type: "session"` header, when the log starts with one. */
    header?: SessionRecord;
    /** Wall-clock decode time in milliseconds. */
    decodeMs: number;
}
/** Decode a multi-frame zstd buffer into its concatenated UTF-8 text. */
export declare function decodeMultiFrame(buf: Buffer): {
    text: string;
    frames: number;
};
/** Parse decoded JSONL text into records, skipping malformed lines. */
export declare function parseSessionText(text: string): SessionRecord[];
/**
 * Read and decode one session log file.
 *
 * Delegates to `decodeMultiFrame`, so the frame walk happens once in the ledger and
 * this module stays a consumer of it.
 *
 * A per-frame variant was written and measured, on the theory that dropping each
 * frame's text before parsing the next would lower peak memory. It does not: peak
 * rose from 137 MiB to 160 MiB (per-frame `toString`/`split` makes more short-lived
 * garbage) while retained memory barely moved (135 → 127 MiB), because the dominant
 * cost is the 53,671 parsed record objects that both strategies must hold. The
 * simpler version wins on both counts.
 */
export declare function readSessionLog(file: string): SessionLog;
/** The Harness home directory (`$DSH_HOME`, else `~/.dsh`). */
export declare function dshHome(): string;
/** One session log discovered under the Harness home. */
export interface SessionRef {
    /** Session id (the directory name, e.g. `session-774a…` or a bare uuid). */
    id: string;
    /** Absolute path of the `session.jsonl.zstd` file. */
    file: string;
    /** Workspace directory name the session belongs to. */
    workspace: string;
    /** Last modification time (ms). */
    mtimeMs: number;
    sizeBytes: number;
}
/** List every session log under `$DSH_HOME/sessions`, newest first. */
export declare function listSessions(home?: string): SessionRef[];
/**
 * Resolve a user-supplied session reference to a log file.
 * Accepts an absolute/relative file path, a session directory, a full session
 * id, or an unambiguous id prefix. Throws when nothing or several match.
 */
export declare function resolveSession(ref: string, home?: string): SessionRef;
