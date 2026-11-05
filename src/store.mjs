// Store layer: repo discovery, board, claims. No dependencies.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PAIR_DIR = '.pair';
export const DEFAULT_CLAIM_TTL_MS = 2 * 60 * 60 * 1000;

export function agentName() {
  const raw = process.env.PAIR_AGENT || process.env.PAIR_ROLE || '';
  return raw.trim() || 'unknown';
}

export function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireRepo(start) {
  const root = findRepoRoot(start);
  if (!root) {
    throw new Error(
      `not inside a git repository (searched upward from ${path.resolve(start)}); run \`git init\` or cd into the project`
    );
  }
  return root;
}

export function resolveRepo(start, explicit) {
  const candidate = explicit || process.env.PAIR_REPO || null;
  if (candidate) {
    const root = findRepoRoot(candidate);
    if (!root) throw new Error(`no git repository at or above ${path.resolve(candidate)}`);
    return root;
  }
  return findRepoRoot(start);
}

export function pairPath(root, ...rest) {
  return path.join(root, PAIR_DIR, ...rest);
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function ensureInit(root) {
  const dir = pairPath(root);
  fs.mkdirSync(dir, { recursive: true });

  const gitignore = path.join(root, '.gitignore');
  const marker = `${PAIR_DIR}/`;
  let ignore = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  if (!ignore.split(/\r?\n/).some((line) => line.trim() === marker || line.trim() === PAIR_DIR)) {
    ignore = ignore.length && !ignore.endsWith('\n') ? `${ignore}\n${marker}\n` : `${ignore}${marker}\n`;
    fs.writeFileSync(gitignore, ignore);
  }

  const board = pairPath(root, 'board.jsonl');
  if (!fs.existsSync(board)) fs.writeFileSync(board, '');

  const claims = pairPath(root, 'claims.json');
  if (!fs.existsSync(claims)) writeAtomic(claims, JSON.stringify({ claims: [] }, null, 2));

  const config = pairPath(root, 'config.json');
  if (!fs.existsSync(config)) {
    writeAtomic(
      config,
      JSON.stringify({ version: 1, createdAt: new Date().toISOString(), claimTtlMs: DEFAULT_CLAIM_TTL_MS }, null, 2)
    );
  }
  return dir;
}

export function isInitialized(root) {
  return fs.existsSync(pairPath(root, 'config.json'));
}

export function readConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(pairPath(root, 'config.json'), 'utf8'));
  } catch {
    return { version: 1, claimTtlMs: DEFAULT_CLAIM_TTL_MS };
  }
}

// ---------------------------------------------------------------- board

export function appendEvent(root, { agent, kind, text, refs }) {
  ensureInit(root);
  const event = {
    ts: new Date().toISOString(),
    agent,
    kind: kind || 'note',
    text: String(text || ''),
    ...(refs && refs.length ? { refs } : {}),
  };
  if (!event.text.trim()) throw new Error('text is required');
  fs.appendFileSync(pairPath(root, 'board.jsonl'), `${JSON.stringify(event)}\n`);
  return event;
}

export function readEvents(root, { limit = 30, since = null, excludeAgent = null } = {}) {
  const file = pairPath(root, 'board.jsonl');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      /* ignore a torn line */
    }
  }
  if (since) {
    const t = new Date(since).getTime();
    if (!Number.isNaN(t)) events = events.filter((e) => new Date(e.ts).getTime() > t);
  }
  events = events.slice(-Math.max(1, limit));
  if (excludeAgent) events = events.filter((e) => e.agent !== excludeAgent);
  return events;
}

// ---------------------------------------------------------------- lock

const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 5_000;

// Cross-process mutex around read-modify-write of claims.json.
// Two agents can claim at the same millisecond; without this one write is lost.
export function withLock(root, fn) {
  const file = pairPath(root, 'claims.lock');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS;
      } catch {
        /* lock vanished between open and stat */
      }
      if (stale) {
        try {
          fs.unlinkSync(file);
        } catch {
          /* someone else won the race */
        }
        continue;
      }
      if (Date.now() > deadline) throw new Error(`claims.lock is held by another process (${file})`);
      const until = Date.now() + 15;
      while (Date.now() < until) {
        /* short spin, claims are quick */
      }
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
}

// ---------------------------------------------------------------- claims

function loadClaims(root) {
  ensureInit(root);
  try {
    return JSON.parse(fs.readFileSync(pairPath(root, 'claims.json'), 'utf8')).claims || [];
  } catch {
    return [];
  }
}

function saveClaims(root, claims) {
  writeAtomic(pairPath(root, 'claims.json'), JSON.stringify({ claims }, null, 2));
}

export function activeClaims(root, now = Date.now()) {
  const ttl = readConfig(root).claimTtlMs || DEFAULT_CLAIM_TTL_MS;
  return loadClaims(root).filter((c) => now - new Date(c.ts).getTime() < ttl);
}

function overlaps(a, b) {
  const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

export function claim(root, { agent, paths, note }) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('paths must be a non-empty array');
  return withLock(root, () => claimUnlocked(root, { agent, paths, note }));
}

function claimUnlocked(root, { agent, paths, note }) {
  const active = activeClaims(root);
  const conflicts = [];
  for (const c of active) {
    if (c.agent === agent) continue;
    for (const p of paths) {
      const hit = (c.paths || []).find((q) => overlaps(p, q));
      if (hit) conflicts.push({ path: p, with: c.agent, claimedPath: hit, since: c.ts, note: c.note || '' });
    }
  }
  if (conflicts.length) {
    const err = new Error(
      `claim rejected: ${conflicts.map((c) => `${c.path} is held by ${c.with}`).join('; ')}`
    );
    err.code = 'CLAIM_CONFLICT';
    err.conflicts = conflicts;
    throw err;
  }
  const kept = active.filter((c) => c.agent !== agent);
  const entry = { agent, paths, note: note || '', ts: new Date().toISOString() };
  saveClaims(root, [...kept, entry]);
  appendEvent(root, { agent, kind: 'claim', text: `claimed ${paths.join(', ')}${note ? ` — ${note}` : ''}`, refs: paths });
  return entry;
}

export function release(root, { agent, paths }) {
  return withLock(root, () => releaseUnlocked(root, { agent, paths }));
}

function releaseUnlocked(root, { agent, paths }) {
  const active = activeClaims(root);
  let removed = [];
  const kept = active.filter((c) => {
    if (c.agent !== agent) return true;
    removed = [...removed, ...(c.paths || [])];
    return false;
  });
  saveClaims(root, kept);
  if (removed.length) {
    appendEvent(root, { agent, kind: 'release', text: `released ${removed.join(', ')}`, refs: removed });
  }
  return removed;
}

// ---------------------------------------------------------------- git

function git(root, args, maxBytes = 200_000) {
  try {
    const out = execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.length > maxBytes ? `${out.slice(0, maxBytes)}\n... [truncated]` : out;
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : '';
    throw new Error(`git ${args.join(' ')} failed: ${stderr || err.message}`);
  }
}

export function gitState(root) {
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=normal']).trim();
  const diffstat = git(root, ['diff', '--stat']).trim();
  const staged = git(root, ['diff', '--cached', '--stat']).trim();
  const log = git(root, ['log', '--oneline', '-n', '8', '--date=short', '--pretty=%h %ad %an %s']).trim();
  return { branch, status, diffstat, staged, log };
}

export function gitDiff(root, { paths = [], staged = false, maxBytes = 60_000, rev = null } = {}) {
  const args = ['diff', ...(staged ? ['--cached'] : []), '--no-color', ...(rev ? [rev] : []), '--', ...paths];
  const out = git(root, args, maxBytes);
  return out.trim() ? out : '(no changes)';
}