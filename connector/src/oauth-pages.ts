// The two plain pages the connector's sign-in shows: the approval page, and a short message page for anything that stops it.
// No script and no image files: the OpenIslet mark at the top is drawn inline, so the person can see whose page this is. Everything
// that came from an AI app (its name, its addresses) is escaped before it is shown.
import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { CONTACT_EMAIL } from './core/contact';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Headers for the pages: no framing, no caching, and a policy that allows the page's own inline style and nothing else. */
export const PAGE_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

const STYLE = `
:root{color-scheme:light dark;--bg:#f5f7f8;--fg:#0b1b26;--muted:#4b5d69;--line:#d8e0e5;--accent:#2a3fd6;--accent-fg:#fff;--warn-bg:#fff3dc;--warn-fg:#7a4a00;--mark-big:#0b1b26;--mark-mid:#2a3fd6;--mark-edge:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0b1b26;--fg:#e6edf2;--muted:#a6b6c2;--line:#2a4152;--accent:#8ea0ff;--accent-fg:#0b1b26;--warn-bg:#3a2f0b;--warn-fg:#ffe9a8;--mark-big:#e6edf2;--mark-mid:#8ea0ff;--mark-edge:#0b1b26}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:1.0625rem/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:38rem;margin:0 auto;padding:1.5rem 1rem 3rem}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 1rem}
p,ul,dl{margin:0 0 1rem}
li{margin:0 0 .5rem}
dl{border:1px solid var(--line);border-radius:.5rem;padding:.75rem 1rem}
dt{font-weight:600;color:var(--muted);font-size:.9rem}
dd{margin:0 0 .6rem;overflow-wrap:anywhere}
dd:last-child{margin-bottom:0}
.warn{background:var(--warn-bg);color:var(--warn-fg);border-radius:.5rem;padding:.75rem 1rem}
.buttons{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.25rem}
button{font:inherit;min-height:2.75rem;padding:.5rem 1.1rem;border-radius:.5rem;border:2px solid var(--accent);cursor:pointer}
button.primary{background:var(--accent);color:var(--accent-fg);font-weight:600}
button.secondary{background:transparent;color:var(--fg);border-color:var(--line)}
button:focus-visible{outline:3px solid var(--fg);outline-offset:2px}
.small{font-size:.9rem;color:var(--muted)}
.brand{display:flex;align-items:center;gap:.6rem;margin:0 0 1.75rem;font-weight:600;font-size:1.25rem;letter-spacing:-.01em}
.brand svg{width:2rem;height:2rem;flex:none}
`;

/** The OpenIslet mark (three islet cells), drawn inline so the page needs no image file. */
const BRAND = `<p class="brand"><svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="14" cy="19" r="11" fill="var(--mark-big)"/><circle cx="25.5" cy="10" r="7.8" fill="var(--mark-mid)" stroke="var(--mark-edge)" stroke-width="1.5"/><circle cx="26" cy="26" r="4.5" fill="var(--mark-edge)" stroke="var(--mark-big)" stroke-width="2"/></svg>OpenIslet</p>`;

function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${BRAND}
${inner}
</main>
</body>
</html>
`;
}

/** The page that asks the person to approve the connection, before they are sent to GitHub. */
export function consentPage(details: ConsentDescription, handle: string): string {
  const app = escapeHtml(details.clientName);
  const published = details.clientDomain
    ? `<dd>${escapeHtml(details.clientDomain)}</dd>`
    : '<dd>This app registered itself, so its name has not been checked.</dd>';
  const local = details.redirectIsLoopback
    ? '<p class="warn"><strong>This sends the sign-in back to an app on your own computer.</strong> Continue only if you have just started connecting OpenIslet from that app.</p>'
    : '';
  return shell(
    'Connect your AI app to OpenIslet',
    `<h1>Let ${app} send Islet Improvement Proposals (IIPs) to OpenIslet as you?</h1>
<p><strong>${app}</strong> wants to connect to the OpenIslet connector, so that it can send in IIPs for you.</p>
<ul>
<li>You will sign in with GitHub next. OpenIslet sees only your public profile (your username and your account number). It does not see your email address or your repositories, and it cannot change anything on your GitHub account.</li>
<li>An IIP you send becomes a public issue that names you. IIPs are published openly under CC BY 4.0.</li>
<li>For 7 days after you approve, it can send IIPs in your name without asking you here again.</li>
</ul>
<dl>
<dt>App asking</dt><dd>${app}</dd>
<dt>Published by</dt>${published}
<dt>After GitHub, you are sent back to</dt><dd>${escapeHtml(details.redirectHost)}</dd>
</dl>
${local}
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<div class="buttons">
<button type="submit" name="decision" value="approve" class="primary">Continue with GitHub</button>
<button type="submit" name="decision" value="deny" class="secondary">Cancel</button>
</div>
</form>
<p class="small">No GitHub account yet? You can make one on the next screen in a minute, for example with your Google or Apple account.</p>`,
  );
}

/** A short page for when the sign-in cannot go on. */
export function messagePage(title: string, message: string): string {
  return shell(
    title,
    `<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
<p class="small">If this keeps happening, tell us at ${escapeHtml(CONTACT_EMAIL)}.</p>`,
  );
}
