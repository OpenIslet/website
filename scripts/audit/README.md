# Checking the site: accessibility, other browsers, speed

These scripts re-run the checks done on 25 October 2026, so they can be repeated after content changes (a new blueprint, a roadmap edit, a new page). They are not part of the normal build and nothing here runs on its own.

## Set up (once)

```bash
cd scripts/audit
npm install                         # axe-core, puppeteer-core, pngjs, lighthouse (kept inside this folder)
mkdir -p bin && swiftc -swift-version 5 -O -o bin/webkitshot webkitshot.swift   # macOS only: draws pages with Apple's WebKit, the engine inside Safari
```

They need Google Chrome in the usual place (set `CHROME` to use another copy). The WebKit tool needs Xcode's command line tools.

## Serve a build that nobody else is writing to

Other tools can build into `dist/` at the same time as you (and a build that fails halfway leaves it incomplete). Build to a folder of your own and serve that:

```bash
npx astro build --outDir /tmp/openislet-audit      # no sync, no prebuild: it uses the data already in src/data
npx astro preview --outDir /tmp/openislet-audit --port 4500 --host 127.0.0.1
```

Point the scripts at it with `BASE=http://127.0.0.1:4500` (the default is port 4400). `PAGES=/roadmap,/contact` limits any of them to some pages.

## The scripts

| Run | What it checks | A good result |
| --- | --- | --- |
| `node axe.mjs` | axe-core (WCAG 2.2 A and AA, plus best practice) on every page at desktop and phone width, also with every fold-out open and every toggle pressed | `VIOLATIONS: 0` |
| `node contrast.mjs` | Text contrast measured from the drawn pixels, which catches text over pictures and gradients that axe cannot decide | `Below the WCAG AA minimum: 0` (see the known false alarms below) |
| `node keyboard.mjs` | Tab order and skip link, focus indicators, motion (nothing keeps moving after 5 seconds, nothing at all when motion is reduced), reflow at 320px, text at 200% | `KEYBOARD, MOTION AND REFLOW PROBLEMS: 0` (see below) |
| `node sweep.mjs` | Every page at nine widths from 320 to 2560px, in Chrome and in WebKit, with every fold-out open: does anything scroll sideways or poke off the screen | `Problems: 0` |
| `node evenrows.mjs` | Every grid and wrapping row on every page at 390, 600, 820, 1024, 1280 and 1440px: does any row of cards or columns end short (3 + 1, 2 + 2 + 1)? `WIDTHS=` and `PAGES=` change what it looks at | Only inline flows that wrap like text are listed (chips, buttons, links, the assistant picker, the PMID links in an open Graveyard idea); no row of cards or columns |
| `node e2e-mcp.mjs` | The MCP route for real: an MCP client (the SDK an AI app uses) over HTTP to the Worker, and a real browser for the person's part. The tools and prompts are there and current (it fails if the local bundle is stale: reseed it); `check_draft` reads an AI's whole reply; a review that does not support the IIP is refused; not signed in, the one-click link opens the form filled in and GitHub posts it; signing in through the connector (approval page, GitHub, PKCE) and `submit_proposal` posts at once, and `get_submission_status` points to the new IIP; Cancel on the approval page goes back to the app. Needs the same three servers as `e2e-submit.mjs` | `6 of 6 scenarios passed` |
| `node touch.mjs` | A simulated finger at 390px (`W=` changes it) taps through every page: the menu row shows the current page, the cure hover, the ring links, the design switch, the specification and its contents, the edit buttons, Copy, Next and the step bar, the route and assistant pickers, the board and Idea Graveyard rows and filters, the consent tick, and that form text is 16px or more (smaller text makes an iPhone zoom in) | Every line `PASS` |
| `node taps.mjs` | The size of every tap target at 390px, with every fold-out open: under 24 by 24 (the WCAG 2.2 minimum, unless spaced out), and under 44px tall (what Apple and Google recommend). Links inside a sentence are left out | Nothing under 24px except the known item below |
| `node jumps.mjs` | Every in-page link on Blueprint and Start at 390, 820 and 1280px: does the heading it jumps to land clear of the bar that stays at the top? | `0 land under the bar` everywhere |
| `node figure-shots.mjs` | Draws the Blueprint page's engineering drawing for Design A, B and X at twice the usual sharpness (`out/figure-A.png`, with `-cell` and `-graft` close-ups). Nothing is checked automatically: you look, for overlaps, crowded labels and a part drawn in the wrong place. `WIDTH=390` gives the phone layout | Nothing touches anything it should not |
| `node e2e-submit.mjs` | The submission form in a real browser against a pretend GitHub and the Worker running here: the sign-in, the issue that comes out, the AI's whole replies pasted as they come (they become a clean issue), a double click, a slow load, blocked storage, a lost answer (needs the three servers started as the file's top comment says) | `11 of 11 scenarios passed` |
| `node xbrowser.mjs` | Every page in Chrome and in WebKit at 1280 and 390px: where every box sits, what the pictures look like, script errors, fonts, missing images, unsupported CSS. Pictures go to `out/` | No script errors or sideways scroll; only text-wrapping differences |
| Lighthouse | Speed, accessibility, best practice, SEO | see below |

Lighthouse, for a phone-like run:

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node_modules/.bin/lighthouse http://127.0.0.1:4500/ --quiet --chrome-flags="--headless=new" \
  --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=out/lh-home.json
node lhsum.mjs out/lh-home.json
```

On 25 October 2026: performance 96 to 100 (home page 97), accessibility 100 and best practice 100 on every page. SEO shows 63 only because the pages say `noindex` until `PUBLIC_INDEXABLE=true`.

## Known false alarms

- `keyboard.mjs` says "no visible focus indicator" on the numbered links in the home page's ring picture and the Blueprint drawing. Those are SVG links whose focus ring is drawn by the picture itself (a ring pill, or a pin that turns white with an amber ring). Tab to one and look.
- `contrast.mjs` lists a few numbers on the Blueprint drawing (dark pin numbers on amber, which move when Design A and Design B are switched) and the "about 350 µm" label (faint grid lines under the text). They read clearly.
- `contrast.mjs` also lists the two "B" labels in the Home page's "Matched to the patient" picture (dark text on a pale pill with a dark outline): the box it measures is a little taller than the pill's inside, so it samples the outline. The text is dark on pale and reads clearly.
- `taps.mjs` lists the numbered pins on the Blueprint drawing as smaller than 24px on a phone. The same parts are a list of full-size links right under the drawing, which is what a phone user taps.
- axe lists some contrast results as "could not decide": text over the photo, gradients and drawings. `contrast.mjs` measures those.

## What could not be tested

Firefox would not start on the Mac these were written on (Firefox 150.0.3 on macOS 27.0.1 would not open even a blank page), and a real iPhone was not tried. WebKit stands in for Safari, but look at the site on an iPhone before launch.
