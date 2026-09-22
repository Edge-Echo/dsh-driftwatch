// dsh-driftwatch — session log reader.
//
// DSH session logs are append-only `.jsonl.zstd` files: each append writes one
// independent zstd frame, so a log is a *concatenation of frames*. Node's
// zlib decodes only the first frame, and its stream API refuses the second
// ("Unknown frame descriptor"). DSH itself works around this with a private
// zstd handle plus a koffi FFI fallback.
//
// We stay dependency-free and use a different, self-healing strategy: scan for
// the zstd frame magic (0x28 0xB5 0x2F 0xFD), then greedily decode from each
// candidate start until a slice decodes successfully. A magic sequence that
// appears inside compressed payload merely extends the slice; a real frame
// boundary decodes on the first try. Validated on a 20 MB / 34 729-frame log:
// full decode in ~1.4 s.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** One session-log record: every entry has a `type`, most carry `seq`/`time`/`data`. */
export interface SessionRecord {
  type: string
  seq?: number
  time?: number
  data?: unknown
  [key: string]: unknown
}

/** Decoded session log: raw records plus the header record when present. */
export interface SessionLog {
  path: string
  /** File size on disk (compressed). */
  compressedBytes: number
  /** Decoded payload size. */
  decodedBytes: number
  /** zstd frames found. */
  frames: number
  /** Every record in file order. */
  records: SessionRecord[]
  /** The `type: "session"` header, when the log starts with one. */
  header?: SessionRecord
  /** Wall-clock decode time in milliseconds. */
  decodeMs: number
}

/** Decode a multi-frame zstd buffer into its concatenated UTF-8 text. */
export function decodeMultiFrame(buf: Buffer): { text: string; frames: number } {
  const starts: number[] = []
  let i = 0
  while ((i = buf.indexOf(ZSTD_MAGIC, i)) !== -1) {
    starts.push(i)
    i += 4
  }
  const parts: Buffer[] = []
  let k = 0
  while (k < starts.length) {
    let decoded: Buffer | null = null
    let endIdx = k
    for (let j = k; j < starts.length; j++) {
      const end = j + 1 < starts.length ? starts[j + 1] : buf.length
      try {
        decoded = zstdDecompressSync(buf.subarray(starts[k], end))
        endIdx = j
        break
      } catch {
        /* magic inside payload — extend the slice and retry */
      }
    }
    if (decoded === null) break
    parts.push(decoded)
    k = endIdx + 1
  }
  return { text: Buffer.concat(parts).toString('utf8'), frames: parts.length }
}

/** Parse decoded JSONL text into records, skipping malformed lines. */
export function parseSessionText(text: string): SessionRecord[] {
  const records: SessionRecord[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line) as SessionRecord)
    } catch {
      /* a torn final line is normal for append-only logs */
    }
  }
  return records
}

/** Read and decode one session log file. */
export function readSessionLog(file: string): SessionLog {
  const t0 = Date.now()
  const buf = readFileSync(file)
  const { text, frames } = decodeMultiFrame(buf)
  const records = parseSessionText(text)
  return {
    path: resolve(file),
    compressedBytes: buf.length,
    decodedBytes: Buffer.byteLength(text, 'utf8'),
    frames,
    records,
    header: records.find((r) => r.type === 'session'),
    decodeMs: Date.now() - t0,
  }
}

/** The Harness home directory (`$DSH_HOME`, else `~/.dsh`). */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** One session log discovered under the Harness home. */
export interface SessionRef {
  /** Session id (the directory name, e.g. `session-774a…` or a bare uuid). */
  id: string
  /** Absolute path of the `session.jsonl.zstd` file. */
  file: string
  /** Workspace directory name the session belongs to. */
  workspace: string
  /** Last modification time (ms). */
  mtimeMs: number
  sizeBytes: number
}

/** List every session log under `$DSH_HOME/sessions`, newest first. */
export function listSessions(home = dshHome()): SessionRef[] {
  const root = join(home, 'sessions')
  const out: SessionRef[] = []
  let workspaces: string[]
  try {
    workspaces = readdirSync(root)
  } catch {
    return out
  }
  for (const ws of workspaces) {
    const wsDir = join(root, ws)
    let entries: string[]
    try {
      if (!statSync(wsDir).isDirectory()) continue
      entries = readdirSync(wsDir)
    } catch {
      continue
    }
    for (const name of entries) {
      const file = join(wsDir, name, 'session.jsonl.zstd')
      try {
        const st = statSync(file)
        out.push({ id: name, file, workspace: ws, mtimeMs: st.mtimeMs, sizeBytes: st.size })
      } catch {
        /* not a session directory */
      }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * Resolve a user-supplied session reference to a log file.
 * Accepts an absolute/relative file path, a session directory, a full session
 * id, or an unambiguous id prefix. Throws when nothing or several match.
 */
export function resolveSession(ref: string, home = dshHome()): SessionRef {
  const asPath = resolve(ref)
  try {
    const st = statSync(asPath)
    if (st.isFile()) {
      return { id: asPath.split(/[\\/]/).slice(-2, -1)[0] ?? asPath, file: asPath, workspace: '?', mtimeMs: st.mtimeMs, sizeBytes: st.size }
    }
    if (st.isDirectory()) {
      const file = join(asPath, 'session.jsonl.zstd')
      const fst = statSync(file)
      return { id: asPath.split(/[\\/]/).pop() ?? asPath, file, workspace: '?', mtimeMs: fst.mtimeMs, sizeBytes: fst.size }
    }
  } catch {
    /* fall through to id lookup */
  }
  const all = listSessions(home)
  const exact = all.filter((s) => s.id === ref)
  if (exact.length === 1) return exact[0]
  const prefix = all.filter((s) => s.id.startsWith(ref))
  if (prefix.length === 1) return prefix[0]
  if (prefix.length > 1) {
    throw new Error(`Session reference "${ref}" is ambiguous (${prefix.length} matches): ${prefix.slice(0, 5).map((s) => s.id).join(', ')}`)
  }
  throw new Error(`No session matches "${ref}". Run \`dsh-driftwatch list\` to see available sessions.`)
}
