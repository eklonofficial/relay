// World-generation versions, so saves made before an update pick up what the update adds.
// Terrain and structure blocks regenerate from the seed on every load anyway; what a chunk only
// gets once, on its first visit, is the loot in its chests and the mobs living in its structures.
// Chunks first visited under an older GEN_VERSION receive those for every structure kind that
// arrived after it (and nothing they already had), when they next load.
export const GEN_VERSION = 4;
export const KIND_SINCE = {
  shipwreck: 3, ocean_ruin: 3, ocean_monument: 3, buried_treasure: 3,
  jungle_temple: 4, desert_well: 4, fossil: 4, trail_ruins: 4, woodland_mansion: 4, trial_chambers: 4,
};
export const sinceOf = kind => (kind && KIND_SINCE[kind]) || 1;
