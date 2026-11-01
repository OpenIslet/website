import { describe, expect, it, vi } from 'vitest';

// Execute the SDK's real host validator with the options selected by our Worker.
// The live loopback smoke separately exercises the complete Agents transport.
vi.mock('agents/mcp', async () => {
  const { hostHeaderValidationResponse } = await import('@modelcontextprotocol/server');
  return { createMcpHandler: (_factory: unknown, options: { allowedHostnames?: string[] }) =>
    async (request: Request) => hostHeaderValidationResponse(request, options.allowedHostnames ?? []) ?? new Response('accepted') };
});
import worker, { type Env } from '../src/worker';

const env = { BUNDLE: {} } as Env;
const ctx = {} as ExecutionContext;
async function invoke(host: string | null) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (host !== null) headers.set('Host', host);
  return worker.fetch(new Request('http://127.0.0.1:8787/mcp', { method: 'POST', headers, body: '{}' }), env, ctx);
}

describe('the main module', () => {
  it('exports only what Cloudflare accepts from it: the handler and classes (a constant stops the Worker from starting)', async () => {
    const mod: Record<string, unknown> = await import('../src/worker');
    for (const [name, value] of Object.entries(mod)) expect(name === 'default' || typeof value === 'function', `export ${name}`).toBe(true);
  });
});

describe('explicit Worker endpoint authority', () => {
  it.each(['localhost:8787', '127.0.0.1:8787', '[::1]:8787', 'mcp.openislet.org', 'mcp-staging.openislet.org'])('permits configured endpoint %s', async host => {
    expect((await invoke(host)).status).toBe(200);
  });
  it.each(['untrusted.invalid', '127.0.0.1.untrusted.invalid', 'mcp.openislet.org.untrusted.invalid', 'mcp-staging.openislet.org.untrusted.invalid', 'staging.openislet.org', 'unconfigured.workers.dev'])('rejects unconfigured Host %s before MCP handling', async host => {
    expect((await invoke(host)).status).toBe(403);
  });
  it('rejects a missing authority', async () => {
    expect((await invoke(null)).status).toBe(403);
  });
});
