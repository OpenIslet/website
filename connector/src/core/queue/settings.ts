// The queue's settings, read from the Worker's variables and secrets (see docs/connector/QUEUE-API.md, "Configuration").
//
// If anything a path needs is missing or malformed, that path answers `queue_not_configured` and does nothing else.
// It never falls back to something weaker (for example, no rate limit or an unsigned marker).

/** The strings the queue reads. Everything is optional here; `missingFor` says what a given path cannot do without. */
export interface QueueEnv {
  ALLOWED_ORIGINS?: string;
  SITE_ORIGIN?: string;
  QUEUE_REPO?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_WEB_BASE?: string;
  GITHUB_API_BASE?: string;
  DAILY_LIMIT_PER_ACCOUNT?: string;
  HOURLY_LIMIT_EVERYONE?: string;
  /** For testing on one machine only: multiplies the hourly limits per address. Leave it unset when deployed. */
  IP_LIMIT_MULTIPLIER?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  STATE_SIGNING_KEY?: string;
  /** "Verify my ORCID iD": the app ORCID knows us by, its secret, and which ORCID (the real one, the practice site, or a local stand-in). */
  ORCID_CLIENT_ID?: string;
  ORCID_CLIENT_SECRET?: string;
  ORCID_BASE?: string;
}

export const DEFAULTS = {
  siteOrigin: 'https://openislet.org',
  allowedOrigins: 'https://openislet.org',
  repo: 'openislet/openislet',
  dailyLimit: 5,
  /** Posts per clock hour from everyone together: a ceiling on a flood from many accounts, far above an honest busy hour. */
  hourlyLimit: 30,
  githubWebBase: 'https://github.com',
  githubApiBase: 'https://api.github.com',
  orcidBase: 'https://orcid.org',
} as const;

export const MIN_SIGNING_KEY_LENGTH = 32;

export interface QueueSettings {
  siteOrigin: string;
  /** Browser origins allowed to call /api/* (CORS). */
  allowedOrigins: string[];
  owner: string;
  repo: string;
  dailyLimit: number;
  hourlyLimit: number;
  /** 1 unless IP_LIMIT_MULTIPLIER says otherwise (local testing). */
  ipLimitMultiplier: number;
  githubWebBase: string;
  githubApiBase: string;
  clientId?: string;
  clientSecret?: string;
  appId?: string;
  installationId?: string;
  privateKey?: string;
  signingKey?: string;
  orcidBase: string;
  orcidClientId?: string;
  orcidClientSecret?: string;
  /** Names of settings that were given but could not be used. */
  invalid: string[];
}

const text = (v: string | undefined): string | undefined => (v === undefined || v.trim() === '' ? undefined : v.trim());

/** An origin such as https://openislet.org (a path, if given, is dropped). Null when it is not a web address. */
function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** A base address for GitHub (or the mock) without a trailing slash. */
function baseOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export function readQueueSettings(env: QueueEnv): QueueSettings {
  const invalid: string[] = [];

  let siteOrigin: string = DEFAULTS.siteOrigin;
  const site = text(env.SITE_ORIGIN);
  if (site !== undefined) {
    const o = originOf(site);
    if (o) siteOrigin = o;
    else invalid.push('SITE_ORIGIN');
  }

  const allowedRaw = env.ALLOWED_ORIGINS === undefined ? DEFAULTS.allowedOrigins : env.ALLOWED_ORIGINS;
  const allowedOrigins = [...new Set(allowedRaw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => originOf(s)).filter((o): o is string => o !== null))];

  let owner = DEFAULTS.repo.split('/')[0];
  let repo = DEFAULTS.repo.split('/')[1];
  const repoText = text(env.QUEUE_REPO);
  if (repoText !== undefined) {
    const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repoText);
    if (m) [, owner, repo] = m;
    else invalid.push('QUEUE_REPO');
  }

  let dailyLimit: number = DEFAULTS.dailyLimit;
  const limitText = text(env.DAILY_LIMIT_PER_ACCOUNT);
  if (limitText !== undefined) {
    if (/^\d{1,4}$/.test(limitText) && Number(limitText) >= 1) dailyLimit = Number(limitText);
    else invalid.push('DAILY_LIMIT_PER_ACCOUNT');
  }

  let hourlyLimit: number = DEFAULTS.hourlyLimit;
  const hourlyText = text(env.HOURLY_LIMIT_EVERYONE);
  if (hourlyText !== undefined) {
    if (/^\d{1,5}$/.test(hourlyText) && Number(hourlyText) >= 1) hourlyLimit = Number(hourlyText);
    else invalid.push('HOURLY_LIMIT_EVERYONE');
  }

  let ipLimitMultiplier = 1;
  const multiplierText = text(env.IP_LIMIT_MULTIPLIER);
  if (multiplierText !== undefined) {
    if (/^\d{1,4}$/.test(multiplierText) && Number(multiplierText) >= 1) ipLimitMultiplier = Number(multiplierText);
    else invalid.push('IP_LIMIT_MULTIPLIER');
  }

  let githubWebBase: string = DEFAULTS.githubWebBase;
  const web = text(env.GITHUB_WEB_BASE);
  if (web !== undefined) {
    const b = baseOf(web);
    if (b) githubWebBase = b;
    else invalid.push('GITHUB_WEB_BASE');
  }
  let githubApiBase: string = DEFAULTS.githubApiBase;
  const api = text(env.GITHUB_API_BASE);
  if (api !== undefined) {
    const b = baseOf(api);
    if (b) githubApiBase = b;
    else invalid.push('GITHUB_API_BASE');
  }

  // A credential in the wrong shape is treated as not given at all, so the paths that need it say `queue_not_configured`.
  const shaped = (name: string, value: string | undefined, ok: (v: string) => boolean): string | undefined => {
    if (value === undefined) return undefined;
    // (wrangler.jsonc ships "REPLACE_WITH_..." placeholders: they count as not given.)
    if (ok(value) && !/^REPLACE/i.test(value)) return value;
    invalid.push(name);
    return undefined;
  };
  const clientId = shaped('GITHUB_CLIENT_ID', text(env.GITHUB_CLIENT_ID), (v) => /^[A-Za-z0-9._-]{4,80}$/.test(v));
  const appId = shaped('GITHUB_APP_ID', text(env.GITHUB_APP_ID), (v) => /^\d{1,12}$/.test(v));
  const installationId = shaped('GITHUB_APP_INSTALLATION_ID', text(env.GITHUB_APP_INSTALLATION_ID), (v) => /^\d{1,12}$/.test(v));
  const signingKey = shaped('STATE_SIGNING_KEY', text(env.STATE_SIGNING_KEY), (v) => v.length >= MIN_SIGNING_KEY_LENGTH);
  const privateKey = shaped('GITHUB_APP_PRIVATE_KEY', text(env.GITHUB_APP_PRIVATE_KEY), (v) => /BEGIN PRIVATE KEY/.test(v));
  // ORCID's client ids look like APP-1A2B3C4D5E6F7G8H; its secrets are UUIDs (the local stand-in uses the same shapes).
  const orcidClientId = shaped('ORCID_CLIENT_ID', text(env.ORCID_CLIENT_ID), (v) => /^APP-[A-Z0-9]{16}$/.test(v));
  const orcidClientSecret = shaped('ORCID_CLIENT_SECRET', text(env.ORCID_CLIENT_SECRET), (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));
  // Which ORCID vouches for an iD. The real one always; ORCID's practice site (where anyone can make an account in a minute) never for
  // the live site; anything else only on this machine (the local stand-in). Otherwise the setting is unusable, so the check is off.
  let orcidBase: string = DEFAULTS.orcidBase;
  const orcid = text(env.ORCID_BASE);
  if (orcid !== undefined) {
    const b = baseOf(orcid);
    let host = '';
    try {
      host = b ? new URL(b).hostname : '';
    } catch {
      host = '';
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(host);
    const ok = b === DEFAULTS.orcidBase || (b === 'https://sandbox.orcid.org' && siteOrigin !== DEFAULTS.siteOrigin) || (b !== null && local);
    if (ok && b) orcidBase = b;
    else invalid.push('ORCID_BASE');
  }

  return {
    siteOrigin,
    allowedOrigins,
    owner,
    repo,
    dailyLimit,
    hourlyLimit,
    ipLimitMultiplier,
    githubWebBase,
    githubApiBase,
    clientId,
    clientSecret: text(env.GITHUB_CLIENT_SECRET),
    appId,
    installationId,
    privateKey,
    signingKey,
    orcidBase,
    orcidClientId,
    orcidClientSecret,
    invalid,
  };
}

/**
 * What a path needs: "check" (the dry run's rate limit), "post" (open an issue), "web" (also the GitHub sign-in on the form) or
 * "orcid" (the form's "Verify my ORCID iD", which only makes sense where the form can post).
 */
export type Need = 'check' | 'post' | 'web' | 'orcid';

/** Settings that have a default but were given in a form we cannot use, by the kind of path they matter to. */
const UNUSABLE: Record<Need, string[]> = {
  check: ['IP_LIMIT_MULTIPLIER'],
  post: ['IP_LIMIT_MULTIPLIER', 'QUEUE_REPO', 'DAILY_LIMIT_PER_ACCOUNT', 'HOURLY_LIMIT_EVERYONE', 'GITHUB_API_BASE'],
  web: ['IP_LIMIT_MULTIPLIER', 'QUEUE_REPO', 'DAILY_LIMIT_PER_ACCOUNT', 'HOURLY_LIMIT_EVERYONE', 'GITHUB_API_BASE', 'SITE_ORIGIN', 'GITHUB_WEB_BASE'],
  orcid: ['IP_LIMIT_MULTIPLIER', 'QUEUE_REPO', 'DAILY_LIMIT_PER_ACCOUNT', 'HOURLY_LIMIT_EVERYONE', 'GITHUB_API_BASE', 'SITE_ORIGIN', 'GITHUB_WEB_BASE', 'ORCID_BASE'],
};

/** The stores a path may need: the queue's KV, and the Durable Object that keeps the exact posting limits. */
export interface Stores {
  kv: boolean;
  limits: boolean;
}

/** The names of settings that are missing or unusable for a path. Empty means ready. Names only, never values. */
export function missingFor(s: QueueSettings, have: Stores, need: Need): string[] {
  const out: string[] = [];
  if (!have.kv) out.push('QUEUE_KV');
  if (!s.signingKey) out.push('STATE_SIGNING_KEY');
  if (need !== 'check') {
    if (!have.limits) out.push('QUEUE_LIMITS');
    if (!s.appId) out.push('GITHUB_APP_ID');
    if (!s.installationId) out.push('GITHUB_APP_INSTALLATION_ID');
    if (!s.privateKey) out.push('GITHUB_APP_PRIVATE_KEY');
  }
  if (need === 'web' || need === 'orcid') {
    if (!s.clientId) out.push('GITHUB_CLIENT_ID');
    if (!s.clientSecret) out.push('GITHUB_CLIENT_SECRET');
  }
  if (need === 'orcid') {
    if (!s.orcidClientId) out.push('ORCID_CLIENT_ID');
    if (!s.orcidClientSecret) out.push('ORCID_CLIENT_SECRET');
  }
  for (const name of UNUSABLE[need]) if (s.invalid.includes(name)) out.push(name);
  return [...new Set(out)];
}
