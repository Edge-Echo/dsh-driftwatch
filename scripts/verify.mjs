// Smoke check: build synthetic multi-frame session logs, decode them, and
// verify the fingerprint + drift pipeline end to end (no real session needed).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { compareFingerprints, fingerprint } from '../lib/drift.js'
import { renderHtml, renderMarkdown } from '../lib/report.js'
import { readSessionLog } from '../lib/session-log.js'

function records(toolCount) {
  const out = [
    { type: 'session', version: 1, id: 'test-session', createdAt: 1000, cwd: 'C:/test' },
    { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: 1001, data: { turn: 1, step: 1 } },
    { type: 'reasoning-chunks', seq: 3, time: 1002, data: { turn: 1, step: 1, index: 0, dt: [1], texts: ['thinking', ' hard'] } },
  ]
  let seq = 10
  for (let i = 0; i < toolCount; i++) {
    const callId = `call_${i}`
    out.push({
      type: 'tool/call', seq: seq++, time: 2000 + i,
      data: {
        turn: 1, step: 1, callId,
        name: i % 3 === 0 ? 'read' : 'edit',
        arguments: JSON.stringify({ path: `file${i % 5}.ts`, content: 'x' }),
      },
    })
    out.push({
      type: 'tool/result', seq: seq++, time: 2100 + i,
      data: {
        turn: 1, step: 1,
        message: {
          source: { kind: 'tool', callId },
          content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: 'ok' }], isError: i === 2 }],
        },
      },
    })
  }
  out.push({ type: 'turn/end', seq: seq++, time: 3000, data: { turn: 1, reason: { kind: 'completed' } } })
  return out
}

/** Write one log as several zstd frames (mirrors append-only writes). */
function writeLog(root, name, recs) {
  mkdirSync(join(root, name), { recursive: true })
  const file = join(root, name, 'session.jsonl.zstd')
  const frames = []
  for (let i = 0; i < recs.length; i += 3) {
    const chunk = recs.slice(i, i + 3).map((r) => JSON.stringify(r)).join('\n') + '\n'
    frames.push(zstdCompressSync(Buffer.from(chunk, 'utf8')))
  }
  writeFileSync(file, Buffer.concat(frames))
  return file
}

const root = mkdtempSync(join(tmpdir(), 'driftwatch-'))
const fileA = writeLog(root, 'session-aaa', records(12))
const fileB = writeLog(root, 'session-bbb', records(20))

const logA = readSessionLog(fileA)
const logB = readSessionLog(fileB)
const fpA = fingerprint(logA)
const fpB = fingerprint(logB)
const report = compareFingerprints(fpA, fpB)

const html = renderHtml(report, fpA, fpB)
// Session data reaches the HTML report, so escaping is a property worth asserting rather than
// eyeballing. A crafted tool name must not become markup.
const hostile = renderHtml({ ...report, toolUsage: [{ name: '<img src=x onerror=alert(1)>', a: 1, b: 2, delta: 1 }] }, fpA, fpB)

const checks = [
  ['multi-frame decode A', logA.frames >= 5],
  ['multi-frame decode B', logB.frames >= 8],
  ['records parsed A', fpA.records === 12 * 2 + 5],
  ['tool calls A', fpA.toolCalls.length === 12],
  ['tool calls B', fpB.toolCalls.length === 20],
  ['error flagged', fpA.toolErrors === 1],
  ['file ops extracted', fpA.fileOps.length === 12],
  ['turn outcome recorded', fpA.completionReasons.completed === 1],
  ['drift score in range', report.score >= 0 && report.score <= 100],
  ['verdict assigned', ['stable', 'moderate', 'significant'].includes(report.verdict)],
  ['markdown rendered', renderMarkdown(report, fpA, fpB).includes('# Behavior drift report')],
  ['html is a complete document', html.startsWith('<!doctype html>') && html.trimEnd().endsWith('</html>')],
  ['html carries the score', html.includes(`>${report.score}<`)],
  ['html carries the verdict', html.includes('significant drift') || html.includes('moderate drift') || html.includes('stable')],
  ['html is self-contained (no scripts, no remote assets)', !html.includes('<script') && !html.includes('http://') && !html.includes('https://')],
  ['html escapes session data', hostile.includes('&lt;img') && !hostile.includes('<img')],
]

let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failed++
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed; drift score ${report.score} (${report.verdict})`)
process.exit(failed ? 1 : 0)
