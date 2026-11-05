#!/usr/bin/env node
// Local dashboard for a paired repo: one page, no dependencies, no build step.
//   node src/ui.mjs --repo=F:/your/project --port=8787
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  activeClaims,
  ensureInit,
  gitState,
  isInitialized,
  readEvents,
  resolveRepo,
} from './store.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(flag('port', 8787));
const INITIAL_REPO = flag('repo', process.cwd());

function snapshot(repoArg) {
  const root = resolveRepo(process.cwd(), repoArg || INITIAL_REPO);
  if (!root) {
    return { error: 'not a git repository', repo: repoArg || INITIAL_REPO, claims: [], events: [], state: null };
  }
  if (!isInitialized(root)) ensureInit(root);
  let state = null;
  let commits = [];
  try {
    state = gitState(root);
    commits = execFileSync('git', ['-C', root, 'log', '--pretty=%h|%s|%an|%ad', '--date=format:%H:%M', '-8'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, author, time] = line.split('|');
        return { hash, subject, author, time };
      });
  } catch {
    state = { branch: '-', status: '', staged: '', diffstat: '', log: '' };
  }
  return {
    repo: root,
    name: path.basename(root),
    claims: activeClaims(root),
    events: readEvents(root, { limit: 60 }).reverse(),
    state,
    commits,
    now: new Date().toISOString(),
  };
}

const PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-pair</title>
<style>
  :root{--bg:#0d1017;--panel:#151a23;--line:#232b38;--ink:#e6edf6;--dim:#8b98ac;--acc:#4c9aff;--ok:#3fb950;--warn:#d29922;--bad:#f85149}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif}
  header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:5}
  .logo{font-weight:700;letter-spacing:.5px}
  .repo{color:var(--dim);font-family:ui-monospace,Consolas,monospace;font-size:12px}
  .grow{flex:1}
  .pill{font-size:12px;padding:2px 9px;border-radius:20px;border:1px solid var(--line);color:var(--dim)}
  .pill.live{color:var(--ok);border-color:#1f3d26;background:#0f2016}
  main{max-width:1080px;margin:0 auto;padding:20px;display:grid;gap:16px}
  .grid{display:grid;gap:16px;grid-template-columns:1fr 1fr}
  @media(max-width:820px){.grid{grid-template-columns:1fr}}
  section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:var(--dim);margin:0 0 10px;font-weight:600}
  .claim{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px dashed var(--line)}
  .claim:last-child{border:0}
  .who{font-family:ui-monospace,monospace;font-size:12px;padding:1px 7px;border-radius:5px;background:#1d2534;color:var(--acc);flex:none}
  .who.dsh{color:#bc8cff}
  .paths{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--ink);word-break:break-all}
  .note{color:var(--dim);font-size:12px}
  .empty{color:var(--dim);font-size:13px;padding:6px 0}
  .ev{display:grid;grid-template-columns:56px 74px 60px 1fr;gap:8px;padding:5px 0;font-size:13px;border-bottom:1px solid #1a2029}
  .ev:last-child{border:0}
  #events{max-height:400px;overflow:auto}
  #commits{max-height:260px;overflow:auto}
  .t{color:var(--dim);font-family:ui-monospace,monospace;font-size:12px}
  .a{font-family:ui-monospace,monospace;font-size:12px;color:var(--acc)}
  .a.dsh{color:#bc8cff}
  .k{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim)}
  .k.done{color:var(--ok)}.k.blocker,.k.question{color:var(--warn)}.k.intent{color:var(--acc)}
  pre{margin:0;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#c9d4e3;white-space:pre-wrap;word-break:break-all}
  .commit{display:grid;grid-template-columns:64px 1fr 70px;gap:10px;padding:5px 0;font-size:13px;border-bottom:1px solid #1a2029}
  .commit:last-child{border:0}
  .hash{font-family:ui-monospace,monospace;font-size:12px;color:var(--warn)}
  .who2{color:var(--dim);font-size:12px;text-align:right}
  .switcher{display:flex;gap:8px;align-items:center}
  input{background:#0d1017;border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:5px 9px;font-size:12px;width:260px;font-family:ui-monospace,monospace}
  button{background:#1d2534;border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer}
  button:hover{border-color:var(--acc);color:var(--acc)}
</style></head>
<body>
<header>
  <span class="logo">dsh-pair</span>
  <span class="repo" id="repo">…</span>
  <span class="grow"></span>
  <span class="switcher"><input id="repoInput" placeholder="repo path, then Enter"><button id="go">switch</button></span>
  <span class="pill live" id="live">live</span>
</header>
<main>
  <div class="grid">
    <section><h2>Claims · who is editing what</h2><div id="claims"></div></section>
    <section><h2>Working tree · uncommitted</h2><pre id="status"></pre></section>
  </div>
  <section><h2>Board · what is happening</h2><div id="events"></div></section>
  <div class="grid">
    <section><h2>Recent commits</h2><div id="commits"></div></section>
    <section><h2>Branch & stats</h2><pre id="meta"></pre></section>
  </div>
</main>
<script>
let repo = "";
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const cls = (a) => (a === "dsh" ? "dsh" : "");

async function load() {
  try {
    const res = await fetch("/api/state" + (repo ? "?repo=" + encodeURIComponent(repo) : ""));
    const d = await res.json();
    if (d.error) { document.getElementById("repo").textContent = d.error + " · " + d.repo; return; }
    repo = d.repo;
    document.getElementById("repo").textContent = d.repo;
    document.getElementById("live").textContent = "live · " + new Date().toLocaleTimeString();
    document.getElementById("claims").innerHTML = d.claims.length
      ? d.claims.map(c => '<div class="claim"><span class="who ' + cls(c.agent) + '">' + esc(c.agent) + '</span>'
          + '<div><div class="paths">' + c.paths.map(esc).join("<br>") + '</div>'
          + (c.note ? '<div class="note">' + esc(c.note) + '</div>' : "") + '</div></div>').join("")
      : '<div class="empty">没人占文件 — 现在改是安全的</div>';
    document.getElementById("status").textContent = d.state.status || "(clean — nothing uncommitted)";
    document.getElementById("events").innerHTML = d.events.length
      ? d.events.map(e => '<div class="ev"><span class="t">' + esc(e.ts.slice(11, 19)) + '</span>'
          + '<span class="a ' + cls(e.agent) + '">' + esc(e.agent) + '</span>'
          + '<span class="k ' + esc(e.kind) + '">' + esc(e.kind) + '</span>'
          + '<span>' + esc(e.text) + '</span></div>').join("")
      : '<div class="empty">board is empty — have an agent say something</div>';
    document.getElementById("commits").innerHTML = d.commits.length
      ? d.commits.map(c => '<div class="commit"><span class="hash">' + esc(c.hash) + '</span>'
          + '<span>' + esc(c.subject) + '</span><span class="who2">' + esc(c.author) + '</span></div>').join("")
      : '<div class="empty">还没有提交</div>';
    document.getElementById("meta").textContent = "branch " + d.state.branch + "\\n" + (d.state.diffstat || "nothing unstaged");
  } catch (e) {
    document.getElementById("live").textContent = "断线重连…";
  }
}
document.getElementById("go").onclick = () => { repo = document.getElementById("repoInput").value.trim(); load(); };
document.getElementById("repoInput").onkeydown = (e) => { if (e.key === "Enter") document.getElementById("go").click(); };
load(); setInterval(load, 2000);
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/api/state') {
    const body = JSON.stringify(snapshot(url.searchParams.get('repo') || ''));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(body);
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(PAGE);
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dsh-pair dashboard → http://127.0.0.1:${PORT}`);
  console.log(`repo: ${snapshot('').repo}`);
});