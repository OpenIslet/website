// "Verify my ORCID iD" (docs/connector/QUEUE-API.md, "Checking an ORCID iD"). It proves that the person on the form controls an
// ORCID record, so the public IIP can say the iD was verified instead of only stated. GitHub stays the only sign-in that posts.
//
//   - The only verified iD is the one ORCID's token endpoint returns here, server to server, with the client secret. An iD from the
//     browser is never taken as verified.
//   - ORCID's answer also holds the person's name. It is ignored: never kept, logged or published. The iD is not logged either.
//   - The access token is never kept or logged, and it is revoked straight after use, so OpenIslet keeps no lasting access.
//   - The browser gets a short-lived proof signed with STATE_SIGNING_KEY, which /api/begin checks. Only this Worker can make one.
import { base64url, hmacHex, timingSafeEqual, utf8 } from './crypto';
import { isValidOrcid } from './contributor';

/** How long a proof is good for, from the moment ORCID confirmed the iD. */
export const ORCID_PROOF_TTL_SECONDS = 60 * 60;

const TIMEOUT_MS = 10_000;
const USER_AGENT = 'OpenIslet-Connector';
// What the signature covers starts with this, so a signature made for anything else (the issue marker, a caller key) can never pass.
const PROOF_DOMAIN = 'openislet:orcid-proof:v1:';

/**
 * `refused`: ORCID said no to this person's code (used, expired or wrong), so they should start again. `unavailable`: ORCID did not
 * answer, or was busy. `broken`: ORCID refused OUR request in a way that trying again will not fix (the client id or secret is wrong).
 * The message never holds a code, a token or a secret.
 */
export type OrcidErrorKind = 'refused' | 'unavailable' | 'broken';
export class OrcidError extends Error {
  constructor(
    readonly kind: OrcidErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'OrcidError';
  }
}

export interface OrcidSettings {
  /** https://orcid.org, https://sandbox.orcid.org (the practice site), or the local pretend one. */
  base: string;
  clientId: string;
  clientSecret: string;
}

/** The part of ORCID the queue uses. OrcidClient is the real one; tests can supply a smaller fake. */
export interface OrcidPort {
  /** Swaps the one-time code for the iD it proves, and the token that came with it (only to revoke it). */
  exchangeCode(args: { code: string; redirectUri: string }): Promise<{ orcid: string; token: string }>;
  /** Ends the token. Best effort: a failure changes nothing for the person. */
  revoke(token: string): Promise<void>;
}

// A wrong client id or secret, a client ORCID has switched off, or a request this Worker should never send: ours to fix. (A used or
// expired code, or a wrong redirect address, comes back as invalid_grant, which is the person's to retry.)
const OUR_OAUTH_ERRORS = new Set(['invalid_client', 'unauthorized_client', 'invalid_request', 'unsupported_grant_type', 'invalid_scope']);

export class OrcidClient implements OrcidPort {
  constructor(
    private readonly settings: OrcidSettings,
    // Wrapped, not passed as it is: Cloudflare's runtime refuses a fetch called away from the global object ("Illegal invocation").
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async call(path: string, form: Record<string, string>): Promise<Response> {
    try {
      return await this.fetchFn(`${this.settings.base}${path}`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
        body: new URLSearchParams({ client_id: this.settings.clientId, client_secret: this.settings.clientSecret, ...form }).toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new OrcidError('unavailable', 'ORCID could not be reached');
    }
  }

  async exchangeCode(args: { code: string; redirectUri: string }): Promise<{ orcid: string; token: string }> {
    const res = await this.call('/oauth/token', { grant_type: 'authorization_code', code: args.code, redirect_uri: args.redirectUri });
    if (res.status >= 500 || res.status === 429) throw new OrcidError('unavailable', `ORCID answered ${res.status} to the code exchange`);
    let data: { access_token?: unknown; orcid?: unknown; scope?: unknown; error?: unknown } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new OrcidError('unavailable', 'ORCID sent an unreadable answer to the code exchange');
    }
    if (res.ok) {
      // The iD must be one ORCID could issue, and the token must be the sign-in kind this Worker asked for, nothing wider. A token that
      // came with an answer we cannot use is still let go before saying so.
      const token = typeof data.access_token === 'string' && data.access_token ? data.access_token : null;
      const problem =
        !token || typeof data.orcid !== 'string' || !isValidOrcid(data.orcid)
          ? new OrcidError('unavailable', 'ORCID sent an answer without a usable iD')
          : typeof data.scope === 'string' && !data.scope.trim().split(/\s+/).every((scope) => scope === '/authenticate')
            ? new OrcidError('broken', 'ORCID granted a different scope from the one asked for')
            : null;
      if (problem) {
        if (token) await this.revoke(token);
        throw problem;
      }
      return { orcid: data.orcid as string, token: token as string };
    }
    if (typeof data.error === 'string' && OUR_OAUTH_ERRORS.has(data.error)) throw new OrcidError('broken', `ORCID refused the code exchange (${data.error})`);
    throw new OrcidError('refused', `ORCID did not accept the sign-in code (${res.status})`);
  }

  async revoke(token: string): Promise<void> {
    try {
      await this.call('/oauth/revoke', { token });
    } catch {
      // Best effort: the token was never kept anywhere.
    }
  }
}

const fromBase64url = (text: string): string | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
};

/**
 * A proof that ORCID confirmed this iD just now, for the browser to send with the submission. It names the ORCID that confirmed it
 * (`iss`), so a proof made against the practice site is never good where the real ORCID is used, even under the same key.
 */
export async function makeOrcidProof(signingKey: string, orcid: string, issuer: string, nowMs: number): Promise<{ proof: string; expiresAt: number }> {
  const expiresAt = nowMs + ORCID_PROOF_TTL_SECONDS * 1000;
  const payload = base64url(utf8(JSON.stringify({ v: 1, iss: issuer, orcid, exp: expiresAt })));
  return { proof: `${payload}.${await hmacHex(signingKey, PROOF_DOMAIN + payload)}`, expiresAt };
}

/** The iD a proof vouches for, or null when it is not one this Worker signed for this ORCID, has expired, or holds no valid iD. */
export async function readOrcidProof(signingKey: string, proof: string, issuer: string, nowMs: number): Promise<string | null> {
  if (typeof proof !== 'string' || proof.length > 512) return null;
  const dot = proof.indexOf('.');
  if (dot < 1 || dot !== proof.lastIndexOf('.')) return null;
  const payload = proof.slice(0, dot);
  const signature = proof.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;
  if (!timingSafeEqual(await hmacHex(signingKey, PROOF_DOMAIN + payload), signature)) return null;
  const text = fromBase64url(payload);
  if (text === null) return null;
  let fields: unknown;
  try {
    fields = JSON.parse(text);
  } catch {
    return null;
  }
  const f = fields as { v?: unknown; iss?: unknown; orcid?: unknown; exp?: unknown };
  if (!f || typeof f !== 'object' || f.v !== 1 || f.iss !== issuer || typeof f.orcid !== 'string' || !isValidOrcid(f.orcid) || typeof f.exp !== 'number') return null;
  // A proof that claims to last longer than any proof is made for is not one of ours, whatever its signature says.
  if (f.exp <= nowMs || f.exp - nowMs > ORCID_PROOF_TTL_SECONDS * 1000) return null;
  return f.orcid;
}
