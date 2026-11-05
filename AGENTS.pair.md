# 结对规则（粘到项目根的 AGENTS.md）

这个仓库有两个 agent 在同时干活：Codex 和 DSH。规矩是**先占位再动手，干完留话**。

工具（在项目根执行，`<PAIR>` 指 `F:/mcp/dsh-pair/bin/pair.cmd`，DSH 里是 `F:/mcp/dsh-pair/bin/pair`）：

| 想干什么 | 命令 |
|---|---|
| 看现场 | `<PAIR> status --agent=<我自己>` |
| 占文件 | `<PAIR> claim src/foo.js --note="在改什么"` |
| 放开 | `<PAIR> release` |
| 说一句 | `<PAIR> say "一句话" --kind=intent\|done\|question\|blocker` |
| 读看板 | `<PAIR> board --limit=20` |
| 看改动 | `<PAIR> diff` 或 `<PAIR> diff HEAD~1..HEAD` |

## 硬规则

1. **开工前先 `status`** —— 看对方占了哪些文件、看板最后几条在说什么。
2. **改文件前先 `claim`** —— 被拒绝（`claim rejected`）说明对方正在那里，**换一块改**，不要抢、不要等。
3. **一块活干完立刻 `say --kind=done` + `release`**，说清改了哪些文件。不要攒到最后。
4. **要动对方占着的文件**：先 `say --kind=question` 问，等对方 `release`，不要静默覆盖。
5. **收工前 `diff` 看一眼**自己这一轮的改动，确认没有把对方的改动带掉。
6. 冲突无法用说话解决时，`say --kind=blocker` 写清楚，然后停手等人。

## 为什么

两个 agent 共用一个工作目录，**不会产生 merge 冲突，覆盖是静默的** —— 所以只能靠 claim 占位和 diff 自查来兜底。