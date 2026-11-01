// Rehearses the submission queue end to end on this machine, in a real browser: the website's form, the Worker and a mock GitHub.
// Nothing real is touched: no GitHub account, no network. It is the scripted version of the rehearsal that connector/DEPLOY.md asks for.
//
// You need three things running (see connector/README.md, "Queue"):
//   1. the mock GitHub        npm --prefix connector run mock-github      (http://127.0.0.1:8788)
//   2. the Worker             npm --prefix connector run dev              (http://127.0.0.1:8787), with SITE_ORIGIN and ALLOWED_ORIGINS set to SITE
//   3. a build of the website made with the Worker's address and the switches on, and served at SITE:
//        PUBLIC_QUEUE_API=http://127.0.0.1:8787 PUBLIC_SUBMISSIONS_OPEN=true PUBLIC_CONNECTOR_STATUS=live \
//          npx astro build --outDir /tmp/openislet-e2e && npx astro preview --outDir /tmp/openislet-e2e --port 4501 --host 127.0.0.1
//
//   SITE=http://127.0.0.1:4501 node e2e-submit.mjs
//
// Each scenario prints PASS or FAIL, and the script exits 1 if any failed.
import puppeteer from 'puppeteer-core';

const SITE = process.env.SITE ?? 'http://127.0.0.1:4501';
const WORKER = process.env.WORKER ?? 'http://127.0.0.1:8787';
const MOCK = process.env.MOCK ?? 'http://127.0.0.1:8788';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Each run's drafts are new: the connector posts one issue per IIP and remembers it for a day, so last run's text would only
// get last run's answer back.
const RUN = Date.now().toString(36).slice(-6);
const draft = (title) => `# ${title} (run ${RUN})
**Type:** Problem found
**Claim in one sentence:** The B2M promoter may give too little CD47 on resting beta cells in the first hours after transplant.
**In plain English:** The new cells may carry too little of the signal that tells macrophages to leave them alone. If so, the first hours are risky for them. (Ping @someone-real here: this must not notify anyone.)
**Affects test:** 3, because macrophages attack in the first hours
**Affects design:** Design A
## Evidence
- Example paper, PMID 12345678, "The exact sentence from the paper goes here, copied word for word."
## What I propose changing
Measure CD47 at hour zero before relying on the B2M promoter, and add a steady promoter if it is too low.
## How this could be wrong
Inflammation in the first hours may raise B2M enough to make up for it.
## Cheapest way to check it
Count CD47 molecules on resting and inflamed edited cells with calibrated flow cytometry.
## AI tools used
Example model (High Effort)`;

const review = (verdict = 'Partly supported') => `# Review: Too little CD47 at hour zero?
**Claim reviewed:** The B2M promoter may give too little CD47 on resting beta cells in the first hours after transplant.
**Verdict:** ${verdict}
**Confidence:** Medium
**Submit to OpenIslet?** ${verdict.startsWith('Not') ? 'No' : 'Yes'}
**In plain English:** The idea is reasonable, but it depends on how much B2M is made in resting cells, which the paper cited does not measure directly.
## What I checked
I read the claim against the blueprint and the cited paper.
## Evidence for
- The cited paper shows B2M is low in resting cells.
## Evidence against
- Inflammation raises B2M quickly.
## Idea Graveyard check
It is close to rule GY-009 and does not contradict it.
## Other ways it could fail
The effect may be too small to matter.
## Cheapest way to settle it
Measure CD47 on resting and inflamed cells.
## AI tools used
Another example model (Max Effort)`;

const results = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

// `expected` lists console errors that the scenario causes on purpose (a faked 502, for example), so only surprises fail it.
async function scenario(name, run, expected = []) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`script error: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && !expected.some((re) => re.test(message.text())) && problems.push(`console error: ${message.text()}`));
  try {
    await run(page, context);
    if (problems.length) throw new Error(problems.join('; '));
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, why: error.message });
    console.log(`FAIL  ${name}\n      ${error.message}`);
  } finally {
    await context.close();
  }
}

const mockIssues = async () => (await (await fetch(`${MOCK}/_mock/issues`)).json());
const issueList = (payload) => (Array.isArray(payload) ? payload : payload.issues ?? []);
const text = async (page, selector) => page.$eval(selector, (el) => el.innerText);
const type = async (page, selector, value) => {
  await page.$eval(selector, (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};
const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};

// Start every scenario from a clean mock.
await fetch(`${MOCK}/_mock/reset`, { method: 'POST' }).catch(() => {});

await scenario('copy-and-paste user: form, GitHub, public issue', async (page) => {
  await page.goto(`${SITE}/submit`, { waitUntil: 'networkidle0' });
  expect((await page.$eval('#go-btn', (b) => b.getAttribute('aria-disabled'))) === 'false', 'the final button is switched off: build the site with PUBLIC_SUBMISSIONS_OPEN=true');
  await type(page, '#draft', draft('E2E: too little CD47 at hour zero?'));
  await type(page, '#review', review());
  await type(page, '#name', 'Example Tester');
  await type(page, '#orcid', '0000-0002-1825-0097');
  await type(page, '#x', '@example_tester');
  await page.click('#check-btn');
  await page.waitForFunction(() => /basic rules/i.test(document.getElementById('status').innerText) || !document.getElementById('problems').hidden, { timeout: 15000 });
  expect(await page.$eval('#problems', (el) => el.hidden), `Check my files reported problems: ${await text(page, '#problems')}`);
  await page.click('#consent');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }), page.click('#go-btn')]);
  await page.waitForFunction(() => /Thank you|could not|can.t finish|expired/i.test(document.getElementById('result')?.innerText ?? ''), { timeout: 20000 });
  const outcome = await text(page, '#result');
  expect(/Thank you\. Your IIP is public/.test(outcome), `the confirmation page said: ${outcome.slice(0, 200)}`);
  const [issue] = issueList(await mockIssues()).slice(-1);
  expect(issue, 'the mock GitHub received no issue');
  const body = JSON.stringify(issue);
  expect(/E2E: too little CD47/.test(body), 'the issue has the wrong title');
  expect(/\[IIP\] E2E/.test(body), 'the issue title does not start with [IIP]');
  expect(/IIP-\d{4,}/.test(outcome), `the confirmation page did not show the record id (IIP-0001 and so on): ${outcome.slice(0, 200)}`);
  expect(/verified through GitHub/.test(body), 'the issue does not say who submitted it');
  expect(/0000-0002-1825-0097/.test(body) && /example_tester/.test(body), 'the stated ORCID iD and X handle are missing from the issue');
  expect(!/(^|[^​])@someone-real/.test(String(issue.body ?? body).replace(/\\u200b/g, '​')), 'an @mention in the draft was not defanged');
});

// What people really paste: the AI's whole reply (its words, the draft in a code block, then the prompt for the fresh chat in a second
// one), and a review copied out of the chat as formatted text, with the # and ** marks lost.
const paste = async (page, selector, value) => {
  await page.$eval(selector, (el, v) => {
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('paste', { bubbles: true }));
  }, value);
  await new Promise((r) => setTimeout(r, 300));
};
const asRendered = (md) => md.split('\n').map((l) => l.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').replace(/^- /, '')).join('\n');

await scenario('the AI’s whole replies, pasted as they come, become a clean public issue', async (page) => {
  await page.goto(`${SITE}/submit`, { waitUntil: 'networkidle0' });
  const file = draft('E2E: a whole reply pasted');
  const reply = `Here's your Islet Improvement Proposal. I've saved it as openislet-iip-cd47.md.\n\n\`\`\`markdown\n${file}\n\`\`\`\n\n**FRESH-CHAT PROMPT**\n\n\`\`\`\nYou are a blind reviewer for OpenIslet. [OPENISLET-REVIEW-v1]\n\nCLAIM TO TEST\nThe B2M promoter may give too little CD47.\n\nHow to review:\n1. Restate the claim.\n\`\`\`\n\nWould you like me to change anything?`;
  await paste(page, '#draft', reply);
  await paste(page, '#review', `I've reviewed the claim. Here it is:\n\n${asRendered(review())}`);
  const notes = await page.evaluate(() => [document.getElementById('draft-note').innerText, document.getElementById('review-note').innerText]);
  expect(/kept just the draft/.test(notes[0]), `the draft note said: ${notes[0]}`);
  expect(/Partly supported/.test(notes[1]), `the review note said: ${notes[1]}`);
  expect((await page.$eval('#draft', (el) => el.value)) === file, 'the draft box does not hold just the draft');
  await page.click('#consent');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }), page.click('#go-btn')]);
  await page.waitForFunction(() => /Thank you|could not|can.t finish|expired/i.test(document.getElementById('result')?.innerText ?? ''), { timeout: 20000 });
  expect(/Thank you\. Your IIP is public/.test(await text(page, '#result')), 'the confirmation page did not confirm');
  const [issue] = issueList(await mockIssues()).slice(-1);
  const body = String(issue?.body ?? '');
  expect(/a whole reply pasted/.test(issue?.title ?? ''), 'the issue has the wrong title');
  expect(!/Here's your|Would you like|CLAIM TO TEST|```/.test(body), 'the AI’s chatter, the fresh-chat prompt or a code fence reached the public issue');
  expect(/\*\*Verdict:\*\* Partly supported/.test(body), 'the review was not posted in the template’s own Markdown');
});

await scenario('a review that does not support the IIP is stopped before GitHub', async (page) => {
  const before = issueList(await mockIssues()).length;
  await page.goto(`${SITE}/submit`, { waitUntil: 'networkidle0' });
  await type(page, '#draft', draft('E2E: unsupported'));
  await type(page, '#review', review('Not supported'));
  await page.click('#consent');
  await page.click('#go-btn');
  await page.waitForFunction(() => !document.getElementById('problems').hidden, { timeout: 15000 });
  expect(/Supported or Partly supported/.test(await text(page, '#problems')), 'the problem list does not explain the verdict rule');
  expect(new URL(page.url()).pathname === '/submit', 'the form left the page');
  expect(issueList(await mockIssues()).length === before, 'an issue was opened for a refused IIP');
});

await scenario('one-click link from the connector pre-fills the form, then posts', async (page) => {
  const staged = await (await fetch(`${WORKER}/api/stage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draft: draft('E2E: staged by the connector'), review: review(), consent: true, contributor: { name: 'Link User' } }),
  })).json();
  expect(staged.staged_id && staged.form_url, `the Worker did not stage the draft: ${JSON.stringify(staged).slice(0, 200)}`);
  const url = new URL(staged.form_url);
  await page.goto(`${SITE}/submit${url.hash}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.getElementById('draft').value.length > 100, { timeout: 15000 });
  expect(/E2E: staged by the connector/.test(await page.$eval('#draft', (el) => el.value)), 'the form was not pre-filled');
  expect((await page.$eval('#name', (el) => el.value)) === 'Link User', 'the display name was not pre-filled');
  await page.click('#consent');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }), page.click('#go-btn')]);
  await page.waitForFunction(() => /Thank you|could not|can.t finish|expired/i.test(document.getElementById('result')?.innerText ?? ''), { timeout: 20000 });
  expect(/Thank you\. Your IIP is public/.test(await text(page, '#result')), `the confirmation page said: ${(await text(page, '#result')).slice(0, 200)}`);
  expect(/staged by the connector/.test(JSON.stringify(issueList(await mockIssues()).slice(-1))), 'the staged IIP did not become an issue');
});

await scenario('finishing the sign-in in another browser is refused safely', async (page) => {
  const before = issueList(await mockIssues()).length;
  await page.goto(`${SITE}/submit/finish?code=made-up&state=made-up`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => /different browser or tab/.test(document.getElementById('result').innerText), { timeout: 10000 });
  expect(issueList(await mockIssues()).length === before, 'an issue was opened without a sign-in');
});

await scenario('cancelling on GitHub leads back to the form with the files kept', async (page) => {
  await page.goto(`${SITE}/submit/finish?error=access_denied&state=made-up`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => /chose not to sign in/.test(document.getElementById('result').innerText), { timeout: 10000 });
  expect(await page.$eval('#result a', (a) => a.getAttribute('href').startsWith('/submit')), 'no way back to the form');
});

await scenario('a double click on the final button starts one sign-in, not two (FRESH-WEB-B05)', async (page) => {
  const before = issueList(await mockIssues()).length;
  const begins = [];
  // Only the real request counts: the browser's own permission check before it (an OPTIONS request) is not a second try.
  page.on('request', (request) => request.url().endsWith('/api/begin') && request.method() === 'POST' && begins.push(request.url()));
  await page.goto(`${SITE}/submit`, { waitUntil: 'networkidle0' });
  await type(page, '#draft', draft('E2E: double click'));
  await type(page, '#review', review());
  await page.click('#consent');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }), page.click('#go-btn', { count: 2, delay: 0 })]);
  await page.waitForFunction(() => /Thank you|could not|can.t finish|expired/i.test(document.getElementById('result')?.innerText ?? ''), { timeout: 20000 });
  expect(/Thank you\. Your IIP is public/.test(await text(page, '#result')), `the confirmation page said: ${(await text(page, '#result')).slice(0, 200)}`);
  expect(begins.length === 1, `the form asked to begin ${begins.length} times`);
  expect(issueList(await mockIssues()).length === before + 1, 'a double click opened more than one issue');
});

await scenario('the button is really switched off while the sign-in is set up (FRESH-WEB-B05)', async (page) => {
  await page.goto(`${SITE}/submit`, { waitUntil: 'networkidle0' });
  await type(page, '#draft', draft('E2E: disabled'));
  await type(page, '#review', review());
  await page.click('#consent');
  // Stop the begin request so the button stays in its busy state long enough to look at.
  await page.setRequestInterception(true);
  page.on('request', (request) => (request.url().endsWith('/api/begin') ? undefined : request.continue()));
  await page.evaluate(() => document.getElementById('go-btn').click());
  const state = await page.evaluate(() => {
    const b = document.getElementById('go-btn');
    return { disabled: b.disabled, busy: b.getAttribute('aria-busy') };
  });
  expect(state.disabled === true && state.busy === 'true', `the button was not switched off while working: ${JSON.stringify(state)}`);
});

await scenario('files from the connector link never overwrite what the person typed meanwhile (FRESH-WEB-B05)', async (page) => {
  const staged = await (await fetch(`${WORKER}/api/stage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draft: draft('E2E: staged late'), review: review(), consent: true }),
  })).json();
  expect(staged.staged_id, 'the Worker did not stage the draft');
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    if (request.url().includes('/api/staged/')) await new Promise((resolve) => setTimeout(resolve, 2500)); // a slow answer
    request.continue();
  });
  await page.goto(`${SITE}/submit#staged=${staged.staged_id}`, { waitUntil: 'domcontentloaded' });
  await type(page, '#draft', 'My own words, typed while the files were still on their way.');
  await page.waitForFunction(() => /left your text alone|Your AI.s files|expired|cannot be used/.test(document.getElementById('from-link').innerText), { timeout: 20000 });
  expect(/left your text alone/.test(await text(page, '#from-link')), `the note said: ${await text(page, '#from-link')}`);
  expect((await page.$eval('#draft', (el) => el.value)) === 'My own words, typed while the files were still on their way.', 'the typed words were overwritten');
  expect((await page.$eval('#review', (el) => el.value)) === '', 'the review box was filled in over the person’s own text');
});

await scenario('a browser that blocks storage is told so before it is sent to GitHub (FRESH-WEB-B06)', async (page) => {
  const begins = [];
  page.on('request', (request) => request.url().endsWith('/api/begin') && request.method() === 'POST' && begins.push(request.url()));
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await page.goto(`${SITE}/submit`, { waitUntil: 'networkidle0' });
  expect(await page.$eval('#storage-warning', (el) => !el.hidden && /not letting this page keep/.test(el.textContent)), 'no warning about blocked storage on the form');
  await type(page, '#draft', draft('E2E: blocked storage'));
  await type(page, '#review', review());
  await page.click('#consent');
  await page.click('#go-btn');
  await page.waitForFunction(() => !document.getElementById('problems').hidden, { timeout: 10000 });
  expect(/not letting this page keep/.test(await text(page, '#problems')), 'the problem list does not explain the blocked storage');
  expect(new URL(page.url()).pathname === '/submit', 'the form left the page');
  expect(begins.length === 0, 'a sign-in was started although the secret could not be kept');
});

await scenario('when GitHub does not answer in time the page says it is not sure, and points to the public queue (FRESH-WEB-B02)', async (page) => {
  const before = issueList(await mockIssues()).length;
  const cors = { 'access-control-allow-origin': SITE, 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (!request.url().endsWith('/api/complete')) return request.continue();
    if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers: cors });
    // What the Worker sends when the request to open the issue went out and no clear answer came back.
    return request.respond({
      status: 502,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({
        error: 'github_unavailable',
        message: 'GitHub did not answer in time, so we can’t be sure whether your IIP was posted. Please look at the public queue before you try again: https://github.com/openislet/openislet/issues.',
        outcome_unknown: true,
        queue_url: 'https://github.com/openislet/openislet/issues',
      }),
    });
  });
  await page.goto(`${SITE}/submit`, { waitUntil: 'networkidle0' });
  await type(page, '#draft', draft('E2E: lost answer'));
  await type(page, '#review', review());
  await page.click('#consent');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }), page.click('#go-btn')]);
  await page.waitForFunction(() => /not sure|Thank you|could not|can.t finish|expired/i.test(document.getElementById('result')?.innerText ?? ''), { timeout: 20000 });
  const outcome = await text(page, '#result');
  expect(/We.re not sure your IIP was posted/.test(outcome), `the page said: ${outcome.slice(0, 200)}`);
  expect(!/nothing was posted|could not post your IIP/i.test(outcome), 'the page still claims that nothing was posted');
  expect(await page.$eval('#result a', (a) => a.getAttribute('href') === 'https://github.com/openislet/openislet/issues'), 'the first link is not the public queue');
  expect((await page.$$eval('#result a', (links) => links.some((a) => (a.getAttribute('href') ?? '').startsWith('/submit')))), 'no way back to the form');
  expect(issueList(await mockIssues()).length === before, 'an issue was opened although the answer was faked');
}, [/status of 502/]);

await scenario('a connection lost while finishing keeps the sign-in, and Try again posts the IIP once', async (page) => {
  const before = issueList(await mockIssues()).length;
  let dropped = 0;
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    // The first finish request never gets an answer, as when the wifi drops; everything after goes through.
    if (request.url().endsWith('/api/complete') && request.method() === 'POST' && dropped === 0) {
      dropped++;
      return request.abort('internetdisconnected');
    }
    return request.continue();
  });
  await page.goto(`${SITE}/submit`, { waitUntil: 'networkidle0' });
  await type(page, '#draft', draft('E2E: connection lost while finishing'));
  await type(page, '#review', review());
  await page.click('#consent');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }), page.click('#go-btn')]);
  await page.waitForFunction(() => /lost the connection/i.test(document.getElementById('result')?.innerText ?? ''), { timeout: 20000 });
  const lost = await text(page, '#result');
  expect(/never posts your IIP twice/.test(lost), `the page said: ${lost.slice(0, 200)}`);
  expect(issueList(await mockIssues()).length === before, 'an issue was opened although the request never left the browser');
  await page.click('#result button');
  await page.waitForFunction(() => /Thank you|could not|expired/i.test(document.getElementById('result')?.innerText ?? ''), { timeout: 20000 });
  const done = await text(page, '#result');
  expect(/Thank you\. Your IIP is public\./.test(done), `after Try again the page said: ${done.slice(0, 200)}`);
  expect(issueList(await mockIssues()).length === before + 1, 'Try again did not post exactly one issue');
}, [/ERR_INTERNET_DISCONNECTED/]);

await scenario('an answer cut off after the IIP was posted keeps the sign-in, and Try again shows the IIP, still one issue', async (page) => {
  const before = issueList(await mockIssues()).length;
  const cors = { 'access-control-allow-origin': SITE, 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
  let cut = 0;
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    if (!request.url().endsWith('/api/complete') || cut > 0) return request.continue();
    if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers: cors });
    // The Worker gets the request and posts the IIP, but its answer reaches the browser cut short.
    cut++;
    const real = await fetch(request.url(), { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: request.postData() });
    const whole = await real.text();
    return request.respond({ status: real.status, contentType: 'application/json', headers: cors, body: whole.slice(0, 20) });
  });
  await page.goto(`${SITE}/submit`, { waitUntil: 'networkidle0' });
  await type(page, '#draft', draft('E2E: answer cut off'));
  await type(page, '#review', review());
  await page.click('#consent');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }), page.click('#go-btn')]);
  await page.waitForFunction(() => /lost the connection|Thank you|could not/i.test(document.getElementById('result')?.innerText ?? ''), { timeout: 20000 });
  const lost = await text(page, '#result');
  expect(/was cut off/.test(lost) && /never posts your IIP twice/.test(lost), `the page said: ${lost.slice(0, 200)}`);
  expect(!/could not post your IIP/i.test(lost), 'the page claims the IIP was not posted');
  expect(issueList(await mockIssues()).length === before + 1, 'the Worker did not post the IIP behind the cut-off answer');
  await page.click('#result button');
  await page.waitForFunction(() => /Thank you|could not|expired/i.test(document.getElementById('result')?.innerText ?? ''), { timeout: 20000 });
  const done = await text(page, '#result');
  expect(/Thank you\. Your IIP is public\./.test(done), `after Try again the page said: ${done.slice(0, 200)}`);
  expect(issueList(await mockIssues()).length === before + 1, 'Try again opened a second issue');
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} scenarios passed.`);
process.exit(failed.length ? 1 : 0);
