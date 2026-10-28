import type { Input } from '../input/Input';

/** DOM focus keeps keyboard, mouse and controller menus on the same actions. */
export class MenuNavigation {
  private nextMove = 0;

  constructor() {
    // Escape belongs to the open transfer disclosure even when focus has moved outside it.
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      const close=Array.from(document.querySelectorAll<HTMLButtonElement>('.arsenal-transfer:not([hidden]) [data-menu-back]')).find(button=>button.getClientRects().length>0);
      if(!close)return;
      event.preventDefault();event.stopPropagation();close.click();
    },true);
  }

  update(input: Input, now: number): void {
    const roots = Array.from(document.querySelectorAll<HTMLElement>('.title-screen, .hangar, .sheet, [role="dialog"]'));
    const root = roots.reverse().find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if (!root) return;
    for (let pad = 0; pad < 4; pad++) {
      const p = input.pad(pad);
      if (!p) continue;
      const x = p.axes[0] ?? 0, y = p.axes[1] ?? 0;
      const axis = Math.abs(y) >= Math.abs(x) ? y : x;
      const previous = input.padPressed(pad, 12) || input.padPressed(pad, 14);
      const next = input.padPressed(pad, 13) || input.padPressed(pad, 15);
      const move = previous ? -1 : next ? 1 : Math.abs(axis) > 0.6 && now >= this.nextMove ? Math.sign(axis) : 0;
      if (move) {
        this.nextMove = now + 220;
        this.move(root, move);
        for (const button of [12, 13, 14, 15]) input.consumePadPress(pad, button);
      }
      if (input.padPressed(pad, 0)) {
        this.activate(root);
        input.consumePadPress(pad, 0);
      }
      if (input.padPressed(pad, 1)) {
        const back = root.querySelector<HTMLButtonElement>('.arsenal-transfer:not([hidden]) [data-menu-back]') ?? Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b => /^(Back|Resume|Cancel)/i.test(b.textContent?.trim() ?? ''));
        back?.click();
        input.consumePadPress(pad, 1);
      }
    }
  }

  private controls(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]')).filter(e => e.getClientRects().length > 0);
  }

  move(root: HTMLElement, direction: number): void {
    const active = document.activeElement;
    if (active instanceof HTMLSelectElement && root.contains(active)) {
      const i = Number(active.dataset.menuOption ?? active.selectedIndex);
      const next = i + direction;
      if (next >= 0 && next < active.options.length) {
        active.dataset.menuOption = String(next);
        if (!active.multiple) {
          active.selectedIndex = next;
          active.dispatchEvent(new Event('change', { bubbles: true }));
        }
        active.options[next].scrollIntoView({ block: 'nearest' });
        return;
      }
    }
    const controls = this.controls(root);
    const at = controls.indexOf(active as HTMLElement);
    const next = controls[(at + direction + controls.length) % controls.length];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  }

  activate(root: HTMLElement): void {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.contains(active)) { this.controls(root)[0]?.focus(); return; }
    if (active instanceof HTMLSelectElement) {
      if (active.multiple) {
        const option = active.options[Number(active.dataset.menuOption ?? Math.max(0, active.selectedIndex))];
        if (option) option.selected = !option.selected;
        active.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const controls = this.controls(root);
        controls[(controls.indexOf(active) + 1) % controls.length]?.focus();
      }
    } else if (active instanceof HTMLTextAreaElement) active.focus();
    else active.click();
  }
}
