// Deterministic transcendental functions for lockstep play.
//
// Browsers disagree in the last bits of Math.sin, Math.exp and friends (V8 and JavaScriptCore
// differ on most of them), and a lockstep battle drifts apart within seconds when they do.
// These are ports of fdlibm (Sun's freely distributable libm, the code V8 itself derives from)
// that use only + - * /, Math.sqrt and bit access, all of which IEEE 754 makes exact on every
// engine. installDeterministicMath() puts them on the global Math once, before any game code
// runs, so the simulation (and three.js inside it) gets identical bits everywhere.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const HI = LITTLE ? 1 : 0;
const LO = LITTLE ? 0 : 1;

/** High word of a double, as a signed 32-bit integer. */
function hiWord(x: number): number {
  f64[0] = x;
  return u32[HI] | 0;
}

/** Low word of a double, unsigned. */
function loWord(x: number): number {
  f64[0] = x;
  return u32[LO];
}

function fromWords(hi: number, lo: number): number {
  u32[HI] = hi;
  u32[LO] = lo;
  return f64[0];
}

function setHi(x: number, hi: number): number {
  f64[0] = x;
  u32[HI] = hi;
  return f64[0];
}

function clearLo(x: number): number {
  f64[0] = x;
  u32[LO] = 0;
  return f64[0];
}

/** 2^n for n in [-1022, 1023], exactly. */
function pow2(n: number): number {
  return fromWords((n + 1023) << 20, 0);
}

/** x * 2^n with a single rounding (x is near 1 where it is used). */
function scalbn(x: number, n: number): number {
  if (n > 1023) {
    x *= pow2(1023);
    n = Math.min(n - 1023, 1023);
  } else if (n < -1022) {
    // Scale while the value is still normal, so only the last multiply rounds.
    const first = Math.max(n + 54, -1022);
    x *= pow2(first);
    n -= first;
  }
  return x * pow2(n);
}

// ------------------------------------------------------------------ argument reduction

const INVPIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e0;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;
const TWO_PI = 6.28318530717958647692e0;

/** Reduced argument (head and tail) left by remPio2. */
let ry0 = 0;
let ry1 = 0;

/** x = n * pi/2 + (ry0 + ry1); returns n. */
function remPio2(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    ry0 = x;
    ry1 = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3pi/4: n = +-1.
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        ry0 = z - PIO2_1T;
        ry1 = z - ry0 - PIO2_1T;
      } else {
        z -= PIO2_2;
        ry0 = z - PIO2_2T;
        ry1 = z - ry0 - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      ry0 = z + PIO2_1T;
      ry1 = z - ry0 + PIO2_1T;
    } else {
      z += PIO2_2;
      ry0 = z + PIO2_2T;
      ry1 = z - ry0 + PIO2_2T;
    }
    return -1;
  }
  if (ix >= 0x7ff00000) {
    ry0 = ry1 = x - x;
    return 0;
  }
  // Huge arguments: fold by whole turns first. `%` is exact, so this is repeatable, though the
  // double nearest 2pi is not 2pi and the phase is meaningless that far out anyway.
  if (ix > 0x413921fb) return remPio2(x % TWO_PI);
  const t0 = Math.abs(x);
  const n = (t0 * INVPIO2 + 0.5) | 0;
  const fn = n;
  let r = t0 - fn * PIO2_1;
  let w = fn * PIO2_1T;
  // Cody-Waite in up to three parts, refining while the subtraction cancels many bits.
  const j = ix >> 20;
  ry0 = r - w;
  let i = j - ((hiWord(ry0) >> 20) & 0x7ff);
  if (i > 16) {
    let t = r;
    w = fn * PIO2_2;
    r = t - w;
    w = fn * PIO2_2T - (t - r - w);
    ry0 = r - w;
    i = j - ((hiWord(ry0) >> 20) & 0x7ff);
    if (i > 49) {
      t = r;
      w = fn * PIO2_3;
      r = t - w;
      w = fn * PIO2_3T - (t - r - w);
      ry0 = r - w;
    }
  }
  ry1 = r - ry0 - w;
  if (hx < 0) {
    ry0 = -ry0;
    ry1 = -ry1;
    return -n;
  }
  return n;
}

// ------------------------------------------------------------------ kernels on [-pi/4, pi/4]

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

function kSin(x: number, y: number, iy: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kCos(x: number, y: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

const T = [
  3.33333333333334091986e-1, 1.33333333333201242699e-1, 5.39682539762260521377e-2, 2.18694882948595424599e-2,
  8.86323982359930005737e-3, 3.59207910759131235356e-3, 1.45620945432529025516e-3, 5.88041240820264096874e-4,
  2.46463134818469906812e-4, 7.81794442939557092300e-5, 7.14072491382608190305e-5, -1.85586374855275456654e-5,
  2.59073051863633712884e-5,
];
const PIO4 = 7.85398163397448278999e-1;
const PIO4LO = 3.06161699786838301793e-17;

function kTan(x: number, y: number, iy: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3e300000) {
    if (((ix | loWord(x)) | (iy + 1)) === 0) return 1 / Math.abs(x);
    if (iy === 1) return x;
    const w = x + y;
    const z = clearLo(w);
    const v = y - (z - x);
    const a = -1 / w;
    const t = clearLo(a);
    const s = 1 + t * z;
    return t + a * (s + t * v);
  }
  const big = ix >= 0x3fe59428;
  if (big) {
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    const z = PIO4 - x;
    const w = PIO4LO - y;
    x = z + w;
    y = 0;
  }
  let z = x * x;
  let w = z * z;
  let r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
  let v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
  const s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T[0] * s;
  w = x + r;
  if (big) {
    v = iy;
    return (1 - ((hx >> 30) & 2)) * (v - 2 * (x - ((w * w) / (w + v) - r)));
  }
  if (iy === 1) return w;
  z = clearLo(w);
  v = r - (z - x);
  const a = -1 / w;
  const t = clearLo(a);
  const s2 = 1 + t * z;
  return t + a * (s2 + t * v);
}

// ------------------------------------------------------------------ public functions

export function sin(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kSin(ry0, ry1, 1);
    case 1:
      return kCos(ry0, ry1);
    case 2:
      return -kSin(ry0, ry1, 1);
    default:
      return -kCos(ry0, ry1);
  }
}

export function cos(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kCos(ry0, ry1);
    case 1:
      return -kSin(ry0, ry1, 1);
    case 2:
      return -kCos(ry0, ry1);
    default:
      return kSin(ry0, ry1, 1);
  }
}

export function tan(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kTan(x, 0, 1);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  return kTan(ry0, ry1, 1 - ((n & 1) << 1));
}

const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2,
];

export function atan(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {
    // |x| >= 2^66
    if (x !== x) return x + x;
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  }
  let id: number;
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e400000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - (x * (s1 + s2) - ATANLO[id] - x);
  return hx < 0 ? -r : r;
}

const PI = 3.1415926535897931160e0;
const PI_O_2 = 1.5707963267948965580e0;
const PI_O_4 = 7.8539816339744827900e-1;
const PI_LO = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  const lx = loWord(x);
  const hy = hiWord(y);
  const iy = hy & 0x7fffffff;
  const ly = loWord(y);
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y);
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) === 0) {
    switch (m) {
      case 0:
      case 1:
        return y;
      case 2:
        return PI;
      default:
        return -PI;
    }
  }
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 : PI_O_2;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return PI_O_4;
        case 1:
          return -PI_O_4;
        case 2:
          return 3 * PI_O_4;
        default:
          return -3 * PI_O_4;
      }
    }
    switch (m) {
      case 0:
        return 0;
      case 1:
        return -0;
      case 2:
        return PI;
      default:
        return -PI;
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 : PI_O_2;
  const k = (iy - ix) >> 20;
  let z: number;
  let mm = m;
  if (k > 60) {
    z = PI_O_2 + 0.5 * PI_LO;
    mm &= 1;
  } else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (mm) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

const PIO2_HI = 1.57079632679489655800e0;
const PIO2_LO = 6.12323399573676603587e-17;
const PIO4_HI = 7.85398163397448278999e-1;
const PS0 = 1.66666666666666657415e-1;
const PS1 = -3.25565818622400915405e-1;
const PS2 = 2.01212532134862925881e-1;
const PS3 = -4.00555345006794114027e-2;
const PS4 = 7.91534994289814532176e-4;
const PS5 = 3.47933107596021167570e-5;
const QS1 = -2.40339491173441421878e0;
const QS2 = 2.02094576023350569471e0;
const QS3 = -6.88283971605453293030e-1;
const QS4 = 7.70381505559019352791e-2;

function asinP(t: number): number {
  return t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
}

function asinQ(t: number): number {
  return 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
}

export function asin(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | loWord(x)) === 0) return x * PIO2_HI + x * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    if (ix < 0x3e400000) return x;
    const t = x * x;
    return x + x * (asinP(t) / asinQ(t));
  }
  const w0 = 1 - Math.abs(x);
  const t = w0 * 0.5;
  const p = asinP(t);
  const q = asinQ(t);
  const s = Math.sqrt(t);
  let r: number;
  if (ix >= 0x3fef3333) {
    r = PIO2_HI - (2 * (s + s * (p / q)) - PIO2_LO);
  } else {
    const w = clearLo(s);
    const c = (t - w * w) / (s + w);
    const pp = 2 * s * (p / q) - (PIO2_LO - 2 * c);
    const qq = PIO4_HI - 2 * w;
    r = PIO4_HI - (pp - qq);
  }
  return hx > 0 ? r : -r;
}

export function acos(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | loWord(x)) === 0) return hx > 0 ? 0 : PI + 2 * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    const z = x * x;
    const r = asinP(z) / asinQ(z);
    return PIO2_HI - (x - (PIO2_LO - x * r));
  }
  if (hx < 0) {
    const z = (1 + x) * 0.5;
    const s = Math.sqrt(z);
    const r = asinP(z) / asinQ(z);
    const w = r * s - PIO2_LO;
    return PI - 2 * (s + w);
  }
  const z = (1 - x) * 0.5;
  const s = Math.sqrt(z);
  const df = clearLo(s);
  const c = (z - df * df) / (s + df);
  const r = asinP(z) / asinQ(z);
  const w = r * s + c;
  return 2 * (df + w);
}

const O_THRESHOLD = 7.09782712893383973096e2;
const U_THRESHOLD = -7.45133219101941108420e2;
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INVLN2 = 1.44269504088896338700e0;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

export function exp(x: number): number {
  let hx = hiWord(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) {
      if (x !== x) return x + x;
      return xsb === 0 ? x : 0;
    }
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return 0;
  }
  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    // |x| > 0.5 ln2
    if (hx < 0x3ff0a2b2) {
      hi = x - (xsb ? -LN2_HI : LN2_HI);
      lo = xsb ? -LN2_LO : LN2_LO;
      k = 1 - xsb - xsb;
    } else {
      k = (INVLN2 * x + (xsb ? -0.5 : 0.5)) | 0;
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    return 1 + x;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  if (k >= -1021) {
    if (k === 1024) return y * 2 * pow2(1023);
    return y * pow2(k);
  }
  return y * pow2(k + 1000) * pow2(-1000);
}

const TWO54 = 1.80143985094819840000e16;
const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

export function log(x: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = setHi(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) {
      if (k === 0) return 0;
      return k * LN2_HI + k * LN2_LO;
    }
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    return k * LN2_HI - (R - k * LN2_LO - f);
  }
  const s = f / (2 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - (hfsq - (s * (hfsq + R) + dk * LN2_LO) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f);
}

const BP = [1, 1.5];
const DP_H = [0, 5.84962487220764160156e-1];
const DP_L = [0, 1.35003920212974897128e-8];
const TWO53 = 9007199254740992;
const HUGE = 1e300;
const TINY = 1e-300;
const L1 = 5.99999999999994648725e-1;
const L2 = 4.28571428578550184252e-1;
const L3 = 3.33333329818377432918e-1;
const L4 = 2.72728123808534006489e-1;
const L5 = 2.30660745775561754067e-1;
const L6 = 2.06975017800338417784e-1;
const LG2_ = 6.93147180559945286227e-1;
const LG2_H = 6.93147182464599609375e-1;
const LG2_L = -1.90465429995776804525e-9;
const OVT = 8.0085662595372944372e-17;
const CP = 9.61796693925975554329e-1;
const CP_H = 9.61796700954437255859e-1;
const CP_L = -7.02846165095275826516e-9;
const IVLN2 = 1.44269504088896338700e0;
const IVLN2_H = 1.44269502162933349609e0;
const IVLN2_L = 1.92596299112661746887e-8;

export function pow(x: number, y: number): number {
  const hx = hiWord(x);
  const lx = loWord(x);
  const hy = hiWord(y);
  const ly = loWord(y);
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;

  if ((iy | ly) === 0) return 1;
  if (x !== x || y !== y) return NaN;

  // yisint: 0 not an integer, 1 odd, 2 even (only needed when x < 0).
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2;
    else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff;
      if (k > 20) {
        const j = ly >>> (52 - k);
        if (((j << (52 - k)) >>> 0) === ly) yisint = 2 - (j & 1);
      } else if (ly === 0) {
        const j = iy >> (20 - k);
        if (j << (20 - k) === iy) yisint = 2 - (j & 1);
      }
    }
  }

  if (ly === 0) {
    if (iy === 0x7ff00000) {
      // y is +-Infinity; (+-1)**+-Infinity is NaN in JavaScript.
      if (((ix - 0x3ff00000) | lx) === 0) return NaN;
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0;
      return hy < 0 ? -y : 0;
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x;
    if (hy === 0x40000000) return x * x;
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x);
  }

  let ax = Math.abs(x);
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    let z = ax;
    if (hy < 0) z = 1 / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) z = NaN;
      else if (yisint === 1) z = -z;
    }
    return z;
  }

  let n = (hx >> 31) + 1;
  if ((n | yisint) === 0) return NaN;
  let s = 1;
  if ((n | (yisint - 1)) === 0) s = -1;

  let t1: number;
  let t2: number;
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      if (ix <= 0x3fefffff) return hy < 0 ? Infinity : 0;
      if (ix >= 0x3ff00000) return hy > 0 ? Infinity : 0;
    }
    if (ix < 0x3fefffff) return hy < 0 ? s * HUGE * HUGE : s * TINY * TINY;
    if (ix > 0x3ff00000) return hy > 0 ? s * HUGE * HUGE : s * TINY * TINY;
    const t = ax - 1;
    const w = t * t * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    const u = IVLN2_H * t;
    const v = t * IVLN2_L - w * IVLN2;
    t1 = clearLo(u + v);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    if (ix < 0x00100000) {
      ax *= TWO53;
      n -= 53;
      ix = hiWord(ax);
    }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    ix = j | 0x3ff00000;
    let k: number;
    if (j <= 0x3988e) k = 0;
    else if (j < 0xbb67a) k = 1;
    else {
      k = 0;
      n += 1;
      ix -= 0x00100000;
    }
    ax = setHi(ax, ix);

    let u = ax - BP[k];
    let v = 1 / (ax + BP[k]);
    const ss = u * v;
    const sH = clearLo(ss);
    let tH = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    let tL = ax - (tH - BP[k]);
    const sL = v * (u - sH * tH - sH * tL);
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += sL * (sH + ss);
    s2 = sH * sH;
    tH = clearLo(3 + s2 + r);
    tL = r - (tH - 3 - s2);
    u = sH * tH;
    v = sL * tH + tL * ss;
    const pH = clearLo(u + v);
    const pL = v - (pH - u);
    const zH = CP_H * pH;
    const zL = CP_L * pH + pL * CP + DP_L[k];
    const t = n;
    t1 = clearLo(zH + zL + DP_H[k] + t);
    t2 = zL - (t1 - t - DP_H[k] - zH);
  }

  // (y1 + y2) * (t1 + t2), with y split so y1 * t1 is exact.
  const y1 = clearLo(y);
  const pL0 = (y - y1) * t1 + y * t2;
  let pH = y1 * t1;
  let z = pL0 + pH;
  let j = hiWord(z);
  let i = loWord(z);
  if (j >= 0x40900000) {
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE;
    if (pL0 + OVT > z - pH) return s * HUGE * HUGE;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    if (((j - (0xc090cc00 | 0)) | i) !== 0) return s * TINY * TINY;
    if (pL0 <= z - pH) return s * TINY * TINY;
  }

  // 2^(pH + pL0)
  i = j & 0x7fffffff;
  let k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = fromWords(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    pH -= t;
  }
  const t = clearLo(pL0 + pH);
  const u = t * LG2_H;
  const v = (pL0 - (t - pH)) * LG2_ + t * LG2_L;
  z = u + v;
  const w = v - (z - u);
  const tt = z * z;
  const tt1 = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
  const r = (z * tt1) / (tt1 - 2) - (w + z * w);
  z = 1 - (r - z);
  j = hiWord(z) + (n << 20);
  if (j >> 20 <= 0) z = scalbn(z, n);
  else z = setHi(z, j);
  return s * z;
}

/** sqrt of the summed squares, in argument order (the native one is implementation-defined). */
export function hypot(...v: number[]): number {
  let s = 0;
  let nan = false;
  for (const a of v) {
    if (a === Infinity || a === -Infinity) return Infinity;
    if (a !== a) nan = true;
    s += a * a;
  }
  return nan ? NaN : Math.sqrt(s);
}

function hypotFast(a?: number, b?: number, c?: number): number {
  const n = arguments.length;
  if (n === 2) {
    const x = a!;
    const y = b!;
    if (x === Infinity || x === -Infinity || y === Infinity || y === -Infinity) return Infinity;
    return Math.sqrt(x * x + y * y);
  }
  if (n === 3) {
    const x = a!;
    const y = b!;
    const z = c!;
    if (x === Infinity || x === -Infinity || y === Infinity || y === -Infinity || z === Infinity || z === -Infinity) return Infinity;
    return Math.sqrt(x * x + y * y + z * z);
  }
  // 0, 1 or 4+ arguments: the general version.
  return hypot(...(Array.prototype.slice.call(arguments) as number[]));
}

/** The engine's own versions, captured before installation (for tests). */
export const native = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  exp: Math.exp,
  log: Math.log,
  pow: Math.pow,
  hypot: Math.hypot,
};

/** Math functions that IEEE 754 or the spec pin down exactly; the sim may use these freely. */
export const EXACT = ['abs', 'max', 'min', 'floor', 'ceil', 'round', 'trunc', 'sign', 'sqrt', 'imul', 'fround', 'PI', 'E', 'SQRT2', 'LN2'];
/** Ported here and installed over the natives. */
export const PORTED = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'pow', 'hypot'];

let installed = false;

/** Replace the engine's transcendental functions with the deterministic ports (once). */
export function installDeterministicMath(): void {
  if (installed) return;
  installed = true;
  const m = Math as unknown as Record<string, unknown>;
  Object.assign(m, { sin, cos, tan, asin, acos, atan, atan2, exp, log, pow, hypot: hypotFast });
}
