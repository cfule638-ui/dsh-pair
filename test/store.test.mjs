import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  activeClaims,
  appendEvent,
  claim,
  ensureInit,
  isInitialized,
  readEvents,
  release,
} from '../src/store.mjs';

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-test-'));
  ensureInit(dir);
  return dir;
}

function setTtl(root, ms) {
  fs.writeFileSync(
    path.join(root, '.pair', 'config.json'),
    JSON.stringify({ version: 1, claimTtlMs: ms })
  );
}

test('ensureInit creates .pair and ignores it in git', () => {
  const root = tmpRoot();
  assert.equal(isInitialized(root), true);
  assert.ok(fs.existsSync(path.join(root, '.pair', 'claims.json')));
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.pair\/$/m);
});

test('ensureInit is idempotent', () => {
  const root = tmpRoot();
  ensureInit(root);
  ensureInit(root);
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.equal(ignore.split('\n').filter((l) => l.trim() === '.pair/').length, 1);
});

test('claim blocks another agent on the same path', () => {
  const root = tmpRoot();
  claim(root, { agent: 'codex', paths: ['src/a.js'] });
  assert.throws(
    () => claim(root, { agent: 'dsh', paths: ['src/a.js'] }),
    (err) => err.code === 'CLAIM_CONFLICT' && /held by codex/.test(err.message)
  );
});

test('claim treats a directory prefix as overlapping', () => {
  const root = tmpRoot();
  claim(root, { agent: 'codex', paths: ['src/auth'] });
  assert.throws(() => claim(root, { agent: 'dsh', paths: ['src/auth/token.js'] }), /CLAIM_CONFLICT|held by codex/);
});

test('claim allows disjoint paths', () => {
  const root = tmpRoot();
  claim(root, { agent: 'codex', paths: ['src/a.js'] });
  const entry = claim(root, { agent: 'dsh', paths: ['src/b.js'] });
  assert.deepEqual(entry.paths, ['src/b.js']);
  assert.equal(activeClaims(root).length, 2);
});

test('the same agent can re-claim without conflicting itself', () => {
  const root = tmpRoot();
  claim(root, { agent: 'codex', paths: ['src/a.js'] });
  claim(root, { agent: 'codex', paths: ['src/a.js', 'src/b.js'] });
  const mine = activeClaims(root).filter((c) => c.agent === 'codex');
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].paths, ['src/a.js', 'src/b.js']);
});

test('release frees the path for the other agent', () => {
  const root = tmpRoot();
  claim(root, { agent: 'codex', paths: ['src/a.js'] });
  release(root, { agent: 'codex' });
  assert.equal(activeClaims(root).length, 0);
  assert.doesNotThrow(() => claim(root, { agent: 'dsh', paths: ['src/a.js'] }));
});

test('expired claims stop blocking', async () => {
  const root = tmpRoot();
  claim(root, { agent: 'codex', paths: ['src/a.js'] });
  setTtl(root, 20);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(activeClaims(root).length, 0);
  assert.doesNotThrow(() => claim(root, { agent: 'dsh', paths: ['src/a.js'] }));
});

test('board records events in order and supports since', async () => {
  const root = tmpRoot();
  appendEvent(root, { agent: 'codex', kind: 'intent', text: 'start on auth' });
  await new Promise((r) => setTimeout(r, 10));
  const cutoff = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 10));
  appendEvent(root, { agent: 'dsh', kind: 'done', text: 'finished logging' });

  const all = readEvents(root, { limit: 10 });
  assert.equal(all.length, 2);
  assert.equal(all[0].agent, 'codex');

  const fresh = readEvents(root, { limit: 10, since: cutoff });
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].text, 'finished logging');

  const onlyOther = readEvents(root, { limit: 10, excludeAgent: 'dsh' });
  assert.equal(onlyOther.length, 1);
  assert.equal(onlyOther[0].agent, 'codex');
});

test('board rejects empty text', () => {
  const root = tmpRoot();
  assert.throws(() => appendEvent(root, { agent: 'codex', text: '  ' }), /text is required/);
});

test('claim rejects an empty path list', () => {
  const root = tmpRoot();
  assert.throws(() => claim(root, { agent: 'codex', paths: [] }), /non-empty array/);
});