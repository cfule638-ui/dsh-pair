#!/usr/bin/env node
// Minimal MCP server over stdio: newline-delimited JSON-RPC 2.0, tools only.
// No dependencies. Started by Codex or DSH as a child process.
import { TOOLS, callTool, makeContext } from './tools.mjs';

const PROTOCOL_VERSION = '2025-06-18';

let ctx = null;
const ctxError = (() => {
  try {
    ctx = makeContext(process.cwd());
    return null;
  } catch (err) {
    return err.message;
  }
})();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(request) {
  const { id, method, params } = request;

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'dsh-pair', version: '0.1.0' },
      instructions:
        'Shared workspace with the other coding agent. Call pair_status before starting and after finishing a chunk; pair_claim before editing files; pair_say to tell the other agent what you are doing.',
    });
  }

  if (method === 'tools/list') {
    return ok(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }

  if (method === 'tools/call') {
    if (!ctx) return fail(id, -32000, `dsh-pair: ${ctxError}`);
    try {
      const text = await callTool(params?.name, params?.arguments || {}, ctx);
      return ok(id, { content: [{ type: 'text', text }], isError: false });
    } catch (err) {
      return ok(id, { content: [{ type: 'text', text: `error: ${err.message}` }], isError: true });
    }
  }

  if (method === 'ping') return ok(id, {});
  if (method === 'resources/list') return ok(id, { resources: [] });
  if (method === 'prompts/list') return ok(id, { prompts: [] });
  if (typeof id === 'undefined') return; // notification, ignore
  return fail(id, -32601, `method not found: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      continue;
    }
    handle(request).catch((err) => {
      if (request && typeof request.id !== 'undefined') fail(request.id, -32603, String(err.message || err));
    });
  }
});

process.stdin.on('end', () => process.exit(0));