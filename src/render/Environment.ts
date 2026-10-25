import {
  Color,
  CubeCamera,
  type CubeTexture,
  DirectionalLight,
  FogExp2,
  HalfFloatType,
  HemisphereLight,
  LinearMipmapLinearFilter,
  MathUtils,
  PMREMGenerator,
  Scene,
  Vector3,
  type Texture,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { OceanLook } from './Ocean';

// Sky dome, sun, ambient light, fog and the image-based lighting environment
// for one battle. Colours are tuned per map preset (time of day / haze).

/** What the sky needs from a map, naval or ground: its look id, the sun's place and the haze. */
export interface SkyPreset {
  id: string;
  sun: { elevation: number; azimuth: number };
  turbidity: number;
}

export interface Look extends OceanLook {
  rayleigh: number;
  clouds: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  exposure: number;
  /** Multiplies the sky's colour (white leaves the physical sky alone). */
  skyTint?: number;
}

export const LOOKS: Record<string, Look> = {
  strait: {
    deep: 0x07202b,
    scatter: 0x1c5560,
    horizon: 0xc9c2b4,
    zenith: 0x5a7fa6,
    sunColor: 0xffd9a8,
    fog: 0xb9b6ad,
    fogDensity: 1.3e-4,
    rayleigh: 1.6,
    clouds: 0.45,
    sunIntensity: 2.6,
    hemiSky: 0x9fb7cf,
    hemiGround: 0x2b3a3f,
    exposure: 0.62,
  },
  open: {
    deep: 0x062433,
    scatter: 0x16627a,
    horizon: 0xb7cad8,
    zenith: 0x3f74b0,
    sunColor: 0xfff1dc,
    fog: 0xadc1cf,
    fogDensity: 1.0e-4,
    rayleigh: 1.1,
    clouds: 0.3,
    sunIntensity: 3.2,
    hemiSky: 0xb3cbe3,
    hemiGround: 0x23363f,
    exposure: 0.55,
  },
  archipelago: {
    deep: 0x0a1d26,
    scatter: 0x24525a,
    horizon: 0xd8b48e,
    zenith: 0x55688a,
    sunColor: 0xffb877,
    fog: 0xc0a68c,
    fogDensity: 1.45e-4,
    rayleigh: 2.4,
    clouds: 0.55,
    sunIntensity: 2.2,
    hemiSky: 0xa9a7b5,
    hemiGround: 0x30302c,
    exposure: 0.66,
  },
  // Low red sun, purple zenith, dark water: lasers and fires carry the scene.
  dusk: {
    deep: 0x0a0f1a,
    scatter: 0x3a2a3a,
    horizon: 0xff7a4a,
    zenith: 0x2a2450,
    sunColor: 0xff7040,
    fog: 0x7a4048,
    fogDensity: 1.25e-4,
    rayleigh: 0.9,
    clouds: 0.5,
    sunIntensity: 2.6,
    hemiSky: 0xc8a0c0,
    hemiGround: 0x2a1e26,
    exposure: 0.95,
    skyTint: 0xffa08c,
  },
  // Ground, Ruined city: low overcast evening, smoke-brown haze over the rooftops.
  city: {
    deep: 0x141a1c,
    scatter: 0x2c3a38,
    horizon: 0xb59a80,
    zenith: 0x5a6070,
    sunColor: 0xffc890,
    fog: 0x8f8478,
    fogDensity: 9e-4,
    rayleigh: 1.4,
    clouds: 0.75,
    sunIntensity: 2.1,
    hemiSky: 0xa8a49c,
    hemiGround: 0x3a342c,
    exposure: 0.72,
    skyTint: 0xe8d8c8,
  },
  // Ground, Snowy pass: cold bright morning, blue shadows on the snow.
  pass: {
    deep: 0x10202a,
    scatter: 0x3a6070,
    horizon: 0xd8e4ee,
    zenith: 0x4a78b0,
    sunColor: 0xfff0e0,
    fog: 0xc8d6e2,
    fogDensity: 6e-4,
    rayleigh: 1.2,
    clouds: 0.35,
    sunIntensity: 2.8,
    hemiSky: 0xbcd4ec,
    hemiGround: 0x5a6878,
    exposure: 0.5,
  },
};

/** Sky radiance above the knee rolls off toward SKY_MAX. */
const SKY_KNEE = 1;
/** Just under the renderer's bloom threshold. */
const SKY_MAX = 1.5;

/**
 * The stock sky paints the sun disc at up to ~60000, at the edge of half-float range: a low sun in
 * view (Crimson Dusk) overflows the HDR target, and bloom smears the Inf across the whole screen.
 * Even finite, the haze around the sun is bright enough for bloom to white out half the view.
 * Roll the radiance off with a soft knee to just under the bloom threshold, keeping its hue (a
 * per-channel clamp would bleach the sunset white).
 * `uTint` grades the physical sky toward a map's palette (a low Preetham sun is white, not red).
 */
function tameSky(sky: Sky, tint = 0xffffff): Sky {
  const m = sky.material;
  m.uniforms.uTint = { value: new Color(tint) };
  m.fragmentShader = m.fragmentShader
    .replace('void main() {', 'uniform vec3 uTint;\nvoid main() {')
    .replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      `vec3 c = min( texColor * uTint, vec3( 6e4 ) );
			float m = max( c.r, max( c.g, c.b ) );
			float k = ${SKY_KNEE.toFixed(2)}, top = ${SKY_MAX.toFixed(2)};
			if ( m > k ) c *= ( k + ( top - k ) * ( 1.0 - exp( ( k - m ) / ( top - k ) ) ) ) / m;
			gl_FragColor = vec4( c, 1.0 );`,
    );
  m.needsUpdate = true;
  return sky;
}

export class Environment {
  readonly sky: Sky;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly sunDir = new Vector3();
  readonly look: Look;
  envMap: Texture | null = null;
  /** The sky (with its clouds) as a cube map, for the sea to reflect. */
  skyCube: CubeTexture | null = null;
  private cubeTarget: WebGLCubeRenderTarget | null = null;

  constructor(
    readonly scene: Scene,
    preset: SkyPreset,
  ) {
    this.look = LOOKS[preset.id] ?? LOOKS.open;
    const look = this.look;
    const phi = MathUtils.degToRad(90 - preset.sun.elevation);
    const theta = MathUtils.degToRad(preset.sun.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    this.sky = tameSky(new Sky(), look.skyTint);
    this.sky.scale.setScalar(100000);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    const u = this.sky.material.uniforms;
    u.turbidity.value = preset.turbidity;
    u.rayleigh.value = look.rayleigh;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    if (u.cloudCoverage) u.cloudCoverage.value = look.clouds;
    scene.add(this.sky);

    this.sun = new DirectionalLight(look.sunColor, look.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -220;
    sc.right = sc.top = 220;
    sc.near = 10;
    sc.far = 2400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);

    this.hemi = new HemisphereLight(look.hemiSky, look.hemiGround, 0.9);
    scene.add(this.hemi);
    scene.fog = new FogExp2(look.fog, look.fogDensity);
    scene.background = new Color(look.fog);
  }

  /** Bake the sky into a PMREM environment for metal/roughness lighting. */
  bake(renderer: WebGLRenderer): void {
    const pm = new PMREMGenerator(renderer);
    const s = new Scene();
    const sky = tameSky(new Sky());
    sky.scale.setScalar(1000);
    const src = this.sky.material.uniforms;
    const dst = sky.material.uniforms;
    for (const k of Object.keys(src)) {
      const v = src[k].value;
      dst[k].value = v && typeof v.clone === 'function' ? v.clone() : v;
    }
    s.add(sky);
    const rt = pm.fromScene(s, 0, 0.1, 2000);
    this.envMap = rt.texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.55;
    this.cubeTarget = new WebGLCubeRenderTarget(256, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
    new CubeCamera(1, 2000, this.cubeTarget).update(renderer, s);
    this.skyCube = this.cubeTarget.texture;
    sky.geometry.dispose();
    sky.material.dispose();
    pm.dispose();
  }

  /** Keep the shadow frustum centred on what the camera is looking at. */
  focus(x: number, z: number): void {
    const s = 8;
    const fx = Math.round(x / s) * s;
    const fz = Math.round(z / s) * s;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 1200, Math.max(200, this.sunDir.y * 1200), fz + this.sunDir.z * 1200);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  update(time: number): void {
    const u = this.sky.material.uniforms;
    if (u.time) u.time.value = time;
  }

  dispose(): void {
    this.scene.remove(this.sky, this.sun, this.sun.target, this.hemi);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.sun.shadow.map?.dispose();
    this.envMap?.dispose();
    this.cubeTarget?.dispose();
    this.scene.environment = null;
    this.scene.fog = null;
  }
}
