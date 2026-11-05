# dsh-pair

两个编码 agent（Codex + DSH，或任意两个）在**同一个仓库**里结对干活：各自改文件，互相看得见对方改了什么。

不是派活，不是审稿 —— 是并排干活。

## 它解决什么

两个 agent 同时改一个仓库，最容易出的三个问题：

1. **看不见** —— 不知道对方改了哪些文件、改了什么。
2. **撞车** —— 两个人同时写同一个文件，后写的把前面覆盖掉，而且没有任何提示。
3. **断片** —— 不知道对方在干什么、卡在哪。

`dsh-pair` 用三样东西解决：

```
git status / git diff     ← 谁改了什么（真相）
.pair/claims.json         ← 谁在改哪里（申明锁，2h 过期）
.pair/board.jsonl         ← 谁在干什么（看板，append-only）
```

`.pair/` 自动写进 `.gitignore`，不污染仓库。

## 装在哪

装在 **C 盘**：`C:\Users\橙子\dsh-tools\dsh-pair`（55 KB，零依赖）。

放 C 盘的原因是 F 盘是移动盘 —— 拔了就没了，工具不该跟着盘走。项目数据仍然待在 F 盘。

## 安装

零依赖，Node ≥ 20。放到任意位置即可，不用 npm install。

```bash
git clone <this> C:/Users/橙子/dsh-tools/dsh-pair
node C:/Users/橙子/dsh-tools/dsh-pair/src/cli.mjs status --repo=F:/your/project
```

## 接入 Codex

```bash
codex mcp add pair --env PAIR_AGENT=codex -- node C:/Users/橙子/dsh-tools/dsh-pair/src/server.mjs
codex mcp list
```

等价于 `~/.codex/config.toml`：

```toml
[mcp_servers.pair]
command = "C:/dev/nodejs/node"
args = ["C:/Users/橙子/dsh-tools/dsh-pair/src/server.mjs"]
env = { PAIR_AGENT = "codex" }
startup_timeout_sec = 30
tool_timeout_sec = 120
```

## 接入 DSH

编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`，追加一条（与已有的 mcp-client 条目同形）：

```yaml
- id: mcp-pair
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: pair
    transport: stdio
    command: 'C:/dev/nodejs/node'
    args:
      - 'C:/Users/橙子/dsh-tools/dsh-pair/src/server.mjs'
    env:
      PAIR_AGENT: dsh
    toolCallTimeoutMs: 30000
    failOnStartupError: false
```

保存后 DSH 热重载，工具会以 `mcp__pair__pair_status` 这种名字出现。

## 看得见的面板

```bash
C:\Users\橙子\dsh-tools\dsh-pair\bin\pair.cmd ui --repo=F:\your\project --port=8787
```

打开 http://127.0.0.1:8787 ，2 秒自动刷新。页面上能看到：

- **申明锁** —— 谁占了哪些文件、附注是什么；没人占时会写"现在改是安全的"
- **工作区** —— 未提交改动（`git status`）
- **看板** —— intent / done / question / blocker 时间线，谁在干什么
- **最近提交** —— 谁提交了什么
- **分支与统计** —— 当前分支和未暂存 diffstat

右上角输入框可以直接切仓库路径，不用重启。零依赖，就一个 `src/ui.mjs`。

## 六个工具

| 工具 | 干什么 |
|---|---|
| `pair_status` | 一次看全：未提交改动、最近提交、对方的申明、看板消息 |
| `pair_say` | 往看板写一句：我要干什么 / 干完了 / 有问题 |
| `pair_board` | 读看板，`since` 只读新的 |
| `pair_claim` | 申明「这几个文件我在改」，被别人占着就拒绝 |
| `pair_release` | 改完了，放开 |
| `pair_diff` | 看真正的逐行改动，`rev` 支持 `HEAD~2..HEAD` |

**所有工具都接受 `repo` 参数**（项目绝对路径）。长驻进程（DSH 桌面版）启动 MCP server 时的 cwd 是固定的，不是你的项目目录 —— 这时第一次调用随手带上 `repo` 就行，或者启动前设环境变量 `PAIR_REPO`。

命令行同理：

```bash
PAIR_AGENT=codex node C:/Users/橙子/dsh-tools/dsh-pair/src/cli.mjs status --repo=F:/your/project
PAIR_AGENT=codex node C:/Users/橙子/dsh-tools/dsh-pair/src/cli.mjs say "改 auth.ts 的 token 刷新" --kind=intent --repo=F:/your/project
PAIR_AGENT=codex node C:/Users/橙子/dsh-tools/dsh-pair/src/cli.mjs claim src/auth.ts --note="token refresh" --repo=F:/your/project
```

## 写进两边的系统提示词

两个 agent 都必须知道这个规矩，否则不会用。在项目根的 `AGENTS.md`（Codex 读）和 DSH 项目的 `AGENTS.md` 里加同一段：

```markdown
## 结对规则
这个仓库有另一个 agent 在同时工作。
- 开工前：pair_status，看清对方在改哪里。
- 改文件前：pair_claim 声明路径；被拒就换一块改，别抢。
- 每完成一块：pair_say --kind=done 说清改了什么，再 pair_release。
- 看过对方的 diff 再看自己的：pair_diff。
- 撞车了不要静默覆盖，pair_say --kind=blocker 说出来。
```

## 常见问题

**`fatal: detected dubious ownership in repository`**
FAT/exFAT 盘（比如 F:）不记录文件属主，git 会拒绝操作。加一条白名单：

```bash
git config --global --add safe.directory F:/your/project
```

**`codex mcp add` 报 `failed to load configuration`**
是 `config.toml` 里别的问题把整个文件卡住了（例如 `service_tier = "default"` 在 codex-cli 0.128 只接受 `fast`/`flex`）。修掉那一行再执行。

**两边看到的不是同一个仓库**
`pair_status` 输出的第一行 `repo` 必须是同一个绝对路径。不一样就是 cwd 或 `repo` 参数不一致。

## 为什么不用两个 worktree

worktree 适合「各干各的最后合并」，但你会失去最关键的东西：**实时看见**。同目录 + 申明锁 + git diff，是两个人在一张桌子上干活的形态，也是冲突最早暴露的形态。

## 边界

- 申明锁是协作约定，不是内核锁；绕过 `pair_claim` 直接写文件仍然可能，靠 `pair_status` 里 claims 与 status 对不上来发现。
- 两个人共用同一个工作区，意味着**不会**出现 merge 冲突 —— 覆盖是静默的。这是它的代价，靠 claim + diff 来控制。
- `.pair/` 不进版本库；跨机器协作请用分支 + PR。