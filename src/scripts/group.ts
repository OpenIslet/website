// Shared wiring for "pick one" controls. Every panel is rendered by the server and
// hidden; picking a button only flips `hidden` and the pressed or selected state.
// The same data attribute (data-<key>="<id>") marks a button and the panel it controls.

interface Options {
  key: string;
  buttons: string;
  panels: string;
  aria?: 'aria-pressed';
  root?: ParentNode;
  onChange?: (id: string) => void;
}

export function wireGroup(opts: Options): (id: string) => void {
  const root = opts.root ?? document;
  const aria = opts.aria ?? 'aria-pressed';
  const buttons = Array.from(root.querySelectorAll<HTMLElement>(opts.buttons));
  const panels = Array.from(root.querySelectorAll<HTMLElement>(opts.panels));
  const validIds = new Set(buttons.map((b) => b.dataset[opts.key]).filter((id): id is string => typeof id === 'string' && id.length > 0));

  const select = (id: string) => {
    if (!validIds.has(id)) return;
    buttons.forEach((b) => b.setAttribute(aria, String(b.dataset[opts.key] === id)));
    panels.forEach((p) => {
      p.hidden = p.dataset[opts.key] !== id;
    });
    opts.onChange?.(id);
  };

  buttons.forEach((b) => b.addEventListener('click', () => select(b.dataset[opts.key] ?? '')));
  return select;
}

const originalLabels = new WeakMap<HTMLElement, string>();
const resetTimers = new WeakMap<HTMLElement, number>();
const copyAttempts = new WeakMap<HTMLElement, number>();

/** The older way to copy, for in-app browsers that block the clipboard API: select the text in a hidden box and ask the page to copy it. */
function oldCopy(text: string): boolean {
  try {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(box);
    box.select();
    box.setSelectionRange(0, text.length);
    const worked = document.execCommand('copy');
    box.remove();
    return worked;
  } catch {
    return false;
  }
}

/** Copy text and flash the button label for a moment. Falls back to the older copy command if the clipboard is blocked. Says whether the copy worked. */
export async function copyWithFlash(button: HTMLElement, text: string, done = 'Copied'): Promise<boolean> {
  // A button may keep hidden words for screen readers beside its visible label; only the label flashes.
  const target = button.querySelector<HTMLElement>('[data-copy-text]') ?? button;
  if (!originalLabels.has(button)) {
    originalLabels.set(button, target.textContent ?? '');
  }
  const original = originalLabels.get(button) ?? '';
  const attempt = (copyAttempts.get(button) ?? 0) + 1;
  copyAttempts.set(button, attempt);
  const clearExistingTimer = () => {
    const previousTimer = resetTimers.get(button);
    if (previousTimer !== undefined) {
      window.clearTimeout(previousTimer);
    }
  };
  const scheduleRestore = () => {
    clearExistingTimer();
    const timer = window.setTimeout(() => {
      if (copyAttempts.get(button) === attempt) {
        target.textContent = original;
        resetTimers.delete(button);
      }
    }, 1800);
    resetTimers.set(button, timer);
  };
  try {
    await navigator.clipboard.writeText(text);
    if (copyAttempts.get(button) !== attempt) return true;
    target.textContent = done;
    scheduleRestore();
    return true;
  } catch {
    if (copyAttempts.get(button) !== attempt) return false;
    if (oldCopy(text)) {
      target.textContent = done;
      scheduleRestore();
      return true;
    }
    target.textContent = 'Copy failed';
    scheduleRestore();
    return false;
  }
}
