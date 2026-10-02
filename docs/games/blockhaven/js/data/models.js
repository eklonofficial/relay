// Block models in Java Edition's element format (block/*.json), for blocks whose texture is a
// sheet rather than one picture per face: torches, lanterns, end rods, bamboo, campfires, panes,
// iron bars, ladders, doors, trapdoors, anvils, end portal frames and cacti. Each element is a box
// with its own UV rectangle per face, so resource-pack textures land exactly where they do in Java.
//
// An element: [from, to, faces, rotation?, shade?]. Faces: 'face texture u0 v0 u1 v1 [rN] [c]; ...'
// (rN turns the texture by N degrees; c culls the face against a full block, Java's cullface).
// Rotation: [axis, degrees, origin, rescale?]. Coordinates are pixels, 0-16 across the block.
// Java's planes 0.001 or 0.01 off a block side sit half a pixel in (our vertex grid), so they never fight it.
const RAW = {
  torch: [
    [[7, 0, 7], [9, 10, 9], 'down torch 7 13 9 15; up torch 7 6 9 8', null, false],
    [[7, 0, 0], [9, 16, 16], 'west torch 0 0 16 16; east torch 0 0 16 16', null, false],
    [[0, 0, 7], [16, 16, 9], 'north torch 0 0 16 16; south torch 0 0 16 16', null, false],
  ],
  wall_torch: [
    [[-1, 3.5, 7], [1, 13.5, 9], 'down torch 7 13 9 15; up torch 7 6 9 8', ['z', -22.5, [0, 3.5, 8]], false],
    [[-1, 3.5, 0], [1, 19.5, 16], 'west torch 0 0 16 16; east torch 0 0 16 16', ['z', -22.5, [0, 3.5, 8]], false],
    [[-8, 3.5, 7], [8, 19.5, 9], 'north torch 0 0 16 16; south torch 0 0 16 16', ['z', -22.5, [0, 3.5, 8]], false],
  ],
  cactus: [
    [[0, 0, 0], [16, 16, 16], 'down bottom 0 0 16 16 c; up top 0 0 16 16 c'],
    [[0, 0, 1], [16, 16, 15], 'north side 0 0 16 16; south side 0 0 16 16'],
    [[1, 0, 0], [15, 16, 16], 'west side 0 0 16 16; east side 0 0 16 16'],
  ],
  lantern: [
    [[5, 0, 5], [11, 7, 11], 'down lantern 0 9 6 15 c; up lantern 0 9 6 15; north lantern 0 2 6 9; south lantern 0 2 6 9; west lantern 0 2 6 9; east lantern 0 2 6 9'],
    [[6, 7, 6], [10, 9, 10], 'up lantern 1 10 5 14; north lantern 1 0 5 2; south lantern 1 0 5 2; west lantern 1 0 5 2; east lantern 1 0 5 2'],
    [[6.5, 9, 8], [9.5, 11, 8], 'north lantern 14 1 11 3; south lantern 11 1 14 3', ['y', 45, [8, 8, 8]], false],
    [[8, 9, 6.5], [8, 11, 9.5], 'west lantern 14 10 11 12; east lantern 11 10 14 12', ['y', 45, [8, 8, 8]], false],
  ],
  hanging_lantern: [
    [[5, 1, 5], [11, 8, 11], 'down lantern 0 9 6 15; up lantern 0 9 6 15; north lantern 0 2 6 9; south lantern 0 2 6 9; west lantern 0 2 6 9; east lantern 0 2 6 9'],
    [[6, 8, 6], [10, 10, 10], 'down lantern 1 10 5 14; up lantern 1 10 5 14; north lantern 1 0 5 2; south lantern 1 0 5 2; west lantern 1 0 5 2; east lantern 1 0 5 2'],
    [[6.5, 11, 8], [9.5, 15, 8], 'north lantern 14 1 11 5; south lantern 11 1 14 5', ['y', 45, [8, 8, 8]], false],
    [[8, 10, 6.5], [8, 16, 9.5], 'west lantern 14 6 11 12; east lantern 11 6 14 12', ['y', 45, [8, 8, 8]], false],
  ],
  end_rod: [
    [[6, 0, 6], [10, 1, 10], 'down end_rod 6 6 2 2 c; up end_rod 2 2 6 6; north end_rod 2 6 6 7; south end_rod 2 6 6 7; west end_rod 2 6 6 7; east end_rod 2 6 6 7'],
    [[7, 1, 7], [9, 16, 9], 'up end_rod 2 0 4 2 c; north end_rod 0 0 2 15; south end_rod 0 0 2 15; west end_rod 0 0 2 15; east end_rod 0 0 2 15'],
  ],
  bamboo1: [
    [[7, 0, 7], [9, 16, 9], 'down all 13 4 15 6 c; up all 13 0 15 2 c; north all 0 0 2 16; south all 0 0 2 16; west all 0 0 2 16; east all 0 0 2 16'],
  ],
  bamboo2: [
    [[7, 0, 7], [9, 16, 9], 'down all 13 4 15 6 c; up all 13 0 15 2 c; north all 3 0 5 16; south all 3 0 5 16; west all 3 0 5 16; east all 3 0 5 16'],
  ],
  bamboo3: [
    [[7, 0, 7], [9, 16, 9], 'down all 13 4 15 6 c; up all 13 0 15 2 c; north all 6 0 8 16; south all 6 0 8 16; west all 6 0 8 16; east all 6 0 8 16'],
  ],
  bamboo4: [
    [[7, 0, 7], [9, 16, 9], 'down all 13 4 15 6 c; up all 13 0 15 2 c; north all 9 0 11 16; south all 9 0 11 16; west all 9 0 11 16; east all 9 0 11 16'],
  ],
  campfire: [
    [[1, 0, 0], [5, 4, 16], 'down log 0 0 16 4 r90 c; up log 0 0 16 4 r90; north log 0 4 4 8 c; south log 0 4 4 8 c; west log 16 0 0 4; east lit_log 0 1 16 5'],
    [[0, 3, 11], [16, 7, 15], 'down lit_log 0 4 16 8; up log 0 0 16 4 r180; north lit_log 16 0 0 4; south lit_log 0 0 16 4; west log 0 4 4 8 c; east log 0 4 4 8 c'],
    [[11, 0, 0], [15, 4, 16], 'down log 0 0 16 4 r90 c; up log 0 0 16 4 r90; north log 0 4 4 8 c; south log 0 4 4 8 c; west lit_log 16 1 0 5; east log 0 0 16 4'],
    [[0, 3, 1], [16, 7, 5], 'down lit_log 0 4 16 8; up log 0 0 16 4 r180; north lit_log 0 0 16 4; south lit_log 16 0 0 4; west log 0 4 4 8 c; east log 0 4 4 8 c'],
    [[5, 0, 0], [11, 1, 16], 'down log 0 8 16 14 r90 c; up lit_log 0 8 16 14 r90; north log 0 15 6 16 c; south log 10 15 16 16 c'],
    [[0.8, 1, 8], [15.2, 17, 8], 'north fire 0 0 16 16; south fire 0 0 16 16', ['y', 45, [8, 8, 8], true], false],
    [[8, 1, 0.8], [8, 17, 15.2], 'west fire 0 0 16 16; east fire 0 0 16 16', ['y', 45, [8, 8, 8], true], false],
  ],
  pane_post: [
    [[7, 0, 7], [9, 16, 9], 'down edge 7 7 9 9; up edge 7 7 9 9'],
  ],
  pane_side: [
    [[7, 0, 0], [9, 16, 7], 'down edge 7 0 9 7; up edge 7 0 9 7; north edge 7 0 9 16 c; west pane 16 0 9 16; east pane 9 0 16 16'],
  ],
  pane_side_alt: [
    [[7, 0, 9], [9, 16, 16], 'down edge 7 0 9 7; up edge 7 0 9 7; south edge 7 0 9 16 c; west pane 7 0 0 16; east pane 0 0 7 16'],
  ],
  pane_noside: [
    [[7, 0, 7], [9, 16, 9], 'north pane 9 0 7 16'],
  ],
  pane_noside_alt: [
    [[7, 0, 7], [9, 16, 9], 'east pane 7 0 9 16'],
  ],
  bars_post_ends: [
    [[7, 0.5, 7], [9, 0.5, 9], 'down edge 7 7 9 9; up edge 7 7 9 9'],
    [[7, 15.5, 7], [9, 15.5, 9], 'down edge 7 7 9 9; up edge 7 7 9 9'],
  ],
  bars_post: [
    [[8, 0, 7], [8, 16, 9], 'west bars 7 0 9 16; east bars 9 0 7 16'],
    [[7, 0, 8], [9, 16, 8], 'north bars 7 0 9 16; south bars 9 0 7 16'],
  ],
  bars_cap: [
    [[8, 0, 8], [8, 16, 9], 'west bars 8 0 7 16; east bars 7 0 8 16'],
    [[7, 0, 9], [9, 16, 9], 'north bars 9 0 7 16; south bars 7 0 9 16'],
  ],
  bars_cap_alt: [
    [[8, 0, 7], [8, 16, 8], 'west bars 8 0 9 16; east bars 9 0 8 16'],
    [[7, 0, 7], [9, 16, 7], 'north bars 7 0 9 16; south bars 9 0 7 16'],
  ],
  bars_side: [
    [[8, 0, 0], [8, 16, 8], 'west bars 16 0 8 16; east bars 8 0 16 16'],
    [[7, 0, 0], [9, 16, 7], 'north edge 7 0 9 16 c'],
    [[7, 0.5, 0], [9, 0.5, 7], 'down edge 9 0 7 7; up edge 7 0 9 7'],
    [[7, 15.5, 0], [9, 15.5, 7], 'down edge 9 0 7 7; up edge 7 0 9 7'],
  ],
  bars_side_alt: [
    [[8, 0, 8], [8, 16, 16], 'west bars 8 0 0 16; east bars 0 0 8 16'],
    [[7, 0, 9], [9, 16, 16], 'down edge 9 9 7 16; up edge 7 9 9 16; south edge 7 0 9 16 c'],
    [[7, 0.5, 9], [9, 0.5, 16], 'down edge 9 9 7 16; up edge 7 9 9 16'],
    [[7, 15.5, 9], [9, 15.5, 16], 'down edge 9 9 7 16; up edge 7 9 9 16'],
  ],
  end_portal_frame: [
    [[0, 0, 0], [16, 13, 16], 'down bottom 0 0 16 16 c; up top 0 0 16 16; north side 0 3 16 16 c; south side 0 3 16 16 c; west side 0 3 16 16 c; east side 0 3 16 16 c'],
  ],
  end_portal_frame_filled: [
    [[0, 0, 0], [16, 13, 16], 'down bottom 0 0 16 16 c; up top 0 0 16 16; north side 0 3 16 16 c; south side 0 3 16 16 c; west side 0 3 16 16 c; east side 0 3 16 16 c'],
    [[4, 13, 4], [12, 16, 12], 'up eye 4 4 12 12 c; north eye 4 0 12 3; south eye 4 0 12 3; west eye 4 0 12 3; east eye 4 0 12 3'],
  ],
  ladder: [
    [[0, 0, 15.2], [16, 16, 15.2], 'north texture 0 0 16 16; south texture 16 0 0 16', null, false],
  ],
  door_bottom: [
    [[0, 0, 0], [3, 16, 16], 'down bottom 16 13 0 16 r90 c; north bottom 3 0 0 16 c; south bottom 0 0 3 16 c; west bottom 0 0 16 16 c; east bottom 16 0 0 16'],
  ],
  door_bottom_open: [
    [[0, 0, 0], [3, 16, 16], 'down bottom 0 16 16 13 r90 c; north bottom 0 0 3 16 c; south bottom 0 0 3 16 c; west bottom 16 0 0 16 c; east bottom 0 0 16 16'],
  ],
  door_top: [
    [[0, 0, 0], [3, 16, 16], 'up top 0 3 16 0 r90 c; north top 3 0 0 16 c; south top 0 0 3 16 c; west top 0 0 16 16 c; east top 16 0 0 16'],
  ],
  door_top_open: [
    [[0, 0, 0], [3, 16, 16], 'up top 0 3 16 0 r270 c; north top 0 0 3 16 c; south top 0 0 3 16 c; west top 16 0 0 16 c; east top 0 0 16 16'],
  ],
  trapdoor_bottom: [
    [[0, 0, 0], [16, 3, 16], 'down texture 0 0 16 16 c; up texture 0 0 16 16; north texture 0 16 16 13 c; south texture 0 16 16 13 c; west texture 0 16 16 13 c; east texture 0 16 16 13 c'],
  ],
  trapdoor_top: [
    [[0, 13, 0], [16, 16, 16], 'down texture 0 0 16 16; up texture 0 0 16 16 c; north texture 0 16 16 13 c; south texture 0 16 16 13 c; west texture 0 16 16 13 c; east texture 0 16 16 13 c'],
  ],
  trapdoor_open: [
    [[0, 0, 13], [16, 16, 16], 'down texture 0 13 16 16 c; up texture 0 16 16 13 c; north texture 0 0 16 16; south texture 0 0 16 16 c; west texture 16 0 13 16 c; east texture 13 0 16 16 c'],
  ],
  anvil: [
    [[2, 0, 2], [14, 4, 14], 'down body 2 2 14 14 r180 c; up body 2 2 14 14 r180; north body 2 12 14 16; south body 2 12 14 16; west body 0 2 4 14 r90; east body 4 2 0 14 r270'],
    [[4, 4, 3], [12, 5, 13], 'up body 4 3 12 13 r180; north body 4 11 12 12; south body 4 11 12 12; west body 4 3 5 13 r90; east body 5 3 4 13 r270'],
    [[6, 5, 4], [10, 10, 12], 'north body 6 6 10 11; south body 6 6 10 11; west body 5 4 10 12 r90; east body 10 4 5 12 r270'],
    [[3, 10, 0], [13, 16, 16], 'down body 3 0 13 16 r180; up top 3 0 13 16 r180; north body 3 0 13 6; south body 3 0 13 6; west body 10 0 16 16 r90; east body 16 0 10 16 r270'],
  ],
  fire_floor: [
    [[0, 0, 8.8], [16, 22.4, 8.8], 'south fire 0 0 16 16', ['x', -22.5, [8, 8, 8], true], false],
    [[0, 0, 7.2], [16, 22.4, 7.2], 'north fire 0 0 16 16', ['x', 22.5, [8, 8, 8], true], false],
    [[8.8, 0, 0], [8.8, 22.4, 16], 'west fire 0 0 16 16', ['z', -22.5, [8, 8, 8], true], false],
    [[7.2, 0, 0], [7.2, 22.4, 16], 'east fire 0 0 16 16', ['z', 22.5, [8, 8, 8], true], false],
  ],
  fire_side: [
    [[0, 0, 0.5], [16, 22.4, 0.5], 'north fire 0 0 16 16; south fire 0 0 16 16', null, false],
  ],
  fire_side_alt: [
    [[0, 0, 0.5], [16, 22.4, 0.5], 'north fire 16 0 0 16; south fire 16 0 0 16', null, false],
  ],
  stem0: [
    [[0, -1, 8], [16, 1, 8], 'north stem 0 0 16 2; south stem 16 0 0 2', ['y', 45, [8, 8, 8], true]],
    [[8, -1, 0], [8, 1, 16], 'west stem 0 0 16 2; east stem 16 0 0 2', ['y', 45, [8, 8, 8], true]],
  ],
  stem1: [
    [[0, -1, 8], [16, 3, 8], 'north stem 0 0 16 4; south stem 16 0 0 4', ['y', 45, [8, 8, 8], true]],
    [[8, -1, 0], [8, 3, 16], 'west stem 0 0 16 4; east stem 16 0 0 4', ['y', 45, [8, 8, 8], true]],
  ],
  stem2: [
    [[0, -1, 8], [16, 5, 8], 'north stem 0 0 16 6; south stem 16 0 0 6', ['y', 45, [8, 8, 8], true]],
    [[8, -1, 0], [8, 5, 16], 'west stem 0 0 16 6; east stem 16 0 0 6', ['y', 45, [8, 8, 8], true]],
  ],
  stem3: [
    [[0, -1, 8], [16, 7, 8], 'north stem 0 0 16 8; south stem 16 0 0 8', ['y', 45, [8, 8, 8], true]],
    [[8, -1, 0], [8, 7, 16], 'west stem 0 0 16 8; east stem 16 0 0 8', ['y', 45, [8, 8, 8], true]],
  ],
  stem4: [
    [[0, -1, 8], [16, 9, 8], 'north stem 0 0 16 10; south stem 16 0 0 10', ['y', 45, [8, 8, 8], true]],
    [[8, -1, 0], [8, 9, 16], 'west stem 0 0 16 10; east stem 16 0 0 10', ['y', 45, [8, 8, 8], true]],
  ],
  stem5: [
    [[0, -1, 8], [16, 11, 8], 'north stem 0 0 16 12; south stem 16 0 0 12', ['y', 45, [8, 8, 8], true]],
    [[8, -1, 0], [8, 11, 16], 'west stem 0 0 16 12; east stem 16 0 0 12', ['y', 45, [8, 8, 8], true]],
  ],
  stem6: [
    [[0, -1, 8], [16, 13, 8], 'north stem 0 0 16 14; south stem 16 0 0 14', ['y', 45, [8, 8, 8], true]],
    [[8, -1, 0], [8, 13, 16], 'west stem 0 0 16 14; east stem 16 0 0 14', ['y', 45, [8, 8, 8], true]],
  ],
  stem7: [
    [[0, -1, 8], [16, 15, 8], 'north stem 0 0 16 16; south stem 16 0 0 16', ['y', 45, [8, 8, 8], true]],
    [[8, -1, 0], [8, 15, 16], 'west stem 0 0 16 16; east stem 16 0 0 16', ['y', 45, [8, 8, 8], true]],
  ],
};

// Mesher face indices: +X (east), -X (west), +Y (up), -Y (down), +Z (south), -Z (north).
const FACE = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 };
const AXIS = { x: 0, y: 1, z: 2 };

function compile(els) {
  return els.map(([from, to, faces, rot = null, shade = true]) => {
    const e = { from, to, shade, rot: null, faces: [] };
    for (const spec of faces.split(';')) {
      const [name, tex, u0, v0, u1, v1, ...opts] = spec.trim().split(/\s+/);
      const r = opts.find(o => o[0] === 'r');
      e.faces.push({ f: FACE[name], tex, uv: [+u0, +v0, +u1, +v1], rot: r ? (+r.slice(1) / 90) & 3 : 0, cull: opts.includes('c') });
    }
    if (rot) {
      const [axis, deg, origin, rescale] = rot, a = deg * Math.PI / 180;
      // Java's rescale stretches the two turned axes so the element still spans the block.
      const k = rescale ? 1 / Math.cos(Math.abs(a)) : 1;
      e.rot = { axis: AXIS[axis], c: Math.cos(a), s: Math.sin(a), o: origin, scale: [0, 1, 2].map(i => (i === AXIS[axis] ? 1 : k)) };
    }
    return e;
  });
}

export const MODELS = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, compile(v)]));
