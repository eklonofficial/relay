// Every gameplay constant in one place (GDD Appendix A). Units, as in the GDD:
//   velocities and ranges in units per tick / units (30 ticks a second, 1 unit = 1 map cell);
//   rof, burst gaps, melee, scope, swap and jump-buffer timers in ticks (−1 per tick);
//   reload, recoil, grenade-throw and shield timers in 1/60 s (−2 per tick).
// Both kinds of countdown are kept exactly: many timings only feel right because of them.
export const TICK_HZ = 30;
export const TICK = 1 / TICK_HZ;
export const SYNC_EVERY = 3;

export const PLAYER = {
  maxHp: 100,
  regenPerTick: 0.1, regenDelayTicks: 60,
  moveAccel: 0.025, friction: 0.64, adsMoveMult: 0.5, sprintMult: 1.4,
  gravity: 0.012, terminalFall: 0.29, maxStep: 0.29,
  jumpVel: 0.13, adsJumpMult: 0.66, coyoteTicks: 4, jumpBufferTicks: 10,
  ladderAccel: 0.028, ladderJumpOff: 0.065, jumpPadVel: 0.27,
  collideRadius: 0.31, hitRadius: 0.30, hitCenterY: 0.30,
  // The head pivots at +0.30 (pitch turns it); the eye, and the point every shot leaves from, sits
  // 0.10 up the head's own up axis [REF]. eyeY is that height when looking level.
  headY: 0.30, eyeUp: 0.10, eyeY: 0.40,
  stepUp: 0.26, killPlaneY: -10,
  spawnShield: 120, respawnTicks: 150, pauseGraceTicks: 90, pauseCooldownTicks: 150,
  swapStowTicks: 13, swapEquipTicks: 13, scopeDelayTicks: 7,
};

export const DAMAGE = { angleBase: 0.2, angleExp: 4 };

// Fields: dmg, rof (ticks), recoil (1/60 s), auto, mag, store, pickup, range (u), vel (u/tick),
// reload [short, long] (1/60 s), acc [accuracyMax, accuracyMin, accuracyLoss, accuracyRecover],
// ads (adsMod), moveMod (movementAccuracyMod), scope (FOV multiplier when aiming), dropoff [full damage
// up to (u), down to the minimum at (u), minimum multiplier] (damage falls with distance flown).
export const WEAPONS = {
  yolk47: { name: 'Yolk-47', dmg: 30, rof: 3, recoil: 7, auto: true, mag: 30, store: 240, pickup: 30, range: 20, vel: 1.5, reload: [160, 205], acc: [0.03, 0.15, 0.05, 0.025], ads: 0.5, moveMod: 1.0, tracer: 2, scope: 0.9, scoped: false,
    desc: 'Reliable full-auto rifle. Tap it at range, hose it up close.' },
  doubleYolker: { name: 'Double Yolker', dmg: 12.5, pellets: 16, dropoff: [3, 7, 0.12], rof: 8, recoil: 10, auto: false, mag: 2, store: 24, pickup: 8, range: 12, vel: 1.1, reload: [150, 150], acc: [0.07, 0.11, 0.12, 0.02], ads: 0.6, moveMod: 0.2, vSpreadMul: 0.55, scope: 1.0, scoped: false,
    desc: 'Two barrels. Point blank, nothing hits harder; it fades fast with distance.' },
  cageFree: { name: 'Cage Free', dmg: 101, rof: 13, recoil: 13, auto: false, mag: 15, store: 60, pickup: 15, range: 50, vel: 1.75, reload: [165, 225], acc: [0.004, 0.3, 0.3, 0.025], ads: 0.5, moveMod: 1.0, scope: 0.7, scoped: true,
    desc: 'Fifteen-round marksman rifle that forgives a miss.' },
  // Yolkzooka: a direct hit does `direct` (from [close, far], ramping up over the rocket's first rampDist
  // units of flight); the blast does `splash` of that at its centre, falling off linearly to its edge,
  // and throws eggs it doesn't crack (knock sideways, lift up). The shooter's own blast never hurts
  // them, it launches them (a rocket jump), and firing shoves them back a little (recoilPush).
  yolkzooka: { name: 'Yolkzooka', dmg: 110, direct: [50, 110], rampDist: 18, splash: 0.7, radius: 3.25, falloff: 1, minRange: 0,
    knock: 0.38, lift: 0.15, selfKnock: 0.3, selfLift: 0.06, recoilPush: 0.12, rof: 40, recoil: 60, auto: false, mag: 1, store: 4, pickup: 1, range: 45, vel: 0.8, reload: [140, 140], acc: [0.015, 0.3, 0.3, 0.02], ads: 0.5, moveMod: 1.0, absMinAcc: 0.3, scope: 0.9, scoped: true, rocket: true,
    desc: 'Rocket that hits harder the further it flies. Blast eggs aside, or rocket-jump off your own.' },
  beater: { name: 'Beater', dmg: 23, rof: 2, recoil: 7, auto: true, mag: 40, store: 200, pickup: 40, range: 20, vel: 1.25, reload: [190, 225], acc: [0.06, 0.19, 0.045, 0.05], ads: 0.6, moveMod: 0.7, tracer: 3, scope: 1.0, scoped: false,
    desc: 'Forty-round bullpup that never stops whisking.' },
  poacher: { name: 'Poacher', dmg: 180, rof: 15, recoil: 20, auto: false, mag: 1, store: 12, pickup: 4, range: 120, vel: 17, reload: [144, 144], acc: [0.0, 0.35, 0.1, 0.023], ads: 0.5, moveMod: 0.85, reloadBloom: false, scope: 0.3, scoped: true,
    desc: 'One round. One egg. Make it count.' },
  triBoil: { name: 'Tri-Boil', dmg: 35, burst: 3, burstGap: 3, rof: 15, recoil: 18, auto: false, mag: 24, store: 150, pickup: 24, range: 20, vel: 1.5, reload: [160, 205], acc: [0.03, 0.15, 0.04, 0.03], ads: 0.6, moveMod: 0.8, scope: 0.7, scoped: false,
    desc: 'Three-round burst for disciplined mid-range.' },
  peck9mm: { name: 'Peck 9mm', dmg: 28, rof: 4, recoil: 6, auto: false, mag: 15, store: 60, pickup: 15, range: 60, vel: 1.6, reload: [160, 195], acc: [0.008, 0.15, 0.06, 0.08], angleMin: 0.75, ads: 0.8, moveMod: 0.6, scope: 1.1, scoped: false,
    desc: 'Backup pistol: four or five hits crack an egg at any range.' },
};
// Home-screen order of the primaries (and their index on the wire).
export const PRIMARIES = ['yolk47', 'doubleYolker', 'cageFree', 'yolkzooka', 'beater', 'poacher', 'triBoil'];
export const SECONDARY = 'peck9mm';
export const WEAPON_IDS = [...PRIMARIES, SECONDARY];

// Melee (the whisk): `dmg` point blank (up to `close` along the swing: two eggs touching), down to `farDmg` at full reach; quick enough to spam (a swing
// every `lock` ticks, landing `windup` ticks in, and `recoil` blocks firing only briefly after).
export const MELEE = { dmg: 75, farDmg: 30, shellBreakerDmg: 255, windup: 2, reach: 0.8, close: 0.42, back: 0.25, radius: 0.475, lock: 10, recoil: 16 };

export const GRENADE = {
  startCount: 1, max: 3, dmg: 150, radius: 3, fuse: 75,
  chargeStart: -0.15, chargePerTick: 0.03, throwLock: 80, cancelLock: 30,
  drag: 0.96, restitution: 0.6, tangential: 0.98, restSpeed: 0.05, radiusBody: 0.12,
  throwSpeed: [0.10, 0.35], upBias: 0.1,
};

export const PICKUPS = { ammoRespawnTicks: 450, grenadeRespawnTicks: 750, jitter: 0.2, radius: 0.55 };

export const STREAKS = {
  every: 5,
  order: ['hardBoiled', 'shellBreaker', 'restock', 'overheal', 'doubleYolks', 'quailEgg'],
  randomAfter: 30,
  hardBoiledHp: 100,
  shellBreaker: { bulletMult: 1.5, ticks: 450, perKill: 90, cap: 450 },
  overheal: { hp: 200, decayPerTick: 5 / 30 },
  doubleYolks: { ticks: 450, mult: 2 },
  quailEgg: { ticks: 450, scale: 0.5 },
};

export const ROOST = { max: 1200, speeds: [1.2, 1.5, 2.04, 3.0, 4.8], takeover: 90, goal: 5, winBonus: 250, intermissionTicks: 300 };
export const SPATULA = { hop: 0.05, restitution: 0.5, carryBack: 0.3, radius: 0.6 };
export const ECONOMY = { perKill: 10, weekendMult: 2 };

export const MODES = ['ffa', 'teams', 'spatula', 'roost'];
export const MODE_NAMES = { ffa: 'Free For All', teams: 'Teams', spatula: 'Spatula Snatch', roost: 'Rule the Roost' };
// Home-screen dropdown order (GDD §14).
export const MODE_MENU = ['spatula', 'teams', 'ffa', 'roost'];

// Host options (GDD §17), defaults.
export const DEFAULT_OPTIONS = { gravity: 1, damage: 1, regen: 1, disabled: [], locked: false, noTeamChange: false, noTeamShuffle: false, scoreLimit: 0, botChat: true };

// Control bitmask (GDD §26).
export const CTRL = { up: 1, down: 2, left: 4, right: 8, jump: 16, fire: 32, melee: 64, scope: 128, reload: 256, swap: 512, grenade: 1024, sprint: 2048 };
