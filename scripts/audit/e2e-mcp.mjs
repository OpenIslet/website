// Rehearses the MCP route end to end, for real: an MCP client (the SDK an AI app uses) talks to the Worker over HTTP, and a real
// browser does the person's part (the connector's approval page, GitHub's sign-in, the pre-filled form). Nothing is in-process.
// It needs the same three servers as e2e-submit.mjs (the mock GitHub, the Worker, and the website built with the switches on).
//
//   SITE=http://127.0.0.1:4501 node e2e-mcp.mjs
//
// Each scenario prints PASS or FAIL, and the script exits 1 if any failed.
import puppeteer from 'puppeteer-core';

const SITE = process.env.SITE ?? 'http://127.0.0.1:4501';
const WORKER = process.env.WORKER ?? 'http://127.0.0.1:8787';
const MOCK = process.env.MOCK ?? 'http://127.0.0.1:8788';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER = `${WORKER}/mcp`;
const REDIRECT = 'http://localhost:53999/cb';
const { Client, StreamableHTTPClientTransport, auth } = await import(new URL('../../connector/node_modules/@modelcontextprotocol/client/dist/index.mjs', import.meta.url).href);

// Each run's drafts are new: the connector posts one issue per IIP and remembers it for a day, so last run's text would only
// get last run's answer back.
const RUN = Date.now().toString(36).slice(-6);
const draft = (title) => `# ${title} (run ${RUN})
**Type:** Problem found
**Claim in one sentence:** The B2M promoter may give too little CD47 on resting beta cells in the first hours after transplant.
**In plain English:** The new cells may carry too little of the signal that tells macrophages to leave them alone. If so, the first hours are risky for them.
**Affects test:** 3, because macrophages attack in the first hours
**Affects design:** Design A
## Evidence
- Example paper, PMID 12345678, "The exact sentence from the paper goes here, copied word for word."
## What I propose changing
Measure CD47 at hour zero before relying on the B2M promoter.
## How this could be wrong
Inflammation in the first hours may raise B2M enough to make up for it.
## Cheapest way to check it
Count CD47 molecules on resting and inflamed edited cells.
## AI tools used
Example model (High Effort)`;
const review = (verdict = 'Partly supported') => `# Review: Too little CD47 at hour zero?
**Claim reviewed:** The B2M promoter may give too little CD47 on resting beta cells in the first hours after transplant.
**Verdict:** ${verdict}
**Confidence:** Medium
**Submit to OpenIslet?** ${verdict.startsWith('Not') ? 'No' : 'Yes'}
**In plain English:** The idea is reasonable, but it depends on how much B2M is made in resting cells.
## What I checked
The claim against the blueprint and the cited paper.
## Evidence for
- B2M is low in resting cells.
## Evidence against
- Inflammation raises B2M quickly.
## Idea Graveyard check
Close to GY-009, not in conflict.
## Other ways it could fail
The effect may be too small to matter.
## Cheapest way to settle it
Measure CD47 on resting and inflamed cells.
## AI tools used
Another example model (Max Effort)`;
/** The AI's whole reply, as a person copies it: its words, the draft in a code block, and the prompt for the fresh chat in another. */
const wholeReply = (file) => `Here's your IIP.\n\n\`\`\`markdown\n${file}\n\`\`\`\n\n**FRESH-CHAT PROMPT**\n\n\`\`\`\nYou are a blind reviewer. CLAIM TO TEST\nx\nHow to review:\n1. Restate the claim.\n\`\`\`\n\nAnything else?`;

const results = [];
const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};
async function scenario(name, run) {
  try {
    await run();
    results.push(true);
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}
const text = (r) => (r.content ?? []).map((c) => c.text ?? '').join('\n');
const connect = async (authProvider) => {
  const client = new Client({ name: 'OpenIslet MCP rehearsal', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(SERVER), authProvider ? { authProvider } : undefined));
  return client;
};
const issues = async () => {
  const payload = await (await fetch(`${MOCK}/_mock/issues`)).json();
  return Array.isArray(payload) ? payload : payload.issues ?? [];
};
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

await scenario('the tools and prompts are there, and the prompts are the current ones (IIP, not "finding")', async () => {
  const client = await connect();
  const tools = (await client.listTools()).tools.map((t) => t.name);
  for (const t of ['check_draft', 'submit_proposal', 'get_submission_status', 'get_blueprint_overview']) expect(tools.includes(t), `missing tool ${t}`);
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  for (const p of ['draft_a_proposal', 'blind_review', 'submit_my_proposal']) expect(prompts.includes(p), `missing prompt ${p}`);
  const drafting = (await client.getPrompt({ name: 'draft_a_proposal', arguments: {} })).messages.map((m) => m.content.text).join('\n');
  expect(/openislet-iip-\[short-title\]\.md/.test(drafting) && !/openislet-finding-/.test(drafting), 'the drafting prompt is out of date: reseed the local bundle (npm --prefix connector run seed) and restart the Worker');
  await client.close();
});

await scenario('check_draft reads the AI’s whole reply and says the files meet the basic rules', async () => {
  const client = await connect();
  const r = await client.callTool({ name: 'check_draft', arguments: { draft: wholeReply(draft('MCP: check a whole reply')), review: review(), consent: true } });
  expect(!r.isError, text(r).slice(0, 300));
  expect(r.structuredContent?.ready === true, `not ready: ${(r.structuredContent?.what_to_fix ?? []).join(' | ').slice(0, 300)}`);
  await client.close();
});

await scenario('eight tool calls at once all answer (four work at a time, the rest wait their turn)', async () => {
  const client = await connect();
  const words = ['macrophage', 'beta', 'CD47', 'hypoxia', 'insulin', 'B2M', 'oxygen', 'vascular'];
  const answers = await Promise.allSettled(words.map((query) => client.callTool({ name: 'search_studies', arguments: { query } })));
  const failed = answers.filter((a) => a.status === 'rejected' || a.value.isError);
  const first = failed[0];
  expect(!failed.length, `${failed.length} of 8 failed: ${first ? (first.status === 'rejected' ? first.reason?.message : text(first.value)).slice(0, 200) : ''}`);
  await client.close();
});

await scenario('a review that does not support the IIP is refused, with the reason', async () => {
  const client = await connect();
  const r = await client.callTool({ name: 'submit_proposal', arguments: { draft: draft('MCP: refused'), review: review('Not supported'), consent: true } });
  expect(r.structuredContent?.submitted === false && r.structuredContent?.reason === 'basic_rules', JSON.stringify(r.structuredContent).slice(0, 300));
  expect(/Not supported/.test(text(r)), 'the answer does not say why');
  await client.close();
});

await scenario('not signed in: the one-click link opens the form filled in, and GitHub posts it', async () => {
  const client = await connect();
  const before = (await issues()).length;
  const r = await client.callTool({ name: 'submit_proposal', arguments: { draft: wholeReply(draft('MCP: by the link')), review: review(), consent: true, idempotency_key: `link-${Date.now()}` } });
  await client.close();
  const link = r.structuredContent?.form_url;
  expect(r.structuredContent?.reason === 'sign_in_needed' && typeof link === 'string' && link.startsWith(`${SITE}/submit#staged=`), `no link: ${text(r).slice(0, 300)}`);
  expect(text(r).includes(link), 'the answer does not show the link itself');
  const page = await browser.newPage();
  await page.goto(link, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => /filled this in/.test(document.getElementById('from-link').innerText), { timeout: 20000 });
  expect((await page.$eval('#draft', (el) => el.value)).startsWith('# MCP: by the link'), 'the form does not hold just the draft');
  await page.click('#consent');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }), page.click('#go-btn')]);
  await page.waitForFunction(() => /Thank you|could not|expired/i.test(document.getElementById('result')?.innerText ?? ''), { timeout: 20000 });
  expect(/Your IIP is public/.test(await page.$eval('#result', (el) => el.innerText)), 'the confirmation page did not confirm');
  await page.close();
  const after = await issues();
  expect(after.length === before + 1 && /MCP: by the link/.test(after[after.length - 1].title), 'no new issue at the mock GitHub');
  expect(/"via":"mcp_link"/.test(after[after.length - 1].body) && !/Here's your|```/.test(after[after.length - 1].body), 'the issue is not marked as from the link, or carries the AI’s chatter');
});

class Provider {
  info;
  tokenSet;
  verifier = '';
  disc;
  authUrl;
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata() {
    return { client_name: 'OpenIslet MCP rehearsal', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'submit' };
  }
  async clientInformation() {
    return this.info;
  }
  async saveClientInformation(i) {
    this.info = i;
  }
  async tokens() {
    return this.tokenSet;
  }
  async saveTokens(t) {
    this.tokenSet = t;
  }
  async redirectToAuthorization(url) {
    this.authUrl = url;
  }
  async saveCodeVerifier(v) {
    this.verifier = v;
  }
  async codeVerifier() {
    return this.verifier;
  }
  async saveDiscoveryState(d) {
    this.disc = d;
  }
  async discoveryState() {
    return this.disc;
  }
}

/** The person's part of the sign-in: the approval page, then GitHub. Returns where the browser was sent back to. */
async function approve(provider, button) {
  const page = await browser.newPage();
  let back = null;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().startsWith(REDIRECT)) {
      back = new URL(req.url());
      req.respond({ status: 200, contentType: 'text/plain', body: 'back in the app' });
    } else req.continue();
  });
  await page.goto(provider.authUrl.href, { waitUntil: 'networkidle0' });
  const words = await page.evaluate(() => document.body.innerText);
  expect(/sign in with GitHub next/i.test(words) && /public issue that names you/i.test(words), 'the approval page does not say what happens and what becomes public');
  for (const b of await page.$$('button')) {
    if (new RegExp(button, 'i').test(await b.evaluate((x) => x.textContent))) {
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {}), b.click()]);
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
  await page.close();
  return back;
}

await scenario('signing in through the connector (approval page, GitHub), then submit_proposal posts at once', async () => {
  const provider = new Provider();
  expect((await auth(provider, { serverUrl: SERVER })) === 'REDIRECT' && provider.authUrl, 'the connector did not offer a sign-in');
  const back = await approve(provider, 'Continue with GitHub');
  expect(back?.searchParams.get('code'), `no code came back: ${back}`);
  expect((await auth(provider, { serverUrl: SERVER, authorizationCode: back.searchParams.get('code'), iss: back.searchParams.get('iss') ?? undefined })) === 'AUTHORIZED', 'the code was not turned into a token');
  const client = await connect(provider);
  const r = await client.callTool({ name: 'submit_proposal', arguments: { draft: draft('MCP: signed in'), review: review(), consent: true, idempotency_key: `signed-${Date.now()}` } });
  expect(r.structuredContent?.submitted === true && /^IIP-\d{4,}$/.test(r.structuredContent?.record_id ?? ''), `not posted: ${text(r).slice(0, 300)}`);
  const status = await client.callTool({ name: 'get_submission_status', arguments: { id: r.structuredContent.record_id } });
  // A new IIP is not in OpenIslet's record until the weekly update: the answer says so and links its public page.
  expect(!status.isError && /record yet/.test(text(status)) && text(status).includes(`/issues/${Number(r.structuredContent.record_id.slice(4))}`), `the status lookup did not point to the new IIP: ${text(status).slice(0, 200)}`);
  await client.close();
  const [issue] = (await issues()).slice(-1);
  expect(/MCP: signed in/.test(issue.title) && /"via":"mcp_signed_in"/.test(issue.body), 'the issue at the mock GitHub is not the signed-in one');
});

await scenario('pressing Cancel on the approval page goes back to the app, and nothing is shared', async () => {
  const provider = new Provider();
  await auth(provider, { serverUrl: SERVER });
  const back = await approve(provider, 'Cancel');
  expect(back?.searchParams.get('error') === 'access_denied', `Cancel did not return access_denied: ${back}`);
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed} of ${results.length} scenarios passed.`);
process.exit(passed === results.length ? 0 : 1);
