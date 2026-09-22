#!/usr/bin/env node
// dsh-driftwatch CLI.
//
//   dsh-driftwatch compare <sessionA> <sessionB> [--json] [--markdown <file>]
//                          [--fail-on-drift <score>] [--quiet]
//   dsh-driftwatch fingerprint <session> [--json]
//   dsh-driftwatch list [--json]
//
// A session reference is a file path, a session directory, a full session id,
// or an unambiguous id prefix (resolved under $DSH_HOME/sessions).
import { readFileSync, writeFileSync } from 'node:fs';
import { fingerprint, compareFingerprints } from './drift.js';
import { renderMarkdown, renderSummary, renderFingerprint } from './report.js';
import { listSessions, readSessionLog, resolveSession } from './session-log.js';
function parseArgs(argv) {
    const out = { command: '', positional: [], json: false, quiet: false, maxToolCalls: 5000 };
    const rest = [...argv];
    out.command = rest.shift() ?? '';
    while (rest.length) {
        const token = rest.shift();
        switch (token) {
            case '--json':
                out.json = true;
                break;
            case '--quiet':
                out.quiet = true;
                break;
            case '--markdown':
                out.markdownFile = rest.shift();
                break;
            case '--fail-on-drift':
                out.failOnDrift = Number(rest.shift());
                break;
            case '--max-tool-calls':
                out.maxToolCalls = Number(rest.shift());
                break;
            case '--version':
            case '-v':
                out.command = '--version';
                break;
            case '--help':
            case '-h':
                out.command = '--help';
                break;
            default:
                if (token.startsWith('--')) {
                    console.error(`Unknown option: ${token}`);
                    process.exit(2);
                }
                out.positional.push(token);
        }
    }
    return out;
}
const HELP = `dsh-driftwatch — behavior drift reports for DeepSeek Harness agents

Usage:
  dsh-driftwatch compare <sessionA> <sessionB> [options]
      Compare two sessions and print a drift report.

      Options:
        --json                  print the machine-readable report instead
        --markdown <file>       also write the Markdown report to <file>
        --fail-on-drift <n>     exit 1 when the drift score is >= n (CI gate)
        --quiet                 print only the one-line summary
        --max-tool-calls <n>    cap retained tool calls per session (default 5000)

  dsh-driftwatch fingerprint <session> [--json]
      Summarize one session's behavior.

  dsh-driftwatch list [--json]
      List sessions under $DSH_HOME/sessions, newest first.

Session references may be a file path, a session directory, a full session id,
or an unambiguous id prefix.

Examples:
  dsh-driftwatch list
  dsh-driftwatch compare session-774a session-91bc
  dsh-driftwatch compare session-a session-b --fail-on-drift 35 --markdown drift.md
`;
function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.command === '--version') {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        console.log(pkg.version);
        return 0;
    }
    if (args.command === '--help' || args.command === '' || args.command === 'help') {
        console.log(HELP);
        return args.command === '' ? 2 : 0;
    }
    if (args.command === 'list') {
        const sessions = listSessions();
        if (args.json) {
            console.log(JSON.stringify(sessions, null, 2));
            return 0;
        }
        if (!sessions.length) {
            console.log('No sessions found under $DSH_HOME/sessions.');
            return 0;
        }
        console.log(`${sessions.length} session(s), newest first:\n`);
        for (const s of sessions.slice(0, 40)) {
            const when = new Date(s.mtimeMs).toISOString().replace('T', ' ').slice(0, 16);
            console.log(`  ${s.id.padEnd(44)} ${(s.sizeBytes / 1024).toFixed(0).padStart(6)} KB  ${when}  ${s.workspace}`);
        }
        if (sessions.length > 40)
            console.log(`  … ${sessions.length - 40} more`);
        return 0;
    }
    if (args.command === 'fingerprint') {
        const ref = args.positional[0];
        if (!ref) {
            console.error('Usage: dsh-driftwatch fingerprint <session>');
            return 2;
        }
        const log = readSessionLog(resolveSession(ref).file);
        const fp = fingerprint(log, { maxToolCalls: args.maxToolCalls });
        console.log(args.json ? JSON.stringify({ fingerprint: fp, decode: { frames: log.frames, compressedBytes: log.compressedBytes, decodedBytes: log.decodedBytes, decodeMs: log.decodeMs } }, null, 2) : renderFingerprint(fp));
        return 0;
    }
    if (args.command === 'compare') {
        const [refA, refB] = args.positional;
        if (!refA || !refB) {
            console.error('Usage: dsh-driftwatch compare <sessionA> <sessionB>');
            return 2;
        }
        const logA = readSessionLog(resolveSession(refA).file);
        const logB = readSessionLog(resolveSession(refB).file);
        const fpA = fingerprint(logA, { maxToolCalls: args.maxToolCalls });
        const fpB = fingerprint(logB, { maxToolCalls: args.maxToolCalls });
        const report = compareFingerprints(fpA, fpB);
        if (args.markdownFile) {
            writeFileSync(args.markdownFile, renderMarkdown(report, fpA, fpB), 'utf8');
        }
        if (args.json) {
            console.log(JSON.stringify(report, null, 2));
        }
        else if (args.quiet) {
            console.log(renderSummary(report));
        }
        else {
            console.log(renderMarkdown(report, fpA, fpB));
            if (args.markdownFile)
                console.log(`\n_Report also written to ${args.markdownFile}_`);
        }
        if (args.failOnDrift !== undefined) {
            if (Number.isNaN(args.failOnDrift)) {
                console.error('--fail-on-drift needs a number');
                return 2;
            }
            if (report.score >= args.failOnDrift) {
                console.error(`\ndrift score ${report.score} >= threshold ${args.failOnDrift} — failing`);
                return 1;
            }
        }
        return 0;
    }
    console.error(`Unknown command: ${args.command}\n`);
    console.log(HELP);
    return 2;
}
process.exit(main());
