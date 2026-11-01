// Run against npm run dev; uses installed Chrome, or PLAYWRIGHT_CHANNEL for another browser.
// Checks the sea on every tier, with and without anti-tiling: the shaders compile, the ripple
// lattice repeats at least 40% less, the GPU cost stays within budget, and gameplay-angle shots land
// in docs/verification/ocean (or OUT) for a look.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.STEEL_URL ?? 'http://127.0.0.1:5173';
const out = process.env.OUT ?? 'docs/verification/ocean';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: process.env.HEADED !== '1' });
const failures = [];
const require = (v, message) => { if (!v) failures.push(message); };
const report = { tiers: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (process.env.DEBUG) {
    page.on('framenavigated', (f) => console.error('navigated', f.url()));
    page.on('console', (m) => console.error('console', m.type(), m.text().slice(0, 300)));
  }
  await page.goto(base);
  await page.waitForFunction(() => window.steel);
  // Let the dev server settle: a fresh source edit can still reload the page once.
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.steel);
  // A bench of our own: its own canvas and renderer over the page, the same three the game loads.
  await page.evaluate(async () => {
    const src = await (await fetch('/src/render/Ocean.ts')).text();
    const url = src.match(/from\s+["'](\/node_modules\/\.vite\/deps\/three\.js[^"']*)["']/)[1];
    const THREE = await import(url);
    const { Ocean } = await import('/src/render/Ocean.ts');
    const { Environment } = await import('/src/render/Environment.ts');
    const { MAP_BY_ID } = await import('/src/world/GameMap.ts');
    const { oceanLayers } = await import('/src/render/OceanLayers.ts');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999';
    document.body.append(canvas);
    const gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    gl.setPixelRatio(1);
    gl.setSize(innerWidth, innerHeight, false);
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    const ctx = gl.getContext();
    const info = ctx.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    const scene = new THREE.Scene();
    const env = new Environment(scene, MAP_BY_ID.open);
    env.bake(gl);
    gl.toneMappingExposure = env.look.exposure;
    const make = (tier, antiTile) => {
      const o = new Ocean(env.look, env.sunDir, env.skyCube, tier, antiTile);
      o.update(100);
      return o;
    };
    window.oceanBench = { THREE, gl, ctx, gpu, scene, env, make, oceanLayers, canvas };
  });
  const gpu = await page.evaluate(() => window.oceanBench.gpu);
  const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  report.gpu = gpu;

  for (const tier of [0, 1, 2]) {
    const row = { tier };
    // 1. Both shaders compile and link.
    row.compiled = await page.evaluate((tier) => {
      const { THREE, gl, scene, make } = window.oceanBench;
      const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 60000);
      cam.position.set(0, 40, 160);
      cam.lookAt(0, 0, -600);
      const ok = {};
      for (const anti of [false, true]) {
        const o = make(tier, anti);
        o.follow(cam);
        scene.add(o.mesh);
        gl.compile(scene, cam);
        gl.render(scene, cam);
        scene.remove(o.mesh);
        const prog = gl.properties.get(o.material).currentProgram;
        ok[anti ? 'anti' : 'before'] = !!prog && prog.diagnostics?.runnable !== false;
        o.dispose();
      }
      return ok;
    }, tier);
    require(row.compiled.before && row.compiled.anti, `tier ${tier}: a shader failed to compile`);

    // 2. Repetition: for each ripple layer on its own, render its slope straight down (distance fades
    // held at 1, every other term dropped), at 40 pixels a tile over 32 tiles, and correlate the image
    // with itself one tile over along the layer's lattice. A lattice shift scores what it beats the
    // same-length shifts turned or stretched off the lattice by (the wind envelope correlates a little
    // at any short shift). Each layer is scored against the one it replaces in the old table.
    row.repetition = await page.evaluate((tier) => {
      const { THREE, gl, scene, make, oceanLayers } = window.oceanBench;
      const N = 1280, PER = 40, m = 48;
      const rt = new THREE.WebGLRenderTarget(N, N, { depthBuffer: true, type: THREE.FloatType });
      const solo = new THREE.Scene();
      const lit = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
      // The layer's slope alone, as two images (x and z).
      const slopes = (anti, scale) => {
        const o = make(tier, anti);
        const tag = `, ${lit(scale)},`;
        let first = true;
        o.material.fragmentShader = o.material.fragmentShader
          .replace(/float (fine|mid|broad|atten) = [^;]+;/g, 'float $1 = 1.0;')
          .split('\n')
          .flatMap((line) => {
            if (!/^\s*slope \+= ripple/.test(line)) return [line];
            const keep = line.includes(tag) ? [line] : [];
            if (!first) return keep;
            first = false;
            return ['  slope = vec2(0.0);', ...keep];
          })
          .join('\n')
          .replace('  vec3 N = normalize', '  gl_FragColor = vec4(slope, 0.0, 1.0);\n  return;\n  vec3 N = normalize');
        const px = scale / PER;
        const cam = new THREE.OrthographicCamera((-N / 2) * px, (N / 2) * px, (N / 2) * px, (-N / 2) * px, 1, 2000);
        cam.position.set(4321, 420, -2789);
        cam.up.set(0, 0, -1);
        cam.lookAt(4321, 0, -2789);
        cam.updateMatrixWorld();
        o.mesh.position.set(cam.position.x, 0, cam.position.z);
        o.mesh.updateMatrixWorld();
        solo.add(o.mesh);
        gl.setRenderTarget(rt);
        gl.render(solo, cam);
        const buf = new Float32Array(N * N * 4);
        gl.readRenderTargetPixels(rt, 0, 0, N, N, buf);
        gl.setRenderTarget(null);
        solo.remove(o.mesh);
        o.dispose();
        const sx = new Float32Array(N * N), sz = new Float32Array(N * N);
        for (let i = 0; i < N * N; i++) { sx[i] = buf[i * 4]; sz[i] = buf[i * 4 + 1]; }
        return [sx, sz];
      };
      // Pearson correlation of an image with itself shifted by (dx, dy) pixels, bilinear.
      const corr1 = (L, dx, dy) => {
        const ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy;
        let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
        for (let y = m; y < N - m; y += 2) {
          const y2 = y + iy;
          for (let x = m; x < N - m; x += 2) {
            const x2 = x + ix;
            const a = L[y * N + x];
            const b = (L[y2 * N + x2] * (1 - fx) + L[y2 * N + x2 + 1] * fx) * (1 - fy) + (L[(y2 + 1) * N + x2] * (1 - fx) + L[(y2 + 1) * N + x2 + 1] * fx) * fy;
            n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
          }
        }
        const cov = sab / n - (sa / n) * (sb / n);
        return cov / Math.sqrt(Math.max(1e-12, (saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2)));
      };
      const corr = (img, dx, dy) => (corr1(img[0], dx, dy) + corr1(img[1], dx, dy)) / 2;
      // World x is pixel x; world -z is pixel up (readback rows run bottom to top).
      const score = (img, angle) => {
        const c = Math.cos(angle), s = Math.sin(angle);
        const vs = [[PER * c, -PER * s], [-PER * s, -PER * c]];
        let total = 0;
        for (const [x, y] of vs) {
          const off = [0.45, -0.45, 0.9, -0.9].map((a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]).concat([[x * 0.8, y * 0.8], [x * 1.2, y * 1.2]]);
          const base = off.reduce((t, [ox, oy]) => t + corr(img, ox, oy), 0) / off.length;
          total += Math.max(0, corr(img, x, y) - base);
        }
        return total / vs.length;
      };
      const was = oceanLayers({ tier, antiTile: false });
      const now = oceanLayers({ tier, antiTile: true });
      const layers = now.map((l, i) => ({
        scale: l.scale,
        replaces: was[i]?.scale ?? null,
        before: was[i] ? score(slopes(false, was[i].scale), was[i].angle) : null,
        anti: score(slopes(true, l.scale), l.angle),
      }));
      rt.dispose();
      const paired = layers.filter((l) => l.before !== null);
      const mean = (k) => paired.reduce((t, l) => t + l[k], 0) / paired.length;
      return { before: mean('before'), anti: mean('anti'), layers };
    }, tier);
    const drop = 1 - row.repetition.anti / row.repetition.before;
    row.repetition.drop = drop;
    require(drop >= 0.4, `tier ${tier}: repetition only dropped ${(drop * 100).toFixed(0)}% (needs 40%)`);

    // 3. GPU cost at a gameplay angle: the sea alone (no sky dome) at 1920×1080, A/B interleaved.
    // Each sample is ten draws between two pixel reads, which wait for the GPU, so it times finished
    // work with the GPU kept busy. (ANGLE's Metal timer queries report how long a draw waited in
    // the queue, not how long it ran, so they are not used.) Each A/B pair runs back to back and the
    // median of the pair ratios is what counts; clock changes between pairs cancel out.
    if (software) row.cost = 'not measured (software renderer)';
    else {
      row.cost = await page.evaluate(async (tier) => {
        const { THREE, gl, make } = window.oceanBench;
        const W = 1920, H = 1080;
        const solo = new THREE.Scene();
        const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
        const cam = new THREE.PerspectiveCamera(55, W / H, 1, 60000);
        cam.position.set(0, 38, 150);
        cam.lookAt(0, 0, -700);
        cam.updateMatrixWorld();
        const os = [make(tier, false), make(tier, true)];
        for (const o of os) o.follow(cam);
        const px = new Uint8Array(4);
        const sync = () => gl.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
        const draw = (o) => {
          solo.add(o.mesh);
          gl.setRenderTarget(rt);
          gl.render(solo, cam);
          solo.remove(o.mesh);
        };
        // Warm up both programs and the GPU clock.
        for (let i = 0; i < 30; i++) for (const o of os) draw(o);
        sync();
        const pairs = [];
        for (let i = 0; i < 40; i++) {
          const pair = [0, 0];
          for (const k of i % 2 ? [1, 0] : [0, 1]) {
            sync();
            const t0 = performance.now();
            for (let j = 0; j < 10; j++) draw(os[k]);
            sync();
            pair[k] = (performance.now() - t0) / 10;
          }
          pairs.push(pair);
        }
        gl.setRenderTarget(null);
        rt.dispose();
        for (const o of os) o.dispose();
        const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
        return { method: 'readPixels sync', before: median(pairs.map((p) => p[0])), anti: median(pairs.map((p) => p[1])), ratio: median(pairs.map((p) => p[1] / p[0])), samples: pairs.length };
      }, tier);
      const c = row.cost;
      const ratio = tier === 2 ? 1.08 : 1.05;
      require(c.ratio <= ratio || c.anti <= c.before + 0.15, `tier ${tier}: GPU ${c.anti.toFixed(3)} ms against ${c.before.toFixed(3)} ms (×${c.ratio.toFixed(3)}, budget ×${ratio})`);
    }

    // 4. Gameplay-angle shots, before and after.
    for (const anti of [false, true]) {
      await page.evaluate(({ tier, anti }) => {
        const { THREE, gl, scene, make, env } = window.oceanBench;
        const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 60000);
        cam.position.set(0, 38, 150);
        cam.lookAt(0, 0, -700);
        cam.updateMatrixWorld();
        const o = make(tier, anti);
        o.follow(cam);
        scene.add(o.mesh);
        gl.setRenderTarget(null);
        gl.render(scene, cam);
        scene.remove(o.mesh);
        o.dispose();
      }, { tier, anti });
      await page.locator('canvas').last().screenshot({ path: `${out}/ocean-tier${tier}-${anti ? 'anti' : 'before'}.jpg`, quality: 88 });
    }
    // A high view over a wide patch, where a tile lattice shows most.
    for (const anti of [false, true]) {
      await page.evaluate(({ tier, anti }) => {
        const { THREE, gl, scene, make } = window.oceanBench;
        const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 60000);
        cam.position.set(0, 900, 900);
        cam.lookAt(0, 0, -900);
        cam.updateMatrixWorld();
        const o = make(tier, anti);
        o.follow(cam);
        scene.add(o.mesh);
        gl.render(scene, cam);
        scene.remove(o.mesh);
        o.dispose();
      }, { tier, anti });
      await page.locator('canvas').last().screenshot({ path: `${out}/ocean-high-tier${tier}-${anti ? 'anti' : 'before'}.jpg`, quality: 88 });
    }
    report.tiers.push(row);
  }
  require(errors.length === 0, `page errors: ${errors.slice(0, 3).join(' / ')}`);
} finally {
  await browser.close();
}
writeFileSync(`${out}/ocean.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('verify-ocean: OK');
