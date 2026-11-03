# The submission queue: how the website and the connector talk to each other

This is the contract between the website's pages (`/start`, `/submit`, `/submit/finish`, owned by the website code in `src/`) and the Worker (owned by `connector/src/`). Change both sides together.

## Details both sides rely on

- **Names.** What a contributor submits is an Islet Improvement Proposal (IIP). The MCP tool is `submit_proposal`, the MCP prompts are `draft_a_proposal` and `submit_my_proposal`, the issue title starts with `[IIP] `, and the draft file the prompt asks the AI to write is `openislet-iip-[short-title].md`. "Finding" means a result taken from a published study, in `search_studies`, `get_study` and `get_conflicting_evidence`.
- **Staged links.** `form_url` puts the staged id after a `#` (`<SITE_ORIGIN>/submit#staged=<id>`), so it is not in the page request or a `Referer`. The page then sends it to the connector in the path of `GET /api/staged/:id`. `/submit` reads it (or an older `?staged=<id>`), removes it from the address bar before anything else, and keeps it in memory for its retries. The finish page's way back uses `#staged=` too.
- **Retries.** A retried `POST /api/stage` (or unsigned `submit_proposal`) with the same `idempotency_key` gets the earlier link only when everything else matches too: both files, `ai_tools`, `contributor` and the wet-lab readouts, with `consent: true`. A retry that changes any of them stages a new submission, and one without consent gets `422 consent_needed`.
- **`POST /api/begin` returns `staged_id`**, the id of the staged submission it created (or reused, when the request carried a `staged_id` and changed nothing: see "A sign-in is tied to the exact files" below). The `/submit/finish` page uses it to send someone who cancels on GitHub back to the pre-filled form at `<SITE_ORIGIN>/submit#staged=<staged_id>`.
- **Pasted text is read as people really paste it.** People copy what their AI gave them: often the whole reply (the AI's own words, the draft in a code block, then the prompt for the fresh chat in a second code block, then "Would you like me to…"), or the file copied as formatted text, which loses the `#` and `**` marks. `connector/src/core/template.ts` (`cleanPaste`) finds the file inside any of that and gives it back in the template's own Markdown: it picks the code block that looks like a draft (or a review), never the reviewer prompt; drops the AI's words before the file, and after it when there were words before it too; and puts back a missing `# ` title, `**Name:**` labels (also "Verdict: x" not in bold) and `## ` sections (also `###` or bold headings). It adds marks and drops chatter around the file; it never changes the words inside it. The website's form (`src/scripts/submit.ts`) uses the same module, so the form and the Worker never disagree about a file.
  - The checks read the cleaned file, but look for keys and passwords in **everything** that was sent (a key pasted outside the file still stops it).
  - What is saved (`POST /api/stage`, `POST /api/begin`, `submit_proposal`) and posted in the issue is the cleaned file. `GET /api/staged/:id` returns the cleaned file.
  - The basic rules name two mix-ups for what they are: the reviewer prompt sent as the review ("This is the reviewer prompt… not the review it produces"), and the draft and the review the wrong way round.
- **`get_submission_status` for an IIP sent since the last weekly update** says the IIP is not in OpenIslet's record yet and links its public page (`data.found: false`, `data.queue_open: true`, `data.id`, `data.issue_url`). The link is built from `QUEUE_REPO` (and `GITHUB_WEB_BASE`), which the reading side also reads (`Config.queueIssues`).
- **A lost answer from GitHub never says "nothing was posted".** When the request to open the issue was sent and no clear answer came back (the connection dropped, it timed out, or GitHub answered with a server error, or with an answer that could not be read), `502 github_unavailable` also carries `outcome_unknown: true` and `queue_url` (the public queue's issue list), and its `message` says we can't be sure the IIP was posted and asks the person to look at the public queue before trying again. A failure before anything was sent to GitHub to open the issue (the sign-in, or getting the bot's token) says nothing was posted, and has neither field. The staged files are kept either way. `submit_proposal` shows the same in its answer (`data.outcome_unknown`, `data.queue_url`, and "Not confirmed" instead of "Not sent"). The website's `/submit/finish` shows "We're not sure your IIP was posted" with a link to the queue.
- **The marker covers the issue text.** `markerFields` ends with `body_sha256`: the SHA-256 (hex) of everything in the issue above the marker (who signed in, the stated name, the AI tools line, the draft, the review and any wet-lab block), with `\r\n` made `\n` and the end trimmed. It is inside the signature, so a genuine marker moved onto other text, a different GitHub name, or an issue edited after it was posted stops verifying. `connector/scripts/verify-marker.mjs` checks both the signature and this digest, and says which failed. `v` is `1`.
- **What the instant checks cover.** The checks run when an IIP is sent look at the format, the Idea Graveyard rules, and whether quotes match the studies OpenIslet already holds. They do not look papers up on PubMed or judge the science: a person does that in the weekly review. The comment, the tool descriptions and the answers say so.
- **Not built, on purpose:** no GitHub search before a retry, no rejection of JSON-RPC batch arrays on newer MCP protocol versions, no frozen-release registry. See "Limits to know" below.
- **More error codes**, all in the usual `{ error, message }` shape, for requests that cannot be read or are refused before any rule runs: `400 bad_request` (not JSON, wrong `content-type`, a field of the wrong type or too long; `field` names it), `413 payload_too_large`, `403 origin_not_allowed` (an `Origin` that is not in `ALLOWED_ORIGINS`: no CORS headers are sent and nothing runs), `403 host_not_allowed`, `404 not_found`, `405 method_not_allowed` (with an `Allow` header), `500 internal_error`. A `429` also carries a `Retry-After` header.
- **While `SUBMISSIONS_OPEN` is `false`**, every endpoint except `/api/check` answers `503 queue_not_open` (that includes `GET /api/staged/:id`, and a request whose body could not be read: the open check comes first), and nothing is read or written. `/api/check` still answers; while closed it has no rate limit and writes nothing. Once open, `/api/check` is rate limited and also needs `QUEUE_KV` and `STATE_SIGNING_KEY` (else `503 queue_not_configured`).
- **A repeated `POST /api/complete`** gets the first answer again for 24 hours (not only for the 15 minutes the sign-in itself lasts), if it carries the same binding secret. Any other secret gets `400 binding_mismatch`. A `state` whose first attempt failed (for example `github_refused`) stays used: the person presses the button again and gets a new one.
- **A sign-in is tied to the exact files it was started for.** If `POST /api/begin` carries a `staged_id` together with typed values that differ from what is saved (the draft, the review, the contributor details or the AI tools), the changed files are saved under a **new** `staged_id`, which the response returns, and the original stays as it was. An unchanged request reuses the id. So a sign-in already started on the old files cannot be changed from under it, and `POST /api/complete` answers `400 state_unknown` (before it spends the GitHub code) if the saved files no longer match what the sign-in was started for. A key or password shaped value in `contributor` or `idempotency_key` is refused with `422 basic_rules`, like one in the files.
- **Too large:** a draft or review over 60,000 characters is `400 bad_request` (`field`: `draft` or `review`). Two files that each pass the 30,000-character rule but cannot share one GitHub issue (64,000 characters, counting the escaping described below) are `422 basic_rules`, with a failed `size` entry in `door`.
- **Labels.** The issue gets every label `check_draft` reports (so also `possible-duplicate`, `stale-version`, `idea-graveyard-check` and `wetlab-readout` where they apply) plus `status:queued`. Design labels: `design:a`, `design:b`, `design:x`, `design:both` (A and B), `design:all-three`, `design:neither`. A list such as "Design A and Design X" gives `design:a` and `design:x`.
- **The marker.** `sig` is the lower-case hex of `HMAC-SHA-256(STATE_SIGNING_KEY, JSON.stringify({ v, idempotency_key, claim, pmids, via, body_sha256 }))`, with the keys in that order (`body_sha256` is described above). `idempotency_key` is `null` for an IIP typed on the form (the form has no key). `claim` is cut at 300 characters and `pmids` at 40. Inside the comment, `<`, `>` and `&` are written as the JSON escapes `\u003c`, `\u003e` and `\u0026`, so a claim can never close the comment. `connector/scripts/verify-marker.mjs` checks a marker for the weekly review.
- **The connector's sign-in is on only while `SUBMISSIONS_OPEN` is `true` and everything it needs is set up.** Otherwise `/authorize`, `/callback`, `/token` and `/register` answer `503`, the two `.well-known` documents answer `404`, and an `Authorization` header on `/mcp` is ignored (so closing the queue never breaks reading). Registering an app at `/register` is limited to 20 an hour per address. Opening the approval page (`GET /authorize`, which saves a short-lived record) is limited to 30 an hour per address, the person's own browser; past that it answers `429` with a plain page and `Retry-After`. A `POST` to any of the sign-in addresses may be at most 16 KB, and a form at most 50 fields; past that it answers `413` or `400` (`invalid_request`) before the sign-in library reads it. The approval page sets two cookies that last ten minutes at most, `__Host-oauth-consent-…` and `__Host-oauth-upstream-…`: that is the "one short-lived cookie" under Privacy.
- **ORCID** may also be given as `https://orcid.org/…`, and a lower-case `x` check character is accepted; it is stored as the bare, upper-case iD. An X handle is shown in the issue as a link to `x.com/<handle>`, never as `@handle` (that would mention a GitHub user).
- **New setting `IP_LIMIT_MULTIPLIER`**, for testing on one machine only. It multiplies the hourly per-address limits. Leave it unset when deployed.
- **For the pages: the first read of a new staged id can be late.** Workers KV is eventually consistent, so right after `submit_proposal` stages a draft, the first `GET /api/staged/:id` from another part of the world can take up to a minute to find it. If `/submit#staged=` gets `404 staged_unknown` in the first minute, try again a few times, a few seconds apart, before saying the draft has gone.

## The three ways in

Three ways to send an Islet Improvement Proposal (IIP). All of them end the same way: a **public GitHub issue**, opened by the OpenIslet bot, that names the contributor ("Submitted by @handle, verified through GitHub").

1. **Web form (no connector needed).** The contributor pastes or uploads the draft and the blind review on `openislet.org/submit`, presses **Continue with GitHub & Submit**, signs in on GitHub, and lands on a confirmation page.
2. **Connector, signed in.** The contributor's AI client holds an OAuth token from the connector (GitHub sign-in). `submit_proposal` posts straight away. The token can be up to a week old, so the name in "Submitted by @handle" is looked up again at that moment, by the account's numeric ID (`GET /user/{id}` as the bot): a renamed account is named as it is now, never by an old name someone else may have taken. If GitHub no longer has the account, nothing is posted (`401 github_account_gone`).
3. **Connector, not signed in.** `submit_proposal` stages the checked draft and returns a one-click link to the web form with everything already filled in. The contributor presses the same button.

Identity is **GitHub only**. ORCID iD, X handle and a display name are optional plain-text fields on the form. They are shown as "stated by the contributor", except an ORCID iD the person verifies on the form ("Verify my ORCID iD", below), which is shown as "verified through ORCID". That proves the person controlled that ORCID record at the time, not who they are: ORCID names are self-asserted.

Nobody is dropped onto raw GitHub. Nothing is written to the science files: the only write is a new public issue (and one comment) in the queue repository.

## Configuration

Variables (`wrangler.jsonc` `vars`, or `.dev.vars` locally):

| Name | Meaning | Default |
| --- | --- | --- |
| `SUBMISSIONS_OPEN` | Master switch. `false`: nothing is staged or posted, and every submit path answers `queue_not_open`. Already exists. | `false` |
| `ALLOWED_ORIGINS` | Comma-separated browser origins that may call `/api/*` (CORS). | `https://openislet.org` |
| `PUBLIC_HOSTNAMES` | Comma-separated hostnames the Worker answers on, besides this machine (`localhost`, `127.0.0.1`, `[::1]`). Anything else is `403 host_not_allowed`. Entries that are not plain hostnames are ignored. | `mcp.openislet.org`, `mcp-staging.openislet.org` |
| `SITE_ORIGIN` | Where the form lives. Used to build `form_url` and the GitHub `redirect_uri` (`<SITE_ORIGIN>/submit/finish`). | `https://openislet.org` |
| `QUEUE_REPO` | `owner/name` of the repository that receives issues. | `openislet/openislet` |
| `GITHUB_CLIENT_ID` | The GitHub App's client ID. | none |
| `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID` | For the bot that opens the issues. | none |
| `GITHUB_WEB_BASE`, `GITHUB_API_BASE` | Override `https://github.com` and `https://api.github.com`. Used only by the local mock. | real GitHub |
| `DAILY_LIMIT_PER_ACCOUNT` | Submissions per GitHub account per UTC day. | `5` |
| `HOURLY_LIMIT_EVERYONE` | Submissions per clock hour from all accounts together: a ceiling on a flood from many accounts. | `30` |
| `ORCID_CLIENT_ID` | "Verify my ORCID iD": the app's client ID at ORCID (`APP-` and sixteen characters). Without it and its secret, `/api/orcid/*` answer `503 orcid_not_configured`. | none |
| `ORCID_BASE` | Which ORCID: `https://orcid.org`, `https://sandbox.orcid.org` (ORCID's practice site) or the local mock. The live connector must use the real one. | `https://orcid.org` |

Secrets (`wrangler secret put`): `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (PKCS#8 PEM), `STATE_SIGNING_KEY` (random, 32 bytes or more, base64), and for "Verify my ORCID iD" `ORCID_CLIENT_SECRET` (a UUID).

Bindings: `BUNDLE` (R2, exists), `QUEUE_KV` (KV: staged submissions, sign-in state, idempotency, the per-address rate counters), `OAUTH_KV` (KV for the connector's own OAuth server), `QUEUE_LIMITS` (a Durable Object, `src/queue-limits.ts`: the exact posting limits, which KV cannot count atomically; the first deploy creates it through the `v1` migration in `wrangler.jsonc`).

If any value needed for a path is missing, that path answers `queue_not_configured` and does nothing else. It never falls back to a weaker behaviour.

## Limits that apply everywhere

- `draft` and `review`: strings, at most 60,000 characters each. Whole request body at most 200 KB.
- `ai_tools.draft`, `ai_tools.review`: at most 200 characters each.
- `contributor.name`: at most 80 characters. `contributor.orcid`: `0000-0000-0000-000X` shape, with the ISO 7064 mod 11-2 check digit verified. `contributor.x`: 1 to 15 letters, digits or underscores, optional leading `@` (stored without it).
- `consent` must be exactly `true`.
- Per GitHub account: `DAILY_LIMIT_PER_ACCOUNT` posts per UTC day. From everyone together: `HOURLY_LIMIT_EVERYONE` posts per clock hour. Both are counted exactly, in `QUEUE_LIMITS`, so posts sent at the same moment cannot pass together; a post that fails gives its place back. Per IP address (hashed with a salt that rotates daily): 30 `/api/check` calls and 10 `/api/begin` calls per hour (counted in KV, so roughly). A limit answers `429` with `{ "error": "rate_limited", "message": "<plain English>", "retry_after_seconds": n }`.
- One IIP once: the same GitHub account sending the same draft, review and wet-lab readouts again within a day gets the first answer back (changed readouts make a new IIP) (the earlier issue), never a second issue, whichever way it comes in (a new sign-in on the form, or `submit_proposal` without the same key). The same IIP being posted at that moment answers `409 in_progress` ("look at the public queue in a minute"). If `QUEUE_LIMITS` does not answer, nothing is posted: `503 queue_unavailable`. If it does not answer just after a post has gone through, recording the post is tried three times, and then the answer is kept in `QUEUE_KV` (`posted:<fingerprint>`, a day) and checked before each post, so the same IIP still gets the first answer.
- Staged submissions live 24 hours, then are deleted. Sign-in state lives 15 minutes and is single use.

## HTTP API (Worker, `https://mcp.openislet.org`)

All bodies are JSON (`content-type: application/json`). All errors have the shape `{ "error": "<code>", "message": "<plain English for a person>", ... }`. CORS: allowed origins get `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`, methods `GET, POST, OPTIONS`, header `content-type`. No cookies are set or read by `/api/*`.

### `POST /api/check`

Dry run. Same checks as the MCP tool `check_draft`, nothing stored.

Request: `{ draft, review, ai_tools?, consent? }`.
Response `200`: `{ ready, door: [...], checks: [...], what_to_fix: [...], labels: [...], summary }` (the same data the tool returns, plus the one-sentence summary).

### `POST /api/begin`

Starts sign-in for a submission. Validates, stores the submission, and returns the GitHub address to send the browser to.

Request: `{ staged_id?, draft?, review?, ai_tools?, consent, contributor?, binding_hash, orcid_proof? }`.
- `orcid_proof`: from `/api/orcid/complete`, when the person verified their ORCID iD. Checked after the contributor fields: not signed by this Worker, older than an hour or otherwise unreadable is `422 orcid_proof_invalid`; for a different iD from `contributor.orcid` is `422 orcid_mismatch` (an empty `contributor.orcid` takes the proven iD). Only then is the iD marked verified; nothing else can mark it (`contributor` is read for `name`, `orcid` and `x` only, and `/api/staged/:id` never returns the mark).
- Either `staged_id` (a submission staged earlier by the connector) or `draft` + `review` (typed on the form). If both are sent, the typed values replace the staged ones.
- `binding_hash`: lowercase hex SHA-256 of a random secret the browser keeps (see `/submit/finish` below). It ties the sign-in to the browser that started it. The secret itself never reaches the server until `/api/complete`.

Checks, in order: queue open (`503 queue_not_open`), configured (`503 queue_not_configured`), limits (`429`), the basic rules of `check_draft` (`422 basic_rules` with `what_to_fix`, `door`), `consent === true` (`422 consent_needed`), contributor field formats (`422 bad_contributor` naming the field).

Response `200`: `{ authorize_url, expires_at, staged_id }`. `staged_id` is the id of the staged submission this call created, or reused when the request carried one and changed nothing. `authorize_url` is
`<GITHUB_WEB_BASE>/login/oauth/authorize?client_id=…&redirect_uri=<SITE_ORIGIN>/submit/finish&state=<state>&allow_signup=true`.
`state` is 128 random bits, base64url, stored with `{ staged_id, binding_hash }` for 15 minutes. No scopes are requested: the sign-in sees only the public profile.

### `POST /api/complete`

Finishes sign-in and posts the issue.

Request: `{ code, state, binding }`.

Steps: look up `state` (single use: delete it first; `400 state_unknown` if missing or expired); check `sha256(binding)` equals the stored `binding_hash`, compared in constant time (`400 binding_mismatch`); exchange `code` for a GitHub user token; read `GET /user` to get `login` and numeric `id`; apply the per-account limit; post the issue (below); delete the staged submission; remember the result under the staged id for 24 hours so a repeated call returns the same answer.

Response `200`: `{ submitted: true, issue: { number, url }, record_id: "IIP-0042", contributor: { github: "login", name?, orcid?, x? } }`.
Errors: `400 state_unknown | binding_mismatch`, `401 github_refused` (GitHub rejected the code), `409 in_progress` (the same IIP is being posted right now), `429 rate_limited`, `502 github_unavailable` (the staged submission is kept, so the contributor can try again; when the request to open the issue was sent and not clearly answered the body also has `outcome_unknown: true` and `queue_url`, and the message does not say that nothing was posted), `503 queue_not_open | queue_not_configured | queue_unavailable`.

### `POST /api/orcid/begin`

"Verify my ORCID iD": proves the person on the form controls an ORCID record, so the issue can say the iD was verified instead of stated. GitHub stays the only sign-in that posts.

Request: `{ binding_hash }` (as for `/api/begin`: the SHA-256 of a secret the browser keeps, this tab only). Checks: queue open and configured, then `ORCID_CLIENT_ID` and `ORCID_CLIENT_SECRET` (`503 orcid_not_configured`), then an hourly limit per address (`orcid`, 20; `429`).

Response `200`: `{ authorize_url, expires_at }`, where `authorize_url` is `<ORCID_BASE>/oauth/authorize?client_id=…&response_type=code&scope=/authenticate&redirect_uri=<SITE_ORIGIN>/submit/orcid&state=<state>`. `state` is 128 random bits, stored (by its hash) with the binding hash for 15 minutes, single use. `/authenticate` gives the iD only: no access to the record beyond that.

### `POST /api/orcid/complete`

Request: `{ code, state, binding }` from `/submit/orcid`. The state is marked used before anything else; then the binding must match (`400 binding_mismatch`, and the state is spent), then the code is swapped for the iD at `<ORCID_BASE>/oauth/token`, server to server with the client secret. ORCID's token is revoked straight after (best effort) and never kept or logged; the name ORCID also sends is ignored.

Response `200`: `{ orcid, proof, expires_at }`. `proof` is `base64url(JSON {v:1, orcid, exp}) "." HMAC-SHA-256(STATE_SIGNING_KEY, "openislet:orcid-proof:v1:" + payload)`, good for an hour. Errors: `400 state_unknown` (unknown, used or expired), `400 orcid_refused` (ORCID did not accept the code), `502 orcid_unavailable`, `502 orcid_broken` (our client id or secret is wrong). None of them changes anything about the submission: the iD stays as stated.

### `GET /api/staged/:id`

Returns a staged submission so the form can pre-fill. The id is a capability (128 random bits): anyone holding it can read it, nobody can list.

Response `200`: `{ draft, review, ai_tools, contributor, expires_at }`. `404 staged_unknown` if missing or expired.

### `POST /api/stage`

Used by the connector internally through `submit_proposal`; also available over HTTP for the same checks. Request: `{ draft, review, ai_tools?, consent, contributor?, idempotency_key? }`. Runs the basic rules and stores the submission. Response `200`: `{ staged_id, form_url, expires_at }` with `form_url = <SITE_ORIGIN>/submit#staged=<staged_id>`. Same errors as `/api/begin`.

## The issue

Opened as the bot (a GitHub App installation token for `QUEUE_REPO`), in this shape:

- Title: `[IIP] <the draft's first # heading>` (trimmed to 120 characters).
- Labels: `submission`, `status:queued`, and the `type:*`, `test:*`, `design:*` labels that `check_draft` reports (`design:x` is new, for Design X). Labels that do not exist yet are created by GitHub.
- Body, in this order: `Submitted by @login (verified through GitHub)`; when the iD was verified on the form, a line `ORCID iD … (verified through ORCID)`; if given, a line `Stated by the contributor, not verified: name …, ORCID …, X …` (the ORCID part only when it was not verified); `AI tools (self-reported): draft = …, review = …`; `Written against: <version>`; `Consent: published openly under CC BY 4.0`; the draft in `<details open>`; the blind review in `<details>`; last, one hidden marker line `<!-- openislet:submission {...json...} -->` with `v`, `idempotency_key`, `claim`, `pmids`, `via` (`web_form` | `mcp_signed_in` | `mcp_link`) and `sig`, an HMAC-SHA-256 of the other fields under `STATE_SIGNING_KEY`, so a later job can tell a bot-made marker from text pasted by a contributor.
- Contributor text is data. Before it goes into the body: `@name` mentions are defanged (a zero-width space after the `@`), `#123` references are left alone, any `<!-- openislet:submission` inside the draft or review is removed, and the draft and review are never placed in a position where they could close the `<details>` blocks (escape `</details>`).
- First comment, by the bot: the **Automatic checks** table (the same rows `check_draft` shows), headed exactly `## Automatic checks`. There are no other automatic stages: no spam-filter bot and no AI review bot. The weekly review is done by hand and published afterwards.
- `record_id` is `IIP-` plus the issue number padded to four digits.

## Connector: `submit_proposal`

Input is as today (`draft`, `review`, `ai_tools`, `consent`, `idempotency_key`, wet-lab readouts) plus an optional `contributor` object (`name`, `orcid`, `x`).

| Situation | What it does | `data.reason` |
| --- | --- | --- |
| Basic rules fail | Nothing sent. Says what to fix. (Unchanged.) | `basic_rules` |
| `SUBMISSIONS_OPEN` is `false` | Nothing sent or staged. Says the queue opens soon and that the web form will take the same files then. | `queue_not_open` |
| Not configured | Nothing sent. `isError: true`. | `queue_not_configured` |
| Open, caller holds a valid connector token | Posts the issue now as that GitHub account. `data.submitted: true`, `issue`, `record_id`, `contributor`. | none |
| Open, no token | Stages the checked draft and returns the one-click link. `data.submitted: false`, `form_url`, `staged_id`, `expires_at`. Not an error. The text tells the person to open the link, check what is filled in, and press **Continue with GitHub & Submit**. | `sign_in_needed` |

A retry with the same `idempotency_key` never posts twice (signed in) and never stages twice (not signed in: returns the same link).

## Connector sign-in (OAuth 2.1 for MCP clients)

The connector is its own OAuth server for MCP clients, with GitHub as the upstream login (`@cloudflare/workers-oauth-provider`). Endpoints: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/token`, and the GitHub return address `/callback` on `mcp.openislet.org`. PKCE (S256) is required. Scope: `submit`. The token stores only the GitHub numeric ID and login.

`/mcp` stays open to everyone for reading: a request with **no** `Authorization` header is served exactly as today. A request **with** a valid bearer token is served the same way and also tells `submit_proposal` who is signed in. A request with an invalid or expired token is answered `401` with a `WWW-Authenticate` header that points at the protected-resource metadata, so a client can sign in again. Tokens travel only in the `Authorization` header, never in tool arguments.

## What the website pages do (for reference)

- `/submit`: form with draft, review, AI tools, optional name / ORCID iD / X handle, consent box, a **Check my files** button (`/api/check`) and **Continue with GitHub & Submit** (`/api/begin`, then the browser goes to `authorize_url`). With `#staged=<id>` (or an older `?staged=<id>`) it takes the id out of the address bar at once, then calls `GET /api/staged/:id` to pre-fill.
- `/submit/orcid`: ORCID sends the browser here after "Verify my ORCID iD" with `?code=…&state=…` (or `?error=access_denied`). The page posts `{ code, state, binding }` to `/api/orcid/complete`, keeps `{ orcid, proof, expires_at }` in the tab's `sessionStorage` (`openislet.submit.orcid-proof`) and goes back to `/submit`, which puts the iD in its box with "Verified with ORCID" and sends the proof with `/api/begin` while the box still holds that iD. The ORCID secret is kept in this tab only (`openislet.submit.orcid.<state>`). The button shows only in a site built with `PUBLIC_ORCID_VERIFY=true`.
- `/submit/finish`: GitHub sends the browser here with `?code=…&state=…`. The page posts `{ code, state, binding }` to `/api/complete` and shows the link to the new public issue.
- The browser-side secret is kept in the tab's `sessionStorage` under `openislet.submit.binding.<state>`, and a copy of the secret alone in `localStorage` under the same name, for 15 minutes, so the sign-in can also be finished in another tab of the same browser (GitHub's phone app may open one). The finish page reads the tab's copy first and removes both after use or a cancel; the form removes its tab's copies when the person is back on it; both pages sweep out expired copies. The saved-files id stays in the tab. Another browser has neither. The form also keeps what was typed in the tab's `sessionStorage` (`openislet.submit.saved`), never the consent tick, and clears it after a successful submission.
- The API address is `PUBLIC_QUEUE_API` (default `https://mcp.openislet.org`).

## Privacy, in one place

Stored on the Worker: a staged submission for at most 24 hours; a sign-in state for 15 minutes; a result for 24 hours; counters keyed by hashed IP or GitHub numeric ID. The connector's OAuth server stores the GitHub numeric ID and login with each token. Everything a contributor submits is public by design once the issue is opened. Not stored: email address, GitHub token (used once, discarded), chat contents. No cookies on `/api/*`; the connector's `/authorize` approval page may set one short-lived cookie to protect the approval step.

## Limits to know

- **Posting is exact, the rest is approximate.** The daily and hourly posting limits and the one-issue-per-IIP rule are kept by a Durable Object that answers one request at a time, so two quick presses cannot both post. Staged drafts, sign-in state and the per-address request counters live in Workers KV, which has no compare-and-set, so those counters slow abuse down but are not exact.
- **A lost answer can still lead to a second issue.** If GitHub opens the issue but the answer never reaches the Worker, the person is told to look at the public queue before trying again, and a retry does not search for the first issue. If they press the button again without looking, there will be two. The weekly review closes the duplicate.
- **The marker proves the text is as the bot posted it, not that the IIP is right.** A maintainer who edits an issue body for any reason makes it stop verifying; use comments for anything added later.
