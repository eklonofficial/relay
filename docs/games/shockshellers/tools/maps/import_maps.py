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
grid cell (x, y, z). A placement turns its piece by quarter turns rx, ry, rz, applied as Euler YXZ
(roll, then pitch, then yaw: R = Ry Rx Rz), stored as one code ry + 4 rx + 16 rz (maps/pieces.js
orient()); the meshes are used as they are. (Checked against the maps themselves: ramps' high ends
and off-centre pieces' heavy sides meet their neighbouring blocks under this convention and not
under a mirrored one.)

Collision follows each piece's collider (the third part of its name):
  full          the whole cell
  aabb / obb    the piece's collider meshes (its child boxes), each its own box; a tilted box (obb)
                fills its 1/8-cell voxels
  wedge, iwedge ramps and stairs (no colliders): the shape's columns, floor up to its surface (a
                wedge) or ceiling down to it (an inverted wedge), in 1/8 steps the movement code climbs
  ladder        no boxes; the side it hangs on
  none          nothing
A fourth part, soft or verysoft, lets shots (and grenades) through; INTERACTIVE.jump-pad is a pad.
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

def columns(tris, n):
    """The highest and lowest surface over each column of an n×n grid [z, x] (cell space)."""
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
    return np.clip(top, 0, 1), np.clip(bot, 0, 1)

def heightfield(tris, n, ceiling=False):
    """Boxes [x0, y0, z0, x1, y1, z1] (cell space, 0..1) for a shape with no overhangs, column by
    column on an n×n grid: from the floor up to its top surface, or (ceiling) from the top down to
    its lowest surface."""
    if not len(tris): return []
    top, bot = columns(tris, n)
    vox = np.zeros((n, n, n), bool)   # [x, y, z]
    for j in range(n):
        for i in range(n):
            if not np.isfinite(top[j, i]): continue
            lo, hi = (bot[j, i], 1.0) if ceiling else (0.0, top[j, i])
            k0, k1 = int(round(lo * n)), int(round(hi * n))
            vox[i, k0:k1, j] = True
    return merge(vox)

RAMP = 16
def wedge(tris, ceiling=False):
    """A wedge's collision: a slope (the source game's wedge collider is a plane, whatever the mesh
    looks like, steps or a smooth ramp), as RAMP fine steps rising the way its mesh rises."""
    n = RAMP; top, bot = columns(tris, n)
    h = (1 - bot) if ceiling else top                       # how far the solid reaches into the cell
    if not np.isfinite(h).all(): return heightfield(tris, 8, ceiling)
    u = (np.arange(n) + 0.5) / n
    best = None
    for axis in (0, 1):                                     # h[z, x]: along x (axis 1) or z (axis 0)
        for sign in (1, -1):
            along = u if sign > 0 else 1 - u
            ideal = np.broadcast_to(along[None, :] if axis == 1 else along[:, None], (n, n))
            err = np.abs(h - ideal).mean()
            if best is None or err < best[0]: best = (err, axis, sign)
    err, axis, sign = best
    boxes = []
    for k in range(n):
        lo, hi = k / n, 1.0                                   # the part of the cell this layer covers...
        if sign < 0: lo, hi = 0.0, 1 - k / n
        y0, y1 = (1 - (k + 1) / n, 1 - k / n) if ceiling else (k / n, (k + 1) / n)
        boxes.append([lo, y0, 0, hi, y1, 1] if axis == 1 else [0, y0, lo, 1, y1, hi])
    return boxes

def merge(vox):
    """Greedy boxes covering a voxel grid [x, y, z] (n per side), in cell space."""
    n = vox.shape[0]; vox = vox.copy(); boxes = []
    for y in range(n):
        for z in range(n):
            for x in range(n):
                if not vox[x, y, z]: continue
                x1 = x
                while x1 + 1 < n and vox[x1 + 1, y, z]: x1 += 1
                z1 = z
                while z1 + 1 < n and vox[x:x1 + 1, y, z1 + 1].all(): z1 += 1
                y1 = y
                while y1 + 1 < n and vox[x:x1 + 1, y1 + 1, z:z1 + 1].all(): y1 += 1
                vox[x:x1 + 1, y:y1 + 1, z:z1 + 1] = False
                boxes.append([x / n, y / n, z / n, (x1 + 1) / n, (y1 + 1) / n, (z1 + 1) / n])
    return boxes

def colliders(i, M=np.eye(4), top=True):
    """The collider meshes under a piece: (their own-space bounds, [matrices into the piece to try]).
    A collider nested under another takes its parents' transforms too (the glTF rule, right for most),
    but some sit where their own transform alone puts them: both are offered."""
    out = []
    for c in NODES[i].get('children', []):
        own = local_matrix(NODES[c]); m = M @ own
        if 'mesh' in NODES[c]:
            v = triangles(c, np.eye(4)).reshape(-1, 3)
            if len(v): out.append((v.min(0), v.max(0), [m] if top or np.allclose(m, own) else [m, own]))
        out += colliders(c, m, False)
    return out

def surface_points(tris, step=0.04):
    """Points spread over triangles (every ~step), to tell where a mesh actually has surface."""
    pts = []
    for a, b, c in tris:
        k = int(min(40, math.ceil(max(np.linalg.norm(b - a), np.linalg.norm(c - a), np.linalg.norm(c - b)) / step) + 1))
        u, v = np.meshgrid(np.linspace(0, 1, k + 1), np.linspace(0, 1, k + 1)); keep = (u + v) <= 1
        pts.append(a + np.outer(u[keep], b - a) + np.outer(v[keep], c - a))
    return np.concatenate(pts) if pts else np.zeros((0, 3))

VOX = 8
DROPPED = []
def collider_boxes(i, oriented):
    """A piece's collider meshes as boxes in cell space (clipped to the cell). Each is a box; one
    turned by other than quarter turns fills its voxels (oriented) or its bounding box (aabb)."""
    boxes, vox = [], np.zeros((VOX, VOX, VOX), bool)
    centres = (np.arange(VOX) + 0.5) / VOX - 0.5
    P = np.stack(np.meshgrid(centres, centres, centres, indexing='ij'), -1).reshape(-1, 3)
    surface = surface_points(triangles(i, np.eye(4)))
    for lo, hi, ms in colliders(i):
        # Where the box lies most on the visible surface; one no visible surface touches is a leftover
        # (it would be an invisible wall).
        def touching(m):
            q = (np.c_[surface, np.ones(len(surface))] @ np.linalg.inv(m).T)[:, :3]
            return int(((q >= lo - 0.03) & (q <= hi + 0.03)).all(1).sum())
        m = max(ms, key=touching)
        if not touching(m): DROPPED.append(NODES[i]['name']); continue
        corners = np.array([[x, y, z, 1] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]) @ m.T
        R = m[:3, :3] / np.linalg.norm(m[:3, :3], axis=0)
        if np.allclose(np.abs(R), np.round(np.abs(R)), atol=1e-3) or not oriented:
            a, b = np.clip(corners[:, :3].min(0) + 0.5, 0, 1), np.clip(corners[:, :3].max(0) + 0.5, 0, 1)
            if (b - a).min() > 1e-3: boxes.append([*a, *b])
        else:
            q = (np.c_[P, np.ones(len(P))] @ np.linalg.inv(m).T)[:, :3]
            inside = ((q >= lo - 1e-6) & (q <= hi + 1e-6)).all(1)
            vox |= inside.reshape(VOX, VOX, VOX)
    out = []
    for b in boxes + merge(vox):
        if b[4] - b[1] < 0.05: b = [b[0], max(0.0, b[4] - 0.05), b[2], b[3], b[4], b[5]]
        out.append(b)
    return out

def piece(name):
    """A piece's collision kind and boxes (unturned), from its name (theme.piece.collider[.soft]) and mesh."""
    parts = name.split('.')
    collider = parts[2] if len(parts) > 2 else 'none'
    soft = len(parts) > 3 and parts[3] in ('soft', 'verysoft')
    if parts[0] == 'SPECIAL':
        # Invisible walls: they stop players and grenades but not shots.
        return {'kind': 'pass', 'boxes': [[0, 0, 0, 1, 1, 1]], 'mesh': False} if parts[1] == 'barrier' and collider == 'full' else None
    if parts[0] == 'DYNAMIC': return None
    i = BY_NAME[name]
    if parts[0] == 'INTERACTIVE' and parts[1] == 'jump-pad': return {'kind': 'pad', 'boxes': [[0, 0, 0, 1, 1, 1]], 'mesh': True}
    if collider == 'none': return {'kind': 'none', 'boxes': [], 'mesh': True}
    if collider == 'ladder':
        tris = triangles(i, np.eye(4)) + 0.5
        cx, cz = tris[:, :, 0].mean() - 0.5, tris[:, :, 2].mean() - 0.5
        # The side it hangs on (game ry convention: 0 +z, 1 +x, 2 -z, 3 -x).
        face = (0 if cz > 0 else 2) if abs(cz) >= abs(cx) else (1 if cx > 0 else 3)
        return {'kind': 'ladder', 'boxes': [], 'mesh': True, 'face': face}
    if collider == 'full': boxes = [[0, 0, 0, 1, 1, 1]]
    elif collider in ('wedge', 'iwedge'): boxes = wedge(triangles(i, np.eye(4)), ceiling=collider == 'iwedge')
    else: boxes = collider_boxes(i, oriented=collider == 'obb') or heightfield(triangles(i, np.eye(4)), VOX)
    # Slopes and stairs (bots walk up them rather than jumping).
    ramp = collider == 'wedge' or (collider == 'obb' and len({round(b[4], 2) for b in boxes}) > 2)
    kind = 'pass' if soft else 'solid'
    return {'kind': kind if boxes else 'none', 'boxes': boxes, 'mesh': True, **({'ramp': True} if ramp else {})}

# Orientation: R = Ry Rx Rz by quarter turns, as maps/pieces.js orient() (code ry + 4 rx + 16 rz).
def orient(code):
    ry, rx, rz = code & 3, (code >> 2) & 3, (code >> 4) & 3
    c = [1, 0, -1, 0]; s = [0, 1, 0, -1]
    Ry = np.array([[c[ry], 0, s[ry]], [0, 1, 0], [-s[ry], 0, c[ry]]])
    Rx = np.array([[1, 0, 0], [0, c[rx], -s[rx]], [0, s[rx], c[rx]]])
    Rz = np.array([[c[rz], -s[rz], 0], [s[rz], c[rz], 0], [0, 0, 1]])
    return Ry @ Rx @ Rz
def turn_box(b, code):
    R = orient(code)
    a = R @ (np.array(b[:3]) - 0.5) + 0.5; z = R @ (np.array(b[3:]) - 0.5) + 0.5
    return [*np.minimum(a, z), *np.maximum(a, z)]

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
            x, y, z = p['x'], p['y'], p['z']
            code = ((p.get('ry') or 0) & 3) | (((p.get('rx') or 0) & 3) << 2) | (((p.get('rz') or 0) & 3) << 4)
            if name in ('SPECIAL.spawn-blue.none', 'SPECIAL.spawn-red.none'):
                spawns.append([x + 0.5, y, z + 0.5, 1 if 'blue' in name else 2]); continue
            if name == 'SPECIAL.spatula.none': spatula.append([x + 0.5, y, z + 0.5]); continue
            if name == 'DYNAMIC.capture-zone.none': zone_cells.append((x, y, z)); continue
            if name not in index: continue
            b = blocks[index[name]]
            place += [index[name], x, y, z, code]
            if b['kind'] in ('solid', 'pass', 'pad') and b['boxes']: solid[(x, y, z)] = max(turn_box(bx, code)[4] for bx in b['boxes'])
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
print(f'dropped {len(DROPPED)} stray colliders from', sorted(set(DROPPED))[:12])
print(f'{len(pack)} maps, {len(blocks)} pieces, {sum(len(p["place"]) // 5 for p in pack)} placements')
