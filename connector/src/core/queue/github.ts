// Everything the queue says to GitHub, in one place.
//
//   - the contributor's sign-in: swap the one-time code for a user token, read who they are, then let the token go;
//   - the bot: a GitHub App installation token (signed with RS256 through WebCrypto, cached until close to expiry),
//     used to open the issue and add the first comment.
//
// The two web addresses are settings, so a local mock can stand in for GitHub. No token or key is ever put in an
// error message: callers can show or log a GitHubError safely.
import { base64url, utf8 } from './crypto';

export type GitHubErrorKind = 'refused' | 'unavailable' | 'broken';

/**
 * `refused`: GitHub said no to this person (a bad or used code). `unavailable`: GitHub is not answering, or is busy or slow, so try again
 * later. `broken`: GitHub refused one of OUR requests in a way that trying again will not fix (the app suspended, uninstalled or made
 * private, its key or client secret wrong or replaced, issues switched off, the repository archived or gone): someone has to put our
 * set-up right, and the person should be told it is not their fault.
 * `outcomeUnknown`: the request to open the issue was sent and no clear answer came back (the connection dropped, it timed out, or GitHub
 * answered with a server error), so the issue may exist. Without it, nothing was sent, and "nothing was posted" is true.
 */
export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    message: string,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface GitHubSettings {
  /** https://github.com, or the mock. */
  webBase: string;
  /** https://api.github.com, or the mock. */
  apiBase: string;
  clientId: string;
  clientSecret: string;
  appId: string;
  installationId: string;
  /** PKCS#8 PEM. */
  privateKey: string;
  owner: string;
  repo: string;
}

/** The part of GitHub the queue uses. GitHubClient is the real one; tests can supply a smaller fake. */
export interface GitHubPort {
  exchangeCode(args: { code: string; redirectUri: string; codeVerifier?: string }): Promise<string>;
  getUser(token: string): Promise<{ id: number; login: string }>;
  revokeUserToken(token: string): Promise<void>;
  loginFor(id: number): Promise<string | null>;
  createIssue(args: { title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }>;
  createComment(issueNumber: number, body: string): Promise<void>;
}

/**
 * An installation token kept between requests. One cache per app and installation. It holds only a finished token, never one on
 * its way: on Workers one request should not wait on another's work (see inTurn in src/server.ts), so two requests that both find
 * no token each ask for their own. GitHub allows that.
 */
export interface TokenCache {
  token?: string;
  /** Milliseconds since the epoch. */
  expiresAt?: number;
}

const USER_AGENT = 'OpenIslet-connector (+https://openislet.org)';
const TIMEOUT_MS = 10_000;
/** A cached installation token is renewed this long before GitHub says it expires. */
const RENEW_BEFORE_MS = 5 * 60_000;
const API_VERSION = '2022-11-28';
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;

/**
 * A 401, 403, 404 or 410 to one of our own requests means our set-up is broken (see GitHubErrorKind), unless GitHub is only asking us
 * to slow down, which passes by itself. It says so with a retry-after or an exhausted rate limit (a 403 or 429), and a secondary rate
 * limit can come as a bare 403 with only a message that says so, so the message is read too.
 */
async function trouble(res: Response): Promise<GitHubErrorKind> {
  if (![401, 403, 404, 410].includes(res.status)) return 'unavailable';
  if (res.headers.get('retry-after') !== null || res.headers.get('x-ratelimit-remaining') === '0') return 'unavailable';
  let said = '';
  try {
    said = (await res.text()).slice(0, 2000);
  } catch {
    // an answer we cannot read says nothing about a rate limit
  }
  return /rate limit|abuse|too many requests/i.test(said) ? 'unavailable' : 'broken';
}

/** What GitHub's code exchange answers when our own client id, client secret or redirect address is the problem. */
const OUR_OAUTH_ERRORS = new Set(['incorrect_client_credentials', 'redirect_uri_mismatch', 'application_suspended', 'unauthorized_client', 'device_flow_disabled']);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------------------------------------------
// The app's private key
// ---------------------------------------------------------------------------------------------------------------

/** Reads a PKCS#8 PEM, tolerating the "\n" that pasted secrets often carry instead of real line breaks. */
export function pemToDer(pem: string): Uint8Array {
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) throw new GitHubError('broken', 'The GitHub App key is in the old PKCS#1 format; convert it to PKCS#8 (see connector/DEPLOY.md, step 4)');
  const text = pem.replace(/\\n/g, '\n');
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(text);
  if (!m) throw new GitHubError('broken', 'The GitHub App key is not a PKCS#8 PEM');
  let binary: string;
  try {
    binary = atob(m[1].replace(/\s+/g, ''));
  } catch {
    throw new GitHubError('broken', 'The GitHub App key is not valid base64');
  }
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function importAppKey(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  try {
    return await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new GitHubError('broken', 'The GitHub App key was not accepted (it must be an RSA private key in PKCS#8 form)');
  }
}

/** The short-lived token that proves we are the app (RS256). GitHub allows ten minutes at most; this one lasts nine. */
export async function signAppJwt(key: CryptoKey, appId: string, nowMs: number): Promise<string> {
  const now = Math.floor(nowMs / 1000);
  const head = base64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = base64url(utf8(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${head}.${body}`));
  return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------------------------------------------

export class GitHubClient implements GitHubPort {
  private appKey: Promise<CryptoKey> | null = null;
  /** This request's own ask for a token, while it is on its way. A client lives for one request (src/worker.ts). */
  private minting: Promise<string> | null = null;

  constructor(
    private readonly settings: GitHubSettings,
    private readonly cache: TokenCache = {},
    private readonly fetchFn: FetchLike = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new GitHubError('unavailable', 'GitHub could not be reached');
    }
  }

  private apiHeaders(authorization: string, json = false): Record<string, string> {
    return {
      authorization,
      accept: 'application/vnd.github+json',
      'x-github-api-version': API_VERSION,
      'user-agent': USER_AGENT,
      ...(json ? { 'content-type': 'application/json' } : {}),
    };
  }

  // ---- The contributor signs in ----

  /** Swaps the one-time code from GitHub's redirect for a user token. */
  async exchangeCode(args: { code: string; redirectUri: string; codeVerifier?: string }): Promise<string> {
    const res = await this.call(`${this.settings.webBase}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        code: args.code,
        redirect_uri: args.redirectUri,
        ...(args.codeVerifier ? { code_verifier: args.codeVerifier } : {}),
      }),
    });
    if (res.status >= 500 || res.status === 429) throw new GitHubError('unavailable', `GitHub answered ${res.status} to the code exchange`);
    let data: { access_token?: unknown; error?: unknown } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new GitHubError('unavailable', 'GitHub sent an unreadable answer to the code exchange');
    }
    if (typeof data.access_token === 'string' && data.access_token) return data.access_token;
    // A used or wrong code is the contributor's to retry. Anything else (wrong client secret, wrong redirect address) is ours to fix.
    if (data.error === 'bad_verification_code') throw new GitHubError('refused', 'GitHub did not accept the sign-in code');
    throw new GitHubError(typeof data.error === 'string' && OUR_OAUTH_ERRORS.has(data.error) ? 'broken' : 'unavailable', `GitHub refused the code exchange (${typeof data.error === 'string' ? data.error.slice(0, 60) : `HTTP ${res.status}`})`);
  }

  /** Who signed in. The user token is used for this and nothing else. */
  async getUser(token: string): Promise<{ id: number; login: string }> {
    const res = await this.call(`${this.settings.apiBase}/user`, { method: 'GET', headers: this.apiHeaders(`Bearer ${token}`) });
    if (res.status === 401) throw new GitHubError('refused', 'GitHub did not accept the sign-in');
    // Not classified as our fault: a 403 here can be about the person's own account. A suspended app shows at the code exchange instead.
    if (!res.ok) throw new GitHubError('unavailable', `GitHub answered ${res.status} when asked who signed in`);
    let user: { id?: unknown; login?: unknown };
    try {
      user = (await res.json()) as typeof user;
    } catch {
      throw new GitHubError('unavailable', 'GitHub sent an unreadable profile');
    }
    if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.login !== 'string' || !LOGIN.test(user.login)) {
      throw new GitHubError('unavailable', 'GitHub sent a profile we could not read');
    }
    return { id: user.id, login: user.login };
  }

  /** Ends the user token as soon as we have what we needed. A failure here changes nothing for the contributor. */
  async revokeUserToken(token: string): Promise<void> {
    const basic = btoa(`${this.settings.clientId}:${this.settings.clientSecret}`);
    try {
      await this.call(`${this.settings.apiBase}/applications/${encodeURIComponent(this.settings.clientId)}/token`, {
        method: 'DELETE',
        headers: this.apiHeaders(`Basic ${basic}`, true),
        body: JSON.stringify({ access_token: token }),
      });
    } catch {
      // Best effort: the token is short-lived and was never stored.
    }
  }

  // ---- The bot ----

  /** A token for the app's installation, from the cache when one with time left exists. */
  async installationToken(force = false): Promise<string> {
    const c = this.cache;
    if (!force && c.token && c.expiresAt !== undefined && c.expiresAt - this.now() > RENEW_BEFORE_MS) return c.token;
    if (this.minting) return this.minting;
    const minting = this.mintInstallationToken().finally(() => {
      if (this.minting === minting) this.minting = null;
    });
    this.minting = minting;
    return minting;
  }

  private async mintInstallationToken(): Promise<string> {
    const s = this.settings;
    this.appKey ??= importAppKey(s.privateKey);
    let key: CryptoKey;
    try {
      key = await this.appKey;
    } catch (error) {
      this.appKey = null;
      throw error;
    }
    const jwt = await signAppJwt(key, s.appId, this.now());
    const res = await this.call(`${s.apiBase}/app/installations/${encodeURIComponent(s.installationId)}/access_tokens`, {
      method: 'POST',
      headers: this.apiHeaders(`Bearer ${jwt}`, true),
      // Least privilege: this token can open issues in the queue repository and nothing else.
      body: JSON.stringify({ repositories: [s.repo], permissions: { issues: 'write' } }),
    });
    if (res.status !== 201 && res.status !== 200) throw new GitHubError(await trouble(res), `GitHub answered ${res.status} when the bot asked for a token`);
    let data: { token?: unknown; expires_at?: unknown };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new GitHubError('unavailable', 'GitHub sent an unreadable bot token');
    }
    if (typeof data.token !== 'string' || !data.token) throw new GitHubError('unavailable', 'GitHub sent no bot token');
    const expires = typeof data.expires_at === 'string' ? Date.parse(data.expires_at) : NaN;
    this.cache.token = data.token;
    // If GitHub gave no readable expiry, assume the shortest sensible life (an hour is what GitHub issues).
    this.cache.expiresAt = Number.isFinite(expires) ? expires : this.now() + 55 * 60_000;
    return data.token;
  }

  /** Sends a request as the bot. A token GitHub no longer accepts is replaced once and the request is repeated. */
  private async asBot(path: string, init: RequestInit): Promise<Response> {
    const attempt = async (force: boolean) => {
      const token = await this.installationToken(force);
      try {
        return await this.call(`${this.settings.apiBase}${path}`, { ...init, headers: this.apiHeaders(`Bearer ${token}`, true) });
      } catch (error) {
        // The request was on its way and no answer came back, so GitHub may have acted on it. (A failure to get the token, above, sent nothing.)
        if (error instanceof GitHubError) throw new GitHubError(error.kind, error.message, true);
        throw error;
      }
    };
    const first = await attempt(false);
    if (first.status !== 401) return first;
    this.cache.token = undefined;
    this.cache.expiresAt = undefined;
    return attempt(true);
  }

  /**
   * The account's username now, by its numeric ID, which never changes; null if GitHub no longer has the account. A username can
   * change, and someone else can then take the old one, so a name kept from an earlier sign-in is not trusted for the @mention.
   */
  async loginFor(id: number): Promise<string | null> {
    let res: Response;
    try {
      res = await this.asBot(`/user/${id}`, { method: 'GET' });
    } catch (error) {
      // Only reading: nothing can have been posted.
      if (error instanceof GitHubError) throw new GitHubError(error.kind, error.message);
      throw error;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(await trouble(res), `GitHub answered ${res.status} when asked for the account's name`);
    let user: { id?: unknown; login?: unknown };
    try {
      user = (await res.json()) as typeof user;
    } catch {
      throw new GitHubError('unavailable', 'GitHub sent an unreadable profile');
    }
    if (user.id !== id || typeof user.login !== 'string' || !LOGIN.test(user.login)) throw new GitHubError('unavailable', 'GitHub sent a profile we could not read');
    return user.login;
  }

  async createIssue(args: { title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }> {
    const { owner, repo } = this.settings;
    const res = await this.asBot(`/repos/${owner}/${repo}/issues`, { method: 'POST', body: JSON.stringify(args) });
    // A server error, or any answer we cannot read, may still come from an issue that was made. A clear refusal (4xx) made nothing.
    // A 401, 403, 404 or 410 here is our own set-up (see trouble()); a 422 or a 429 is not, so it stays "unavailable".
    if (res.status !== 201) throw new GitHubError(await trouble(res), `GitHub answered ${res.status} when the issue was opened`, res.status >= 500);
    let issue: { number?: unknown; html_url?: unknown };
    try {
      issue = (await res.json()) as typeof issue;
    } catch {
      throw new GitHubError('unavailable', 'GitHub sent an unreadable issue', true);
    }
    if (typeof issue.number !== 'number' || !Number.isSafeInteger(issue.number) || issue.number <= 0 || typeof issue.html_url !== 'string' || !/^https?:\/\//.test(issue.html_url)) {
      throw new GitHubError('unavailable', 'GitHub sent an issue we could not read', true);
    }
    return { number: issue.number, url: issue.html_url };
  }

  async createComment(issueNumber: number, body: string): Promise<void> {
    const { owner, repo } = this.settings;
    const res = await this.asBot(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    if (res.status !== 201) throw new GitHubError('unavailable', `GitHub answered ${res.status} when the checks comment was added`);
  }
}
