import { describe, expect, it, vi } from 'vitest';

// The lean Agents export is the same installed stateless handler as agents/mcp,
// without unrelated Durable Object imports that require the Cloudflare runtime.
vi.mock('agents/mcp', async () => import('agents/mcp/server'));
import worker, { type Env } from '../src/worker';
const get = vi.fn(async () => null);
const env = { BUNDLE: { get } } as unknown as Env;
const ctx = {} as ExecutionContext;
const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'transport-test', version: '1.0.0' },
} });
async function invoke({ host = 'localhost:8787', origin, body = initialize, length }: { host?: string; origin?: string; body?: string; length?: string } = {}) {
  const headers = new Headers({ Host: host, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' });
  if (origin !== undefined) headers.set('Origin', origin);
  if (length !== undefined) headers.set('Content-Length', length);
  const response = await worker.fetch(new Request('http://localhost:8787/mcp', { method: 'POST', headers, body }), env, ctx);
  return { response, text: await response.text() };
}

describe('Real installed transport boundary', () => {
  it('initializes through the real Agents legacy lane without Origin', async () => {
    const { response, text } = await invoke();
    expect(response.status).toBe(200);
    expect(text).toContain('openislet');
  });
  it.each(['http://localhost:4321', 'http://127.0.0.1:4321', 'http://[::1]:4321'])('accepts configured local browser Origin %s', async origin => {
    expect((await invoke({ origin })).response.status).toBe(200);
  });
  it.each(['https://evil.invalid', 'null', 'https://localhost.evil.invalid', 'https://openislet.org'])('preserves the current restrictive browser-origin policy: %s', async origin => {
    expect((await invoke({ origin })).response.status).toBe(403);
  });
  it.each(['untrusted.invalid', 'localhost.evil.invalid', 'mcp.openislet.org.evil.invalid'])('rejects Host %s through the real adapter', async host => {
    expect((await invoke({ host })).response.status).toBe(403);
  });
  it.each(['localhost:8787', '127.0.0.1:8787', '[::1]:8787', 'mcp.openislet.org'])('accepts endpoint authority %s through the real adapter', async host => {
    expect((await invoke({ host })).response.status).toBe(200);
  });
  // The filler starts with "{": a body of nothing but blank space is refused earlier, by the batch check in src/worker.ts.
  it('refuses an oversized byte body without a declared Content-Length', async () => {
    const { response } = await invoke({ body: `{${' '.repeat(4 * 1024 * 1024)}` });
    expect(response.status).toBe(413);
  });
  it('enforces byte limits for multibyte body text', async () => {
    const { response } = await invoke({ body: 'β'.repeat(2 * 1024 * 1024 + 1) });
    expect(response.status).toBe(413);
  });
  it('does not trust a small Content-Length over the observed streamed body', async () => {
    const { response } = await invoke({ body: `{${' '.repeat(4 * 1024 * 1024)}`, length: '2' });
    expect(response.status).toBe(413);
  });
  it('refuses a declared oversize before trying to parse a small body', async () => {
    const { response } = await invoke({ body: '{}', length: String(4 * 1024 * 1024 + 1) });
    expect(response.status).toBe(413);
  });
  it('rejects array-shaped tool input through the real MCP boundary', async () => {
    const before = get.mock.calls.length;
    const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'check_against_graveyard', arguments: ['A'] } });
    const { response, text } = await invoke({ body });
    expect(response.status).toBe(200);
    expect(text).toMatch(/"error":|"isError":true/);
    expect(get.mock.calls.length).toBe(before);
  });
});
