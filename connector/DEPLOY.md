# Running your own copy of the connector

This guide takes you from a clone to a live connector that reads the blueprint and, when you switch it on, turns each Islet Improvement Proposal (IIP) into a public GitHub issue. Nothing here needs OpenIslet's accounts: you use your own. Every address below is a placeholder: `YOUR-SITE` is where your website runs, `YOUR-CONNECTOR` is the Worker's address, and `YOUR-ORG/YOUR-QUEUE` is the repository that receives the issues.

**What you create:** one GitHub App (it is both the sign-in and the bot), two Cloudflare KV stores, one R2 bucket for the data bundle, three secrets and a few settings. The Worker's answers stay "not open yet" until you switch the queue on, so you can do steps 1 to 9 at your own pace.

The values already in `wrangler.jsonc` (the `openislet` names, the GitHub App numbers, the store ids) belong to OpenIslet. Replace all of them with yours. The contract between the website's form and the Worker is [`../docs/connector/QUEUE-API.md`](../docs/connector/QUEUE-API.md).

## Before you start

- Node.js as in the root `package.json` (`engines`), and `npm ci` done in this folder. Every command below runs from `connector/`.
- A GitHub organisation or account to own the App and the queue repository, and a Cloudflare account (see "Limits").
- **Make the queue repository public before you open the queue.** Issues in a private repository are private too, so a public submission promise needs a public repository.

## Step 0. Try it all on your computer first

A small program stands in for GitHub, so you can watch the whole flow, and its errors, with no account. Follow "Queue" in [`README.md`](README.md). To see the website's form against it, set `PUBLIC_QUEUE_API=http://127.0.0.1:8787`, `PUBLIC_SUBMISSIONS_OPEN=true` and `PUBLIC_CONNECTOR_STATUS=live` in the website's `.env`.

## Step 1. Create the labels (optional)

The Worker puts labels such as `submission`, `status:queued`, `type:*`, `test:*` and `design:*` on each issue; they are listed in `src/core/queue/issue.ts`. GitHub creates a missing label on first use, without a colour or description. Create them yourself with `gh label create NAME --repo YOUR-ORG/YOUR-QUEUE --color RRGGBB --description "..."` if you want a tidy list.

## Step 2. Create the GitHub App

On GitHub, open **Settings > Developer settings > GitHub Apps > New GitHub App** (for an organisation, under the organisation's settings, so contributors see it as the owner). Fill in only this:

| Field | What to put |
| --- | --- |
| GitHub App name | Any unique name. The bot shows as `<name>[bot]` |
| Homepage URL | `https://YOUR-SITE` |
| Callback URLs | `https://YOUR-SITE/submit/finish` and `https://YOUR-CONNECTOR/callback`. For testing on your computer also add `http://localhost:4321/submit/finish` and `http://localhost:8787/callback` (remove them when you launch) |
| Expire user authorization tokens | Leave it ticked |
| Request user authorization (OAuth) during installation | Leave it unticked |
| Enable Device Flow, Setup URL | Leave them off and empty |
| Webhook > Active | **Untick it.** No webhook |
| Repository permissions > Issues | **Read and write** |
| Repository permissions > Metadata | **Read-only** (GitHub sets it) |
| Every other permission, and all events | No access |
| Where can it be installed | Only on this account |

Press **Create GitHub App**.

## Step 3. Copy the two numbers

At the top of the App's page, copy the **App ID** and the **Client ID** (it starts with `Iv`). They are not secret.

## Step 4. Make the client secret and the private key

On the App's page:

1. **Client secrets > Generate a new client secret.** Copy it at once: GitHub shows it only once.
2. **Private keys > Generate a private key.** A `.pem` file downloads.
3. GitHub's key is in an older format (PKCS#1). The Worker needs PKCS#8. Convert it with OpenSSL:

   ```bash
   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in downloaded-key.pem -out app-key-pkcs8.pem
   head -1 app-key-pkcs8.pem    # must print -----BEGIN PRIVATE KEY----- (not RSA PRIVATE KEY)
   ```

Keep both files out of the repository and delete them after step 8.

## Step 5. Install the App on the queue repository

On the App's page choose **Install App**, pick your account, then **Only select repositories** and choose the queue repository. The number at the end of the address you land on (`.../settings/installations/12345678`) is the **installation ID**. Copy it.

## Step 6. Create the stores and the bucket

```bash
npx wrangler login
npx wrangler kv namespace create QUEUE_KV     # staged drafts, sign-in state, counters
npx wrangler kv namespace create OAUTH_KV     # the connector's own sign-in records
npx wrangler r2 bucket create YOUR-BUCKET     # the data bundle
```

Each KV command prints an `id`. Copy both. The bucket name must match `bucket_name` in `wrangler.jsonc` and `bucket` in `scripts/seed-remote-r2.mjs`.

## Step 7. Put your values in `wrangler.jsonc`

| Find | Replace with |
| --- | --- |
| the two `kv_namespaces` ids | the two ids from step 6 |
| `bucket_name` (and `bucket` in `scripts/seed-remote-r2.mjs`) | your bucket from step 6 |
| `GITHUB_CLIENT_ID`, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID` | the numbers from steps 3 and 5 |
| `QUEUE_REPO` | `YOUR-ORG/YOUR-QUEUE` |
| `SITE_ORIGIN`, `ALLOWED_ORIGINS` | `https://YOUR-SITE` |
| `PUBLIC_HOSTNAMES` | your connector's hostname alone, for example `mcp.example.org` (no `https://`). The Worker answers only on this address and on this machine, and refuses any other host with `403 host_not_allowed`. Leave it out and it answers on OpenIslet's own address instead |
| the `routes` pattern | your connector's hostname, for example `mcp.example.org` |

Leave `"SUBMISSIONS_OPEN": "false"`. The `env.staging` block is a second, private copy for a dress rehearsal (`wrangler deploy --env staging`); fill it in the same way or delete it. A deploy from your account fails while any of OpenIslet's ids is left in, because they belong to another account. Until every setting and secret is in place, the Worker answers `queue_not_configured` on every submit path and does nothing else.

## Step 8. Load the bundle, deploy (still closed) and set the secrets

```bash
npm run export          # copies the public blueprint files out of the blueprint repository (see README.md)
npm run bundle          # builds bundle/islet-1-draft/
npm run seed:remote     # uploads the bundle to your R2 bucket
npx wrangler deploy
```

Then the three secrets. Each command stores one in Cloudflare; none goes in a file:

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET                          # paste the client secret from step 4
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < app-key-pkcs8.pem   # the converted key
openssl rand -base64 32 | npx wrangler secret put STATE_SIGNING_KEY  # random; keep a copy
```

Keep a copy of the signing key in a password manager: you need it to check the hidden marker on an issue, and Cloudflare never shows a secret again. If you lose it, set a new one; markers made earlier can no longer be checked. For a staging copy, add `--env staging` to each command.

## Step 9. Check it while it is closed

```bash
curl https://YOUR-CONNECTOR/healthz
curl -s -X POST https://YOUR-CONNECTOR/api/begin -H 'content-type: application/json' -d '{}'    # {"error":"queue_not_open", ...}
curl -s -X POST https://YOUR-CONNECTOR/api/check -H 'content-type: application/json' -d '{}'    # works, and says the files are not ready
npm run smoke -- https://YOUR-CONNECTOR/mcp                                                     # a real MCP client asks a few questions
```

Reading must work: connect an AI assistant to `https://YOUR-CONNECTOR/mcp` and ask it a question.

Then check that Cloudflare's automatic request log line is off, because an address in it can hold the sign-in code or a staged draft's id. In the dashboard, open the Worker's Observability settings; or ask the API for `GET /accounts/<ACCOUNT_ID>/workers/scripts/<WORKER_NAME>/script-settings`. `observability.logs.invocation_logs` must be `false` and `observability.redact_query_string` must be `true` (`wrangler.jsonc` sets both). The connector's own log events stay on; they hold names and counts only. Check again after every deploy.

## Step 10. Open the queue, and close it again

1. In `wrangler.jsonc` set `"SUBMISSIONS_OPEN": "true"` and run `npx wrangler deploy`. It takes about ten seconds.
2. Rehearse with a spare GitHub account: the web form, an AI app that signs in to the connector, an AI app that does not (it gets the link), and a draft that fails the basic rules. After each, look at the new issue: its title, its labels (including `status:queued`), the line `Submitted by @name (verified through GitHub)`, and the first comment headed `## Automatic checks`.

**To close it in a hurry:** set `"SUBMISSIONS_OPEN": "false"` and deploy. Within seconds every submit path answers "not open yet" and nothing is saved or posted. Reading is not affected, and issues already opened stay on GitHub.

**To roll back a bad deploy:** `npx wrangler rollback` returns the Worker to its previous version. Secrets and stores are not touched.

## Every setting in one place

| Name | Kind | Set with | What it is |
| --- | --- | --- | --- |
| `SUBMISSIONS_OPEN` | variable | `wrangler.jsonc` | The master switch. `false` until step 10 |
| `ACTIVE_BUNDLE` | variable | `wrangler.jsonc` | The bundle that answers when no version is asked for |
| `ALLOWED_ORIGINS` | variable | `wrangler.jsonc` | Web pages allowed to call `/api/*` |
| `PUBLIC_HOSTNAMES` | variable | `wrangler.jsonc` | The connector's own address (hostname only, comma-separated if there are several). Any other host is refused |
| `SITE_ORIGIN` | variable | `wrangler.jsonc` | Where the form lives. GitHub sends people back to `<SITE_ORIGIN>/submit/finish` |
| `QUEUE_REPO` | variable | `wrangler.jsonc` | The repository that gets the issues |
| `DAILY_LIMIT_PER_ACCOUNT`, `HOURLY_LIMIT_EVERYONE` | variable | `wrangler.jsonc` | Posts per GitHub account per UTC day, and per clock hour from everyone together |
| `GITHUB_CLIENT_ID`, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID` | variable | `wrangler.jsonc` | From steps 3 and 5 |
| `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `STATE_SIGNING_KEY` | secret | `wrangler secret put` | From steps 4 and 8 |
| `QUEUE_KV`, `OAUTH_KV` | KV stores | `wrangler.jsonc` | Step 6 |
| `BUNDLE` | R2 bucket | `wrangler.jsonc` | The data bundle |
| `GITHUB_WEB_BASE`, `GITHUB_API_BASE`, `IP_LIMIT_MULTIPLIER` | local testing only | `.dev.vars` | Point the Worker at the mock and loosen the hourly limits. Never set them when deployed |

## Reading what comes in

New IIPs carry the label `status:queued`:

```bash
gh issue list --repo YOUR-ORG/YOUR-QUEUE --label status:queued --limit 100 --json number,title,labels,createdAt
```

The last line of each issue is a hidden marker the Worker signed. To check one (with your signing key):

```bash
gh issue view 42 --repo YOUR-ORG/YOUR-QUEUE --json body -q .body | STATE_SIGNING_KEY='the key' node scripts/verify-marker.mjs
```

It says `genuine` or `NOT genuine`: that the bot signed the marker, and that the issue text above it is still what the bot posted. There is no spam filter and no AI review bot in the Worker; the only automatic step is the first comment.

## If something goes wrong

| What you see | Likely cause | What to do |
| --- | --- | --- |
| The form says the queue "is not fully set up" (`queue_not_configured`) | A setting or secret is missing | In the Cloudflare dashboard open the Worker's **Logs**. A `queue.not_configured` line lists the **names** (never the values) of what is missing |
| GitHub shows "redirect_uri is not associated with this application" | The callback list in step 2 is wrong | Edit the App's callback list. It must match exactly, including `http`/`https` and the port |
| After signing in: GitHub "did not accept the sign-in" (`github_refused`) | The code was used or expired, or the client ID or secret is wrong | Press the button again. If it keeps happening, check `GITHUB_CLIENT_ID` and set `GITHUB_CLIENT_SECRET` again |
| GitHub "did not answer" (`github_unavailable`) and the drafts are kept | GitHub is down, or the bot cannot open issues | Check the log line `queue.github_error`. Is the App installed on the repository, does it have Issues: Read and write, is the installation ID right, is the key the PKCS#8 one, are issues switched on for the repository? |
| `wrangler deploy` says a KV namespace is not found | One of OpenIslet's ids is still in `wrangler.jsonc` | Step 7 |
| `403 host_not_allowed` on every request | The address you call is not in `PUBLIC_HOSTNAMES` | Put your connector's hostname in `PUBLIC_HOSTNAMES` (step 7), hostname only, and deploy again |
| An AI app cannot sign in | It must reach `/authorize` on the connector and GitHub, and `https://YOUR-CONNECTOR/callback` must be in the App's callback list | Step 2. Also check that `SUBMISSIONS_OPEN` is `true` |

## Limits

- The posting limits (per account per day, and everyone per hour) and the one-issue-per-IIP rule are kept exactly by a Durable Object. The per-address request counters live in Cloudflare KV, which is eventually consistent and cannot count atomically, so they slow abuse down but are not exact.
- Cloudflare limits how many KV writes a Worker may make in a day, and one submission uses about five to eight. Check your account's limit if you expect many submissions.
- An IIP larger than one GitHub issue allows (about 64,000 characters) is refused before anyone signs in.
- Whether an AI app starts the sign-in itself is up to that app: `/mcp` is open for reading, so no app is forced to sign in. Where it does not, the person gets a link to the form, which works the same.
