import fs from 'node:fs';
const file = process.argv[2];
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const c = r.categories;
const pct = (x) => Math.round((x.score ?? 0) * 100);
const a = r.audits;
const ms = (id) => (a[id]?.numericValue != null ? Math.round(a[id].numericValue) + ' ms' : 'n/a');
console.log(`${new URL(r.requestedUrl).pathname} [${r.configSettings.formFactor}]  performance ${pct(c.performance)}  accessibility ${pct(c.accessibility)}  best-practices ${pct(c['best-practices'])}  seo ${pct(c.seo)}`);
console.log(`  FCP ${ms('first-contentful-paint')} | LCP ${ms('largest-contentful-paint')} | TBT ${ms('total-blocking-time')} | CLS ${a['cumulative-layout-shift']?.numericValue?.toFixed(3)} | SI ${ms('speed-index')} | weight ${Math.round((a['total-byte-weight']?.numericValue ?? 0) / 1024)} KB`);
const lcp = a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet;
if (lcp) console.log('  LCP element:', lcp.slice(0, 110));
const bad = Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode !== 'informative' && x.scoreDisplayMode !== 'notApplicable' && x.scoreDisplayMode !== 'manual');
for (const x of bad.sort((p, q) => p.score - q.score)) {
  const save = x.details?.overallSavingsMs ? ` (could save ~${Math.round(x.details.overallSavingsMs)} ms)` : x.details?.overallSavingsBytes ? ` (could save ~${Math.round(x.details.overallSavingsBytes / 1024)} KB)` : '';
  console.log(`  - ${x.id} [${Math.round(x.score * 100)}]: ${x.title}${save}`);
}
