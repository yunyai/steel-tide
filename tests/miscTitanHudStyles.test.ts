import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The misc titan HUD toggles state classes on its own elements. A state class that is also a
// global HUD class picks up that rule too: `.hurt`, the screen's damage vignette, once made a doll
// slot absolute and invisible every time its ship was hit.

const hud = readFileSync('src/ui/MiscTitanHud.ts', 'utf8');
const css = readFileSync('src/ui/styles.css', 'utf8');

/** Every class the misc HUD toggles: with `setFlag`, `flash` or `classList`. */
const toggled = [...new Set([...hud.matchAll(/\b(?:setFlag\([^,]+,|flash\([^,]+,|classList\.(?:toggle|add)\()\s*'([\w-]+)'/g)].map((m) => m[1]))];

describe('Misc titan HUD state classes', () => {
  it('are found in the HUD source', () => {
    expect(toggled.length).toBeGreaterThan(5);
  });

  it.each(toggled)('give %s no global rule of its own', (cls) => {
    // A selector that starts with the bare class (`.hurt {`, `.hurt,`, `.hurt .x`) styles every
    // element carrying it, the misc HUD's included.
    const bare = new RegExp(`(^|[},])\\s*\\.${cls}(?![\\w-])(?!\\[)(?!\\.)`, 'm');
    expect(css).not.toMatch(bare);
  });
});
