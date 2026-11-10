import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

// The misc titans that share a HUD and effects, seen. Each casts all nine skills at three dummy battleships in three stages,
// and every stage is caught mid-effect with the captain's HUD up: panel, marker chips and all. Then
// a battleship captain is held by each titan, for the banner a victim sees. Everything is captured
// at 1280×720 and 1920×1080, and the run fails if a skill does not fire, the effects change the sim
// or the page logs an error.

const source = process.env.STEEL_URL ?? "http://127.0.0.1:5197";
const out = process.env.MISC_OUT ?? "docs/verification/misc-titans";
const sizes = [
  [1280, 720],
  [1920, 1080],
];
const titans = (process.env.MISC_TITANS ?? "judge,hexweaver,gourmand,faultline,pharos").split(",");
mkdirSync(out, { recursive: true });

// PLAYWRIGHT_EXECUTABLE names a browser binary outright, for systems with no Chrome channel installed,
// and PLAYWRIGHT_ARGS adds launch flags (a headless browser may need telling to use the GPU).
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : { channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" }),
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", ...(process.env.PLAYWRIGHT_ARGS?.split(" ").filter(Boolean) ?? [])],
});
const errors = [];
const rows = [];

/** Starts a battle with `captain` at the origin and parks the page's helpers on `window.miscShot`. */
function setup(page, captain, enemy) {
  return page.evaluate(
    async ({ captain, enemy }) => {
      const { SHIP_BY_ID } = await import("/src/data/ships.ts");
      const { stateHash } = await import("/src/net/hash.ts");
      const judge = await import("/src/skills/misc/JudgeRuntime.ts");
      window.steel.start({
        mode: "solo",
        type: "freeplay",
        mapId: "open",
        teamSize: 1,
        ai: [0, 0],
        difficulty: "normal",
        seed: 17,
        era: "mixed",
        players: [{ shipId: captain, device: "mouse" }],
      });
      const b = window.steel.battle;
      const g = b.game;
      const s = g.humans()[0];
      const pc = b.pcs[0];
      g.ai.clear();
      b.shell.input.capture = false;
      b.shell.input.fallback = true;
      b.shell.input.onLockChange = null;
      b.paused = false;
      b.setOverlay(null);
      s.pos.set(0, 0, 0);
      s.prevPos.copy(s.pos);
      s.renderPos.copy(s.pos);
      s.heading = 0;
      s.speed = 0;
      s.throttle = 2;
      s.secondaries.length = 0;
      const add = (id, x, z, heading = 0) => {
        const t = g.addShip(SHIP_BY_ID[id], 1, id, x, z, heading);
        t.hp = t.maxHp = 5e6;
        t.secondaries.length = 0;
        t.throttle = 2;
        t.speed = 0;
        return t;
      };
      const fired = new Set();
      const f = (window.miscShot = { b, g, s, pc, judge, fired, pure: true, view: { x: 0, z: -600, d: 2300 } });
      g.events.on("skill", (e) => {
        if (e.ship === f.titan) fired.add(e.index);
      });
      if (enemy) {
        // A battleship captain facing an enemy titan, which the script plays by hand.
        f.titan = add(enemy, 0, -1100, Math.PI);
        f.titan.hp = f.titan.maxHp;
        s.hp = s.maxHp = 5e6;
        f.foes = [s];
        f.view = { x: 0, z: -550, d: 2100 };
      } else {
        f.titan = s;
        const near = captain === "gourmand";
        f.foes = near
          ? [add("iowa", 0, -760), add("iowa", 460, -980), add("iowa", -480, -1020)]
          : [add("iowa", 0, -1150), add("iowa", 520, -1380), add("iowa", -540, -1420)];
        f.view = near ? { x: 0, z: -520, d: 2100 } : { x: 0, z: -700, d: 2500 };
      }
      f.aim = (x, z) => {
        f.titan.control.aimX = x;
        f.titan.control.aimZ = z;
      };
      /** Aims at `t`; the captain also locks it, so the panel previews what the titan would do to it. */
      f.at = (t) => {
        f.aim(t.pos.x, t.pos.z);
        if (f.titan === s) pc.lock = t;
      };
      /** Casts slot `i`, ready or not; returns whether it fired. */
      f.cast = (i) => {
        const st = f.titan.skills[i];
        st.cooldown = 0;
        if (st.spec.ult) st.meter = 1;
        return f.titan.activateSkill(i) !== false && fired.has(i);
      };
      /** Casts slot `i` at the first of `points` it accepts (terrain skills refuse cramped water). */
      f.castAt = (i, points) => {
        for (const [x, z] of points) {
          f.aim(x, z);
          if (f.cast(i)) return true;
        }
        return false;
      };
      f.draw = (dt = 1 / 60) => {
        const h = stateHash(g);
        g.interpolate();
        const v = f.view;
        pc.updateCamera = () => {};
        // Looking at a point short of the ships lifts them above the skill bar and the panel.
        pc.camera.position.set(v.x - v.d * 0.38, v.d * 0.62, v.z + v.d * 0.95);
        pc.camera.lookAt(v.x - v.d * 0.08, 0, v.z + v.d * 0.3);
        pc.camera.updateMatrixWorld(true);
        window.steel.renderer.update(dt, [pc.camera]);
        for (const hud of b.huds) hud.update(dt);
        window.steel.renderer.render(b.viewports);
        f.pure &&= stateHash(g) === h;
      };
      /** Runs the sim for `seconds`, drawing every frame so the effects age as they would live. */
      f.run = (seconds) => {
        const end = g.time + seconds;
        while (g.time < end - 1e-6) {
          g.step();
          for (const t of f.foes) if (t.alive) t.hp = Math.max(t.hp, t.maxHp * 0.6);
          f.draw();
        }
      };
      /**
       * Where the panel and banner sit against the hull block: above the name bar, as wide as the
       * hull bar, a full-length main row, a top row reaching across, and nothing spilling out.
       */
      f.layout = () => {
        const hp = document.querySelector(".cockpit .hpbar")?.getBoundingClientRect();
        const nb = document.querySelector(".cockpit .namebar")?.getBoundingClientRect();
        const shown = (e) => !e.hidden && e.getBoundingClientRect().width > 0;
        const one = (e) => {
          if (!e || !shown(e)) return null;
          const r = e.getBoundingClientRect();
          const wide = [...e.querySelectorAll(".mp-wide")].find(shown);
          const top = e.querySelector(".mp-top");
          const last = top ? [...top.children].filter(shown).pop() : null;
          const spill = [...e.querySelectorAll("*")].some((c) => {
            if (!shown(c)) return false;
            const q = c.getBoundingClientRect();
            return q.right > r.right + 1 || q.left < r.left - 1;
          });
          return {
            above: !!nb && r.bottom <= nb.top + 0.5,
            width: hp ? +(r.width / hp.width).toFixed(3) : 0,
            wide: wide ? +(wide.getBoundingClientRect().width / r.width).toFixed(3) : null,
            reach: last ? +((last.getBoundingClientRect().right - r.left) / r.width).toFixed(3) : 0,
            overflow: e.scrollWidth > e.clientWidth + 1 || spill,
          };
        };
        return { panel: one(document.querySelector(".misc-panel")), banner: one(document.querySelector(".misc-banner")) };
      };
      f.report = () => {
        const fx = b.scene.miscFx;
        return {
          time: +g.time.toFixed(2),
          ribbons: fx.ribbons.count + fx.kit.dark.count,
          particles: fx.kit.particles.count,
          panel: document.querySelector(".misc-panel")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
          chips: [...document.querySelectorAll(".misc-chip")].filter((e) => !e.hidden && e.textContent).map((e) => e.textContent),
          banner: (() => {
            const e = document.querySelector(".misc-banner");
            return e && !e.hidden ? e.textContent.replace(/\s+/g, " ").trim() : null;
          })(),
          finite: g.ships.every((t) => Number.isFinite(t.hp) && Number.isFinite(t.pos.x) && Number.isFinite(t.pos.z)),
          pure: f.pure,
          ships: g.ships.length,
          shelf: [...document.querySelectorAll(".hx-slot")].filter((e) => !e.hidden).length,
          panelHeight: Math.round(document.querySelector(".misc-panel")?.getBoundingClientRect().height ?? 0),
          layout: f.layout(),
          dolls: f.titan.hexweaver?.dolls.map((d) => d.pins) ?? null,
          case: f.titan.judge ? f.judge.violationCount(f.titan, f.foes[0]) : null,
        };
      };
      f.draw();
    },
    { captain, enemy },
  );
}

/**
 * The three stages per titan. Each casts its slots, runs to mid-effect and is captured; a stage
 * may add a later frame for an effect with a long fuse.
 */
const STAGES = {
  judge: [
    {
      name: "court",
      run: () => {
        const f = window.miscShot;
        const [a] = f.foes;
        const ok = {};
        f.at(a);
        ok.Q = f.cast(0);
        f.run(0.3);
        f.at(a);
        ok.Z = f.cast(2);
        f.run(0.3);
        f.at(a);
        ok.E = f.cast(1);
        f.run(0.75);
        return ok;
      },
    },
    {
      name: "arrest-taxes",
      run: () => {
        const f = window.miscShot;
        const [a, b] = f.foes;
        const ok = {};
        f.at(b);
        ok.X = f.cast(3);
        f.at(a);
        ok.C = f.cast(4);
        ok.V = f.cast(5);
        f.run(0.45);
        return ok;
      },
    },
    {
      name: "verdict",
      run: () => {
        const f = window.miscShot;
        const [a, b] = f.foes;
        const ok = {};
        f.judge.cite(f.s, a, 40);
        f.at(a);
        ok.R = f.cast(6);
        ok.B = f.cast(8);
        // Verdict last, so the panel's lock lands on b, whose case the Death Penalty leaves intact.
        f.at(b);
        ok.T = f.cast(7);
        // Both warnings run 1.1 s: this frame shows the gavel and the blade descending.
        f.run(0.9);
        return ok;
      },
      later: { name: "verdict-slam", seconds: 0.28 },
    },
  ],
  hexweaver: [
    {
      name: "pin-stitch",
      run: () => {
        const f = window.miscShot;
        const ok = {};
        for (const t of f.foes) {
          f.at(t);
          ok[`Q${t.id}`] = f.cast(0);
          f.run(0.05);
        }
        f.at(f.foes[0]);
        ok.Q2 = f.cast(0);
        f.run(0.1);
        ok.E = f.cast(1);
        f.run(0.15);
        ok.Z = f.cast(2);
        f.run(0.35);
        return ok;
      },
    },
    {
      name: "fire-coven",
      run: () => {
        const f = window.miscShot;
        const ok = {};
        f.at(f.foes[0]);
        ok.X = f.cast(3);
        ok.R = f.cast(6);
        f.aim(-500, -400);
        ok.V = f.cast(5);
        f.run(0.6);
        return ok;
      },
    },
    {
      name: "needles-unmaking",
      run: () => {
        const f = window.miscShot;
        const ok = {};
        f.at(f.foes[0]);
        ok.T = f.cast(7);
        f.run(0.6);
        f.at(f.foes[1]);
        ok.C = f.cast(4);
        f.run(0.15);
        ok.B = f.cast(8);
        f.run(0.3);
        return ok;
      },
    },
  ],
  gourmand: [
    {
      name: "devour-carve",
      run: () => {
        const f = window.miscShot;
        const ok = {};
        f.s.gourmand.pantry = { shells: 6, explosives: 9, wreckage: 4 };
        f.at(f.foes[0]);
        ok.Q = f.cast(0);
        f.run(0.25);
        ok.E = f.cast(1);
        f.at(f.foes[2]);
        ok.X = f.cast(3);
        f.run(0.4);
        return ok;
      },
    },
    {
      name: "cooker-serve",
      run: () => {
        const f = window.miscShot;
        const ok = {};
        f.s.gourmand.pantry = { shells: 6, explosives: 9, wreckage: 4 };
        f.at(f.foes[1]);
        ok.Z = f.cast(2);
        f.run(0.9);
        f.at(f.foes[0]);
        ok.C = f.cast(4);
        ok.V = f.cast(5);
        f.run(0.65);
        return ok;
      },
    },
    {
      name: "banquet-catastrophe",
      run: () => {
        const f = window.miscShot;
        const ok = {};
        f.s.gourmand.pantry = { shells: 8, explosives: 12, wreckage: 6 };
        f.at(f.foes[0]);
        ok.R = f.cast(6);
        ok.T = f.cast(7);
        ok.B = f.cast(8);
        f.run(1.12);
        return ok;
      },
    },
  ],
  faultline: [
    {
      name: "fault-uplift",
      run: () => {
        const f = window.miscShot;
        const ok = {};
        f.s.faultline.pressure = 60;
        f.aim(0, -1300);
        ok.Q = f.cast(0);
        f.run(0.2);
        f.aim(0, -1200);
        ok.Z = f.cast(2);
        ok.E = f.castAt(1, [
          [800, -600],
          [-900, -500],
          [1100, -900],
          [-1100, -900],
        ]);
        f.run(0.65);
        return ok;
      },
    },
    {
      name: "slip-bedrock",
      run: () => {
        const f = window.miscShot;
        const ok = {};
        f.aim(0, -640);
        ok.X = f.cast(3);
        f.run(0.35);
        ok.C = f.cast(4);
        ok.V = f.cast(5);
        f.run(0.4);
        return ok;
      },
    },
    {
      name: "divide-worldbreaker",
      run: () => {
        const f = window.miscShot;
        const ok = {};
        f.s.faultline.pressure = 90;
        ok.R = f.castAt(6, [
          [-300, -1900],
          [700, -1900],
          [-900, -1500],
          [0, -2300],
        ]);
        f.at(f.foes[0]);
        ok.T = f.cast(7);
        ok.B = f.cast(8);
        f.run(1.15);
        return ok;
      },
      later: { name: "caldera-eruption", seconds: 1.0 },
    },
  ],
};

STAGES.pharos = [
  {
    name: "hold-buoy-lance",
    run: () => {
      const f = window.miscShot;
      const ok = {};
      // Start the lamp to port of the dummies, so its sweep crosses all three.
      f.titan.pharos.bearing = -0.7;
      f.run(1.3);
      f.at(f.foes[0]);
      ok.Q = f.cast(0);
      f.run(0.9);
      f.aim(260, -1150);
      ok.C = f.cast(4);
      f.at(f.foes[0]);
      ok.E = f.cast(1);
      f.run(0.78);
      return ok;
    },
  },
  {
    name: "counter-dazzle-dark",
    run: () => {
      const f = window.miscShot;
      const ok = {};
      ok.Z = f.cast(2);
      f.run(0.5);
      ok.X = f.cast(3);
      f.run(0.3);
      ok.V = f.cast(5);
      f.run(0.25);
      return ok;
    },
    later: { name: "relight", seconds: 5.0 },
  },
  {
    name: "twin-daybreak-false-light",
    run: () => {
      const f = window.miscShot;
      const ok = {};
      ok.R = f.cast(6);
      f.aim(f.foes[1].pos.x + 200, f.foes[1].pos.z - 300);
      ok.B = f.cast(8);
      f.at(f.foes[0]);
      ok.T = f.cast(7);
      f.run(2.1);
      return ok;
    },
    later: { name: "false-light-burst", seconds: 1.6 },
  },
];

/** What each titan does to a battleship captain for the victim banner, and when to look. */
const VICTIM = {
  pharos: () => {
    const f = window.miscShot;
    f.titan.pharos.bearing = Math.PI;
    f.at(f.s);
    f.cast(0);
    f.run(1.4);
    f.cast(3);
    f.run(0.3);
  },
  judge: () => {
    const f = window.miscShot;
    f.at(f.s);
    f.cast(0);
    f.s.throttle = 4;
    f.run(1.2);
    f.judge.cite(f.titan, f.s, 18);
    f.run(0.1);
  },
  hexweaver: () => {
    const f = window.miscShot;
    const ok = {};
    f.at(f.s);
    f.run(0.1);
    ok.Q = f.cast(0);
    ok.dolls = f.titan.hexweaver.dolls.length;
    f.run(0.1);
    ok.Q2 = f.cast(0);
    f.run(0.1);
    ok.E = f.cast(1);
    ok.X = f.cast(3);
    f.run(0.5);
    return ok;
  },
  gourmand: () => {
    const f = window.miscShot;
    f.titan.pos.set(0, 0, -800);
    f.titan.prevPos.copy(f.titan.pos);
    f.at(f.s);
    f.cast(7);
    f.run(0.35);
  },
};

/** What is wrong with a panel or banner's place and shape; `main` demands a full-length main row. */
function layoutProblems(name, l, main) {
  if (!l) return [`${name}: not shown`];
  const p = [];
  if (!l.above) p.push(`${name}: not above the hull bar`);
  if (l.width < 0.98) p.push(`${name}: only ${l.width} of the hull bar's width`);
  if ((main || l.wide !== null) && !(l.wide >= 0.55)) p.push(`${name}: main row spans ${l.wide} of the panel`);
  if (l.reach < 0.85) p.push(`${name}: top row reaches ${l.reach} across`);
  if (l.overflow) p.push(`${name}: content spills out`);
  return p;
}

try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    // The page never ticks on its own: every frame below is stepped and drawn by hand.
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 1;
    });
    await page.goto(source);
    await page.waitForFunction(() => window.steel);
    for (const id of titans) {
      await setup(page, id, null);
      const stages = [];
      for (const stage of STAGES[id]) {
        const ok = await page.evaluate(stage.run);
        const shot = `${out}/${id}-${stage.name}-${width}.png`;
        await page.screenshot({ path: shot });
        stages.push({ name: stage.name, ok, shot, ...(await page.evaluate(() => window.miscShot.report())) });
        if (stage.later) {
          await page.evaluate((s) => window.miscShot.run(s), stage.later.seconds);
          const later = `${out}/${id}-${stage.later.name}-${width}.png`;
          await page.screenshot({ path: later });
          stages.push({ name: stage.later.name, ok: {}, shot: later, ...(await page.evaluate(() => window.miscShot.report())) });
        }
      }
      const panel = `${out}/${id}-panel-${width}.png`;
      await page.locator(".misc-panel").first().screenshot({ path: panel });
      const fired = await page.evaluate(() => [...window.miscShot.fired].sort());
      const row = { id, width, fired, panel, stages };
      if (VICTIM[id]) {
        await setup(page, "iowa", id);
        const cast = await page.evaluate(VICTIM[id]);
        const shot = `${out}/${id}-victim-${width}.png`;
        await page.screenshot({ path: shot });
        row.victim = { shot, cast, ...(await page.evaluate(() => window.miscShot.report())) };
      }
      rows.push(row);
      console.log(
        `${width} ${id}: fired ${fired.join("")} | ${stages.map((s) => `${s.name} r${s.ribbons} p${s.particles} chips[${s.chips.join(" ")}]`).join(" | ")}${row.victim ? ` | victim: ${row.victim.banner}` : ""}`,
      );
    }
    await context.close();
  }
  writeFileSync(`${out}/browser-results.json`, JSON.stringify({ rows, errors }, null, 2));
  const problems = [];
  for (const r of rows) {
    if (r.fired.length !== 9) problems.push(`${r.id}@${r.width}: fired ${r.fired.join(",")}`);
    for (const s of r.stages) {
      if (!s.pure) problems.push(`${r.id}@${r.width} ${s.name}: effects changed the sim`);
      if (!s.finite) problems.push(`${r.id}@${r.width} ${s.name}: non-finite state`);
      if (s.ribbons + s.particles === 0) problems.push(`${r.id}@${r.width} ${s.name}: nothing drawn`);
      if (!s.panel) problems.push(`${r.id}@${r.width} ${s.name}: no titan panel`);
      problems.push(...layoutProblems(`${r.id}@${r.width} ${s.name} panel`, s.layout.panel, true));
    }
    if (r.id !== "faultline" && !r.stages.some((s) => s.chips.length)) problems.push(`${r.id}@${r.width}: no marker chip`);
    if (r.victim && !r.victim.banner) problems.push(`${r.id}@${r.width}: no victim banner`);
    if (r.victim) problems.push(...layoutProblems(`${r.id}@${r.width} victim banner`, r.victim.layout.banner, false));
  }
  if (errors.length) problems.push(...errors);
  if (problems.length) throw Error(problems.join("\n"));
} finally {
  await browser.close();
}
