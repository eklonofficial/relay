"""Imports block-built maps (a folder of maps/*.json, models/block-library.glb, skyboxes/*) into
Shock Shellers:

    python3 docs/games/shockshellers/tools/maps/import_maps.py <source folder>

Writes, under docs/games/shockshellers:
  assets/maps/blocks.glb          the block library (the meshes the maps place)
  assets/maps/pack.json           every map: its pieces, spawns, spatula points, roost zones, pickups,
                                  sky, sun, fog, player count and modes
  assets/maps/thumbs/<id>.webp    a small preview of each map that has one (the custom match list)
  assets/maps/sky/<name>/*.jpg    the skyboxes
  js/maps/blocks.js               the pieces' collision (generated; js/maps/pieces.js appends it)
  js/maps/map-assets.js           every file above by name (generated; the build content-addresses them)

Map cells are 1x1x1 with each mesh centred in its cell, so a piece at (x, y, z) fills the game's
grid cell (x, y, z). Collision comes from each piece's own geometry: a full block is one box, and
anything else (ramps, stairs, slopes, props with a collision mesh as a child) becomes a small
heightfield of boxes, so slopes walk as steps the movement code climbs. A ladder records which side
of its cell it hangs on.
"""
import json, math, shutil, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image

SRC = Path(sys.argv[1]).expanduser()
GAME = Path(__file__).resolve().parents[2]
OUT = GAME / 'assets' / 'maps'

# ---------------- the block library ----------------
glb = (SRC / 'models' / 'block-library.glb').read_bytes()
jlen = struct.unpack_from('<I', glb, 12)[0]
G = json.loads(glb[20:20 + jlen])
BIN = glb[28 + jlen:]
NODES = G['nodes']
BY_NAME = {n['name']: i for i, n in enumerate(NODES)}
TYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
SIZE = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def accessor(i):
    a = G['accessors'][i]; v = G['bufferViews'][a['bufferView']]
    dt = np.dtype(TYPES[a['componentType']]); n = SIZE[a['type']]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride', dt.itemsize * n)
    raw = np.frombuffer(BIN, dtype=np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], dt.itemsize * n), strides=(stride, 1))
    return np.frombuffer(rows.copy().tobytes(), dtype=dt).reshape(a['count'], n).astype(np.float64)

def local_matrix(node):
    m = np.eye(4)
    if 'matrix' in node: return np.array(node['matrix']).reshape(4, 4).T
    t = node.get('translation', [0, 0, 0]); r = node.get('rotation', [0, 0, 0, 1]); s = node.get('scale', [1, 1, 1])
    x, y, z, w = r
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m[:3, :3] = R * np.array(s); m[:3, 3] = t
    return m

def triangles(node_index, matrix):
    """Triangles (n, 3, 3) of one node's mesh, transformed."""
    node = NODES[node_index]
    if 'mesh' not in node: return np.zeros((0, 3, 3))
    out = []
    for prim in G['meshes'][node['mesh']]['primitives']:
        pos = accessor(prim['attributes']['POSITION'])
        pos = (np.c_[pos, np.ones(len(pos))] @ matrix.T)[:, :3]
        idx = accessor(prim['indices']).astype(int).ravel() if 'indices' in prim else np.arange(len(pos))
        out.append(pos[idx].reshape(-1, 3, 3))
    return np.concatenate(out) if out else np.zeros((0, 3, 3))

def subtree_triangles(node_index, matrix=np.eye(4)):
    tris = []
    for c in NODES[node_index].get('children', []):
        m = matrix @ local_matrix(NODES[c])
        tris.append(triangles(c, m)); tris.append(subtree_triangles(c, m))
    return np.concatenate(tris) if tris else np.zeros((0, 3, 3))

def heightfield(tris, n):
    """Boxes [x0, y0, z0, x1, y1, z1] (cell space, 0..1) covering the triangles' columns on an n×n grid."""
    if not len(tris): return []
    t = tris + 0.5   # mesh space is centred on the cell
    top = np.full((n, n), -np.inf); bot = np.full((n, n), np.inf)
    for tri in t:
        a, b, c = tri
        span = max(np.ptp(tri[:, 0]), np.ptp(tri[:, 2]), np.ptp(tri[:, 1]))
        k = int(min(64, math.ceil(span * n * 2) + 1))
        u, v = np.meshgrid(np.linspace(0, 1, k + 1), np.linspace(0, 1, k + 1))
        keep = (u + v) <= 1
        u, v = u[keep], v[keep]
        p = a + np.outer(u, b - a) + np.outer(v, c - a)
        inside = (p[:, 0] >= 0) & (p[:, 0] <= 1) & (p[:, 2] >= 0) & (p[:, 2] <= 1)
        p = p[inside]
        if not len(p): continue
        i = np.clip((p[:, 0] * n).astype(int), 0, n - 1); j = np.clip((p[:, 2] * n).astype(int), 0, n - 1)
        np.maximum.at(top, (j, i), p[:, 1]); np.minimum.at(bot, (j, i), p[:, 1])
    top = np.clip(top, 0, 1); bot = np.clip(bot, 0, 1)
    spans = {}
    for j in range(n):
        for i in range(n):
            if not np.isfinite(top[j, i]) or top[j, i] < 0.02: continue
            # (to 1/32: surface detail shouldn't split a slope into dozens of boxes)
            lo, hi = math.floor(float(bot[j, i]) * 32) / 32, math.ceil(float(top[j, i]) * 32 - 1e-6) / 32
            if hi - lo < 0.05: lo = max(0.0, round(hi - 0.05, 3))   # a thin plate still stands on something
            spans[(i, j)] = (lo, hi)
    # Merge runs along x, then identical runs on consecutive rows.
    rows = []
    for j in range(n):
        i = 0
        while i < n:
            if (i, j) not in spans: i += 1; continue
            s = spans[(i, j)]; e = i
            while (e + 1, j) in spans and spans[(e + 1, j)] == s: e += 1
            rows.append([i, e + 1, j, j + 1, s]); i = e + 1
    merged = []
    for r in rows:
        prev = next((m for m in merged if m[0] == r[0] and m[1] == r[1] and m[3] == r[2] and m[4] == r[4]), None)
        if prev: prev[3] = r[3]
        else: merged.append(r)
    return [[m[0] / n, m[4][0], m[2] / n, m[1] / n, m[4][1], m[3] / n] for m in merged]

def piece(name):
    """A piece's collision kind and boxes (ry = 0), from its name (theme.piece.collider) and mesh."""
    parts = name.split('.')
    collider = parts[2] if len(parts) > 2 else 'none'
    if parts[0] == 'SPECIAL':
        # Invisible walls: they stop players and grenades but not shots.
        return {'kind': 'pass', 'boxes': [[0, 0, 0, 1, 1, 1]], 'mesh': False} if parts[1] == 'barrier' and collider == 'full' else None
    if parts[0] == 'DYNAMIC': return None
    i = BY_NAME[name]
    if collider == 'none': return {'kind': 'none', 'boxes': [], 'mesh': True}
    if collider == 'full': return {'kind': 'solid', 'boxes': [[0, 0, 0, 1, 1, 1]], 'mesh': True}
    if collider == 'ladder':
        tris = triangles(i, np.eye(4)) + 0.5
        cx, cz = tris[:, :, 0].mean() - 0.5, tris[:, :, 2].mean() - 0.5
        # The side it hangs on (game ry convention: 0 +z, 1 +x, 2 -z, 3 -x).
        face = (0 if cz > 0 else 2) if abs(cz) >= abs(cx) else (1 if cx > 0 else 3)
        return {'kind': 'ladder', 'boxes': [], 'mesh': True, 'face': face}
    # aabb / obb props collide by their collision children; wedges by their own shape.
    tris = subtree_triangles(i) if NODES[i].get('children') else triangles(i, np.eye(4))
    if not len(tris): tris = triangles(i, np.eye(4))
    boxes = heightfield(tris, 8 if collider in ('wedge', 'iwedge', 'obb') else 4)
    # Slopes and stairs (bots walk up them rather than jumping).
    ramp = collider in ('wedge', 'obb') and len({round(b[4], 2) for b in boxes}) > 2
    return {'kind': 'solid' if boxes else 'none', 'boxes': boxes, 'mesh': True, **({'ramp': True} if ramp else {})}

# ---------------- the maps ----------------
SKY = {'default': 'clear-day', 'moonbase': 'star-field', 'night': 'midnight', 'whimsical': 'candy-sky'}
MODES = {'FFA': 'ffa', 'Teams': 'teams', 'Spatula': 'spatula', 'King': 'roost'}
hexrgb = lambda s: int(s.lstrip('#')[:6], 16)

def slug(name): return ''.join(c if c.isalnum() else '-' for c in name.lower()).strip('-')

files = sorted((SRC / 'maps').glob('*.json'))
names = sorted({k for f in files for k in json.loads(f.read_text())['data']})
blocks, index = [], {}
for n in names:
    p = piece(n)
    if p is None: continue
    index[n] = len(blocks); blocks.append({'name': n, **p})

def cluster(cells):
    """Connected groups (6-neighbour) of cells."""
    cells = set(cells); groups = []
    while cells:
        stack = [cells.pop()]; g = []
        while stack:
            c = stack.pop(); g.append(c)
            for d in [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]:
                q = (c[0] + d[0], c[1] + d[1], c[2] + d[2])
                if q in cells: cells.remove(q); stack.append(q)
        groups.append(g)
    return groups

def pickups(solid, w, h, d, spawns, rnd):
    """Ammo and grenade spots: open floor cells (headroom above, solid under), spread apart."""
    floor = [(x, y, z) for (x, y, z), top in solid.items() if top >= 0.95 and y + 1 < h and (x, y + 1, z) not in solid and (x, y + 2, z) not in solid]
    if not floor: return []
    n = max(4, min(12, round(len(floor) / 90)))
    chosen, taken = [], [(s[0], s[1], s[2]) for s in spawns]
    for _ in range(n):
        best, bd = None, -1
        for c in rnd.sample(floor, min(len(floor), 400)):
            dist = min((abs(c[0] + 0.5 - t[0]) + abs(c[1] + 1 - t[1]) * 2 + abs(c[2] + 0.5 - t[2]) for t in taken), default=99)
            if dist > bd: best, bd = c, dist
        chosen.append(best); taken.append((best[0] + 0.5, best[1] + 1, best[2] + 0.5))
    return [['ammo' if i % 3 else 'grenade', c[0] + 0.5, c[1] + 1.3, c[2] + 0.5] for i, c in enumerate(chosen)]

import random
pack = []
for f in files:
    m = json.loads(f.read_text())
    w, h, d = m['width'], m['height'] + 4, m['depth']
    place, spawns, spatula, zone_cells, solid = [], [], [], [], {}
    for name, items in m['data'].items():
        for p in items:
            x, y, z, ry = p['x'], p['y'], p['z'], p.get('ry', 0) & 3
            if name in ('SPECIAL.spawn-blue.none', 'SPECIAL.spawn-red.none'):
                spawns.append([x + 0.5, y, z + 0.5, 1 if 'blue' in name else 2]); continue
            if name == 'SPECIAL.spatula.none': spatula.append([x + 0.5, y, z + 0.5]); continue
            if name == 'DYNAMIC.capture-zone.none': zone_cells.append((x, y, z)); continue
            if name not in index: continue
            b = blocks[index[name]]
            place += [index[name], x, y, z, ry]
            if b['kind'] in ('solid', 'pass') and b['boxes']: solid[(x, y, z)] = max(bx[4] for bx in b['boxes'])
    zones = []
    for g in cluster(zone_cells):
        xs, ys, zs = [c[0] for c in g], [c[1] for c in g], [c[2] for c in g]
        zones.append([min(xs), min(zs), max(xs), max(zs), min(ys)])
    modes = [MODES[k] for k, on in m['modes'].items() if on and k in MODES and (k != 'King' or zones)]
    fid = slug(f.stem)
    sun = m.get('sun', {}); sd = sun.get('direction', {'x': -0.4, 'y': 0.8, 'z': -0.3})
    fog = m.get('fog', {})
    pack.append({
        'id': 'n-' + fid, 'name': m['name'], 'w': w, 'h': h, 'd': d, 'maxPlayers': int(m['numPlayers']), 'modes': modes,
        'sky': SKY.get(m.get('skybox'), 'clear-day'), 'sun': {'dir': [sd['x'], sd['y'], sd['z']], 'color': hexrgb(sun.get('color', '#ffffff'))},
        'fog': {'color': hexrgb(fog.get('color', '#c7e1ee')), 'density': float(fog.get('density', 0.02))},
        'place': place, 'spawns': spawns, 'spatula': spatula, 'zones': zones,
        'items': pickups(solid, w, h, d, spawns, random.Random(fid)),
        # Floor an egg can stand on (a cell's top with two clear cells above): the map's real size.
        'walk': sum(1 for (x, y, z), top in solid.items() if top >= 0.5 and (x, y + 1, z) not in solid and (x, y + 2, z) not in solid),
    })
    pack[-1]['thumb'] = f.with_suffix('.png').exists()
    if pack[-1]['thumb']:
        thumb = Image.open(f.with_suffix('.png')).convert('RGB'); thumb.thumbnail((192, 100))
        (OUT / 'thumbs').mkdir(parents=True, exist_ok=True); thumb.save(OUT / 'thumbs' / f'n-{fid}.webp', quality=78)

# ---------------- write ----------------
OUT.mkdir(parents=True, exist_ok=True)
shutil.copyfile(SRC / 'models' / 'block-library.glb', OUT / 'blocks.glb')
(OUT / 'pack.json').write_text(json.dumps(pack, separators=(',', ':')))
for sky in sorted(set(SKY.values())):
    (OUT / 'sky' / sky).mkdir(parents=True, exist_ok=True)
    for face in ['px', 'nx', 'py', 'ny', 'pz', 'nz']: shutil.copyfile(SRC / 'skyboxes' / sky / f'skybox_{face}.jpg', OUT / 'sky' / sky / f'{face}.jpg')
rnd = lambda v: round(v, 3)
table = [{k: (([[rnd(c) for c in b] for b in v]) if k == 'boxes' else v) for k, v in blk.items()} for blk in blocks]
(GAME / 'js' / 'maps' / 'blocks.js').write_text(
    '// Generated by tools/maps/import_maps.py: the imported map pieces, by name, with their collision\n'
    '// (kind and boxes at ry = 0, cell space), whether they have a mesh to draw, and a ladder\'s side.\n'
    'export const BLOCKS = ' + json.dumps(table, separators=(',', ':')) + ';\n')
urls = ['pack.json', 'blocks.glb'] + [f'thumbs/{p["id"]}.webp' for p in pack if p['thumb']] + [f'sky/{s}/{f}.jpg' for s in sorted(set(SKY.values())) for f in ['px', 'nx', 'py', 'ny', 'pz', 'nz']]
(GAME / 'js' / 'maps' / 'map-assets.js').write_text(
    '// Generated by tools/maps/import_maps.py: the imported maps\' files (the production build turns\n'
    '// each URL into a content-addressed resource).\nexport const MAP_ASSETS = {\n'
    + ''.join(f"  '{u}': new URL('../../assets/maps/{u}', import.meta.url).href,\n" for u in urls) + '};\n')
print(f'{len(pack)} maps, {len(blocks)} pieces, {sum(len(p["place"]) // 5 for p in pack)} placements')
