// The Cloudflare Worker.
//
//   /mcp        the MCP server, over the bundle in R2. Open to everyone for reading. A request with no Authorization header is
//               served exactly as it always was. A request with a valid connector token is served the same way and also tells
//               `submit_proposal` who is signed in. A bad or expired token is answered 401 with a pointer to the sign-in.
//   /api/*      the submission queue's web API, used by the openislet.org form (see docs/connector/QUEUE-API.md).
//   /authorize, /callback, /token, /register and the two /.well-known documents
//               the connector's sign-in for AI apps (GitHub is the login behind it). Switched on only while submissions are open.
//
// Nothing here is trusted because of the Host it arrived on: only this machine and the addresses in PUBLIC_HOSTNAMES are answered.
import { createMcpHandler } from 'agents/mcp';
import { configFromEnv } from './core/answer';
import { Bundle } from './core/bundle';
import { CONTACT_EMAIL } from './core/contact';
import { GitHubClient, type GitHubSettings, type TokenCache } from './core/queue/github';
import { QueueService } from './core/queue/service';
import { type QueueEnv, type QueueSettings, missingFor, readQueueSettings } from './core/queue/settings';
import type { QueueKV } from './core/queue/kv';
import type { Identity, SubmitContext } from './core/queue/types';
import { type BundleStore, R2Store } from './core/store';
import { type OAuthStack, createOAuthStack, handleAuthorize, handleCallback, signedOut, smallSignInBody } from './connector-oauth';
import { PAGE_HEADERS, messagePage } from './oauth-pages';
import { callerOf, handleApi } from './queue-http';
import { limitsFor } from './queue-limits';
import { createConnectorServer } from './server';

// The Durable Object class behind QUEUE_LIMITS must be exported from the Worker's main module.
export { QueueLimits } from './queue-limits';

export interface Env extends QueueEnv {
  BUNDLE: R2Bucket;
  /** Staged submissions, sign-in state, retry records and the per-address rate counters. */
  QUEUE_KV?: QueueKV;
  /** The exact posting limits: per account per day, everyone per hour, and one post per IIP (src/queue-limits.ts). */
  QUEUE_LIMITS?: DurableObjectNamespace;
  /** The connector's own sign-in server (clients, grants, tokens). Used by @cloudflare/workers-oauth-provider. */
  OAUTH_KV?: KVNamespace;
  ACTIVE_BUNDLE?: string;
  SUBMISSIONS_OPEN?: string;
  UNFREEZE_SCENARIO_SCORES?: string;
  SHOW_SIMULATED_SURVIVAL?: string;
  /** The connector's own public addresses, hostnames only, comma-separated (for example `mcp.example.org`). Unset: OpenIslet's own two. */
  PUBLIC_HOSTNAMES?: string;
}

/** Pin the actual local and canonical public endpoints; never derive trust from the incoming Host.
 *  mcp-staging.openislet.org is the private dress rehearsal before launch. */
const OPENISLET_HOSTNAMES = ['mcp.openislet.org', 'mcp-staging.openislet.org'];
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

/** The public addresses this connector answers on: the PUBLIC_HOSTNAMES setting (a fork sets its own), else OpenIslet's two.
 *  Entries that are not plain hostnames are ignored, so a mistake can only make the connector answer on fewer addresses. */
function publicHostnames(env: Env): string[] {
  const set = (env.PUBLIC_HOSTNAMES ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h));
  return set.length ? set : OPENISLET_HOSTNAMES;
}
const allowedHostnames = (env: Env): string[] => [...LOCAL_HOSTNAMES, ...publicHostnames(env)];

// Reuse the R2 store adapter; each request pins and verifies its own bundle snapshot.
const stores = new WeakMap<object, BundleStore>();
function storeFor(env: Env): BundleStore {
  let store = stores.get(env.BUNDLE);
  if (!store) stores.set(env.BUNDLE, (store = new R2Store(env.BUNDLE)));
  return store;
}

const home = (url: URL) =>
  new Response(
    JSON.stringify(
      {
        name: 'OpenIslet connector',
        what: 'An MCP server for the OpenIslet blueprint: read the blueprint and the evidence, check an idea against the Idea Graveyard, and (when the public queue opens) send in an Islet Improvement Proposal (IIP).',
        mcp_endpoint: `${url.origin}/mcp`,
        guide: 'https://openislet.org/start',
        contact: CONTACT_EMAIL,
        licence: 'Apache-2.0 (code), CC BY 4.0 (project-authored data)',
      },
      null,
      2,
    ),
    { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } },
  );

// ---------------------------------------------------------------------------------------------------------------
// Hosts and logging
// ---------------------------------------------------------------------------------------------------------------

/** True when the Host header names one of the connector's own addresses. */
function hostAllowed(request: Request, env: Env): boolean {
  const host = request.headers.get('host');
  if (!host || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) return false;
  try {
    return allowedHostnames(env).includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** The address this request was made to, if it is one we answer on. The sign-in's addresses are built from it. */
function trustedOrigin(request: Request, env: Env): string | null {
  const url = new URL(request.url);
  if (!hostAllowed(request, env) || !allowedHostnames(env).includes(url.hostname)) return null;
  if (publicHostnames(env).includes(url.hostname) && url.protocol !== 'https:') return null;
  return url.origin;
}

/** One JSON line per event, with names and counts only (see the `log` rule in core/queue/service.ts). */
const log = (event: string, fields: Record<string, string | number | boolean | null> = {}): void => {
  console.log(JSON.stringify({ event, ...fields }));
};

const hostRefused = (env: Env) =>
  new Response(JSON.stringify({ error: 'host_not_allowed', message: `The connector does not answer on this address. Use https://${publicHostnames(env)[0]}.` }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// ---------------------------------------------------------------------------------------------------------------
// The queue, built from the Worker's settings for each request (cheap: nothing is read until it is used)
// ---------------------------------------------------------------------------------------------------------------

/** Installation tokens are kept between requests for as long as this isolate lives. */
const tokenCaches = new Map<string, TokenCache>();

function githubFor(s: QueueSettings): GitHubClient {
  const settings: GitHubSettings = {
    webBase: s.githubWebBase,
    apiBase: s.githubApiBase,
    clientId: s.clientId ?? '',
    clientSecret: s.clientSecret ?? '',
    appId: s.appId ?? '',
    installationId: s.installationId ?? '',
    privateKey: s.privateKey ?? '',
    owner: s.owner,
    repo: s.repo,
  };
  const cacheKey = `${s.githubApiBase}|${s.appId}|${s.installationId}|${s.owner}/${s.repo}`;
  let cache = tokenCaches.get(cacheKey);
  if (!cache) tokenCaches.set(cacheKey, (cache = {}));
  return new GitHubClient(settings, cache);
}

function queueFor(env: Env, ctx: ExecutionContext): { service: QueueService; settings: QueueSettings; github: GitHubClient } {
  const settings = readQueueSettings(env);
  const github = githubFor(settings);
  const service = new QueueService({
    kv: env.QUEUE_KV,
    limits: env.QUEUE_LIMITS ? limitsFor(env.QUEUE_LIMITS) : undefined,
    settings,
    config: configFromEnv(env as unknown as Record<string, string | undefined>),
    github,
    defer: (work) => ctx.waitUntil(work),
    log,
  });
  return { service, settings, github };
}

// ---------------------------------------------------------------------------------------------------------------
// /mcp
// ---------------------------------------------------------------------------------------------------------------

/** How far into a /mcp body the batch check looks for the first character of the message. */
const PEEK_BYTES = 1024;
const JSON_SPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

/**
 * The first byte of the JSON message in `head`, past a byte-order mark and blank space as a JSON reader skips them, or undefined
 * if there is none yet (including half a byte-order mark, which the next chunk may finish).
 */
function firstJsonByte(head: Uint8Array): number | undefined {
  let i = 0;
  if (head[0] === 0xef) {
    if (head.length < 3) return undefined;
    if (head[1] === 0xbb && head[2] === 0xbf) i = 3;
  }
  while (i < head.length && JSON_SPACE.has(head[i])) i++;
  return i < head.length ? head[i] : undefined;
}

/**
 * MCP stopped allowing batches (several messages in one request) in its 2025-06-18 version, and the SDK still runs up to a
 * hundred of them at once for older clients, so one small request could cost as much as a hundred. A body that starts with "["
 * is refused here, before the SDK reads it, and so is one whose first kilobyte is all blank space, since what follows was never
 * looked at. Only the first bytes are looked at; the rest goes on untouched.
 */
async function refuseBatch(request: Request): Promise<Request | Response> {
  if (request.method !== 'POST' || !request.body) return request;
  const [peek, rest] = request.body.tee();
  const reader = peek.getReader();
  let head = new Uint8Array(0);
  let first: number | undefined;
  let ended = false;
  try {
    while ((first = firstJsonByte(head)) === undefined && head.length < PEEK_BYTES) {
      const { value, done } = await reader.read();
      if (done || !value) {
        ended = true;
        break;
      }
      const joined = new Uint8Array(head.length + value.byteLength);
      joined.set(head);
      joined.set(value, head.length);
      head = joined;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  const refuse = (message: string) => {
    rest.cancel().catch(() => undefined);
    const error = { jsonrpc: '2.0', id: null, error: { code: -32600, message } };
    return new Response(JSON.stringify(error), { status: 400, headers: { 'content-type': 'application/json' } });
  };
  if (first === 0x5b) return refuse('Send one message per request: batches are not accepted.');
  if (first === undefined && !ended) return refuse('The message starts with too much blank space.');
  return new Request(request, { body: rest, duplex: 'half' } as RequestInit);
}

async function serveMcp(incoming: Request, env: Env, ctx: ExecutionContext, identity?: Identity): Promise<Response> {
  const request = await refuseBatch(incoming);
  if (request instanceof Response) return request;
  const config = configFromEnv(env as unknown as Record<string, string | undefined>);
  const submit: SubmitContext = { queue: queueFor(env, ctx).service, identity, caller: { ...callerOf(request), shared: true } };
  const handler = createMcpHandler(() => createConnectorServer({ store: storeFor(env), config, submit }), {
    route: '/mcp',
    allowedHostnames: allowedHostnames(env),
  });
  return handler(request, env, ctx);
}

/** Sign-in is on only while submissions are open and everything it needs is set up. Otherwise it is as if it did not exist. */
function signInReady(env: Env): boolean {
  if (!configFromEnv(env as unknown as Record<string, string | undefined>).submissionsOpen || !env.OAUTH_KV) return false;
  return missingFor(readQueueSettings(env), { kv: !!env.QUEUE_KV, limits: !!env.QUEUE_LIMITS }, 'web').length === 0;
}

const stacks = new Map<string, OAuthStack<Env>>();
function stackFor(origin: string): OAuthStack<Env> {
  let stack = stacks.get(origin);
  if (!stack) stacks.set(origin, (stack = createOAuthStack<Env>(origin, serveMcp, log, (e, id, at) => signedOut(e.OAUTH_KV, id, at))));
  return stack;
}

async function mcpRoute(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // No Authorization header: served exactly as before. Also served that way when sign-in is switched off, so closing the queue
  // never breaks reading for an AI app that still holds an old token.
  if (request.headers.has('authorization') && signInReady(env)) {
    const origin = trustedOrigin(request, env);
    if (origin) return stackFor(origin).resourceServer.fetch(request, env, ctx);
  }
  return serveMcp(request, env, ctx);
}

// ---------------------------------------------------------------------------------------------------------------
// The sign-in for AI apps
// ---------------------------------------------------------------------------------------------------------------

const WELL_KNOWN_RESOURCE = '/.well-known/oauth-protected-resource';

async function signInRoute(incoming: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  const origin = trustedOrigin(incoming, env);
  if (!origin) return hostRefused(env);
  if (!signInReady(env)) {
    if (path.startsWith('/.well-known/')) return new Response(null, { status: 404 });
    return new Response(messagePage('Sign-in is not available', 'Sending an Islet Improvement Proposal (IIP) from an AI app is not switched on yet. Reading the blueprint does not need a sign-in.'), { status: 503, headers: PAGE_HEADERS });
  }
  const request = await smallSignInBody(incoming);
  if (request instanceof Response) return request;
  const stack = stackFor(origin);
  const { service, settings, github } = queueFor(env, ctx);
  const deps = { github, settings, defer: (work: Promise<unknown>) => ctx.waitUntil(work), log };

  switch (path) {
    case '/authorize': {
      // Opening the approval page saves a record, so it is limited per address. It is opened in the person's own browser, so
      // the address is theirs, not an AI app's server.
      if (request.method === 'GET') {
        const limited = await service.hit('authorize', callerOf(request));
        if (limited && !limited.ok) {
          const wait = Number(limited.body.retry_after_seconds) || 60;
          return new Response(messagePage('Sign-in paused', limited.body.message), { status: 429, headers: { ...PAGE_HEADERS, 'retry-after': String(wait) } });
        }
      }
      return handleAuthorize(request, env, stack, deps);
    }
    case '/callback':
      return handleCallback(request, env, stack, deps);
    case '/register': {
      // Anyone may register an app, so registering is rate limited like the rest.
      if (request.method === 'POST') {
        const limited = await service.hit('register', { ...callerOf(request), shared: true });
        if (limited) {
          const wait = Number(limited.ok ? 0 : limited.body.retry_after_seconds) || 60;
          return new Response(JSON.stringify({ error: 'temporarily_unavailable', error_description: 'Too many registrations from this connection. Please wait and try again.' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': String(wait), 'access-control-allow-origin': '*' },
          });
        }
      }
      return stack.server.fetch(request, env, ctx);
    }
    case WELL_KNOWN_RESOURCE:
      // Some apps ask for the bare address first. It describes the same resource, /mcp.
      return stack.resourceServer.fetch(new Request(new URL(`${WELL_KNOWN_RESOURCE}/mcp`, origin), request), env, ctx);
    case `${WELL_KNOWN_RESOURCE}/mcp`:
      return stack.resourceServer.fetch(request, env, ctx);
    default:
      return stack.server.fetch(request, env, ctx); // /token and /.well-known/oauth-authorization-server
  }
}

const SIGN_IN_PATHS = new Set(['/authorize', '/callback', '/token', '/register', '/.well-known/oauth-authorization-server', WELL_KNOWN_RESOURCE, `${WELL_KNOWN_RESOURCE}/mcp`]);

// ---------------------------------------------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/' || path === '/healthz') return home(url);
    if (path === '/mcp') return mcpRoute(request, env, ctx);
    if (path.startsWith('/api/')) {
      if (!hostAllowed(request, env)) return hostRefused(env);
      const { service, settings } = queueFor(env, ctx);
      const config = configFromEnv(env as unknown as Record<string, string | undefined>);
      return handleApi(request, { service, settings, bundle: () => new Bundle(storeFor(env), config.activeBundle), log });
    }
    if (SIGN_IN_PATHS.has(path)) return signInRoute(request, env, ctx, path);
    return new Response('Not found. The connector is at /mcp.', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

