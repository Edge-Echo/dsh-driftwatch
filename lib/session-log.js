// dsh-driftwatch — session log reader.
//
// DSH session logs are append-only `.jsonl.zstd` files: each append writes one
// independent zstd frame, so a log is a *concatenation of frames*. Node's zlib
// decodes only the first frame, and its stream API refuses the second ("Unknown
// frame descriptor"). DSH itself works around this with a private zstd handle plus a
// koffi FFI fallback.
//
// This module used to scan for the frame magic and greedily retry decoding from each
// candidate — a heuristic that worked but had to recover from magic sequences found
// inside compressed payload. It now delegates to `@edge-echo/dsh-ledger`, which parses
// the RFC 8878 frame structure and therefore knows where each frame ends without
// guessing, without decompressing. One implementation of a subtle format instead of
// two, and the frame walk is also faster (27 ms for 34,729 frames).
//
// The filesystem helpers below stay here on purpose: enumerating session directories
// is glue, not logic, and keeping it local keeps this module's API synchronous while
// the ledger's own helpers are promise-based.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodeFrame, walkFrameAt } from '@edge-echo/dsh-ledger';
/** Decode a multi-frame zstd buffer into its concatenated UTF-8 text. */
export function decodeMultiFrame(buf) {
    const parts = [];
    let offset = 0;
    for (;;) {
        const walk = walkFrameAt(buf, offset);
        if (walk.kind !== 'frame')
            break;
        parts.push(decodeFrame(buf, walk.span));
        offset = walk.span.end;
    }
    return { text: parts.join(''), frames: parts.length };
}
/** Parse decoded JSONL text into records, skipping malformed lines. */
export function parseSessionText(text) {
    const records = [];
    for (const line of text.split('\n')) {
        if (!line.trim())
            continue;
        try {
            records.push(JSON.parse(line));
        }
        catch {
            /* a torn final line is normal for append-only logs */
        }
    }
    return records;
}
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
export function readSessionLog(file) {
    const t0 = Date.now();
    const buf = readFileSync(file);
    const { text, frames } = decodeMultiFrame(buf);
    const records = parseSessionText(text);
    return {
        path: resolve(file),
        compressedBytes: buf.length,
        decodedBytes: Buffer.byteLength(text, 'utf8'),
        frames,
        records,
        header: records.find((r) => r.type === 'session'),
        decodeMs: Date.now() - t0,
    };
}
/** The Harness home directory (`$DSH_HOME`, else `~/.dsh`). */
export function dshHome() {
    return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}
/** List every session log under `$DSH_HOME/sessions`, newest first. */
export function listSessions(home = dshHome()) {
    const root = join(home, 'sessions');
    const out = [];
    let workspaces;
    try {
        workspaces = readdirSync(root);
    }
    catch {
        return out;
    }
    for (const ws of workspaces) {
        const wsDir = join(root, ws);
        let entries;
        try {
            if (!statSync(wsDir).isDirectory())
                continue;
            entries = readdirSync(wsDir);
        }
        catch {
            continue;
        }
        for (const name of entries) {
            const file = join(wsDir, name, 'session.jsonl.zstd');
            try {
                const st = statSync(file);
                out.push({ id: name, file, workspace: ws, mtimeMs: st.mtimeMs, sizeBytes: st.size });
            }
            catch {
                /* not a session directory */
            }
        }
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
/**
 * Resolve a user-supplied session reference to a log file.
 * Accepts an absolute/relative file path, a session directory, a full session
 * id, or an unambiguous id prefix. Throws when nothing or several match.
 */
export function resolveSession(ref, home = dshHome()) {
    const asPath = resolve(ref);
    try {
        const st = statSync(asPath);
        if (st.isFile()) {
            return { id: asPath.split(/[\\/]/).slice(-2, -1)[0] ?? asPath, file: asPath, workspace: '?', mtimeMs: st.mtimeMs, sizeBytes: st.size };
        }
        if (st.isDirectory()) {
            const file = join(asPath, 'session.jsonl.zstd');
            const fst = statSync(file);
            return { id: asPath.split(/[\\/]/).pop() ?? asPath, file, workspace: '?', mtimeMs: fst.mtimeMs, sizeBytes: fst.size };
        }
    }
    catch {
        /* fall through to id lookup */
    }
    const all = listSessions(home);
    const exact = all.filter((s) => s.id === ref);
    if (exact.length === 1)
        return exact[0];
    const prefix = all.filter((s) => s.id.startsWith(ref));
    if (prefix.length === 1)
        return prefix[0];
    if (prefix.length > 1) {
        throw new Error(`Session reference "${ref}" is ambiguous (${prefix.length} matches): ${prefix.slice(0, 5).map((s) => s.id).join(', ')}`);
    }
    throw new Error(`No session matches "${ref}". Run \`dsh-driftwatch list\` to see available sessions.`);
}
