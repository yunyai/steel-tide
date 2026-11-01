// Rebuilding part of a menu replaces its controls. These carry focus, the caret and scroll
// positions over to the new controls with the same `data-k` and `data-scroll-key`.

interface Caret { start: number | null; end: number | null }
export interface UiMemory { focus?: string; caret?: Caret; menuOption?: string; scroll: Map<string, { top: number; left: number }> }

const keyed = (root: ParentNode, key: string): HTMLElement | undefined =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-k]')).find((el) => el.dataset.k === key);

export function rememberUi(root: HTMLElement): UiMemory {
  const scroll = new Map<string, { top: number; left: number }>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-scroll-key]')) scroll.set(el.dataset.scrollKey!, { top: el.scrollTop, left: el.scrollLeft });
  const active = document.activeElement as (HTMLElement & Partial<HTMLInputElement>) | null;
  if (!active || !root.contains(active) || !active.dataset?.k) return { scroll };
  const caret = typeof active.selectionStart === 'number' ? { start: active.selectionStart, end: active.selectionEnd ?? null } : undefined;
  return { scroll, focus: active.dataset.k, caret, menuOption: active.dataset.menuOption };
}

export function restoreUi(root: HTMLElement, m: UiMemory): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-scroll-key]')) {
    const at = m.scroll.get(el.dataset.scrollKey!);
    if (at) { el.scrollTop = at.top; el.scrollLeft = at.left; }
  }
  if (!m.focus) return;
  const active = document.activeElement;
  if (active && root.contains(active)) return;
  const el = keyed(root, m.focus);
  if (!el) return;
  if (m.menuOption !== undefined) el.dataset.menuOption = m.menuOption;
  el.focus({ preventScroll: true });
  if (m.caret && m.caret.start !== null && 'setSelectionRange' in el) {
    try { (el as HTMLInputElement).setSelectionRange(m.caret.start, m.caret.end ?? m.caret.start); } catch { /* inputs without a caret */ }
  }
}

/** Run `rebuild` and put the player back where they were inside `root`. */
export function keepUi(root: HTMLElement, rebuild: () => void): void {
  const m = rememberUi(root);
  rebuild();
  restoreUi(root, m);
}
