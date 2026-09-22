// dsh-driftwatch — Cordis plugin: behavior-drift tools for the agent.
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import { compareFingerprints, fingerprint } from './drift.js'
import { renderMarkdown, renderSummary } from './report.js'
import { listSessions, readSessionLog, resolveSession } from './session-log.js'

/** Plugin config. */
export interface DriftwatchConfig {
  /** Cap retained tool calls per session (keeps reports bounded). */
  maxToolCalls?: number
}

function meta<T>(result: { meta?: unknown }): T | undefined {
  return result.meta as T | undefined
}

export default Object.assign(
  function driftwatch(ctx: Context, config: DriftwatchConfig = {}) {
    const maxToolCalls = config.maxToolCalls ?? 2000

    // ── drift_compare ─────────────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'drift_compare',
      description:
        'Compare two DSH sessions and report how the agent\'s behavior drifted: tool-call sequence alignment, tool mix, reasoning volume, timing, retries and file targets. ' +
        'Session references may be a session id, an id prefix, or a path. This tool does not judge acceptability — it presents the differences for you to assess.',
      parameters: {
        sessionA: { type: 'string', description: 'Baseline session (id, id prefix, or path)', required: true },
        sessionB: { type: 'string', description: 'Candidate session (id, id prefix, or path)', required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sessionA: { type: 'string', required: true },
            sessionB: { type: 'string', required: true },
            score: { type: 'integer', required: true },
            verdict: { type: 'string', required: true },
            toolCallsA: { type: 'integer', required: true },
            toolCallsB: { type: 'integer', required: true },
            divergencePct: { type: 'number', required: true },
            summary: { type: 'string', required: true },
            report: { type: 'string', required: true },
          },
        },
        render: (_a, value) => [{ type: 'text', text: `${value.summary}\n\n${value.report}` }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({
        card: 'generic',
        title: 'Comparing session behavior',
        kind: 'search',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ score?: number; verdict?: string; summary?: string }>(result)
        const icon = m?.verdict === 'stable' ? '🟢' : m?.verdict === 'moderate' ? '🟡' : '🔴'
        return {
          card: 'generic',
          title: `${icon} drift ${m?.score ?? '?'}/100 (${m?.verdict ?? '?'})`,
          content: [{ type: 'text', text: m?.summary ?? '' }],
        }
      },
      async execute(args) {
        const aRef = args.sessionA as string
        const bRef = args.sessionB as string
        const logA = readSessionLog(resolveSession(aRef).file)
        const logB = readSessionLog(resolveSession(bRef).file)
        const fpA = fingerprint(logA, { maxToolCalls })
        const fpB = fingerprint(logB, { maxToolCalls })
        const report = compareFingerprints(fpA, fpB)
        return {
          sessionA: fpA.id,
          sessionB: fpB.id,
          score: report.score,
          verdict: report.verdict,
          toolCallsA: fpA.toolCalls.length,
          toolCallsB: fpB.toolCalls.length,
          divergencePct: Number((report.toolSequence.divergence * 100).toFixed(2)),
          summary: renderSummary(report),
          report: renderMarkdown(report, fpA, fpB),
        }
      },
    }))

    // ── drift_list ────────────────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'drift_list',
      description: 'List DSH sessions available for drift comparison, newest first. Use the returned ids with drift_compare.',
      parameters: {
        limit: { type: 'integer', description: 'Maximum sessions to return (default 20)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            count: { type: 'integer', required: true },
            sessions: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  workspace: { type: 'string', required: true },
                  sizeKb: { type: 'integer', required: true },
                  modified: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: value.sessions.map((s) => `${s.id}  ${s.sizeKb} KB  ${s.modified}  ${s.workspace}`).join('\n') || '(no sessions)',
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({
        card: 'generic',
        title: 'Listing sessions',
        kind: 'search',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ count?: number }>(result)
        return {
          card: 'generic',
          title: `${m?.count ?? 0} sessions available`,
        }
      },
      async execute(args) {
        const limit = (args.limit as number | undefined) ?? 20
        const sessions = listSessions().slice(0, limit)
        return {
          count: sessions.length,
          sessions: sessions.map((s) => ({
            id: s.id,
            workspace: s.workspace,
            sizeKb: Math.round(s.sizeBytes / 1024),
            modified: new Date(s.mtimeMs).toISOString().replace('T', ' ').slice(0, 16),
          })),
        }
      },
    }))
  },
  { inject: ['tools'] },
)
