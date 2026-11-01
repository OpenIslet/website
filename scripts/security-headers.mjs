// The security headers for every page, written after each build (an Astro integration, see astro.config.mjs).
//  - <outDir>/_headers               what Cloudflare adds to the live site's files
//  - <outDir>/security-headers.json  the same list for site-worker/staging-gate.js: staging answers from Worker code,
//                                    which _headers does not reach
//  - <outDir>/.assetsignore          keeps that JSON file from being uploaded as a page
// The Content-Security-Policy lets in only this site's own files, the connector the forms talk to (each page's
// data-api), the small scripts written into the pages, each by its hash, and Cloudflare's visitor counter. Nothing
// else is typed in by hand, so a new inline script or connector address is picked up by the next build. The build stops on an inline event handler
// (onclick="…") or a javascript: link, because the policy would quietly block them.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Script types the browser runs. Anything else (JSON data, for example) is not covered by the policy.
const RUNS = new Set(['', 'module', 'text/javascript', 'application/javascript']);
// Cloudflare reads at most 2,000 characters on one _headers line.
const MAX_LINE = 2000;
// Cloudflare Web Analytics (visitor counts and countries; Kev, 30 October 2026). Cloudflare adds its script to each
// page itself; the script's file name carries a version, so the whole host is allowed. It reports to /cdn-cgi/rum on
// this site's own address, which 'self' already covers.
const CLOUDFLARE_ANALYTICS = 'https://static.cloudflareinsights.com';

/** Reads every built page: the hashes of its inline scripts, the connector it calls, and anything the policy would block. */
export async function readPages(dir) {
  const hashes = new Set();
  const origins = new Set();
  const problems = [];
  const files = (await readdir(dir, { recursive: true })).filter((f) => f.endsWith('.html')).sort();
  for (const file of files) {
    const html = await readFile(join(dir, file), 'utf8');
    for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\ssrc\s*=/i.test(attrs)) continue;
      const type = (/\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? '').toLowerCase();
      if (RUNS.has(type)) hashes.add(createHash('sha256').update(body, 'utf8').digest('base64'));
    }
    for (const [, api] of html.matchAll(/\sdata-api="([^"]+)"/g)) {
      try {
        origins.add(new URL(api).origin);
      } catch {
        problems.push(`${file}: data-api "${api}" is not an address`);
      }
    }
    for (const [tag] of html.matchAll(/<[a-z][^>]*?\son[a-z]+\s*=/gi)) problems.push(`${file}: inline event handler in ${tag.slice(0, 80)}`);
    if (/\s(?:href|src|action)\s*=\s*["']?\s*javascript:/i.test(html)) problems.push(`${file}: a javascript: link`);
  }
  return { pages: files.length, hashes, origins, problems };
}

/** The header list, from what readPages found. */
export function securityHeaders({ hashes, origins }) {
  const policy = [
    "default-src 'self'",
    ["script-src 'self'", CLOUDFLARE_ANALYTICS, ...[...hashes].sort().map((h) => `'sha256-${h}'`)].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self'",
    ["connect-src 'self'", ...[...origins].sort()].join(' '),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': policy,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000',
  };
}

export default function securityHeadersIntegration() {
  return {
    name: 'openislet-security-headers',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const out = fileURLToPath(dir);
        const found = await readPages(out);
        if (found.problems.length) throw new Error(`The security policy would block part of these pages:\n  ${found.problems.join('\n  ')}`);
        const headers = securityHeaders(found);
        const lines = ['/*', ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)];
        const long = lines.find((line) => line.length > MAX_LINE);
        if (long) throw new Error(`A _headers line is ${long.length} characters, over Cloudflare's ${MAX_LINE}: ${long.slice(0, 60)}…`);
        await writeFile(join(out, '_headers'), `${lines.join('\n')}\n`);
        await writeFile(join(out, 'security-headers.json'), `${JSON.stringify(headers, null, 2)}\n`);
        await writeFile(join(out, '.assetsignore'), 'security-headers.json\n');
        logger.info(`security headers: ${found.hashes.size} inline scripts allowed by hash over ${found.pages} pages; connector ${[...found.origins].join(', ') || 'none'}`);
      },
    },
  };
}
