import type { Era, Nation, ShipSpec } from '../core/types';

// Navies and factions. Every ship belongs to one, and through it to an era. The new eras give each
// faction a focus and a passive trait; the historic navies fight as they did, with no trait.

/** A faction's passive. Static parts are folded into the ship's spec; the rest act in battle. */
export interface Trait {
  name: string;
  description: string;
  // Static: applied to the spec by toBattleScale, so the hangar shows the real numbers.
  hpMul?: number;
  speedMul?: number;
  dispersionMul?: number;
  rangeMul?: number;
  // In battle.
  damageMul?: number;
  damageTakenMul?: number;
  cooldownMul?: number;
  ultChargeMul?: number;
  /** Share of damage dealt returned as hit points. */
  lifesteal?: number;
  fireDurationMul?: number;
  /** Seconds taken off the out-of-combat repair delay, and its rate multiplier. */
  regenSooner?: number;
  regenMul?: number;
  /** Fraction of max HP repaired every second, in combat or not. */
  regenAlways?: number;
  missileDamageMul?: number;
  torpDamageMul?: number;
  missileReloadMul?: number;
  torpReloadMul?: number;
  missileTakenMul?: number;
  torpTakenMul?: number;
  /** Homing weapons and skill locks cannot pick this ship from further than this. */
  lockRange?: number;
  /** Extra missiles in every VLS salvo. */
  vlsExtra?: number;
  /** Summons and wingmen last this much longer. */
  summonTimeMul?: number;
  /** Reach of reticle-aimed skills. */
  reachMul?: number;
  /** Stuns on this ship last this much as long. */
  stunTakenMul?: number;
  /** Blasts and shock waves cannot shove this ship. */
  knockImmune?: boolean;
  /** Fraction of max HP repaired when an enemy sinks within 2 km. */
  killHeal?: number;
  /** The first hit after a blink or cloak deals this much more. */
  ambush?: number;
  /** Allies within 1.5 km (and the ship) shoot planes and missiles down this much faster. */
  aaAura?: number;
  /** Black Flash: this share of the ship's hits strike this many times harder. */
  crit?: { chance: number; mul: number };
  /** Titan Shift forms last this much longer. */
  shiftTimeMul?: number;
}

export interface Faction {
  id: Nation;
  era: Era;
  /** Full name (dossier) and short tag (hangar list). */
  label: string;
  short: string;
  /** What the faction's ships are built around. */
  focus: string;
  trait?: Trait;
}

export const ERAS: Era[] = ['historic', 'fantasy', 'modern', 'scifi', 'anime', 'misc'];

export const ERA_LABEL: Record<Era, string> = {
  historic: 'Historic',
  fantasy: 'Fantasy',
  modern: 'Modern',
  scifi: 'Sci-fi',
  anime: 'Anime',
  misc: 'Misc',
};

export const ERA_BLURB: Record<Era, string> = {
  historic: 'Second World War navies: steel, gunnery and a little science fiction in the skills.',
  fantasy: 'Elves, dwarves, the drowned dead and archmages: magic circles, spells and beasts.',
  modern: 'Missile cruisers, stealth hulls and jets: vertical launch cells and electronic warfare.',
  scifi: 'Railguns, lasers, plasma and orbital strikes: four powers of the next century.',
  anime: 'Heroes and villains of anime at sea. Every ultimate is a Titan Shift: a short, overwhelming titan form.',
  misc: 'Independent titans from the Fold, the Foundry and the abyss.',
};

export const FACTIONS: Record<Nation, Faction> = {
  japan: { id: 'japan', era: 'historic', label: 'Imperial Japanese Navy', short: 'IJN', focus: 'Long Lances and the heaviest guns afloat.' },
  usa: { id: 'usa', era: 'historic', label: 'United States Navy', short: 'USN', focus: 'Radar fire control, dense AA and carrier air power.' },
  germany: { id: 'germany', era: 'historic', label: 'Kriegsmarine', short: 'KM', focus: 'Turtleback armour and close-range secondaries.' },
  uk: { id: 'uk', era: 'historic', label: 'Royal Navy', short: 'RN', focus: 'Accurate guns, sturdy cruisers and anti-submarine work.' },
  ussr: { id: 'ussr', era: 'historic', label: 'Soviet Navy', short: 'VMF', focus: 'Fast, long-ranged heavy cruisers.' },

  silverwood: {
    id: 'silverwood',
    era: 'fantasy',
    label: 'Silverwood Elves',
    short: 'Elves',
    focus: 'Precision and renewal: long-range starbolts, healing groves and the wild hunt.',
    trait: {
      name: 'Moonwell',
      description: 'Main battery groups 15% tighter. Hull repair starts 3 s sooner and runs 50% faster.',
      dispersionMul: 0.85,
      regenSooner: 3,
      regenMul: 1.5,
    },
  },
  deepforge: {
    id: 'deepforge',
    era: 'fantasy',
    label: 'Deepforge Clans',
    short: 'Dwarves',
    focus: 'Runic armour, fire and earthquakes.',
    trait: {
      name: 'Runebound',
      description: '15% less damage taken, fires on you burn half as long. 8% slower.',
      damageTakenMul: 0.85,
      fireDurationMul: 0.5,
      speedMul: 0.92,
    },
  },
  drowned: {
    id: 'drowned',
    era: 'fantasy',
    label: 'Drowned Court',
    short: 'Undead',
    focus: 'Curses, life drain and the risen dead.',
    trait: {
      name: 'Undying',
      description: '8% of the damage you deal returns as hull. An enemy sinking within 2 km repairs 8%.',
      lifesteal: 0.08,
      killHeal: 0.08,
    },
  },
  conclave: {
    id: 'conclave',
    era: 'fantasy',
    label: 'Starfall Conclave',
    short: 'Archmages',
    focus: 'Spell burst and control: fireballs, frost, time and polymorph.',
    trait: {
      name: 'Arcane Font',
      description: 'Skills cool down and ultimates charge 20% faster. 10% less hull.',
      cooldownMul: 0.8,
      ultChargeMul: 1.2,
      hpMul: 0.9,
    },
  },

  us_mod: {
    id: 'us_mod',
    era: 'modern',
    label: 'United States Navy',
    short: 'USN',
    focus: 'A networked missile fleet.',
    trait: {
      name: 'Cooperative Engagement',
      description: 'You and allies within 1.5 km shoot planes and missiles down 30% faster. VLS reloads 15% faster.',
      aaAura: 1.3,
      missileReloadMul: 0.85,
    },
  },
  ru_mod: {
    id: 'ru_mod',
    era: 'modern',
    label: 'Russian Navy',
    short: 'VMF',
    focus: 'Hypersonic heavy hitters.',
    trait: {
      name: 'Heavy Salvo',
      description: 'Missile and torpedo hits +25%, their reloads 15% longer. 10% more hull.',
      missileDamageMul: 1.25,
      torpDamageMul: 1.25,
      missileReloadMul: 1.15,
      torpReloadMul: 1.15,
      hpMul: 1.1,
    },
  },
  cn_mod: {
    id: 'cn_mod',
    era: 'modern',
    label: "People's Liberation Army Navy",
    short: 'PLAN',
    focus: 'Saturation and swarms.',
    trait: {
      name: 'Saturation',
      description: 'Every VLS salvo carries two extra missiles. Summons and drones last 50% longer.',
      vlsExtra: 2,
      summonTimeMul: 1.5,
    },
  },
  uk_mod: {
    id: 'uk_mod',
    era: 'modern',
    label: 'Royal Navy',
    short: 'RN',
    focus: 'The silent service and the shield of the fleet.',
    trait: {
      name: 'Silent Service',
      description: 'Missile and torpedo damage taken -20%. Homing weapons and skill locks cannot pick you from beyond 1.5 km.',
      missileTakenMul: 0.8,
      torpTakenMul: 0.8,
      lockRange: 1500,
    },
  },

  jp_sf: {
    id: 'jp_sf',
    era: 'scifi',
    label: 'Japan Kage Fleet',
    short: 'Japan',
    focus: 'Glass cannons and ninja tricks: blinks, clones and blades.',
    trait: {
      name: 'Kage',
      description: '+20% damage, 20% less hull. The first hit after a blink or cloak deals +60%.',
      damageMul: 1.2,
      hpMul: 0.8,
      ambush: 1.6,
    },
  },
  us_sf: {
    id: 'us_sf',
    era: 'scifi',
    label: 'United States Space Navy',
    short: 'USSN',
    focus: 'Orbital supremacy: satellites, lances and lasers from above.',
    trait: {
      name: 'Uplink',
      description: 'Reticle-aimed skills reach 30% further. Main battery range +10%.',
      reachMul: 1.3,
      rangeMul: 1.1,
    },
  },
  ru_sf: {
    id: 'ru_sf',
    era: 'scifi',
    label: 'Russian Bastion Fleet',
    short: 'Bastion',
    focus: 'An unbreakable bastion: gravity, EMP and armour.',
    trait: {
      name: 'Bastion',
      description: '15% more hull. Stuns on you last half as long, and blasts cannot shove you.',
      hpMul: 1.15,
      stunTakenMul: 0.5,
      knockImmune: true,
    },
  },
  cn_sf: {
    id: 'cn_sf',
    era: 'scifi',
    label: 'Chinese Hive Fleet',
    short: 'Hive',
    focus: 'The hive and nanotech: swarms, clones and self-repair.',
    trait: {
      name: 'Nanite Hull',
      description: 'Repairs 0.4% of the hull every second, even in combat. Summons last 50% longer.',
      regenAlways: 0.004,
      summonTimeMul: 1.5,
    },
  },

  jjk: {
    id: 'jjk',
    era: 'anime',
    label: 'Jujutsu Kaisen',
    short: 'JJK',
    focus: 'Cursed techniques: space bent around the hull, slashes from nowhere and domain expansions.',
    trait: {
      name: 'Black Flash',
      description: '8% of your hits land as a Black Flash, for 2.5 times the damage.',
      crit: { chance: 0.08, mul: 2.5 },
    },
  },
  naruto: {
    id: 'naruto',
    era: 'anime',
    label: 'Naruto',
    short: 'Naruto',
    focus: 'Ninjutsu: shadow clones, chakra spheres and the tailed beasts.',
    trait: {
      name: 'Will of Fire',
      description: 'Skills cool down 15% faster. Clones and summons last 50% longer.',
      cooldownMul: 0.85,
      summonTimeMul: 1.5,
    },
  },
  onepiece: {
    id: 'onepiece',
    era: 'anime',
    label: 'One Piece',
    short: 'One Piece',
    focus: 'Devil fruits and Haki: rubber fists, storms and the will to be free.',
    trait: {
      name: 'Haki',
      description: '15% less damage taken. Stuns on you last 30% shorter.',
      damageTakenMul: 0.85,
      stunTakenMul: 0.7,
    },
  },
  dragonball: {
    id: 'dragonball',
    era: 'anime',
    label: 'Dragon Ball',
    short: 'Dragon Ball',
    focus: 'Ki: beams that split the sea, instant transmission and ever higher forms.',
    trait: {
      name: 'Limit Breaker',
      description: 'Ultimates charge 25% faster. Titan forms last 20% longer.',
      ultChargeMul: 1.25,
      shiftTimeMul: 1.2,
    },
  },
  bleach: {
    id: 'bleach',
    era: 'anime',
    label: 'Bleach',
    short: 'Bleach',
    focus: 'Soul Reapers and Bankai: flash steps, crescent slashes and swords that scatter into petals.',
    trait: {
      name: 'Shunpo',
      description: '10% faster. Reticle-aimed skills reach 25% farther.',
      speedMul: 1.1,
      reachMul: 1.25,
    },
  },
  aot: {
    id: 'aot',
    era: 'anime',
    label: 'Attack on Titan',
    short: 'AoT',
    focus: 'Titans and the Survey Corps: hardened fists, steam, thunder spears and the Rumbling.',
    trait: {
      name: 'Titan Regeneration',
      description: 'Repairs 0.4% of the hull every second, even in combat. 10% more hit points.',
      regenAlways: 0.004,
      hpMul: 1.1,
    },
  },
  demonslayer: {
    id: 'demonslayer',
    era: 'anime',
    label: 'Demon Slayer',
    short: 'Demon Slayer',
    focus: 'Breathing styles and blood demon arts: water and flame forms, whips of flesh, an endless castle.',
    trait: {
      name: 'Total Concentration',
      description: '10% more damage. Ultimates charge 15% faster.',
      damageMul: 1.1,
      ultChargeMul: 1.15,
    },
  },
  mha: {
    id: 'mha',
    era: 'anime',
    label: 'My Hero Academia',
    short: 'MHA',
    focus: 'Quirks: smashes that move the weather, explosions, and the Symbol of Peace.',
    trait: {
      name: 'Plus Ultra',
      description: 'Sinking an enemy within 2 km repairs 15% of your hull. 8% more damage.',
      killHeal: 0.15,
      damageMul: 1.08,
    },
  },

  foundry: { id:'foundry',era:'misc',label:'The Foundry',short:'Foundry',focus:'Modular arsenals that assemble their own battlefield.',trait:{name:'Modular Arsenal',description:'Ten railgun modules share the hull’s HP: each carries 50k capacity when deployed. Recall returns surviving health; destroyed modules rebuild in 12 s using redistributed hull health.'} },
  fold: {
    id: 'fold', era: 'misc', label: 'The Fold', short: 'Fold',
    focus: 'Phase warships that fold distance into destructive steps.',
    trait: { name: 'Fold Drive', description: 'Distances fold around the reticle. Every arrival opens another angle of attack.' },
  },
  abyss: {
    id: 'abyss',
    era: 'misc',
    label: 'The Abyss',
    short: 'Abyss',
    focus: 'Things from the hadal deep: drone swarms, whirlpools and jaws.',
    trait: {
      name: 'Hadal Pressure',
      description: 'Torpedo damage taken -25%. Summons and drones last 50% longer.',
      torpTakenMul: 0.75,
      summonTimeMul: 1.5,
    },
  },
};

/** The faction trait of a ship (undefined for the historic navies). */
export function traitOf(spec: ShipSpec): Trait | undefined {
  return FACTIONS[spec.nation].trait;
}

export function eraOf(spec: ShipSpec): Era {
  return FACTIONS[spec.nation].era;
}

/** The factions of an era, in hangar order. */
export function factionsOf(era: Era): Faction[] {
  return Object.values(FACTIONS).filter((f) => f.era === era);
}
