/** Argument keys that name a file path, in priority order. */
const PATH_KEYS = ['path', 'file_path', 'filePath', 'file', 'target', 'targetPath', 'filename', 'old_path'];
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function extractPath(argsJson) {
    try {
        const args = JSON.parse(argsJson);
        for (const key of PATH_KEYS) {
            const v = args[key];
            if (typeof v === 'string' && v.trim())
                return v;
        }
    }
    catch {
        /* arguments are not always valid JSON in a torn record */
    }
    return undefined;
}
/** Build a behavioral fingerprint from a decoded session log. */
export function fingerprint(log, opts = {}) {
    const maxToolCalls = opts.maxToolCalls ?? 5000;
    const records = log.records;
    const header = asRecord(log.header?.data);
    let turns = 0;
    let steps = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let reasoningChunks = 0;
    let reasoningChars = 0;
    let compactions = 0;
    let retries = 0;
    const completionReasons = {};
    const toolHistogram = {};
    const toolCalls = [];
    const fileOps = [];
    /** callId → call index, so tool/result can mark errors on the call. */
    const callIndex = new Map();
    let perTurn = 0;
    let maxToolsPerTurn = 0;
    const firstTime = records.find((r) => typeof r.time === 'number')?.time ?? 0;
    let lastTime = firstTime;
    for (const rec of records) {
        if (typeof rec.time === 'number')
            lastTime = Math.max(lastTime, rec.time);
        const data = asRecord(rec.data);
        switch (rec.type) {
            case 'turn/start':
                turns++;
                perTurn = 0;
                break;
            case 'turn/end': {
                const reason = asRecord(data?.reason);
                const kind = typeof reason?.kind === 'string' ? reason.kind : 'unknown';
                completionReasons[kind] = (completionReasons[kind] ?? 0) + 1;
                break;
            }
            case 'step/start':
                steps++;
                break;
            case 'user/message':
                userMessages++;
                break;
            case 'assistant/message':
                assistantMessages++;
                break;
            case 'reasoning-chunks': {
                const texts = Array.isArray(data?.texts) ? data.texts : [];
                reasoningChunks += texts.length;
                for (const t of texts)
                    if (typeof t === 'string')
                        reasoningChars += t.length;
                break;
            }
            case 'compaction/start':
                compactions++;
                break;
            case 'llm/retry':
                retries++;
                break;
            case 'tool/call': {
                const name = typeof data?.name === 'string' ? data.name : '?';
                const callId = typeof data?.callId === 'string' ? data.callId : '';
                const argsJson = typeof data?.arguments === 'string' ? data.arguments : '';
                const turn = typeof data?.turn === 'number' ? data.turn : 0;
                const step = typeof data?.step === 'number' ? data.step : 0;
                toolHistogram[name] = (toolHistogram[name] ?? 0) + 1;
                perTurn++;
                maxToolsPerTurn = Math.max(maxToolsPerTurn, perTurn);
                if (toolCalls.length < maxToolCalls) {
                    const path = extractPath(argsJson);
                    toolCalls.push({
                        name, turn, step, callId,
                        argsPreview: argsJson.length > 160 ? `${argsJson.slice(0, 160)}…` : argsJson,
                        path,
                        isError: false,
                    });
                    if (path)
                        fileOps.push({ path, op: name, turn });
                    if (callId)
                        callIndex.set(callId, toolCalls.length - 1);
                }
                break;
            }
            case 'tool/result': {
                const message = asRecord(data?.message);
                const source = asRecord(message?.source);
                const callId = typeof source?.callId === 'string' ? source.callId : '';
                const content = Array.isArray(message?.content) ? message.content : [];
                const first = asRecord(content[0]);
                const isError = first?.isError === true;
                if (isError && callId) {
                    const idx = callIndex.get(callId);
                    if (idx !== undefined)
                        toolCalls[idx].isError = true;
                }
                break;
            }
            default:
                break;
        }
    }
    const id = typeof header?.id === 'string' ? header.id : (log.path.split(/[\\/]/).slice(-2, -1)[0] ?? '?');
    const cwd = typeof header?.cwd === 'string' ? header.cwd : undefined;
    return {
        id,
        path: log.path,
        workspace: cwd,
        records: records.length,
        turns,
        steps,
        userMessages,
        assistantMessages,
        durationMs: lastTime > firstTime ? lastTime - firstTime : 0,
        toolCalls,
        toolHistogram,
        toolErrors: toolCalls.filter((c) => c.isError).length,
        fileOps,
        reasoningChunks,
        reasoningChars,
        compactions,
        retries,
        completionReasons,
        maxToolsPerTurn,
    };
}
const LCS_CELL_BUDGET = 4_000_000;
/** Align two string sequences and report how they diverge. */
export function sequenceDiff(a, b) {
    const n = a.length;
    const m = b.length;
    if (n === 0 && m === 0)
        return { kept: 0, added: 0, removed: 0, divergence: 0, exact: true };
    const longer = Math.max(n, m);
    if (n * m > LCS_CELL_BUDGET) {
        // Fall back to multiset overlap for very long sequences.
        const countA = new Map();
        for (const x of a)
            countA.set(x, (countA.get(x) ?? 0) + 1);
        let overlap = 0;
        for (const x of b) {
            const c = countA.get(x) ?? 0;
            if (c > 0) {
                overlap++;
                countA.set(x, c - 1);
            }
        }
        const removed = n - overlap;
        const added = m - overlap;
        return { kept: overlap, added, removed, divergence: longer ? (added + removed) / longer : 0, exact: false };
    }
    let prev = new Uint32Array(m + 1);
    let cur = new Uint32Array(m + 1);
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
        }
        const tmp = prev;
        prev = cur;
        cur = tmp;
        cur.fill(0);
    }
    const kept = prev[m];
    const added = m - kept;
    const removed = n - kept;
    return { kept, added, removed, divergence: longer ? (added + removed) / longer : 0, exact: true };
}
const METRIC_KEYS = [
    'records', 'turns', 'steps', 'userMessages', 'assistantMessages',
    'reasoningChunks', 'reasoningChars', 'compactions', 'retries', 'toolErrors', 'maxToolsPerTurn',
];
function pct(a, b) {
    return a === 0 ? null : ((b - a) / a) * 100;
}
/** Compare two fingerprints into a drift report. */
export function compareFingerprints(a, b) {
    // 1. Tool sequence divergence (40% weight)
    const toolSequence = sequenceDiff(a.toolCalls.map((c) => c.name), b.toolCalls.map((c) => c.name));
    // 2. Tool usage histogram delta (25%)
    const names = new Set([...Object.keys(a.toolHistogram), ...Object.keys(b.toolHistogram)]);
    const toolUsage = [];
    let l1 = 0;
    let totalA = 0;
    for (const name of names) {
        const ca = a.toolHistogram[name] ?? 0;
        const cb = b.toolHistogram[name] ?? 0;
        totalA += ca;
        l1 += Math.abs(cb - ca);
        if (ca !== cb)
            toolUsage.push({ name, a: ca, b: cb, delta: cb - ca });
    }
    toolUsage.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const histogramDrift = totalA > 0 ? Math.min(1, l1 / (2 * totalA)) : 0;
    // 3. Metric changes (20%)
    const metrics = METRIC_KEYS.map((key) => {
        const va = Number(a[key] ?? 0);
        const vb = Number(b[key] ?? 0);
        return { name: String(key), a: va, b: vb, delta: vb - va, pct: pct(va, vb) };
    });
    const metricDrifts = metrics
        .filter((m) => m.pct !== null)
        .map((m) => Math.min(1, Math.abs(m.pct) / 100));
    const metricDrift = metricDrifts.length ? metricDrifts.reduce((s, x) => s + x, 0) / metricDrifts.length : 0;
    // 4. File-operation set difference (15%)
    const filesA = new Set(a.fileOps.map((f) => f.path));
    const filesB = new Set(b.fileOps.map((f) => f.path));
    const onlyInA = [...filesA].filter((p) => !filesB.has(p));
    const onlyInB = [...filesB].filter((p) => !filesA.has(p));
    const union = new Set([...filesA, ...filesB]);
    const fileDrift = union.size ? (onlyInA.length + onlyInB.length) / (2 * union.size) : 0;
    const score = Math.round(100 * (0.40 * toolSequence.divergence + 0.25 * histogramDrift + 0.20 * metricDrift + 0.15 * fileDrift));
    const verdict = score < 10 ? 'stable' : score < 35 ? 'moderate' : 'significant';
    const namesOnlyInA = [...new Set(a.toolCalls.map((c) => c.name))].filter((n) => !(n in b.toolHistogram)).sort();
    const namesOnlyInB = [...new Set(b.toolCalls.map((c) => c.name))].filter((n) => !(n in a.toolHistogram)).sort();
    return {
        generatedAt: new Date().toISOString(),
        a: { id: a.id, path: a.path, records: a.records, turns: a.turns, durationMs: a.durationMs, toolCalls: a.toolCalls.length },
        b: { id: b.id, path: b.path, records: b.records, turns: b.turns, durationMs: b.durationMs, toolCalls: b.toolCalls.length },
        score,
        verdict,
        toolSequence,
        toolUsage,
        metrics,
        files: { onlyInA: onlyInA.sort(), onlyInB: onlyInB.sort(), common: [...filesA].filter((p) => filesB.has(p)).sort() },
        toolNamesOnlyInA: namesOnlyInA,
        toolNamesOnlyInB: namesOnlyInB,
    };
}
