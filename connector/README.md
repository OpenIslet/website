# OpenIslet connector

An [MCP](https://modelcontextprotocol.io) server on Cloudflare Workers. It lets any AI assistant read the OpenIslet blueprint and the evidence behind it, check an idea against the Idea Graveyard, and send in an Islet Improvement Proposal (IIP), which becomes a public GitHub issue. To run your own copy, see [DEPLOY.md](DEPLOY.md). The contract with the website's form is [`../docs/connector/QUEUE-API.md`](../docs/connector/QUEUE-API.md).

## Try it

You need Node.js (see `engines` in `package.json`), Python 3 for the export step, and the blueprint repository, [openislet/openislet](https://github.com/openislet/openislet), cloned next to the website's folder and named `OpenIslet`. Run `npm ci` in the website's root folder first: three of the connector's tests read website files. Then, from this `connector/` folder:

```bash
npm ci
npm run export     # once: copy the public files out of the blueprint repository (it changes nothing there)
npm run bundle     # build the data bundle into bundle/islet-1-draft/
npm test           # rebuild the bundle, then run every test
npm run seed       # load the bundle into the local R2 that wrangler uses
npm run dev        # the Worker, at http://localhost:8787/mcp (leave it running; use a second terminal for the rest)
npm run smoke      # a real MCP client asks the running Worker a few questions
npm run mock-github   # a stand-in for GitHub, to try the submission queue (see "Queue")
```

`npm run export` reads the blueprint repository at `../../OpenIslet` (or `OPENISLET_REPO`) and writes nothing there. A plain clone of the public repository already is the export, so it is checked and copied as it is, without its `.git` folder and Python caches. Exporting it again would change its manifest, and the website's numbers would stop matching it. The full working repository is exported with its own allowlist instead (`export_public_bundle()`). Either way the result is verified before `npm run bundle` uses it.

## The twelve tools

| Tool | What it does |
| --- | --- |
| `get_blueprint_overview` | The blueprint in plain English. Sections: summary, tests, designs, roadmap, versions, help. `detail: "full"` adds the technical text |
| `list_versions` | The open draft, locked versions (frozen, citable) and the planned lock dates |
| `search_studies` | Search the studies and their findings by words, gene, test, direction, year. Paged |
| `get_study` | One study: groups compared, every finding, the exact quote where the publisher allows it |
| `get_conflicting_evidence` | For a gene: findings where changing it improved the outcome beside those where it impaired it |
| `check_against_graveyard` | `exact`: a design from named modules, same rules as the scoring program. `suggest`: an idea in words, labelled as suggestions. `list`: every module |
| `get_open_questions` | Known weak spots, each with how it could be settled |
| `get_layer_atlas` | The DNA, protein, tissue and patient layers |
| `get_contributions` | Who has contributed, and what each IIP changed, in words. No scores or rankings |
| `get_submission_status` | Where a submission is. Public, so no sign-in |
| `check_draft` | A dry run of the submission checks. It posts nothing |
| `submit_proposal` | Sends an IIP to the public queue. Signed in with GitHub, it opens the public issue at once; not signed in, it saves the checked files for a day and returns a link to the web form with them filled in. **Closed until `SUBMISSIONS_OPEN` is switched on**: it runs the same checks, then says submissions open soon |

Every read tool takes `version` (`draft`, `latest`, or a locked name such as `islet-1.0`). Every answer starts with a plain-English summary, ends with the version it came from, and comes with `structuredContent` for programs. Three prompts (`draft_a_proposal`, `blind_review`, `submit_my_proposal`) and six resources (the blueprint, the Idea Graveyard, versions, the review template, open questions and each study) are published too.

## Switches

Set in `wrangler.jsonc` (`vars`) or the Worker's environment. [DEPLOY.md](DEPLOY.md) lists every setting.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ACTIVE_BUNDLE` | `islet-1-draft` | The bundle that answers when no version is asked for |
| `SUBMISSIONS_OPEN` | `false` | The master switch for the whole queue: `submit_proposal`, the web API, and the connector's sign-in |
| `UNFREEZE_SCENARIO_SCORES` | `true` | Whether the design scores appear (only in the designs section, always with their caveat) |
| `SHOW_SIMULATED_SURVIVAL` | `true` | Whether the patient layer shows its simulated "5-year survival" percentages. They always come under the layer's scope note. Set to `false` to hold them back |

## Queue

Three ways to send an IIP, all ending as a **public GitHub issue opened by the OpenIslet bot** that names the contributor: the web form on openislet.org (`/api/*`), `submit_proposal` signed in (the connector's own GitHub sign-in), and `submit_proposal` not signed in (a link to the form with the files filled in). Identity is GitHub only. A name, an ORCID iD and an X handle are optional text, shown as stated by the contributor and never as verified. There are no spam-filter or AI-review bots: the only automatic step is the first comment on each issue (the "Automatic checks" table). The weekly review is done by hand.

| Piece | Where |
| --- | --- |
| The rules: staging, sign-in state, retries, limits, posting | `src/core/queue/service.ts` |
| GitHub (sign-in code, who signed in, the bot's signed token, issue, comment) | `src/core/queue/github.ts` |
| The issue body, labels, the first comment, the signed marker | `src/core/queue/issue.ts` |
| The web API, CORS, request limits | `src/queue-http.ts` |
| The connector's sign-in for AI apps (`@cloudflare/workers-oauth-provider`) | `src/connector-oauth.ts`, `src/oauth-pages.ts` |
| Routing (`/mcp` open for reading; with a valid token it also says who is signed in) | `src/worker.ts` |
| A stand-in for GitHub, and a checker for the issue marker | `scripts/mock-github.mjs`, `scripts/verify-marker.mjs` |

**Try the whole flow on your computer (no accounts).**

```bash
npm run seed          # once, if you have not
npm run mock-github   # terminal 1. The first run writes .dev.vars (see .dev.vars.example) with throwaway secrets
npm run dev           # terminal 2: the Worker at http://localhost:8787
```

Then use the website's form (see "Step 0" in [DEPLOY.md](DEPLOY.md)), or drive it with `curl`. `draft.md` and `review.md` are any two files that pass `check_draft` (the tests build a pair in `tests/fixtures.ts`):

```bash
API=http://localhost:8787
SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(16))')      # a browser keeps this in sessionStorage
HASH=$(printf %s "$SECRET" | shasum -a 256 | cut -d' ' -f1)               # and sends only its hash
BODY=$(jq -n --rawfile d draft.md --rawfile r review.md --arg h "$HASH" '{draft:$d, review:$r, consent:true, binding_hash:$h, contributor:{name:"Ada Lovelace"}}')

curl -s -X POST $API/api/begin -H 'content-type: application/json' -H 'origin: http://localhost:4321' -d "$BODY" | tee begin.json
# { "authorize_url": "http://127.0.0.1:8788/login/oauth/authorize?...", "expires_at": "...", "staged_id": "..." }

# The browser goes to authorize_url. The mock signs in at once and sends it back with a code and the state:
LOCATION=$(curl -s -i "$(jq -r .authorize_url begin.json)" | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)
CODE=$(python3 -c 'import sys,urllib.parse as u; print(u.parse_qs(u.urlparse(sys.argv[1]).query)["code"][0])' "$LOCATION")
STATE=$(python3 -c 'import sys,urllib.parse as u; print(u.parse_qs(u.urlparse(sys.argv[1]).query)["state"][0])' "$LOCATION")

curl -s -X POST $API/api/complete -H 'content-type: application/json' -H 'origin: http://localhost:4321' \
  -d "{\"code\":\"$CODE\",\"state\":\"$STATE\",\"binding\":\"$SECRET\"}"
# { "submitted": true, "issue": { "number": 1, "url": "..." }, "record_id": "IIP-0001", "contributor": { "github": "mock-contributor", "name": "Ada Lovelace" } }

curl -s http://127.0.0.1:8788/_mock/issues | jq '.[0]'                       # the issue as the Worker opened it
```

`open http://127.0.0.1:8788/_mock/` shows the same in a page. To rehearse a failure: `curl -X POST http://127.0.0.1:8788/_mock/mode -d '{"mode":"down"}'` (other modes: `refuse_code`, `decline`, `issues_fail`, `app_suspended` for a suspended or uninstalled app, `slow_issues` for an issue that takes six seconds to open, `ok`); to change who signs in: `curl -X POST http://127.0.0.1:8788/_mock/user -d '{"login":"someone"}'`. The local settings let the website's dev addresses (`localhost:4321`, `localhost:4400`, `127.0.0.1:4321`) call the API, and loosen the per-address and per-account limits so a day of testing is not cut short. Use `localhost`, not `127.0.0.1`, for the connector's own sign-in (`http://localhost:8787/authorize`): the sign-in is built on the address it was reached at.

## The data bundle

`npm run bundle` turns the public export plus the website's own content (read from its source files, so the two never disagree) into `bundle/<id>/`. `meta.json` lists every file with its SHA-256 and one fingerprint for the whole set. Building twice gives the same fingerprint, and a bundle built with `--frozen` is never overwritten with different content.

**The rights guard.** The export caps verbatim quotes at 240 characters per paper, but some other fields carried sentences from papers. The builder withholds those fields. When the source texts are on the machine it then proves that no sentence from a paper remains in the bundle except the capped quotes and bibliographic details, and fails the build if one does. `meta.json` records whether that proof ran.

## What the tests prove

- `graveyard.contract.test.ts`: the TypeScript Idea Graveyard checker gives the same rules, severities and reasons as the blueprint repository's Python for **every design**, and the counts equal the numbers on the website (blocked and remaining).
- `bundle.contract.test.ts`: counts, version dates and numbers equal the website; at most 240 verbatim characters per paper; the paper wording the export leaks is withheld; every file matches its SHA-256; the build is repeatable; a locked version cannot be rebuilt with different content.
- `tools.test.ts`: fixed questions to every tool through the real MCP server, including scores always carrying their caveat, aliases, paging, version handling, long and out-of-range input, the scope note on the patient layer and the closed queue.
- `queue-*.test.ts`: the submission queue, with a fake GitHub, a fake clock and in-memory KV (no network, no account). The contributor fields (ORCID check digit), the issue body and what is done to a contributor's text (mentions, `</details>`, fake markers), the GitHub module (the bot's signed token), every endpoint and error code, single-use sign-in state and the binding, repeated calls, rate limits, CORS, nothing written while closed, the connector's sign-in and `/mcp` (open for reading, a bad token is a 401), the three situations of `submit_proposal`, the design labels, and that no secret, token or address ever appears in a response, a log line, an issue or a storage key.
- `draft.test.ts`: `check_draft` and `submit_proposal` against drafts and reviews written to the website's templates, including a quote credited to the wrong paper, a quote matched by its fingerprint, and hostile files built to slow the parser (they run in milliseconds, because `check_draft` is open to anyone).

## Layout

```
src/core/       the work, with no dependency on the Worker runtime: search, studies, graveyard, draft checks, ...
src/core/queue/ the submission queue: rules, GitHub, the issue, limits (also runtime-free)
src/server.ts   wires the core to MCP (tools, prompts, resources)
src/worker.ts   the Cloudflare Worker (stateless, one McpServer per request; routes /mcp, /api/* and the sign-in)
src/queue-http.ts, src/connector-oauth.ts, src/oauth-pages.ts   the queue's web API and the connector's sign-in
src/queue-limits.ts   the QUEUE_LIMITS Durable Object: exact posting limits and one issue per IIP (rules in src/core/queue/limits.ts)
scripts/        export, build-bundle, golden-graveyard.py, seed-local-r2, smoke-http, mock-github, verify-marker, sign-out-account (ends one GitHub account's AI-app sign-ins)
tests/          the suites above, plus golden/graveyard-grid.json (what the Python says for every design)
.dev.vars.example   local settings for `npm run dev` with the GitHub mock (copied to .dev.vars, which is not committed)
data/           open-questions.json (curated: the weak spots listed in the blueprint)
```

## Licence

Code: Apache-2.0. Project-authored data and text: CC BY 4.0. Third-party verbatim excerpts remain the copyright of their authors and publishers.
