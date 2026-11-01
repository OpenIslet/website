// The GitHub module: sign-in code exchange, who signed in, the bot's signed token, and opening an issue. Over a fake GitHub.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GitHubClient, GitHubError, type GitHubSettings, type TokenCache, pemToDer } from '../src/core/queue/github';
import { Clock, FakeGitHub, makeAppKey } from './queue-fakes';

let pem = '';
let publicKey: CryptoKey;
beforeAll(async () => {
  ({ pem, publicKey } = await makeAppKey());
});

let clock: Clock;
let gh: FakeGitHub;
let cache: TokenCache;
const settings = (over: Partial<GitHubSettings> = {}): GitHubSettings => ({
  webBase: gh.web,
  apiBase: gh.api,
  clientId: gh.clientId,
  clientSecret: gh.clientSecret,
  appId: gh.appId,
  installationId: gh.installationId,
  privateKey: pem,
  owner: 'openislet',
  repo: 'openislet',
  ...over,
});
const client = (over: Partial<GitHubSettings> = {}) => new GitHubClient(settings(over), cache, gh.fetch, clock.now);

beforeEach(() => {
  clock = new Clock();
  gh = new FakeGitHub(clock);
  gh.publicKey = publicKey;
  cache = {};
});

const REDIRECT = 'https://openislet.org/submit/finish';

describe('the contributor signs in', () => {
  it('swaps a code for a token and reads who signed in', async () => {
    const code = gh.issueCode({ id: 1234, login: 'octo-cat' });
    const c = client();
    const token = await c.exchangeCode({ code, redirectUri: REDIRECT });
    expect(await c.getUser(token)).toEqual({ id: 1234, login: 'octo-cat' });
  });

  it('says "refused" for a code that was already used or never existed', async () => {
    const code = gh.issueCode({ id: 1, login: 'a' });
    const c = client();
    await c.exchangeCode({ code, redirectUri: REDIRECT });
    await expect(c.exchangeCode({ code, redirectUri: REDIRECT })).rejects.toMatchObject({ kind: 'refused' });
    await expect(c.exchangeCode({ code: 'nonsense', redirectUri: REDIRECT })).rejects.toMatchObject({ kind: 'refused' });
  });

  it('says "unavailable" when the fault is ours (wrong client secret) or GitHub is down', async () => {
    const code = gh.issueCode({ id: 1, login: 'a' });
    await expect(client({ clientSecret: 'wrong' }).exchangeCode({ code, redirectUri: REDIRECT })).rejects.toMatchObject({ kind: 'unavailable' });
    gh.failNext(/access_token/, 503, 'down');
    await expect(client().exchangeCode({ code, redirectUri: REDIRECT })).rejects.toMatchObject({ kind: 'unavailable' });
    gh.failNext(/access_token/, 429, {});
    await expect(client().exchangeCode({ code, redirectUri: REDIRECT })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('says "unavailable" when GitHub cannot be reached at all', async () => {
    const dead = new GitHubClient(settings(), cache, async () => { throw new TypeError('network down'); }, clock.now);
    await expect(dead.exchangeCode({ code: 'x', redirectUri: REDIRECT })).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(dead.getUser('t')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('sends the PKCE verifier when there is one, and GitHub checks it', async () => {
    const verifier = 'v'.repeat(43);
    const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const good = gh.issueCode({ id: 1, login: 'a' }, challenge);
    await expect(client().exchangeCode({ code: good, redirectUri: REDIRECT, codeVerifier: verifier })).resolves.toMatch(/^ghu_/);
    const bad = gh.issueCode({ id: 1, login: 'a' }, challenge);
    await expect(client().exchangeCode({ code: bad, redirectUri: REDIRECT, codeVerifier: 'w'.repeat(43) })).rejects.toMatchObject({ kind: 'refused' });
  });

  it('refuses a token GitHub does not know, and a profile it cannot read', async () => {
    await expect(client().getUser('ghu_unknown')).rejects.toMatchObject({ kind: 'refused' });
    const code = gh.issueCode({ id: 5, login: 'bad login!' });
    const c = client();
    const token = await c.exchangeCode({ code, redirectUri: REDIRECT });
    await expect(c.getUser(token)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('lets the user token go, and does not mind if that fails', async () => {
    const code = gh.issueCode({ id: 1, login: 'a' });
    const c = client();
    const token = await c.exchangeCode({ code, redirectUri: REDIRECT });
    await c.revokeUserToken(token);
    expect(gh.revoked).toEqual([token]);
    await expect(c.getUser(token)).rejects.toMatchObject({ kind: 'refused' });
    gh.failNext(/applications/, 500, {});
    await expect(c.revokeUserToken('anything')).resolves.toBeUndefined();
    const dead = new GitHubClient(settings(), cache, async () => { throw new Error('boom'); }, clock.now);
    await expect(dead.revokeUserToken('t')).resolves.toBeUndefined();
  });
});

describe('the bot', () => {
  it('proves it is the app with a signed token that GitHub accepts, and asks for the least it needs', async () => {
    const c = client();
    const issue = await c.createIssue({ title: 'T', body: 'B', labels: ['submission'] });
    expect(issue).toEqual({ number: 1, url: 'https://github.test/openislet/openislet/issues/1' });
    expect(gh.jwts).toHaveLength(1);
    expect(gh.mintBodies).toEqual([{ repositories: ['openislet'], permissions: { issues: 'write' } }]);
    expect(gh.newestIssue).toMatchObject({ title: 'T', body: 'B', labels: ['submission'] });
  });

  it('keeps the installation token between requests, and renews it five minutes before it expires', async () => {
    const c = client();
    await c.createIssue({ title: '1', body: '', labels: [] });
    await c.createComment(1, 'hello');
    await c.createIssue({ title: '2', body: '', labels: [] });
    expect(gh.mintBodies).toHaveLength(1);
    clock.advance(54 * 60); // 54 minutes: still more than five minutes left of the hour
    await c.createIssue({ title: '3', body: '', labels: [] });
    expect(gh.mintBodies).toHaveLength(1);
    clock.advance(2 * 60); // 56 minutes: inside the last five
    await c.createIssue({ title: '4', body: '', labels: [] });
    expect(gh.mintBodies).toHaveLength(2);
  });

  it('shares the cache between clients made later (one per request in the Worker)', async () => {
    await client().createIssue({ title: '1', body: '', labels: [] });
    await client().createIssue({ title: '2', body: '', labels: [] });
    expect(gh.mintBodies).toHaveLength(1);
  });

  it('asks for only one token when several requests start together', async () => {
    const c = client();
    await Promise.all([1, 2, 3].map((n) => c.createIssue({ title: String(n), body: '', labels: [] })));
    expect(gh.mintBodies).toHaveLength(1);
    expect(gh.issues).toHaveLength(3);
  });

  it('never makes one request wait on another: two at once each ask for their own token, and only finished ones are kept', async () => {
    const both = Promise.all([client(), client()].map((c, n) => c.createIssue({ title: String(n), body: '', labels: [] })));
    expect(Object.values(cache).some((v) => v instanceof Promise)).toBe(false);
    await both;
    expect(gh.mintBodies).toHaveLength(2);
    expect(gh.issues).toHaveLength(2);
    expect(Object.keys(cache).sort()).toEqual(['expiresAt', 'token']);
    await client().createIssue({ title: 'later', body: '', labels: [] });
    expect(gh.mintBodies).toHaveLength(2);
  });

  it("reads an account's name now by its ID, and says when GitHub no longer has it", async () => {
    gh.issueCode({ id: 1234, login: 'octo-cat' });
    gh.rename(1234, 'new-name');
    expect(await client().loginFor(1234)).toBe('new-name');
    expect(await client().loginFor(999)).toBeNull();
    gh.failNext(/GET .*\/user\/1234$/, 502, {});
    await expect(client().loginFor(1234)).rejects.toMatchObject({ kind: 'unavailable', outcomeUnknown: false });
  });

  it('replaces a token GitHub stops accepting, once, and repeats the request', async () => {
    const c = client();
    await c.createIssue({ title: '1', body: '', labels: [] });
    gh.installationTokens.clear(); // GitHub forgot it
    const second = await c.createIssue({ title: '2', body: '', labels: [] });
    expect(second.number).toBe(2);
    expect(gh.mintBodies).toHaveLength(2);
  });

  it('gives up with "unavailable" when GitHub keeps refusing the issue', async () => {
    gh.failNext(/issues$/, 500, {}, 2);
    await expect(client().createIssue({ title: '1', body: '', labels: [] })).rejects.toMatchObject({ kind: 'unavailable' });
    gh.failNext(/issues$/, 422, { message: 'Validation Failed' });
    await expect(client().createIssue({ title: '1', body: '', labels: [] })).rejects.toMatchObject({ kind: 'unavailable' });
    gh.failNext(/access_tokens/, 401, {});
    await expect(client({ installationId: gh.installationId }).createIssue({ title: '1', body: '', labels: [] })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('adds a comment to an issue, and fails clearly if it cannot', async () => {
    const c = client();
    const issue = await c.createIssue({ title: '1', body: '', labels: [] });
    await c.createComment(issue.number, '## Automatic checks');
    expect(gh.newestIssue.comments).toEqual(['## Automatic checks']);
    gh.failNext(/comments/, 500, {});
    await expect(c.createComment(issue.number, 'x')).rejects.toBeInstanceOf(GitHubError);
  });

  it('never puts a secret in an error message', async () => {
    const messages: string[] = [];
    const code = gh.issueCode({ id: 1, login: 'a' });
    const attempts: Promise<unknown>[] = [
      client({ clientSecret: 'super-secret-value-123' }).exchangeCode({ code, redirectUri: REDIRECT }),
      client({ privateKey: 'not a key' }).createIssue({ title: '', body: '', labels: [] }),
      client().getUser('ghu_secrettoken'),
    ];
    for (const a of attempts) await a.catch((e: Error) => messages.push(e.message));
    expect(messages).toHaveLength(3);
    for (const m of messages) {
      expect(m).not.toContain('super-secret-value-123');
      expect(m).not.toContain('ghu_secrettoken');
      expect(m).not.toContain('not a key');
      expect(m).not.toContain(gh.clientSecret);
    }
  });
});

describe('the app key', () => {
  it('reads a PKCS#8 key, including one pasted with "\\n" in place of line breaks', () => {
    const real = pemToDer(pem);
    expect(real.length).toBeGreaterThan(1000);
    expect(pemToDer(pem.trim().replace(/\n/g, '\\n'))).toEqual(real);
  });

  it('explains the old key format instead of failing mysteriously', () => {
    expect(() => pemToDer('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')).toThrow(/PKCS#8/);
    expect(() => pemToDer('hello')).toThrow(GitHubError);
    expect(() => pemToDer('-----BEGIN PRIVATE KEY-----\n!!!\n-----END PRIVATE KEY-----')).toThrow(GitHubError);
  });

  it('refuses bytes that are not an RSA key', async () => {
    const junk = `-----BEGIN PRIVATE KEY-----\n${btoa('this is not a key at all')}\n-----END PRIVATE KEY-----`;
    await expect(client({ privateKey: junk }).createIssue({ title: '', body: '', labels: [] })).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
