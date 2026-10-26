import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three';

/** Cosmetic only: all motion uses render time and never changes the simulation hull. */
export class StepperModel {
  readonly root = new Group();
  private rings: Mesh[] = [];
  private fins: Group[] = [];
  private owned: BufferGeometry[] = [];
  private light = new MeshBasicMaterial({ color: 0xc4a0ff, toneMapped: false });
  private white = new MeshBasicMaterial({ color: 0xf2eaff, toneMapped: false });
  private armor = new MeshStandardMaterial({ color: 0x241b35, metalness: 0.85, roughness: 0.3 });
  private core: Mesh;
  constructor(make: (g: BufferGeometry, material: Material) => Mesh) {
    this.root.name = 'stepper-phase-drive';
    const mesh = (g: BufferGeometry, m: Material, parent: Group = this.root) => {
      this.owned.push(g);
      const v = make(g, m);
      parent.add(v);
      return v;
    };
    // Split armored outriggers; the narrow central keel keeps an unmistakable naval silhouette.
    for (const side of [-1, 1])
      for (const end of [-1, 1]) {
        const pod = new Group();
        pod.position.set(end * 72, 5, side * 19);
        this.root.add(pod);
        this.fins.push(pod);
        const plate = mesh(new BoxGeometry(98, 12, 9), this.armor, pod);
        plate.rotation.y = side * end * 0.08;
        plate.rotation.z = end * 0.055;
        const tip = mesh(new OctahedronGeometry(12, 0), this.armor, pod);
        tip.scale.set(2.4, 0.5, 0.4);
        tip.position.x = end * 54;
        const stripe = mesh(new BoxGeometry(92, 0.8, 0.7), this.light, pod);
        stripe.position.set(0, 6.5, side * 4.6);
        const rail = mesh(new BoxGeometry(65, 0.7, 1.1), this.white, pod);
        rail.position.set(-end * 8, 7, side * 1.6);
      }
    this.core = mesh(new OctahedronGeometry(13, 1), this.white);
    this.core.position.set(-8, 45, 0);
    this.core.scale.set(0.75, 1.6, 0.75);
    const plinth = mesh(new CylinderGeometry(11, 17, 9, 6), this.armor);
    plinth.position.set(-8, 19, 0);
    for (let i = 0; i < 3; i++) {
      const ring = mesh(new TorusGeometry(23 + i * 7, 0.8, 6, 48), i === 1 ? this.white : this.light);
      ring.position.copy(this.core.position);
      ring.rotation.set(Math.PI / 2, (i * Math.PI) / 3, Math.PI / 5);
      this.rings.push(ring);
    }
    for (const x of [-145, -50, 50, 145]) {
      const spine = mesh(new BoxGeometry(22, 1, 1.4), this.light);
      spine.position.set(x, 15, 0);
    }
  }
  pose(time: number, spectral = false): void {
    this.core.rotation.y = time * 0.7;
    this.core.position.y = 45 + Math.sin(time * 2) * 2;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.rotation.x = time * (0.15 + i * 0.07) + (i * Math.PI) / 3;
      r.rotation.y = time * (i % 2 ? 0.3 : -0.25);
      r.rotation.z = (i * Math.PI) / 3 + time * 0.12;
    }
    for (let i = 0; i < this.fins.length; i++) this.fins[i].position.y = 5 + Math.sin(time * 1.6 + i * Math.PI) * 1.2;
    this.armor.transparent = spectral;
    this.armor.opacity = spectral ? 0.42 : 1;
    this.light.color.setHex(spectral ? 0x9764e8 : 0xc4a0ff);
  }
  dispose(): void {
    for (const g of this.owned) g.dispose();
    this.light.dispose();
    this.white.dispose();
    this.armor.dispose();
  }
}
