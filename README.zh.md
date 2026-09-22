# dsh-driftwatch

![dsh-driftwatch](https://raw.githubusercontent.com/Edge-Echo/dsh-driftwatch/main/banner.svg)

> **dsh-toolkit 家族成员**：[dsh-mcp-bridge](https://github.com/Edge-Echo/dsh-mcp-bridge) · [dsh-win-toolkit](https://github.com/Edge-Echo/dsh-win-toolkit) · [dsh-netassist](https://github.com/Edge-Echo/dsh-netassist) · [dsh-driftwatch](https://github.com/Edge-Echo/dsh-driftwatch)

**DeepSeek Harness agent 的行为漂移报告工具。**

你改了个提示词、插件或模型，感觉行为不太一样了。但**到底哪里变了、变了多少**？

DriftWatch 读两份 session log，精确告诉你 agent 行为的分歧：工具调用序列、工具构成、文件目标、推理量、重试、耗时。零依赖，可直接进 CI。

> English docs: [README.md](README.md).

## 解决什么问题

DSH 记录一切（`模型可见即被记录`），证据一直都在——但手工读一份 59 MB 的轨迹不是工作流。已有工具各自解决了相邻问题：

| 工具 | 回答的问题 |
|---|---|
| `dsh-replay` | 「把这个轨迹给我看」（调试） |
| `dsh-eval-harness` | 「这符合我写的预期吗？」（断言） |
| **`dsh-driftwatch`** | **「这次运行和上次有什么不同？」（对比）** |

DriftWatch **刻意不做断言、不渲染轨迹**。它产出一份*漂移报告*：结构化的、可评审的行为变化陈述，另附可选的 CI 阈值门禁。

## 快速开始

```sh
# 列出 $DSH_HOME/sessions 下的会话
npx dsh-driftwatch list

# 对比两次运行（支持 id、id 前缀、路径）
npx dsh-driftwatch compare session-b6c2dcf3 session-b130e75b

# CI 门禁：漂移分 ≥35 时失败
npx dsh-driftwatch compare before after --fail-on-drift 35 --markdown drift.md
```

真实运行输出（两个实际会话）：

```
**Verdict: 🔴 significant drift** — score 54/100

| | A (baseline) | B (candidate) |
|---|---|---|
| turns | 4 | 4 |
| records | 6577 | 2692 |
| tool calls | 163 | 82 |
| duration | 1117m 15s | 1079m 13s |

## Tool usage changes
| tool | A | B | Δ |
|---|---:|---:|---:|
| `write` | 41 | 7 | -34 |
| `edit` | 43 | 29 | -14 |
| `pwsh` | 48 | 36 | -12 |
| `todo_write` | 0 | 4 | +4 |
```

## 测量什么

| 信号 | 细节 | 权重 |
|---|---|---|
| 工具序列 | LCS 对齐：保留 / 删除 / 新增 + 分歧率 | 40% |
| 工具构成 | 每个工具在两边的次数差 | 25% |
| 指标 | 记录数、轮次、步骤、消息、推理片段/字符、压缩、重试、工具错误、每轮最多工具数 | 20% |
| 文件目标 | 只出现在 A / 只出现在 B / 共有 的路径 | 15% |

加权合成 **0–100 漂移分**，三档：`stable`（<10）、`moderate`（10–34）、`significant`（≥35）。

DriftWatch 从不判断漂移是否*可接受*——那是你的判断。分数和阈值只是让变化可见。

## CI 集成

```yaml
# .github/workflows/drift.yml
- name: Behavior drift check
  run: |
    npx dsh-driftwatch compare "$BASELINE_SESSION" "$CANDIDATE_SESSION" \
      --fail-on-drift 35 --markdown drift-report.md
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: drift-report
    path: drift-report.md
```

`--json` 输出完整机器可读报告（分数、差量、文件集合），供看板或 PR 机器人消费。

## 作为 dsh 插件

装进 profile 后，agent 会获得两个工具：

```sh
dsh plugin --profile web add dsh-driftwatch
```

| 工具 | agent 能做什么 |
|---|---|
| `drift_compare` | 对比两个会话并把漂移报告直接呈现出来 |
| `drift_list` | 列出可选会话，挑一个基线 |

适用于「对比你这次和上次做同一个任务的过程」——让 agent 自己收集证据。

## session log 是怎么读的

DSH 的 session log 是 append-only 的 `.jsonl.zstd`：每次追加写入一个独立的 zstd 帧，所以一份日志是**多帧拼接**。Node 的 zlib 只解第一帧，其流式 API 会拒绝后续帧；DSH 官方用的是私有 zstd 句柄 + koffi FFI 兜底。

DriftWatch 保持**零依赖**，用自愈式策略：扫描 zstd 帧魔数（`28 B5 2F FD`），从每个候选起点贪婪解码直到切片解码成功。实测 20 MB / 34 729 帧的日志：**解出 59 MB，耗时约 1.4 秒**。

## 局限

- 记录类型按防御式读取：未知类型忽略、缺失字段容忍。未来格式变化只会让报告降级，不会崩溃。
- 序列对齐在 400 万单元对内是精确 LCS；超出后退化为多重集重叠，并在报告中注明。
- DriftWatch 对比的是*行为*，不是*正确性*。稳定的运行也可能是错的，漂移的运行也可能更好。

## License

MIT
