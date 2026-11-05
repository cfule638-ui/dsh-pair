#!/usr/bin/env node
// CLI mirror of the MCP tools — for shell-only agents, scripts, and for humans.
// Usage: PAIR_AGENT=codex node src/cli.mjs status
import fs from 'node:fs';
import path from 'node:path';
import { callTool, makeContext } from './tools.mjs';
import { resolveRepo } from './store.mjs';

const USAGE = `pair — shared claims, board and diffs for two agents in one repo

usage: pair <command> [args] [--repo=/path/to/project] [--agent=name]

commands
  status                 everything at a glance (default)
  say <text> [--kind=]   post intent: note|intent|done|question|blocker
  board [--limit=] [--since=] [--only-other]
  claim <path...> [--note=]
  release [path...]
  diff [rev] [paths...] [--staged]
  init                   append the pairing rules to AGENTS.md
  ui [--port=8787]       local dashboard

env
  PAIR_AGENT   your identity on the board (codex, dsh, ...)
  PAIR_REPO    default project path
`;
const argv = process.argv.slice(2);
const command = argv.shift() || 'status';
if (command === 'help' || command === '--help' || command === '-h') {
  process.stdout.write(USAGE);
  process.exit(0);
}

function flags(args) {
  const rest = [];
  const opts = {};
  for (const arg of args) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) opts[match[1]] = match[2] ?? true;
    else rest.push(arg);
  }
  return { rest, opts };
}

const { rest, opts } = flags(argv);
const repo = opts.repo || undefined;
if (opts.agent) process.env.PAIR_AGENT = String(opts.agent);


const AGENTS_BLOCK = `<!-- pair:begin -->
## 结对规则（两个 agent 共用一个仓库）

这个仓库有另一个 agent 在同时干活：**先占位再动手，干完留话**。
工具在项目根执行（Codex 用 \`F:/mcp/dsh-pair/bin/pair.cmd\`，bash 用 \`F:/mcp/dsh-pair/bin/pair\`）：

- 开工前：\`pair status --agent=<me>\` —— 看对方占了哪些文件、看板最后几条。
- 改文件前：\`pair claim <path> --note="在改什么" --agent=<me>\`；被拒说明对方在那儿，**换一块**，别抢别等。
- 一块干完：\`pair say "改了什么" --kind=done --agent=<me>\` 然后 \`pair release\`。
- 要动对方占着的：先 \`pair say ... --kind=question\`，等对方 release。
- 收工前：\`pair diff\` 自查，确认没把对方的改动带掉。
- 说不通：\`pair say ... --kind=blocker\`，停手等人。

两边共用同一工作区，**不会 merge 冲突，覆盖是静默的** —— 只能靠 claim 和 diff 兜底。
<!-- pair:end -->`;

async function initAgents(root) {
  const file = path.join(root, 'AGENTS.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.includes('<!-- pair:begin -->')) return `already present: ${file}`;
  const body = existing ? `${existing.replace(/\s+$/, '')}\n\n${AGENTS_BLOCK}\n` : `${AGENTS_BLOCK}\n`;
  fs.writeFileSync(file, body);
  return `wrote pair rules into ${file}`;
}

const actions = {
  async init() {
    const root = resolveRepo(process.cwd(), repo);
    if (!root) throw new Error('不在 git 仓库里；在项目根执行，或加 --repo=<项目路径>');
    return initAgents(root);
  },
  async status() {
    return callTool('pair_status', { repo }, makeContext());
  },
  async say() {
    const text = rest.join(' ');
    if (!text) throw new Error('usage: pair say "what you are doing" [--kind=intent|done|question|blocker]');
    return callTool('pair_say', { text, kind: opts.kind || 'note' , repo }, makeContext());
  },
  async board() {
    return callTool('pair_board', { limit: Number(opts.limit) || 20, only_other: Boolean(opts['only-other']) , repo }, makeContext());
  },
  async claim() {
    if (!rest.length) throw new Error('usage: pair claim <path> [path...] [--note=...]');
    return callTool('pair_claim', { paths: rest, note: opts.note , repo }, makeContext());
  },
  async release() {
    return callTool('pair_release', { paths: rest , repo }, makeContext());
  },
  async ui() {
    await import('./ui.mjs');
  },
  async diff() {
    const rev = opts.rev || rest.find((arg) => arg.includes('..')) || null;
    const paths = rest.filter((arg) => arg !== rev);
    return callTool('pair_diff', { paths, staged: Boolean(opts.staged), rev , repo }, makeContext());
  },
};

const action = actions[command];
if (!action) {
  console.error(`unknown command: ${command}\ncommands: ${Object.keys(actions).join(', ')}`);
  process.exit(2);
}

try {
  console.log(await action());
} catch (err) {
  console.error(err.message);
  process.exit(1);
}