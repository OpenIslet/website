// A box that scrolls sideways has to be reachable with the keyboard, and has to have a name, or a keyboard user cannot read the
// part that is out of sight. This turns that on only for boxes that really scroll, so wide screens keep a short Tab order.
const selector = '.tablewrap, .matrix__scroll, .strip__scroll, [data-scroll-region]';

/** The nearest heading above a box, to name a table that has no name of its own. */
function headingAbove(el: Element): string {
  for (let node: Element | null = el; node; node = node.parentElement) {
    for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
      if (/^H[1-6]$/.test(prev.tagName)) return prev.textContent?.trim() ?? '';
      const inner = [...prev.querySelectorAll('h1,h2,h3,h4,h5,h6')].pop();
      if (inner) return inner.textContent?.trim() ?? '';
    }
  }
  return '';
}

function update(el: HTMLElement): void {
  const scrolls = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  if (scrolls) {
    const name = el.dataset.label ?? (headingAbove(el) ? `Table in ${headingAbove(el)}` : 'Table');
    el.tabIndex = 0;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', `${name} (scrolls sideways)`);
  } else if (el.dataset.scrollRegionSet) {
    el.removeAttribute('tabindex');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
  }
  if (scrolls) el.dataset.scrollRegionSet = 'true';
  else delete el.dataset.scrollRegionSet;
}

const boxes = [...document.querySelectorAll<HTMLElement>(selector)];
const observer = new ResizeObserver((entries) => entries.forEach((e) => update(e.target as HTMLElement)));
boxes.forEach((box) => {
  update(box);
  observer.observe(box);
});
window.addEventListener('load', () => boxes.forEach(update));
