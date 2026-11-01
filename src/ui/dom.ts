// Small DOM builders shared by the menus and the LAN lobby.

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const k of kids) el.append(k);
  return el;
}

/** Trusted markup only (icons, fixed copy); never pass anything a player typed. */
export function html(markup: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as HTMLElement;
}

/** A row of toggle buttons, one pressed. */
export function seg<T extends string | number>(options: { value: T; label: string }[], get: () => T, set: (v: T) => void, click: () => void = () => {}, key = ''): HTMLElement {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const render = () => {
    wrap.replaceChildren(
      ...options.map((o) => {
        const b = h('button', { 'aria-pressed': String(get() === o.value), 'data-value': String(o.value), ...(key ? { 'data-k': `${key}-${o.value}` } : {}) }, o.label);
        b.onclick = () => {
          const focused = document.activeElement === b;
          click();
          set(o.value);
          render();
          if (focused) wrap.querySelector<HTMLElement>(`[data-value="${CSS.escape(String(o.value))}"]`)?.focus({ preventScroll: true });
        };
        return b;
      }),
    );
  };
  render();
  return wrap;
}

/** A row of toggle buttons, any number pressed; `all` adds a last button that presses every one. */
export function multiSeg<T extends string>(options: { value: T; label: string }[], get: () => readonly T[], toggle: (v: T) => void, all?: { label: string; set: () => void }, click: () => void = () => {}, key = ''): HTMLElement {
  const wrap = h('div', { class: 'seg seg-multi', role: 'group' });
  const render = () => {
    const on = get();
    const button = (value: string, label: string, pressed: boolean, act: () => void) => {
      const b = h('button', { 'aria-pressed': String(pressed), 'data-value': value, ...(key ? { 'data-k': `${key}-${value}` } : {}) }, label);
      b.onclick = () => {
        const focused = document.activeElement === b;
        click();
        act();
        render();
        if (focused) wrap.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
      };
      return b;
    };
    wrap.replaceChildren(
      ...options.map((o) => button(o.value, o.label, on.includes(o.value), () => toggle(o.value))),
      ...(all ? [button('all', all.label, options.every((o) => on.includes(o.value)), all.set)] : []),
    );
  };
  render();
  return wrap;
}

/** A `[−] value [+]` control for a number on a step; both buttons take keys and a gamepad like any other. */
export function stepper(label: string, get: () => number, set: (v: number) => void, o: { min: number; max: number; step: number; format(v: number): string }, click: () => void = () => {}, key = ''): HTMLElement {
  const value = h('b', { class: 'num', 'aria-live': 'polite' });
  const button = (d: -1 | 1) => {
    const b = h('button', { type: 'button', class: 'btn step', 'aria-label': `${d < 0 ? 'Less' : 'More'}: ${label}`, ...(key ? { 'data-k': `${key}-${d < 0 ? 'down' : 'up'}` } : {}) }, d < 0 ? '−' : '+');
    b.onclick = () => {
      const v = get() + d * o.step;
      if (v < o.min || v > o.max) return;
      click();
      set(v);
      render();
      // A button that just reached its end hands the focus to the other one.
      if (b.disabled) (d < 0 ? up : down).focus({ preventScroll: true });
    };
    return b;
  };
  const down = button(-1);
  const up = button(1);
  const render = () => {
    const v = get();
    value.textContent = o.format(v);
    down.disabled = v - o.step < o.min;
    up.disabled = v + o.step > o.max;
  };
  render();
  return h('div', { class: 'stepper', role: 'group', 'aria-label': label }, down, value, up);
}

export function field(label: string, control: HTMLElement, note?: HTMLElement | string): HTMLElement {
  if (control.getAttribute('role') === 'group' && !control.hasAttribute('aria-label')) control.setAttribute('aria-label', label);
  const f = h('div', { class: 'field' }, h('div', { class: 'label' }, label), control);
  if (note !== undefined) f.append(typeof note === 'string' ? h('p', { class: 'note' }, note) : note);
  return f;
}
