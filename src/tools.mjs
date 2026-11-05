// Tool surface shared by the MCP server and the CLI.
import {
  activeClaims,
  agentName,
  appendEvent,
  claim,
  ensureInit,
  gitDiff,
  gitState,
  isInitialized,
  readEvents,
  release,
  resolveRepo,
} from './store.mjs';

const indent = (s, pad = '  ') =>
  s
    .split('\n')
    .map((line) => pad + line)
    .join('\n');

const fmtEvent = (e) => {
  const time = e.ts.slice(11, 19);
  return `${time} ${e.agent.padEnd(8)} ${e.kind.padEnd(7)} ${e.text}`;
};

export const TOOLS = [
  {
    name: 'pair_status',
    description:
      'Look at the shared workspace: uncommitted changes, recent commits, files the other agent has claimed, and the latest messages on the board. Call this first, and again before touching files someone else may be editing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler(args, ctx) {
      const root = ctx.root;
      ensureInit(root);
      const me = ctx.agent;
      const state = gitState(root);
      const claims = activeClaims(root);
      const events = readEvents(root, { limit: 12 });
      return [
        `repo     ${root}`,
        `agent    ${me}`,
        `branch   ${state.branch}`,
        '',
        '-- claims ------------------------------------------------------',
        claims.length
          ? claims
              .map((c) => `  ${c.agent}: ${c.paths.join(', ')}${c.note ? `  (${c.note})` : ''}  since ${c.ts.slice(11, 19)}`)
              .join('\n')
          : '  (none)',
        '',
        '-- working tree ------------------------------------------------',
        state.status || '  (clean)',
        state.staged ? `\n-- staged --\n${indent(state.staged)}` : '',
        '',
        '-- unstaged diffstat ------------------------------------------',
        state.diffstat || '  (no unstaged changes)',
        '',
        '-- recent commits ----------------------------------------------',
        state.log || '  (no commits yet)',
        '',
        '-- board (last 12) ---------------------------------------------',
        events.length ? events.map((e) => `  ${fmtEvent(e)}`).join('\n') : '  (empty — say something with pair_say)',
      ]
        .filter((line) => line !== '')
        .join('\n');
    },
  },
  {
    name: 'pair_say',
    description:
      'Post a short message to the shared board: what you are about to do, what you changed, a question, or a blocker. The other agent reads it with pair_board/pair_status.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'One or two sentences.' },
        kind: { type: 'string', enum: ['note', 'intent', 'done', 'question', 'blocker'], description: 'Defaults to note.' },
        refs: { type: 'array', items: { type: 'string' }, description: 'Optional file paths this message is about.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    handler(args, ctx) {
      const event = appendEvent(ctx.root, { agent: ctx.agent, kind: args.kind, text: args.text, refs: args.refs });
      return `posted: ${fmtEvent(event)}`;
    },
  },
  {
    name: 'pair_board',
    description: 'Read recent messages from both agents. Use since (an ISO timestamp) to only get what is new.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many entries, default 20.' },
        since: { type: 'string', description: 'ISO timestamp; only entries strictly newer.' },
        only_other: { type: 'boolean', description: 'Hide my own entries.' },
      },
      additionalProperties: false,
    },
    handler(args, ctx) {
      const events = readEvents(ctx.root, {
        limit: Number(args.limit) || 20,
        since: args.since || null,
        excludeAgent: args.only_other ? ctx.agent : null,
      });
      if (!events.length) return '(board is empty for that query)';
      return events.map(fmtEvent).join('\n');
    },
  },
  {
    name: 'pair_claim',
    description:
      'Declare that you are about to edit these files/directories, so the other agent does not collide with you. Rejected if the other agent already holds an overlapping path. Claims expire after 2 hours.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths or directories.' },
        note: { type: 'string', description: 'What you are doing there.' },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    handler(args, ctx) {
      try {
        const entry = claim(ctx.root, { agent: ctx.agent, paths: args.paths, note: args.note });
        return `claimed: ${entry.paths.join(', ')}`;
      } catch (err) {
        if (err.code === 'CLAIM_CONFLICT') {
          const lines = err.conflicts.map(
            (c) => `  ${c.path} — held by ${c.with} since ${c.since.slice(11, 19)}${c.note ? ` (${c.note})` : ''}`
          );
          const error = new Error(`claim rejected, someone else is there:\n${lines.join('\n')}\nPick different files, or say why on the board with pair_say.`);
          error.code = 'CLAIM_CONFLICT';
          throw error;
        }
        throw err;
      }
    },
  },
  {
    name: 'pair_release',
    description: 'Release your claims when you are done editing (or when you decide not to touch those files).',
    inputSchema: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
    handler(args, ctx) {
      const removed = release(ctx.root, { agent: ctx.agent, paths: args.paths });
      return removed.length ? `released: ${removed.join(', ')}` : 'nothing was claimed by you';
    },
  },
  {
    name: 'pair_diff',
    description: "Show the other agent's (or your own) actual line changes with git diff. This is how you read what changed, not just that it changed.",
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Limit to these paths.' },
        staged: { type: 'boolean', description: 'Show staged diff instead of working tree.' },
        rev: { type: 'string', description: 'Optional git revision or range, e.g. "HEAD~1" or "main...HEAD".' },
        max_bytes: { type: 'number', description: 'Truncate after this many bytes, default 60000.' },
      },
      additionalProperties: false,
    },
    handler(args, ctx) {
      return gitDiff(ctx.root, {
        paths: args.paths || [],
        staged: Boolean(args.staged),
        maxBytes: Number(args.max_bytes) || 60_000,
        rev: args.rev || null,
      });
    },
  },
];

export function makeContext(cwd = process.cwd()) {
  return { cwd, agent: agentName() };
}

const REPO_PROP = {
  type: 'string',
  description:
    'Absolute path of the project (any directory inside it). Only needed when this server was not started inside the repo — e.g. a long-running app spawns it once from its own directory.',
};

for (const tool of TOOLS) {
  tool.inputSchema.properties = { ...tool.inputSchema.properties, repo: REPO_PROP };
}

function resolveRoot(ctx, repo) {
  const root = resolveRepo(ctx.cwd, repo);
  if (!root) {
    throw new Error(
      'not inside a git repository. Pass repo="/absolute/path/to/project" (or set PAIR_REPO) so both agents work in the same tree.'
    );
  }
  if (!isInitialized(root)) ensureInit(root);
  return root;
}

export async function callTool(name, args = {}, ctx = makeContext()) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  const { repo, ...rest } = args || {};
  const target = { ...ctx, root: resolveRoot(ctx, repo) };
  return String(await tool.handler(rest, target));
}