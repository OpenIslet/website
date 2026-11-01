// Rows that scroll sideways on a phone (the menu, the Start here step bar, the Blueprint section links, wide tables) fade out at
// the edge that has more to show, so they never look cut off by mistake. The current item in a row is scrolled into view.
const selector = '[data-sidescroll], .tablewrap, .matrix__scroll, .strip__scroll, pre[data-scroll-region]';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function update(row: HTMLElement): void {
  const max = row.scrollWidth - row.clientWidth;
  row.classList.toggle('has-more-left', max > 1 && row.scrollLeft > 1);
  row.classList.toggle('has-more-right', max > 1 && row.scrollLeft < max - 1);
}

/** Scrolls a sideways row (only the row, never the page) so that one of its items is fully in view, clear of the fade. */
export function revealInRow(row: HTMLElement, item: HTMLElement, smooth = true): void {
  if (row.scrollWidth <= row.clientWidth + 1) return;
  const box = row.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  const room = 40;
  let by = 0;
  if (r.left < box.left + room) by = r.left - box.left - room;
  else if (r.right > box.right - room) by = r.right - box.right + room;
  if (by) row.scrollBy({ left: by, behavior: smooth && !reduced.matches ? 'smooth' : 'auto' });
}

const rows = [...document.querySelectorAll<HTMLElement>(selector)];
const observer = new ResizeObserver((entries) => entries.forEach((e) => update(e.target as HTMLElement)));
rows.forEach((row) => {
  const current = row.querySelector<HTMLElement>('[aria-current]');
  if (current) revealInRow(row, current, false);
  update(row);
  row.addEventListener('scroll', () => update(row), { passive: true });
  observer.observe(row);
});
