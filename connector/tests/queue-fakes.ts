// Stand-ins for the outside world, so the queue can be tested without an account, a network or a clock:
//   MemoryKV      Workers KV in memory, with expiry on a clock the test controls (and a count of writes)
//   FakeLimits    the QUEUE_LIMITS Durable Object: the real class over memory, one request at a time
//   FakeGitHub    the few GitHub addresses the Worker calls, behind a fetch-shaped function
//   makeWorkerEnv a whole Worker environment wired to those, over the real data bundle
//   rpc, signIn   helpers to call /mcp and to go through the connector's sign-in the way an AI app does
import { vi } from 'vitest';
import type { Env } from '../src/worker';
import type { QueueKV } from '../src/core/queue/kv';
import type { LimitsStorage } from '../src/core/queue/limits';
import { QueueLimits } from '../src/queue-limits';
import { base64url, sha256Hex, utf8 } from '../src/core/queue/crypto';
import type { R2Like } from '../src/core/store';
import { bundleId, store } from './helpers';

// ---------------------------------------------------------------------------------------------------------------
// A clock the tests can move
// ---------------------------------------------------------------------------------------------------------------

export class Clock {
  /** When true, the global Date follows this clock (see installWorld), so code that reads Date.now() moves with the test. */
  sync = false;
  constructor(public ms = Date.UTC(2026, 10, 3, 9, 30, 0)) {}
  now = (): number => this.ms;
  advance(seconds: number): void {
    this.ms += seconds * 1000;
    if (this.sync) vi.setSystemTime(this.ms);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Workers KV in memory
// ---------------------------------------------------------------------------------------------------------------

interface Entry {
  value: string;
  expiresAt: number | null;
  metadata?: unknown;
}

/** Enough of KVNamespace for the queue and for the sign-in library. Like the real thing, it refuses an expiry under 60 seconds. */
export class MemoryKV implements QueueKV {
  readonly data = new Map<string, Entry>();
  writes = 0;
  deletes = 0;
  reads = 0;
  /** Makes writes (or deletes) of matching keys fail, `times` times, as a KV store sometimes does. */
  failPuts: { match: RegExp; times: number } | null = null;
  failDeletes: { match: RegExp; times: number } | null = null;
  constructor(private readonly clock: Clock = new Clock()) {}

  private failing(rule: { match: RegExp; times: number } | null, key: string): boolean {
    if (!rule || rule.times <= 0 || !rule.match.test(key)) return false;
    rule.times--;
    return true;
  }

  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= this.clock.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async get(key: string, options?: { type?: 'text' | 'json' } | string): Promise<any> {
    this.reads++;
    const e = this.live(key);
    if (!e) return null;
    const type = typeof options === 'string' ? options : options?.type;
    return type === 'json' ? JSON.parse(e.value) : e.value;
  }

  async put(key: string, value: string, options: { expirationTtl?: number; expiration?: number; metadata?: unknown } = {}): Promise<void> {
    if (typeof value !== 'string') throw new TypeError('MemoryKV stores text');
    if (options.expirationTtl !== undefined && options.expirationTtl < 60) throw new Error(`Invalid expiration_ttl of ${options.expirationTtl}. Expiration TTL must be at least 60.`);
    if (this.failing(this.failPuts, key)) throw new Error('KV PUT failed: 500 Internal Server Error');
    this.writes++;
    const expiresAt = options.expirationTtl !== undefined ? this.clock.now() + options.expirationTtl * 1000 : options.expiration !== undefined ? options.expiration * 1000 : null;
    this.data.set(key, { value, expiresAt, metadata: options.metadata });
  }

  async delete(key: string): Promise<void> {
    if (this.failing(this.failDeletes, key)) throw new Error('KV DELETE failed: 500 Internal Server Error');
    this.deletes++;
    this.data.delete(key);
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const names = [...this.data.keys()].filter((k) => this.live(k) && k.startsWith(options.prefix ?? '')).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1000;
    const page = names.slice(start, start + limit);
    const more = start + limit < names.length;
    return { keys: page.map((name) => ({ name, metadata: this.data.get(name)?.metadata })), list_complete: !more, ...(more ? { cursor: String(start + limit) } : {}) };
  }

  keys(): string[] {
    return [...this.data.keys()].filter((k) => this.live(k));
  }
  get writeCount(): number {
    return this.writes + this.deletes;
  }
  /** Every key and value as one string, for checking that something never appears anywhere. */
  dump(): string {
    return [...this.data.entries()].map(([k, e]) => `${k}\n${e.value}`).join('\n');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The QUEUE_LIMITS Durable Object
// ---------------------------------------------------------------------------------------------------------------

/** A Durable Object's storage in memory. Values are copied in and out, as the real storage does. */
export class MemoryStorage implements LimitsStorage {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.has(key) ? (structuredClone(this.data.get(key)) as T) : undefined;
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v));
  }
  async delete(keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.data.delete(k)) n++;
    return n;
  }
  async list<T>(options: { prefix: string }): Promise<Map<string, T>> {
    return new Map([...this.data].filter(([k]) => k.startsWith(options.prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, structuredClone(v) as T]));
  }
}

/**
 * The QUEUE_LIMITS binding: the real QueueLimits class over MemoryStorage. Like the real object it handles one request at a
 * time, so the tests can fire posts at once and see that the counts still hold. `down` makes it answer 500, as if unreachable.
 */
export class FakeLimits {
  readonly storage = new MemoryStorage();
  down = false;
  /** How many of the next "finish" calls fail, as if the object did not answer just then. */
  failFinishes = 0;
  private readonly object: QueueLimits;
  private turn: Promise<unknown> = Promise.resolve();
  constructor() {
    const state = {
      storage: this.storage,
      blockConcurrencyWhile: <T>(work: () => Promise<T>): Promise<T> => {
        const run = this.turn.then(work);
        this.turn = run.catch(() => undefined);
        return run;
      },
    };
    this.object = new QueueLimits(state as unknown as DurableObjectState);
  }
  idFromName(name: string) {
    return { name };
  }
  get() {
    return {
      fetch: async (url: string, init: RequestInit) => {
        if (this.down) return new Response('down', { status: 500 });
        if (this.failFinishes > 0 && String(init.body).startsWith('{"op":"finish"')) {
          this.failFinishes--;
          return new Response('down', { status: 500 });
        }
        return this.object.fetch(new Request(url, init));
      },
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// GitHub, as far as the Worker uses it
// ---------------------------------------------------------------------------------------------------------------

export interface FakeUser {
  id: number;
  login: string;
}

interface Failure {
  match: RegExp;
  status: number;
  body: unknown;
  times: number;
  headers?: Record<string, string>;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export class FakeGitHub {
  readonly web = 'https://github.test';
  readonly api = 'https://api.github.test';
  readonly clientId = 'Iv1.testclient0001';
  readonly clientSecret = 'test-client-secret-ABCDEF0123456789';
  readonly appId = '424242';
  readonly installationId = '777001';
  /** Codes handed out by "GitHub's login page", each good for one exchange. */
  readonly codes = new Map<string, { user: FakeUser; challenge?: string; used: boolean }>();
  readonly userTokens = new Map<string, FakeUser>();
  /** Every account that has signed in: its ID and its username now. */
  readonly accounts = new Map<number, string>();
  readonly revoked: string[] = [];
  readonly installationTokens = new Map<string, number>();
  readonly mintBodies: unknown[] = [];
  readonly jwts: string[] = [];
  readonly issues: { number: number; title: string; body: string; labels: string[]; comments: string[] }[] = [];
  readonly requests: { method: string; url: string }[] = [];
  /** Every code and token this GitHub ever handed out, for checking that none of them is ever shown or kept. */
  readonly everIssued: string[] = [];
  private readonly failures: Failure[] = [];
  private readonly holds: { match: RegExp; gate: Promise<void> }[] = [];
  private readonly losses: { match: RegExp; times: number }[] = [];
  private counter = 0;
  /** Set by makeWorkerEnv(): the public half of the app's key, for checking the JWT. */
  publicKey?: CryptoKey;

  constructor(private readonly clock: Clock = new Clock()) {}

  /** What GitHub's login page does after the person signs in: it makes a one-time code for them. */
  issueCode(user: FakeUser, challenge?: string): string {
    const code = `code_${++this.counter}_${Math.random().toString(36).slice(2)}`;
    this.accounts.set(user.id, user.login);
    this.codes.set(code, { user, challenge, used: false });
    this.everIssued.push(code);
    return code;
  }

  /** The account changes its username (or, with null, is deleted). Its ID stays the same. */
  rename(id: number, login: string | null): void {
    if (login === null) this.accounts.delete(id);
    else this.accounts.set(id, login);
  }

  /** The next `times` requests whose "METHOD url" matches get this answer instead of the usual one (with these headers, if given). */
  failNext(match: RegExp, status: number, body: unknown = { message: 'failed' }, times = 1, headers?: Record<string, string>): void {
    this.failures.push({ match, status, body, times, headers });
  }

  /** The next `times` matching requests are carried out as usual, but their answer is lost: the caller gets a 500, as after a dropped connection. */
  loseAnswerNext(match: RegExp, times = 1): void {
    this.losses.push({ match, times });
  }

  /** Requests whose "METHOD url" matches wait until the function this returns is called, as a slow GitHub would make them. */
  hold(match: RegExp): () => void {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    this.holds.push({ match, gate });
    return release;
  }

  get newestIssue() {
    return this.issues[this.issues.length - 1];
  }

  private async checkJwt(authorization: string | null): Promise<boolean> {
    const token = authorization?.replace(/^Bearer /, '');
    const parts = token?.split('.');
    if (!token || !parts || parts.length !== 3 || !this.publicKey) return false;
    this.jwts.push(token);
    const header = JSON.parse(new TextDecoder().decode(fromB64(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(fromB64(parts[1])));
    const now = this.clock.now() / 1000;
    if (header.alg !== 'RS256' || claims.iss !== this.appId || !(claims.iat <= now) || !(claims.exp > now) || claims.exp - now > 600) return false;
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', this.publicKey, fromB64(parts[2]), utf8(`${parts[0]}.${parts[1]}`));
  }

  /** Same shape as fetch, so it can be given to GitHubClient or put in place of the global fetch. */
  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const label = `${(init.method ?? 'GET').toUpperCase()} ${new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).href}`;
    const res = await this.handle(input, init);
    // Only a request that went through can lose its answer (a stale token that GitHub refuses first has nothing to lose).
    const loss = res.ok ? this.losses.find((l) => l.times > 0 && l.match.test(label)) : undefined;
    if (loss) {
      loss.times--;
      return json({ message: 'the answer was lost' }, 500);
    }
    return res;
  };

  private handle = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    this.requests.push({ method, url: url.href });
    const label = `${method} ${url.href}`;
    for (const h of this.holds) if (h.match.test(label)) await h.gate;
    const failure = this.failures.find((f) => f.times > 0 && f.match.test(label));
    if (failure) {
      failure.times--;
      return json(failure.body, failure.status, failure.headers);
    }
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};

    if (url.origin === this.web && url.pathname === '/login/oauth/access_token' && method === 'POST') {
      if (body.client_id !== this.clientId || body.client_secret !== this.clientSecret) return json({ error: 'incorrect_client_credentials' });
      const c = this.codes.get(body.code);
      if (!c || c.used) return json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
      if (c.challenge) {
        const wanted = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(String(body.code_verifier ?? '')))));
        if (wanted !== c.challenge) return json({ error: 'bad_verification_code' });
      }
      c.used = true;
      const token = `ghu_${++this.counter}${Math.random().toString(36).slice(2, 12)}`;
      this.userTokens.set(token, c.user);
      this.everIssued.push(token);
      return json({ access_token: token, token_type: 'bearer', scope: '' });
    }
    if (url.origin !== this.api) throw new Error(`Test tried to reach a real address: ${label}`);

    const auth = headers.get('authorization');
    if (url.pathname === '/user' && method === 'GET') {
      const user = this.userTokens.get(auth?.replace(/^Bearer /, '') ?? '');
      return user ? json({ id: user.id, login: user.login, type: 'User' }) : json({ message: 'Bad credentials' }, 401);
    }
    const byId = /^\/user\/(\d+)$/.exec(url.pathname);
    if (byId && method === 'GET') {
      const t = auth?.replace(/^Bearer /, '') ?? '';
      if (!((this.installationTokens.get(t) ?? 0) > this.clock.now())) return json({ message: 'Bad credentials' }, 401);
      const login = this.accounts.get(Number(byId[1]));
      return login ? json({ id: Number(byId[1]), login, type: 'User' }) : json({ message: 'Not Found' }, 404);
    }
    if (url.pathname === `/applications/${this.clientId}/token` && method === 'DELETE') {
      this.revoked.push(String(body.access_token));
      this.userTokens.delete(String(body.access_token));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === `/app/installations/${this.installationId}/access_tokens` && method === 'POST') {
      if (!(await this.checkJwt(auth))) return json({ message: 'A JSON web token could not be decoded' }, 401);
      this.mintBodies.push(body);
      const token = `ghs_${++this.counter}${Math.random().toString(36).slice(2, 12)}`;
      const expires = this.clock.now() + 3600_000;
      this.installationTokens.set(token, expires);
      this.everIssued.push(token);
      return json({ token, expires_at: new Date(expires).toISOString() }, 201);
    }
    const bot = (): boolean => {
      const t = auth?.replace(/^Bearer /, '') ?? '';
      const expires = this.installationTokens.get(t);
      return expires !== undefined && expires > this.clock.now();
    };
    const issueRoute = /^\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(url.pathname);
    if (issueRoute && method === 'POST') {
      if (!bot()) return json({ message: 'Bad credentials' }, 401);
      const number = this.issues.length + 1;
      this.issues.push({ number, title: body.title, body: body.body, labels: body.labels ?? [], comments: [] });
      return json({ number, html_url: `https://github.test/${issueRoute[1]}/${issueRoute[2]}/issues/${number}` }, 201);
    }
    const commentRoute = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/.exec(url.pathname);
    if (commentRoute && method === 'POST') {
      if (!bot()) return json({ message: 'Bad credentials' }, 401);
      const issue = this.issues[Number(commentRoute[3]) - 1];
      if (!issue) return json({ message: 'Not Found' }, 404);
      issue.comments.push(body.body);
      return json({ id: issue.comments.length }, 201);
    }
    return json({ message: `Not handled by the fake: ${label}` }, 404);
  };
}

function fromB64(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** A fresh RSA key pair in the shape the Worker expects (PKCS#8 PEM), and the public half for checking signatures. */
export async function makeAppKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  let binary = '';
  for (const b of der) binary += String.fromCharCode(b);
  const lines = btoa(binary).match(/.{1,64}/g)!.join('\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

// ---------------------------------------------------------------------------------------------------------------
// A whole Worker environment
// ---------------------------------------------------------------------------------------------------------------

/** R2 over the real data bundle on disk, so the checks run against the real thing. */
export const bundleBucket: R2Like = {
  async get(key: string) {
    const slash = key.indexOf('/');
    const text = await store.read(key.slice(0, slash), key.slice(slash + 1));
    return text === null ? null : { text: async () => text };
  },
};

export const SIGNING_KEY = 'test-signing-key-0123456789-abcdefghijklmnopqrstuvwxyz';

export interface TestCtx {
  waitUntil(work: Promise<unknown>): void;
  passThroughOnException(): void;
  flush(): Promise<void>;
}

export function makeCtx(): TestCtx {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (work) => void pending.push(work.catch(() => undefined)),
    passThroughOnException: () => undefined,
    flush: async () => {
      await Promise.all(pending.splice(0));
    },
  };
}

export interface World {
  /** Everything the Worker wrote to the console while this world was installed. */
  logs: string[];
  env: Env;
  kv: MemoryKV;
  oauthKv: MemoryKV;
  limits: FakeLimits;
  github: FakeGitHub;
  clock: Clock;
  ctx: TestCtx;
  /** The Worker's `fetch`, with the test context filled in. */
  call(request: Request): Promise<Response>;
}

let keyPromise: ReturnType<typeof makeAppKey> | undefined;

/**
 * Builds the Worker's environment with everything switched on and pointed at the fakes. Pass `vars` to change or remove a setting
 * (a value of undefined removes it). The caller must have done `vi.mock('agents/mcp', ...)` and must stub the global fetch with
 * `world.github.fetch`; `useWorld()` in the test files does both.
 */
export async function makeWorld(vars: Partial<Record<keyof Env, unknown>> = {}): Promise<World> {
  const { default: worker } = await import('../src/worker');
  keyPromise ??= makeAppKey();
  const key = await keyPromise;
  const clock = new Clock();
  const kv = new MemoryKV(clock);
  const oauthKv = new MemoryKV(clock);
  const limits = new FakeLimits();
  const github = new FakeGitHub(clock);
  github.publicKey = key.publicKey;
  const base: Record<string, unknown> = {
    BUNDLE: bundleBucket,
    QUEUE_KV: kv,
    OAUTH_KV: oauthKv,
    QUEUE_LIMITS: limits,
    ACTIVE_BUNDLE: bundleId,
    SUBMISSIONS_OPEN: 'true',
    SITE_ORIGIN: 'https://openislet.org',
    ALLOWED_ORIGINS: 'https://openislet.org,http://localhost:4321',
    QUEUE_REPO: 'openislet/openislet',
    GITHUB_CLIENT_ID: github.clientId,
    GITHUB_CLIENT_SECRET: github.clientSecret,
    GITHUB_APP_ID: github.appId,
    GITHUB_APP_INSTALLATION_ID: github.installationId,
    GITHUB_APP_PRIVATE_KEY: key.pem,
    STATE_SIGNING_KEY: SIGNING_KEY,
    GITHUB_WEB_BASE: github.web,
    GITHUB_API_BASE: github.api,
  };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  const env = base as unknown as Env;
  const ctx = makeCtx();
  return { logs: [], env, kv, oauthKv, limits, github, clock, ctx, call: (request) => worker.fetch(request, env, ctx as unknown as ExecutionContext) };
}

/**
 * Puts the world in place: every outside call the Worker makes goes to the fake GitHub (anything else fails loudly), the global
 * clock follows the world's clock, and what the Worker logs is collected in `world.logs`. Undo it with `restore()` after each test.
 */
export function installWorld(world: World): void {
  vi.stubGlobal('fetch', world.github.fetch);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(world.clock.ms);
  world.clock.sync = true;
  const keep = (...parts: unknown[]) => void world.logs.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
  vi.spyOn(console, 'log').mockImplementation(keep);
  vi.spyOn(console, 'info').mockImplementation(keep);
  vi.spyOn(console, 'warn').mockImplementation(keep);
  vi.spyOn(console, 'error').mockImplementation(keep);
}

export function restore(): void {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
}

// ---------------------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------------------

export const PUBLIC_ORIGIN = 'https://mcp.openislet.org';

export interface ReqOptions {
  method?: string;
  json?: unknown;
  /** The text of the body, when it should not be JSON. */
  text?: string;
  form?: Record<string, string>;
  origin?: string;
  ip?: string;
  host?: string;
  base?: string;
  headers?: Record<string, string>;
  contentType?: string;
}

/** A request to the Worker as it would arrive at https://mcp.openislet.org (the Host header is set to match). */
export function req(path: string, o: ReqOptions = {}): Request {
  const base = o.base ?? PUBLIC_ORIGIN;
  const headers = new Headers(o.headers);
  headers.set('host', o.host ?? new URL(base).host);
  if (o.origin) headers.set('origin', o.origin);
  if (o.ip) headers.set('cf-connecting-ip', o.ip);
  let body: string | undefined;
  if (o.json !== undefined) {
    body = JSON.stringify(o.json);
    headers.set('content-type', o.contentType ?? 'application/json');
  } else if (o.text !== undefined) {
    body = o.text;
    headers.set('content-type', o.contentType ?? 'application/json');
  } else if (o.form) {
    body = new URLSearchParams(o.form).toString();
    headers.set('content-type', 'application/x-www-form-urlencoded');
  }
  return new Request(`${base}${path}`, { method: o.method ?? (body !== undefined ? 'POST' : 'GET'), headers, body });
}

/** Keeps the cookies a browser would keep between the steps of the sign-in. */
export class Jar {
  private readonly cookies = new Map<string, string>();
  take(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/;\s*Max-Age=0/i.test(line) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): Record<string, string> {
    return this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {};
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The MCP over HTTP
// ---------------------------------------------------------------------------------------------------------------

/** Reads a JSON-RPC answer whether the server sent plain JSON or a one-message event stream. */
export async function readRpc(res: Response): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = await res.text();
  const data = res.headers.get('content-type')?.includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop() ?? '{}' : text;
  return JSON.parse(data);
}

export function rpcRequest(method: string, params: unknown, o: { token?: string; origin?: string; ip?: string; id?: number } = {}): Request {
  return req('/mcp', {
    json: { jsonrpc: '2.0', id: o.id ?? 1, method, params },
    origin: o.origin,
    ip: o.ip,
    headers: { accept: 'application/json, text/event-stream', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
  });
}

export async function callTool(world: World, name: string, args: Record<string, unknown>, o: { token?: string; ip?: string } = {}) {
  const res = await world.call(rpcRequest('tools/call', { name, arguments: args }, o));
  const message = await readRpc(res);
  return { status: res.status, message, result: message.result as { content: { text: string }[]; structuredContent?: Record<string, any>; isError?: boolean } | undefined }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ---------------------------------------------------------------------------------------------------------------
// The connector's sign-in, the way an AI app does it
// ---------------------------------------------------------------------------------------------------------------

export interface SignedIn {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
  redirectUri: string;
}

/** Registers an app, sends the person through the approval page and GitHub, and swaps the code for a token. */
export async function signIn(world: World, user: FakeUser, o: { redirectUri?: string; clientName?: string } = {}): Promise<SignedIn> {
  const redirectUri = o.redirectUri ?? 'http://localhost:53682/callback';
  const registered = await world.call(
    req('/register', { json: { client_name: o.clientName ?? 'Test AI app', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, ip: '198.51.100.9' }),
  );
  if (res201(registered) === false) throw new Error(`register failed: ${registered.status} ${await registered.text()}`);
  const { client_id: clientId } = (await registered.json()) as { client_id: string };

  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier))));
  const jar = new Jar();
  const authorizeQuery = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'submit', state: 'app-state-1', code_challenge: challenge, code_challenge_method: 'S256', resource: `${PUBLIC_ORIGIN}/mcp` });

  const page = await world.call(req(`/authorize?${authorizeQuery}`));
  if (page.status !== 200) throw new Error(`authorize page failed: ${page.status} ${await page.text()}`);
  jar.take(page);
  const handle = /name="handle" value="([^"]+)"/.exec(await page.text())?.[1];
  if (!handle) throw new Error('no handle on the approval page');

  const approved = await world.call(req('/authorize', { form: { handle, decision: 'approve' }, headers: jar.header() }));
  if (approved.status !== 302) throw new Error(`approval failed: ${approved.status} ${await approved.text()}`);
  jar.take(approved);
  const toGitHub = new URL(approved.headers.get('location')!);
  const upstreamState = toGitHub.searchParams.get('state')!;

  // GitHub's page: the person signs in, and GitHub sends the browser back with a one-time code.
  const code = world.github.issueCode(user, toGitHub.searchParams.get('code_challenge') ?? undefined);
  const back = await world.call(req(`/callback?${new URLSearchParams({ code, state: upstreamState })}`, { headers: jar.header() }));
  if (back.status !== 302) throw new Error(`callback failed: ${back.status} ${await back.text()}`);
  const appUrl = new URL(back.headers.get('location')!);
  const appCode = appUrl.searchParams.get('code');
  if (!appCode) throw new Error(`no code for the app: ${back.headers.get('location')}`);

  const tokens = await world.call(req('/token', { form: { grant_type: 'authorization_code', code: appCode, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: `${PUBLIC_ORIGIN}/mcp` } }));
  if (tokens.status !== 200) throw new Error(`token failed: ${tokens.status} ${await tokens.text()}`);
  const t = (await tokens.json()) as { access_token: string; refresh_token?: string };
  return { accessToken: t.access_token, refreshToken: t.refresh_token, clientId, redirectUri };
}
const res201 = (r: Response): boolean => r.status === 201 || r.status === 200;

/** The hash the browser sends to /api/begin for a secret it keeps. */
export async function bindingFor(secret: string): Promise<string> {
  return sha256Hex(secret);
}
