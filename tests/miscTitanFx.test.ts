import { describe, expect, it } from 'vitest';
import { Box3, Scene, type Mesh } from 'three';
import { MiscTitanFx } from '../src/render/MiscTitanFx';
import { pinDoll } from '../src/skills/misc/HexweaverRuntime';
import { emptyGame, place } from './helpers';

describe('Misc titan persistent effects', () => {
  it('keeps court geometry public but hides dolls attached to concealed enemies', () => {
    const g=emptyGame(),scene=new Scene(),judge=place(g,'judge',0,0,0),hex=place(g,'hexweaver',0,-1000,0),enemy=place(g,'stepper',1,2000,0);
    judge.judge!.court={x:0,z:0};pinDoll(hex,enemy);
    const fx=new MiscTitanFx(scene,g);fx.update(1,1/60);fx.prepare(0);
    const doll=scene.getObjectByName(`misc-doll-${hex.id}-${enemy.id}`)!;expect(doll.visible).toBe(true);
    enemy.mods.untargetable=true;fx.prepare(0);expect(doll.visible).toBe(false);
    expect(fx.ribbons.count).toBeGreaterThan(0);
    fx.dispose();expect(scene.children).toHaveLength(0);
  });
  it('matches dynamic ridge dimensions and removes expired geometry', () => {
    const g = emptyGame();
    const scene = new Scene();
    // Raised long enough ago to have finished rising out of the sea.
    g.map.dynamicRidges.push({ id: 1, owner: 1, x0: 0, z0: 0, x1: 900, z1: 0, width: 140, height: 75, expiresAt: 10 });
    const fx = new MiscTitanFx(scene, g);
    fx.update(1, 1 / 60);
    fx.prepare(-1);
    const ridge = scene.getObjectByName('misc-ridge-1-1')!;
    expect(ridge.position.x).toBeCloseTo(450);
    expect(ridge.position.y).toBeCloseTo(0);
    const box = new Box3().setFromObject(ridge);
    expect(box.max.x - box.min.x).toBeCloseTo(900, -1);
    expect(box.max.z - box.min.z).toBeGreaterThan(140 * 0.9);
    expect(box.max.z - box.min.z).toBeLessThan(140 * 1.25);
    expect(box.max.y).toBeGreaterThan(75 * 0.6);
    expect(box.max.y).toBeLessThan(75 * 1.4);
    g.map.dynamicRidges = [];
    fx.update(2, 1 / 60);
    expect(scene.getObjectByName('misc-ridge-1-1')).toBeUndefined();
    fx.dispose();
  });
  it('reuses meshes between frames and disposes shared resources once', () => {
    const g=emptyGame(),scene=new Scene(),hex=place(g,'hexweaver',0,0,0),enemy=place(g,'stepper',1,1000,0);pinDoll(hex,enemy);
    const fx=new MiscTitanFx(scene,g);fx.update(1,1/60);const first=scene.getObjectByName(`misc-doll-${hex.id}-${enemy.id}`)!;
    fx.update(2,1/60);expect(scene.getObjectByName(first.name)).toBe(first);
    const resources=new Set<unknown>();let disposals=0;
    scene.traverse(o=>{const m=o as Mesh;if(m.geometry&&!resources.has(m.geometry)){resources.add(m.geometry);m.geometry.addEventListener('dispose',()=>disposals++);}});
    fx.dispose();expect(disposals).toBe(resources.size);
  });
});
