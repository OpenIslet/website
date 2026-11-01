// The MCP SDK's own OAuth client, as an AI app would use it, signs in to the connector and sends an IIP.
// Everything runs in this process: the SDK's requests are handed straight to the Worker (and to the fake GitHub).
import { Client, StreamableHTTPClientTransport, auth } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { Jar, PUBLIC_ORIGIN, type World, installWorld, makeWorld, restore } from './queue-fakes';

vi.mock('agents/mcp', async () => import('agents/mcp/server'));

const f = shownQuote();
const draft = makeDraft({ evidence: [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`] });
const review = makeReview();
const serverUrl = `${PUBLIC_ORIGIN}/mcp`;
const redirect = 'http://localhost:53999/cb';

let world: World;
beforeEach(async () => {
  world = await makeWorld();
  installWorld(world);
});
afterEach(restore);

/** Hands each request to the Worker (or to the fake GitHub, for GitHub's own addresses), as a real network would. */
const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request && !init ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === world.github.web || url.origin === world.github.api) return world.github.fetch(request.url, { method: request.method, headers: request.headers, body: await request.text() });
  const headers = new Headers(request.headers);
  headers.set('host', url.host);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  return world.call(new Request(request.url, { method: request.method, headers, body }));
};

class Provider {
  info?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  tokenSet?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  verifier = '';
  authUrl?: URL;
  get redirectUrl() {
    return redirect;
  }
  get clientMetadata() {
    return { client_name: 'SDK test app', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'submit' };
  }
  async clientInformation() {
    return this.info as never;
  }
  async saveClientInformation(i: never) {
    this.info = i;
  }
  async tokens() {
    return this.tokenSet as never;
  }
  async saveTokens(t: never) {
    this.tokenSet = t;
  }
  async redirectToAuthorization(url: URL) {
    this.authUrl = url;
  }
  async saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  async codeVerifier() {
    return this.verifier;
  }
}

/** Plays the person's browser: approve, go through GitHub, come back with a code. */
async function approveInBrowser(provider: Provider, user: { id: number; login: string }) {
  const jar = new Jar();
  const page = await fetchFn(provider.authUrl!);
  jar.take(page);
  const handle = /name="handle" value="([^"]+)"/.exec(await page.text())![1];
  const approved = await fetchFn(`${PUBLIC_ORIGIN}/authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...jar.header() }, body: new URLSearchParams({ handle, decision: 'approve' }).toString() });
  jar.take(approved);
  const toGitHub = new URL(approved.headers.get('location')!);
  const code = world.github.issueCode(user, toGitHub.searchParams.get('code_challenge') ?? undefined);
  const back = await fetchFn(`${PUBLIC_ORIGIN}/callback?${new URLSearchParams({ code, state: toGitHub.searchParams.get('state')! })}`, { headers: jar.header() });
  return new URL(back.headers.get('location')!);
}

describe('an AI app that follows the MCP sign-in rules', () => {
  it('finds the sign-in, registers, signs in, and sends an IIP as that GitHub account', async () => {
    const provider = new Provider();
    expect(await auth(provider as never, { serverUrl, scope: 'submit', fetchFn })).toBe('REDIRECT');
    expect(provider.info?.client_id).toBeTruthy();
    expect(provider.authUrl!.origin + provider.authUrl!.pathname).toBe(`${PUBLIC_ORIGIN}/authorize`);
    expect(provider.authUrl!.searchParams.get('code_challenge_method')).toBe('S256');
    expect(provider.authUrl!.searchParams.get('resource')).toBe(serverUrl);

    const back = await approveInBrowser(provider, { id: 321, login: 'sdk-person' });
    expect(back.origin + back.pathname).toBe(redirect);
    expect(back.searchParams.get('iss')).toBe(PUBLIC_ORIGIN); // the app can check the answer came from this sign-in server

    expect(await auth(provider as never, { serverUrl, authorizationCode: back.searchParams.get('code')!, iss: back.searchParams.get('iss') ?? undefined, scope: 'submit', fetchFn })).toBe('AUTHORIZED');
    expect(provider.tokenSet).toMatchObject({ token_type: 'bearer', scope: 'submit' });
    expect(provider.tokenSet?.refresh_token).toBeTruthy();

    const client = new Client({ name: 'sdk-oauth-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider as never, fetch: fetchFn }));
    expect((await client.listTools()).tools).toHaveLength(12);
    const sent = (await client.callTool({ name: 'submit_proposal', arguments: { draft, review, consent: true, contributor: { name: 'SDK Person' } } })) as { isError?: boolean; structuredContent: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(sent.isError).toBeFalsy();
    expect(sent.structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0001', contributor: { github: 'sdk-person', name: 'SDK Person' } });
    expect(world.github.newestIssue.body.startsWith('Submitted by @sdk-person (verified through GitHub)')).toBe(true);

    // An hour later the access token has expired. The app uses its refresh token and carries on, without asking the person again.
    world.clock.advance(3600 + 30);
    const before = provider.tokenSet?.access_token;
    const again = (await client.callTool({ name: 'get_blueprint_overview', arguments: {} })) as { isError?: boolean };
    expect(again.isError).toBeFalsy();
    expect(provider.tokenSet?.access_token).not.toBe(before);
    await client.close();
  });

  it('can still read without signing in at all', async () => {
    const client = new Client({ name: 'sdk-anonymous', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { fetch: fetchFn }));
    expect((await client.listTools()).tools).toHaveLength(12);
    const sent = (await client.callTool({ name: 'submit_proposal', arguments: { draft, review, consent: true } })) as { isError?: boolean; structuredContent: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(sent.isError).toBeFalsy();
    expect(sent.structuredContent).toMatchObject({ submitted: false, reason: 'sign_in_needed' });
    await client.close();
  });
});
