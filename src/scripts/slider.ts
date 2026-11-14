// A row of cards that slides sideways on a narrow screen (the three designs, the five layers, the six steps) gets a row of dots
// under it: one dot per card, the current one marked, each a button that slides its card into view. The dots show only while the
// row really scrolls, so a wide screen, where every card is in view, has none.
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function setUp(row: HTMLElement): void {
  const only = row.children.length === 1 && /^(OL|UL)$/.test(row.children[0].tagName) ? row.children[0] : row;
  const cards = Array.from(only.children) as HTMLElement[];
  if (cards.length < 2) return;
  const what = row.dataset.slider || 'Card';

  const dots = document.createElement('div');
  dots.className = 'slider-dots';
  dots.setAttribute('role', 'group');
  dots.setAttribute('aria-label', `${row.dataset.label ?? 'Cards'}: choose one`);
  const buttons = cards.map((card, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `${what} ${i + 1} of ${cards.length}`);
    b.addEventListener('click', () => {
      const left = card.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft - parseFloat(getComputedStyle(row).scrollPaddingLeft || '0');
      row.scrollTo({ left, behavior: reduced.matches ? 'auto' : 'smooth' });
    });
    dots.appendChild(b);
    return b;
  });
  row.insertAdjacentElement('afterend', dots);

  function update(): void {
    dots.hidden = row.scrollWidth <= row.clientWidth + 1;
    if (dots.hidden) return;
    // The current card is the one whose left edge is nearest the row's left edge.
    const edge = row.getBoundingClientRect().left + parseFloat(getComputedStyle(row).scrollPaddingLeft || '0');
    let at = 0;
    let best = Infinity;
    cards.forEach((card, i) => {
      const d = Math.abs(card.getBoundingClientRect().left - edge);
      if (d < best) {
        best = d;
        at = i;
      }
    });
    // At the far end the last card may not reach the left edge: it is still the current one.
    if (row.scrollLeft >= row.scrollWidth - row.clientWidth - 2) at = cards.length - 1;
    buttons.forEach((b, i) => (i === at ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  }

  let queued = false;
  row.addEventListener(
    'scroll',
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        update();
      });
    },
    { passive: true },
  );
  new ResizeObserver(update).observe(row);
  update();
}

document.querySelectorAll<HTMLElement>('[data-slider]').forEach(setUp);
