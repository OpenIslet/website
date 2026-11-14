# Updating the website

The website is built from data files, so most updates are one command. Nothing on the site needs retyping when the blueprint changes.

## When the blueprint changes (a new version)

1. Update the blueprint in the OpenIslet repository (`../OpenIslet`) as usual.
2. Refresh the website's numbers:

   ```bash
   npm run sync-data
   ```

   This copies the data files, and rewrites `src/data/release.json` (version, date, counts, design scores) and `src/data/references.json` (citations for the specification). Every number on the site is read from those files.

3. Record the change in the changelog. **Only after release.** The changelog starts when the open draft opens on 1 November 2026, and nothing done before then is reported, so `src/data/changelog.json` is empty until that day and the script refuses entries dated earlier. From 1 November:

   ```bash
   npm run changelog -- \
     --version v0.8.1 \
     --title "A short title" \
     --summary "One plain sentence." \
     --fixed "What changed." \
     --contribution IIP-0002
   ```

   Use `--added`, `--changed`, `--fixed` and `--removed` as many times as you need. The date defaults to today.

4. Rebuild the connector's data bundle, so the connector gives the same numbers as the site:

   ```bash
   npm --prefix connector run export    # copies the public blueprint files from the sibling folder OpenIslet (or OPENISLET_REPO)
   npm --prefix connector run bundle    # builds connector/bundle from that copy and this site's src/data
   npm --prefix connector test          # checks that every number the connector gives equals the site's
   ```

5. Check the site: `npm run dev`, then `npm run build`.

## Where each thing lives

| To change | Edit |
| :-- | :-- |
| The concise specification on the Blueprint page | `src/content/blueprint-spec.md` (plain Markdown. Cite papers as `[Author 2024](#ref-PMID)`.) |
| The "Realistic chance of working" estimates and wording on the Blueprint page | `src/data/success-probability.json` (change a percentage and `lastUpdated`; the combined figures work themselves out. See "The chance-of-working estimates" below) |
| The changelog (empty until the open draft opens on 1 November 2026) | `npm run changelog`, or `src/data/changelog.json`. The entries from before release are kept privately in `private/` |
| Who has contributed, and what each IIP changed | `src/data/contributions.json` (one record per IIP, with its outcome in words and any follow-ups. The outcomes and their wording are in `src/data/contributions.ts`. There are no scores) |
| Idea Graveyard entries | `src/data/graveyard.json` |
| Copy-paste prompts in the Start here guide (connector route and copy-and-paste route) | `src/data/prompts.ts`. Each explore prompt has `text` (with the connector) and `pasteText` (with the starter pack) |
| The copy-and-paste starter pack | `src/pages/openislet-starter-pack.md.ts` (it reads the specification, the Idea Graveyard rules and `connector/data/open-questions.json`) |
| The web form for sending an IIP, and where GitHub sends people back | `src/pages/submit.astro`, `src/pages/submit/finish.astro`, `src/scripts/submit.ts`. The contract with the Worker is `docs/connector/QUEUE-API.md` |
| Design A, Design B and Design X | `src/data/blueprint.ts` (edits, notes and Design X's proposals), `src/components/BlueprintFigure.astro` (the drawing), `src/components/designs/DesignScene.astro` (what the immune system sees), `src/components/Designs.astro` (the home page cards). Scores come from `npm run sync-data` |
| How to connect each AI assistant, and the date its steps were last checked (`checkedOn`, shown on Start here). An assistant can have a second way, folded away (`alt`: the command line, or a browser) | `src/data/connect.ts` |
| The company marks on the assistant buttons | `src/data/assistantMarks.ts` (read the note at the top first: where each file came from, each company's rules, and the Anthropic check before launch) |
| The five tests, in plain English | `src/data/gates.ts` |
| Downloads on the Blueprint page | `src/data/assets.json` |
| The contact address (`hello@openislet.org`) | `contact.email` in `src/data/site.ts`, and `CONTACT_EMAIL` in `connector/src/core/contact.ts` (a test checks they match) |
| The version plan (open draft, quarterly locks) | `src/data/versions.ts` (the connector reads it too). The 1 November dates assume the launch is ready. If it is not, move `opens` (and the locks, if they move too) there and nowhere else: every page, the changelog picture and the connector read it, and `tests/launch-date.test.mjs` fails if a date is typed in anywhere else. |
| The roadmap: Stage 0 in full, Stages 1 to 5 as a short outline, the partner and open-source statement, and the dog study's aim | `src/data/roadmap.ts` (see "Changing the roadmap" below). The connector's `roadmap` section reads it too |
| The pictures on the roadmap cards, the two "after the blueprint" pictures and the terrier | `src/components/roadmap/` (`StageArt0` to `StageArt5`, `StageIcon`, `WayArt`, `Terrier`). The terrier's six numbered labels must match the six items in `canine.legend` |
| Whether the connector is live, whether IIPs can be sent, whether search engines may list the site | `PUBLIC_CONNECTOR_STATUS`, `PUBLIC_SUBMISSIONS_OPEN` and `PUBLIC_INDEXABLE` in `.env` (see `README.md` for the launch-day settings). Start here always opens on the copy-and-paste route, with "Connect with MCP" as the other choice (`/start?route=mcp` opens it); `PUBLIC_CONNECTOR_STATUS` is read by the Submit page only |
| The picture shown when a link is shared | `social/x-profile-pack/tools/gen.mjs`, then `social/x-profile-pack/tools/render.sh` (writes `share-card-1200x630.png`; copy it into `public/` under a new name and point `shareImage` in `src/data/site.ts` at it) |

## Changing the roadmap

Each stage on `/roadmap` is one object in `src/data/roadmap.ts`. Keep the page current as the plan evolves.

**The rule (decided 25 October 2026).** OpenIslet's own work is Stage 0, the blueprint, and it is shown in full: what happens, a pass, a stop, what is not known, where it stands, and the detail for scientists. Stages 1 to 5 are a short outline only (a summary, why the stage exists, and who carries it out). They are meant for partner organisations (a research institute, an AI lab or a biotech company) or for any organisation that takes the open blueprint (CC BY 4.0). Do **not** add steps, sizes, schedules, protocols or pass and stop numbers for Stages 1 to 5, in the data, the pictures or the connector. Detailed plans stay private. The text that was on the site before the rule is kept in the git-ignored `private/` folder.

1. To change Stage 0, edit its object. Plain English first; technical detail goes in `science`, which sits under "For scientists".
2. To change a later stage, edit its `summary` and `why` only. If a date is now known, set `timing`. The 2030 goal is the only fixed date so far.
3. The statement about partners and open-source adopters is `afterBlueprint` in the same file (`heading`, `lead`, `ways`, `note` and `oneLine`). The page and the connector both show it. The cards for Stages 1 to 5 stay free of detail: a connector test checks this.
4. The dog study (stage 3) is the aim and a six-item picture legend: `canine.aim`, `canine.why` and `canine.legend` (keep exactly six, in the order of the picture's numbers). Its process and details are not published.
5. Run `npm --prefix connector run bundle && npm --prefix connector test` (`npm test` rebuilds the bundle too). That rebuilds the connector's data bundle so the connector's roadmap matches the website, and checks that the later stages carry no steps or numbers.

The long blueprint download (`ISLET-1-BLUEPRINT.md`) comes from the science repository and may hold more than the website shows. Whether it should is for the science side to decide.

## The Blueprint drawing

`src/components/BlueprintFigure.astro` draws the cell, the DNA strip and the graft for all three designs on one sheet, and shows the design the buttons choose. It is built so that it cannot drift from the rest of the site:

- **The DNA strip** is made from `src/data/blueprint.ts`: each box is one element of the locus the edit-by-edit diagrams show (protein-coding, control region, linker, insulator, switched off, kept, single-letter change), with the same widths. Change a locus there and the strip changes. The key under the strip lists only the kinds this design uses.
- **The cell** is placed with a few numbers at the top of the file (`C`, `R`, the angles in `flags`, `balls` and `hex`, and the `pins` table). Surface proteins sit on stalks around the membrane; what is inside (SERPINB9, iCasp9, TYK2, the INS mark) has a fixed slot.
- **The graft** is to scale: 350 µm thick, clusters of 120 µm or less, the central oxygen layer about a third of the thickness (the model's own proportion, `CENTRAL_LAMINA_HALF_WIDTH_FRACTION = 0.34` in the science repository). The scores for all three designs assume the same graft.
- **The rule for any change:** a number sits beside the part it names and never on it, a leader line joins them when they are more than a few units apart, and no label touches another. After a change, run `node scripts/audit/figure-shots.mjs` and look at the three designs, then `axe.mjs`, `keyboard.mjs` and `sweep.mjs`.

## The chance-of-working estimates

The "Realistic chance of working" section on `/blueprint` reads `src/data/success-probability.json`. Each of the four hurdles has two percentages, `singleArmPct` (one design on its own) and `threeArmPct` (three designs tested side by side), plus its wording. The two combined figures are worked out from them (each hurdle's percentages multiplied together), so to update the odds you change a percentage, set `lastUpdated`, and nothing else. A value outside 0 to 100, or an empty text, stops the build with a message. These are the blueprint team's estimates, not measurements (26 October 2026), and the page says so. Change them when new human trial data or OpenIslet lab results arrive, and say what moved in the changelog once the changelog has started.

## Design X

Design X (the challenger) is Design A plus one INS base edit, with three proposals that are not built or scored. Its scores are read from the science export by `npm run sync-data` (the grid challenger in `champion_challenger_portfolio`). The sentence comparing it with Design A is worked out from the scores (`xAgainstA` in `src/data/scenarios.ts`), so it cannot go stale. The name covers two separate ideas, shown as two cards (`twoIdeas` in `designX`): the scored comparison, and the molecular proposal, a written proposal whose DNA is not built, with no score. The scored comparison ties for second place with another one-edit design, so its rank says "tied". To change its words, edit `designX` in `src/data/blueprint.ts` and section 4.6 of `src/content/blueprint-spec.md`. If the science side materialises the proposals and scores them, replace the "Still on paper" cards with real edits and scores.

## Share pictures

The picture an app shows when a link is shared is `shareImage` in `src/data/site.ts`. Six pages have their own (`pageShareImages` in the same file, files in `public/og/`): a page asks for its picture with `share="…"` on its `<Layout>`. Each picture needs its own `alt` there, saying what the picture says. A changed picture gets a new file name, because apps keep a shared picture by its address.

## The home page's sliding rows and tabs

On a narrow screen the three designs, the five layers and the six steps each sit in a row that slides sideways (`data-slider` on the row; `src/scripts/slider.ts` adds the dots under it). The five tests share one panel with five tabs (`src/components/FiveTests.astro`); without scripts all five show, one under the other, so nothing depends on the script to be read. The "Latest changes" row is `latestCredited()` in `src/data/contributions.ts`: it shows each record's own summary in full, never cut short.

## The launch film

On a first visit to Home the film opens full screen in the browser's own player, always with its sound on: it is never started muted. A browser starts a video with sound by itself only on a site the person has used before, so most first visits wait on the film's first picture until the player's play button is pressed (or, before it starts, a click anywhere on the picture, which Chrome on a computer does not do by itself). A small ✕ in the top-right corner is the site's only button on it; Esc closes it too, and it closes itself at the end. The picture is as big as fits, with nothing under it (the player's controls fade over it, as in any player), and it always leaves that corner clear: above the picture on an upright phone, beside it on a phone on its side. It opens by itself once per browser. It waits for play on a device set to reduce motion or save data, and it stays shut for a link to part of Home and in automated browsers (so the audits see the page). The hero's "Watch the launch film" link and the poster at the top of About open it any time (About never opens it by itself: `<FilmIntro auto />` is on Home only). The code is `src/components/FilmIntro.astro`, and the names of the files are in `src/data/film.ts`.

The two video files (1080p for computers, 720p for phones) are in the R2 bucket `openislet-media`. `site-worker/media.js` serves them at `/media/<file>`, with byte ranges, which iPhone Safari needs (static files can't answer ranges, and must be under 25 MiB). The live site sends only `/media/*` to the Worker (`run_worker_first` in `wrangler.site.jsonc`); staging serves it behind the password. The bucket must exist, with the files in it, before either site is deployed. The poster is a static file in `public/film/`.

**A new cut:** make its 1080p and 720p web copies with new file names, upload both (`wrangler r2 object put openislet-media/<name> --file <file> --content-type video/mp4 --remote`), add its poster to `public/film/`, change the names in `src/data/film.ts`, then build and deploy. Old files can stay in the bucket until nobody can have the old page open.

## Security headers

Every build ends by writing the site's security headers (`scripts/security-headers.mjs`, run from `astro.config.mjs`): a Content-Security-Policy that lets in only the site's own files, the connector named in each page's `data-api`, the small scripts written into the pages, each by its hash, and Cloudflare Web Analytics' script (`static.cloudflareinsights.com`, which Cloudflare adds to each page for the visitor counts). Nothing is typed in by hand, so a new inline script or connector address needs nothing from you. The live site gets the headers from `<outDir>/_headers`; staging answers from its password Worker, which `_headers` does not reach, so `site-worker/staging-gate.js` imports the same list from `dist-staging/security-headers.json` (build before deploying). The build stops on an inline event handler (`onclick="…"`) or a `javascript:` link, because the policy would block it: put the handler in the page's script instead. To see the headers locally (`astro preview` does not send them), build, then run `connector/node_modules/.bin/wrangler dev -c wrangler.site.jsonc --port 4601` for the live setup, or add `--env staging --var STAGING_PASSWORD:local-only-test` for the password copy (it serves `dist-staging`).

## Dependencies and `npm audit`

`npm audit` lists advisories against Astro 5 and the packages it pulls in (sharp, zod and esbuild). The only fix it offers is Astro 7, a major upgrade that is planned for after launch, not made in a hurry. None of the advisories reaches visitors:

- The site is built into static files (`astro.config.mjs` sets no `output` and no adapter), and the Worker in front of it, `site-worker/`, has no dependencies. Astro, sharp, zod and esbuild run only on a computer that builds or previews the site.
- The advisories concern server rendering, the dev server, image optimisation, view transitions and templates fed with user input. The site renders nothing on a server, uses no `astro:assets` images, view transitions or MDX, and puts no visitor input into a template (the Submit page works in the visitor's browser).

The connector shows no advisories, in its production dependencies or its development tools (`npm --prefix connector audit`). When you update Astro, run `npm test`, `npx astro build` and the checks in `scripts/audit`, then run both audits again.

## Plain-English rules for copy

- Write for someone who has type 1 diabetes and no science background. Put gene names and technical detail after the plain explanation.
- Say "test", not "gate". Say "design", not "stack". Say "switch off", not "knock out".
- Leave money out of the copy.
- Do not type a number that is in `release.json`. Use the data, or a `{{token}}` (see `src/data/specTokens.ts`), so it cannot go stale.
