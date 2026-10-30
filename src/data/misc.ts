import type { ShipSpec } from '../core/types';
import { STEPPER_SKILLS } from '../skills/misc/stepper';
import { HADAL_SKILLS } from '../skills/misc/hadal';
import { TUNGSTEN_SKILLS } from '../skills/misc/tungsten';
import { kitOf } from '../skills/types';
import { TITAN_REPAIR, search } from './common';

// Misc: hulls that belong to no fleet and no age. Titans from the trenches and the folded sea.
// Titan HP is final; ranges and reloads are scaled like every other ship.

export const MISC: ShipSpec[] = [
  {
    id: 'stepper', name: 'Stepper', nation: 'fold', cls: 'TT', year: 2099,
    description: 'A warship between moments: black armored sponsons orbit a white-violet phase core. Every step folds the ocean, every arrival is an attack.',
    specialty: 'Teleport titan. Nine steps, relentless broadsides, rearward torpedoes and a twenty-hit flicker. Four fragile afterimages mirror attacks at 75% damage.',
    hp: 1100000, length: 360, beam: 48, draft: 14, freeboard: 13,
    maxSpeed: 36, accelTime: 40, turnRadius: 830, rudderTime: 12,
    armor: { belt: 260, deck: 160, bow: 60, stern: 60, superstructure: 65, turret: 350, citadelInner: 60, torpedoProtection: 0.5 },
    citadel: { length: 0.55, top: 2, width: 0.7 },
    main: {
      name: '406 mm phase cannons', look: 'rail',
      turrets: [
        { x: 115, y: 0, facing: 0, halfArc: 150, barrels: 3 },
        { x: 78, y: 5, facing: 0, halfArc: 150, barrels: 3 },
        { x: -78, y: 5, facing: 180, halfArc: 150, barrels: 3 },
        { x: -115, y: 0, facing: 180, halfArc: 150, barrels: 3 },
      ],
      reload: 10, traverse: 18, range: 15000, dispersion: 110, barrelLength: 23,
      ap: { caliber: 406, mass: 1225, velocity: 1100, damage: 9000, pen: 700 },
      he: { caliber: 406, mass: 1000, velocity: 1100, damage: 4500, pen: 70, fireChance: 0.24 },
    },
    torpedoes: { name: 'Phase lances', launchers: [{ x: -35, side: 1, tubes: 4 },{ x: -35, side: -1, tubes: 4 }], tubes: 4, reload: 24, speed: 80, range: 9000, damage: 16000, floodChance: 0.35, spread: 8, detect: 800, look: 'lance' },
    aa: { range: 4500, dps: 1200 }, consumables: [TITAN_REPAIR, search(9000)],
    skills: kitOf(STEPPER_SKILLS,'stepperFlashStep','ramStep','broadStep','overStep','backStep','sideStep','flickerStep','crossStep','afterimageStep'),
    model: {
      palette: { hull: 0x141020, upper: 0x29213c, deck: 0x1a1727, accent: 0xb388ff, boot: 0x080611 },
      bow: 'clipper', stern: 'transom', sheer: 0.5,
      blocks: [{x: 0,len:90,w:27,h:8},{x: 12,len:46,w:19,h:9}],
      tower: {x:16,h:28,w:12,len:18,style:'tower'}, funnels: [], masts: [],
      lightStrip: 0xb388ff,
      emitters: [{x:0,y:28,len:24,w:20,color:0xb388ff},{x:70,y:15,len:18,w:6,color:0xe7d9ff},{x:-70,y:15,len:18,w:6,color:0xe7d9ff}],
    },
  },
  {
    id: 'tungsten', name: 'Tungsten', nation: 'lodestone', cls: 'TT', year: 2091,
    description: 'A magnet that learned to sail: a levitation dais set into the hull floats a 128-metre cube of tungsten etched with neon circuitry, turning slowly over the deck. She carries no guns. The cube is the weapon, the armour and the anchor.',
    specialty: 'Cube titan, no guns. Hold fire to steer a 2.5M-HP tungsten cube into hulls on the magnet’s energy; it blocks fire in six switchable modes. Singularity, meteor and a six-cube Overdrive.',
    hp: 1600000, length: 400, beam: 80, draft: 15, freeboard: 14,
    maxSpeed: 30, accelTime: 42, turnRadius: 900, rudderTime: 13,
    armor: { belt: 300, deck: 180, bow: 70, stern: 70, superstructure: 70, turret: 380, citadelInner: 70, torpedoProtection: 0.55 },
    citadel: { length: 0.55, top: 2, width: 0.7 },
    aa: { range: 4500, dps: 1200 }, consumables: [TITAN_REPAIR, search(9000)],
    skills: kitOf(TUNGSTEN_SKILLS,'tungstenLunge','tungstenSwitch','tungstenSignature','tungstenSurge','tungstenDock','tungstenShield','tungstenCollapse','tungstenMeteor','tungstenOverdrive'),
    model: {
      palette: { hull: 0x3b4149, upper: 0x59616b, deck: 0x464c54, accent: 0x3ff0ff, boot: 0x15181c },
      bow: 'straight', stern: 'transom', sheer: 0.15,
      // A low angular bridge forward and the reactor aft, clear of the cube turning over the dais amidships.
      blocks: [{x:118,len:48,w:30,h:8},{x:122,len:26,w:20,h:7},{x:-122,len:54,w:36,h:10}],
      funnels: [], masts: [],
      domes: [{x:126,r:6}],
      panels: [{x:116,y:3,w:16}],
      fins: [{x:-122,h:12,len:22,z:-10},{x:-122,h:12,len:22,z:10}],
      lightStrip: 0x3ff0ff,
    },
  },
  {
    id: 'hadal',
    name: 'Hadal',
    nation: 'abyss',
    cls: 'TT',
    year: 2049,
    description: 'Something the sonar operators stopped reporting: a 420 m carrier-submarine that rises from the trenches, looses drone wings from its launch tubes and sinks again before anyone can answer.',
    specialty: 'Titan submarine. 1.5M HP, no guns: drone wings from periscope depth, homing swarms from the deep, a pressure pulse, and a maw that drags line ships under whole.',
    hp: 1500000,
    length: 420,
    beam: 46,
    draft: 16,
    freeboard: 6,
    maxSpeed: 26,
    accelTime: 36,
    turnRadius: 900,
    rudderTime: 11,
    armor: { belt: 300, deck: 200, bow: 120, stern: 120, superstructure: 80, turret: 120, citadelInner: 0, torpedoProtection: 0.5 },
    citadel: { length: 0, top: 0, width: 0 },
    torpedoes: {
      name: 'Abyssal torpedoes',
      launchers: [
        { x: 150, side: 2, tubes: 8 },
        { x: -150, side: -2, tubes: 4 },
      ],
      tubes: 8,
      reload: 32,
      speed: 64,
      range: 8000,
      damage: 20000,
      floodChance: 0.4,
      spread: 6,
      detect: 1000,
      look: 'eel',
    },
    air: {
      torpedo: { name: 'Lancer drones', planes: 6, hangar: 30, restore: 14, speed: 170, hp: 1800, damage: 9000 },
      dive: { name: 'Gulper drones', planes: 6, hangar: 30, restore: 14, speed: 180, hp: 1700, damage: 7000 },
      fighter: { name: 'Ray drones', planes: 8, hangar: 16, restore: 18, speed: 220, hp: 1500, damage: 150 },
      launchCooldown: 14,
      range: 15000,
      look: 'drone',
    },
    aa: { range: 4500, dps: 1500 },
    consumables: [TITAN_REPAIR, search(9000)],
    skills: kitOf(HADAL_SKILLS, 'hkSwarm', 'pressurePulse', 'abyssalVeil', 'droneWing', 'breach', 'sonarLattice', 'hadalTrench', 'swarmMother', 'abyssalMaw'),
    sub: { battery: 160, periscopeDepth: -14, deepDepth: -60, diveRate: 6 },
    model: {
      palette: { hull: 0x14262c, upper: 0x1c343c, deck: 0x14262c, accent: 0x5fe0d0, boot: 0x0a1418 },
      bow: 'clipper',
      stern: 'cruiser',
      blocks: [],
      funnels: [],
      masts: [],
      conningTower: { x: 40, len: 46, h: 12 },
      lightStrip: 0x5fe0d0,
    },
  },
];
