import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Input listens on window and document; a bare stand-in for each is enough to drive its keys here.
type Handler = (e: unknown) => void;
let handlers: Record<string, Handler> = {};
const g = globalThis as Record<string, unknown>;

beforeEach(() => {
  handlers = {};
  g.window = { addEventListener: (t: string, f: Handler) => (handlers[t] = f), localStorage: { getItem: () => null, setItem: () => {} } };
  g.document = { addEventListener: () => {} };
});

afterEach(() => {
  delete g.window;
  delete g.document;
});

/** Press a key; true when the browser's own action for it was stopped. */
function press(code: string): boolean {
  let prevented = false;
  handlers.keydown({ code, repeat: false, preventDefault: () => (prevented = true) });
  handlers.keyup({ code });
  return prevented;
}

describe('keys a paused battle keeps', () => {
  it('keeps the claimed shortcuts from the browser while capture is off, and only those', async () => {
    const { Input } = await import('../src/input/Input');
    const input = new Input({ addEventListener: () => {} } as never);
    // Paused: the menus have the keyboard, so game keys go back to the browser.
    input.capture = false;
    expect(press('F6')).toBe(false);
    // A Sandbox battle claims its F-keys: Chrome's F6 would otherwise jump to the address bar.
    input.claimed = new Set(['F6', 'F7', 'F8']);
    expect(press('F6')).toBe(true);
    expect(press('F7')).toBe(true);
    expect(press('F8')).toBe(true);
    expect(press('Tab')).toBe(false);
    input.claimed = new Set();
    expect(press('F6')).toBe(false);
  });
});
