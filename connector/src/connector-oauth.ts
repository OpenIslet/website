// The connector's own sign-in for AI apps (OAuth 2.1 with PKCE), with GitHub as the login behind it.
// Built on @cloudflare/workers-oauth-provider. The shape, in plain words:
//
//   - The AI app finds us through two small documents (/.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server),
//     registers itself at /register, and sends the person to /authorize.
//   - /authorize shows a plain approval page. Only after the person agrees are they sent on to GitHub.
//   - GitHub sends them back to /callback. We read who they are (their numeric ID and username, nothing else), let the GitHub token go,
//     and hand the AI app a token of our own that carries only that ID and username.
//   - /token swaps codes and refresh tokens for access tokens. The AI app then sends the token to /mcp in an Authorization header.
//
// /mcp itself stays open for reading. The Worker (src/worker.ts) decides which requests come through here.
import {
  AuthorizationError,
  CimdFetchError,
  OAuthAuthorizationServer,
  OAuthResourceServer,
  authorizationErrorRedirect,
  insufficientScope,
} from '@cloudflare/workers-oauth-provider';
import { CONTACT_EMAIL } from './core/contact';
import { type GitHubPort, GitHubError } from './core/queue/github';
import { base64url, randomToken, utf8 } from './core/queue/crypto';
import type { QueueSettings } from './core/queue/settings';
import type { Identity } from './core/queue/types';
import { PAGE_HEADERS, consentPage, messagePage } from './oauth-pages';
import { readCapped } from './queue-http';

/** The one scope: sending an IIP (Islet Improvement Proposal) as the signed-in GitHub account. */
export const SCOPE = 'submit';

/** What a connector token carries (the library keeps it encrypted): the GitHub numeric ID and username, and when it was approved. */
export interface ConnectorProps {
  github: { id: number; login: string };
  /** When the person approved the app (ms). A sign-out ends every approval made at or before its time. */
  approved_at?: number;
}

/**
 * Signing an account out (scripts/sign-out-account.mjs) writes this key in OAUTH_KV, holding the time in ms. Every approval made
 * at or before it stops working, even one that a refresh already under way writes back after the script deletes the keys.
 */
export const signedOutKey = (githubId: number | string): string => `signed-out:${githubId}`;
/** A day longer than an approval lasts (SIGN_IN_LIFETIME_SECONDS), so it outlives every approval it ends. */
export const SIGNED_OUT_TTL_SECONDS = 8 * 24 * 60 * 60;

/** Whether an approval made at `approvedAt` was ended by a sign-out. An approval with no time is older than any sign-out. */
export async function signedOut(kv: Pick<KVNamespace, 'get'> | undefined, githubId: number, approvedAt: unknown): Promise<boolean> {
  const raw = kv ? await kv.get(signedOutKey(githubId)) : null;
  const at = raw === null ? NaN : Number(raw);
  return Number.isFinite(at) && (typeof approvedAt === 'number' ? approvedAt : 0) <= at;
}

export function identityFromProps(props: unknown): Identity | null {
  const github = (props as { github?: { id?: unknown; login?: unknown } } | null | undefined)?.github;
  if (!github || typeof github.id !== 'number' || !Number.isSafeInteger(github.id) || github.id <= 0) return null;
  if (typeof github.login !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/.test(github.login)) return null;
  return { id: github.id, login: github.login };
}

export type ServeMcp<E> = (request: Request, env: E, ctx: ExecutionContext, identity: Identity) => Promise<Response>;

export interface OAuthStack<E> {
  origin: string;
  resource: string;
  server: OAuthAuthorizationServer<E>;
  resourceServer: OAuthResourceServer<E, ConnectorProps>;
}

export interface LoginDeps {
  github: GitHubPort;
  settings: QueueSettings;
  /** Lets go of the GitHub token after the response is sent. */
  defer?: (work: Promise<unknown>) => void;
  log?: (event: string, fields?: Record<string, string | number | boolean | null>) => void;
}

/**
 * The sign-in server and the protected /mcp for one public address. `origin` is where the connector is reached
 * (https://mcp.openislet.org, or http://localhost:8787 when trying it locally); the Worker only passes an address it has
 * already checked against its list of allowed hosts.
 */
/** How long an AI app stays signed in after the person approves it: seven days. */
export const SIGN_IN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export function createOAuthStack<E>(origin: string, serveMcp: ServeMcp<E>, log?: LoginDeps['log'], endedFor?: (env: E, githubId: number, approvedAt: unknown) => Promise<boolean>): OAuthStack<E> {
  const resource = `${origin}/mcp`;
  // Asks the app to sign in again.
  const invalidToken = () =>
    new Response(null, { status: 401, headers: { 'www-authenticate': `Bearer realm="OAuth", error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`, 'cache-control': 'no-store' } });
  const server = new OAuthAuthorizationServer<E>({
    issuer: origin,
    resources: [resource],
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
    scopesSupported: [SCOPE],
    // Clients that publish a metadata document instead of registering. The library turns this on only if the Worker also has the
    // `global_fetch_strictly_public` compatibility flag, which keeps that outbound fetch away from private addresses.
    clientIdMetadataDocumentEnabled: true,
    // An AI app's sign-in lasts a week from when the person approved it, not the library's 30 days (Kev, 29 October 2026), so an
    // app someone was tricked into approving can post in their name for a week at most. A fixed lifetime: refreshing doesn't extend it.
    refreshTokenTTL: SIGN_IN_LIFETIME_SECONDS,
    // What failed, never the request: no tokens, codes or addresses reach the log.
    onError: ({ code, status, internal }) => log?.('oauth.error', { code, status, category: internal.category, reason: internal.reason }),
  });
  const resourceServer = new OAuthResourceServer<E, ConnectorProps>({
    resourceMetadata: { resource, authorization_servers: [origin], resource_name: 'OpenIslet connector' },
    requiredScopes: [SCOPE],
    validateToken: (env) => (res, token) => server.validateToken<ConnectorProps>(res, token, env),
    handler: {
      fetch: async (request, env, ctx) => {
        const identity = identityFromProps(ctx.props);
        // A token from before the sign-in carried a GitHub identity, or a damaged one, or one whose account was signed out.
        if (!identity) return invalidToken();
        if (endedFor && (await endedFor(env, identity.id, (ctx.props as ConnectorProps).approved_at))) return invalidToken();
        if (!ctx.auth.scope.includes(SCOPE)) return insufficientScope(ctx.auth, [SCOPE]);
        return serveMcp(request, env, ctx as unknown as ExecutionContext, identity);
      },
    },
  });
  return { origin, resource, server, resourceServer };
}

// ---------------------------------------------------------------------------------------------------------------
// /authorize
// ---------------------------------------------------------------------------------------------------------------

const html = (body: string, status = 200, extra?: Headers): Response => {
  const headers = new Headers(extra);
  for (const [k, v] of Object.entries(PAGE_HEADERS)) headers.set(k, v);
  return new Response(body, { status, headers });
};

const redirect = (location: string, headers?: Headers): Response => {
  const h = new Headers(headers);
  h.set('location', location);
  return new Response(null, { status: 302, headers: h });
};

/** Sign-in requests are small. Bigger ones are refused before the sign-in library reads them, as it looks at every field of a form. */
export const SIGN_IN_BODY_MAX_BYTES = 16 * 1024;
export const SIGN_IN_FORM_FIELDS_MAX = 50;

/** The request with its body read and checked against those limits, or the answer refusing it. */
export async function smallSignInBody(request: Request): Promise<Request | Response> {
  if (request.method !== 'POST' || !request.body) return request;
  const refuse = (status: number, description: string) =>
    new Response(JSON.stringify({ error: 'invalid_request', error_description: description }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const bytes = await readCapped(request, SIGN_IN_BODY_MAX_BYTES);
  if (!bytes) return refuse(413, `The request is too large. The limit is ${SIGN_IN_BODY_MAX_BYTES / 1024} KB.`);
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/x-www-form-urlencoded') {
    let fields = 1;
    for (const b of bytes) if (b === 0x26) fields++; // "&"
    if (fields > SIGN_IN_FORM_FIELDS_MAX) return refuse(400, `The form has too many fields. The limit is ${SIGN_IN_FORM_FIELDS_MAX}.`);
  }
  return new Request(request, { body: bytes });
}

const STOPPED = 'Sign-in stopped';
const START_AGAIN = 'Please go back to your AI app and start connecting again.';

/** PKCE for the leg to GitHub: the challenge goes to GitHub, the verifier stays here until the callback. */
async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(verifier));
  return base64url(new Uint8Array(digest));
}

export async function handleAuthorize<E>(request: Request, env: E, stack: OAuthStack<E>, deps: LoginDeps): Promise<Response> {
  const oauth = stack.server.getOAuthApi(env);
  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      return html(consentPage(details, consent.handle), 200, consent.headers);
    }
    if (request.method === 'POST') {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return html(messagePage(STOPPED, `That form could not be read. ${START_AGAIN}`), 400);
      }
      const handle = String(form.get('handle') ?? '');
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle, { scope: [SCOPE] });
      const verifier = randomToken(32);
      const upstream = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
      const s = deps.settings;
      const url = new URL(`${s.githubWebBase}/login/oauth/authorize`);
      url.searchParams.set('client_id', s.clientId as string);
      url.searchParams.set('redirect_uri', `${stack.origin}/callback`);
      url.searchParams.set('state', upstream.state);
      url.searchParams.set('allow_signup', 'true');
      url.searchParams.set('code_challenge', await challengeFor(verifier));
      url.searchParams.set('code_challenge_method', 'S256');
      return redirect(url.href, upstream.headers);
    }
    return new Response('Use GET or POST.', { status: 405, headers: { allow: 'GET, POST' } });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return redirect(error.redirectTo);
    if (error instanceof AuthorizationError) return html(messagePage(STOPPED, `${error.description}. ${START_AGAIN}`), 400);
    if (error instanceof CimdFetchError) return html(messagePage(STOPPED, `The app that asked to connect could not be checked. ${START_AGAIN}`), 400);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// /callback (GitHub sends the person back here)
// ---------------------------------------------------------------------------------------------------------------

export async function handleCallback<E>(request: Request, env: E, stack: OAuthStack<E>, deps: LoginDeps): Promise<Response> {
  const oauth = stack.server.getOAuthApi(env);
  let resumed;
  try {
    resumed = await oauth.finishUpstream<{ verifier?: string }>(request);
  } catch (error) {
    if (error instanceof AuthorizationError) return html(messagePage(STOPPED, `This sign-in link has expired, was already used, or was started in a different browser. ${START_AGAIN}`), 400);
    throw error;
  }
  const { request: original, data, headers } = resumed;
  const params = new URL(request.url).searchParams;
  const backToApp = (code: 'access_denied' | 'invalid_request' | 'temporarily_unavailable', description?: string) => redirect(authorizationErrorRedirect(original, code, description), headers);

  if (params.get('error')) return backToApp('access_denied');
  const code = params.get('code');
  if (!code) return backToApp('invalid_request', 'GitHub did not send a sign-in code');

  let user: { id: number; login: string };
  try {
    const token = await deps.github.exchangeCode({ code, redirectUri: `${stack.origin}/callback`, codeVerifier: typeof data?.verifier === 'string' ? data.verifier : undefined });
    try {
      user = await deps.github.getUser(token);
    } finally {
      const work = deps.github.revokeUserToken(token).catch(() => undefined);
      deps.defer?.(work);
    }
  } catch (error) {
    if (error instanceof GitHubError) {
      deps.log?.('oauth.github_error', { kind: error.kind });
      if (error.kind === 'refused') return backToApp('access_denied');
      // Our own set-up is wrong (see GitHubError): say so, rather than "GitHub did not answer".
      return backToApp('temporarily_unavailable', error.kind === 'broken' ? `OpenIslet has a fault on our side, not yours. Please try again later, or tell us at ${CONTACT_EMAIL}.` : 'GitHub did not answer');
    }
    throw error;
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: String(user.id),
    metadata: { login: user.login },
    scope: original.scope,
    props: { github: { id: user.id, login: user.login }, approved_at: Date.now() } satisfies ConnectorProps,
  });
  deps.log?.('oauth.signed_in');
  return redirect(redirectTo, headers);
}
