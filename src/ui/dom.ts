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

export function field(label: string, control: HTMLElement, note?: HTMLElement | string): HTMLElement {
  if (control.getAttribute('role') === 'group' && !control.hasAttribute('aria-label')) control.setAttribute('aria-label', label);
  const f = h('div', { class: 'field' }, h('div', { class: 'label' }, label), control);
  if (note !== undefined) f.append(typeof note === 'string' ? h('p', { class: 'note' }, note) : note);
  return f;
}
