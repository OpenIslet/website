(() => {
  const want = new Set(['section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'h1', 'h2', 'h3', 'h4', 'figure', 'table', 'img', 'button', 'summary', 'details', 'ul', 'ol', 'li', 'p', 'pre', 'a', 'svg', 'form', 'input', 'select', 'textarea', 'dl', 'blockquote']);
  const counts = {};
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    const t = el.tagName.toLowerCase();
    if (!want.has(t)) continue;
    const outer = el.closest('svg');
    if (outer && outer !== el) continue;
    counts[t] = (counts[t] || 0) + 1;
    if (getComputedStyle(el).display === 'none') continue;
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const k = (n) => Math.round(n * 10) / 10;
    out.push([t + '#' + counts[t], k(r.left + scrollX), k(r.top + scrollY), k(r.width), k(r.height), cls, label]);
  }
  return out;
})()
