"""Builds assets/models/*.glb for Shock Shellers with Blender (5.x), headless:

    blender -b --python docs/games/shockshellers/tools/models/build_models.py

Every model is made here from primitives: bevelled boxes, extruded side profiles and turned parts,
with weighted normals for crisp low-poly shading. Nothing is imported from elsewhere.

Conventions (Blender space): +Y is the gun's forward, +Z up, X to the right; the glTF exporter turns
this into three.js's -Z forward, +Y up. 1 unit = 1 metre-ish; a rifle is about 0.75 long. Named empties
mark attachment points the game reads: muzzle (bullet exit), sight (where the eye goes when aiming),
grip and support (where the gloves hold it), and the magazine part is a separate child named "mag".
"""
import bpy, bmesh, math, os
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)

# ---------------- scene & materials ----------------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

MATS = {}
def mat(name, rgb, rough=0.55, metal=0.0, emit=None):
    key = name
    if key in MATS: return MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb(rgb), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*srgb(emit), 1)
        b.inputs['Emission Strength'].default_value = 1.0
    MATS[key] = m
    return m

def srgb(h):
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]

# A shared palette (two-tone guns with bright accents, like toys).
P = {
    'gunmetal': (0x2f343c, 0.45, 0.6), 'black': (0x1c1e22, 0.6, 0.2), 'steel': (0x8a929c, 0.3, 0.85),
    'wood': (0x9c5b2e, 0.65, 0.0), 'woodDark': (0x6e3d1e, 0.65, 0.0), 'tan': (0xc9a46b, 0.7, 0.0),
    'olive': (0x5d6a3f, 0.7, 0.05), 'orange': (0xf39a25, 0.45, 0.05), 'yolk': (0xffc531, 0.4, 0.05),
    'red': (0xd8452f, 0.45, 0.05), 'teal': (0x1f8fa8, 0.45, 0.1), 'blue': (0x2f6fd6, 0.45, 0.1),
    'purple': (0x6b3fb3, 0.45, 0.1), 'glass': (0x7fd0ff, 0.05, 0.1), 'white': (0xf6f4ee, 0.55, 0.0),
    'gold': (0xffc531, 0.25, 0.85), 'rubber': (0x2a2a2e, 0.85, 0.0), 'brass': (0xd9a441, 0.3, 0.9),
    'leaf': (0x7ccc3c, 0.8, 0.0), 'bark': (0x7a4b2a, 0.85, 0.0), 'cardboard': (0xe9a64b, 0.85, 0.0),
    'cardLight': (0xffd27a, 0.85, 0.0), 'shell': (0xfbf6ec, 0.4, 0.0), 'comb': (0xe2463a, 0.5, 0.0),
    'cream': (0xfff3d6, 0.6, 0.0),
}
def M(key): rgb, r, m = P[key]; return mat(key, rgb, r, m)

# ---------------- primitives ----------------
def finish(obj, bevel=0.006, segments=2, smooth_angle=35):
    if bevel:
        mod = obj.modifiers.new('bevel', 'BEVEL'); mod.width = bevel; mod.segments = segments; mod.limit_method = 'ANGLE'; mod.angle_limit = math.radians(30)
        mod.harden_normals = True
    wn = obj.modifiers.new('wn', 'WEIGHTED_NORMAL'); wn.keep_sharp = True
    for p in obj.data.polygons: p.use_smooth = True
    return obj

def link(obj, parent=None):
    bpy.context.collection.objects.link(obj)
    if parent: obj.parent = parent
    return obj

def mesh_obj(name, bm, material, parent=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); o.data.materials.append(material)
    return link(o, parent)

def box(name, size, loc, material, parent=None, bevel=0.006, rot=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    o = mesh_obj(name, bm, material, parent); o.location = loc; o.rotation_euler = rot
    return finish(o, bevel)

def cyl(name, r, depth, loc, material, parent=None, axis='Y', verts=16, r2=None, bevel=0.003, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    o = mesh_obj(name, bm, material, parent); o.location = loc
    o.rotation_euler = rot or {'Y': (math.radians(90), 0, 0), 'X': (0, math.radians(90), 0), 'Z': (0, 0, 0)}[axis]
    return finish(o, bevel, 1)

def sphere(name, r, loc, material, parent=None, scale=(1, 1, 1), seg=24, rings=16):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    o = mesh_obj(name, bm, material, parent); o.location = loc; o.scale = scale
    for p in o.data.polygons: p.use_smooth = True
    return o

def profile(name, pts, width, material, parent=None, x=0.0, bevel=0.008):
    """Extrude a side profile: pts are (y, z) pairs (y forward), extruded width along X, centred on x."""
    bm = bmesh.new()
    vs = [bm.verts.new((x - width / 2, y, z)) for y, z in pts]
    f = bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=[f])
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(width, 0, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(mesh_obj(name, bm, material, parent), bevel)

def empty(name, loc, parent):
    e = bpy.data.objects.new(name, None); e.location = loc; e.empty_display_size = 0.02
    return link(e, parent)

def root(name):
    r = bpy.data.objects.new(name, None); return link(r)

def export(name, roots):
    bpy.ops.object.select_all(action='DESELECT')
    for r in roots:
        r.select_set(True)
        for c in r.children_recursive: c.select_set(True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_extras=False, export_cameras=False, export_lights=False, export_texcoords=(name == 'eggs'), export_normals=True)  # only the shell takes a texture (cracks)
    print('wrote', name, os.path.getsize(path) // 1024, 'KB')

# ---------------- guns ----------------
def rail(r, y0, y1, z, parent):
    box('rail', (0.026, y1 - y0, 0.012), (0, (y0 + y1) / 2, z), M('black'), parent, 0.002)
    for i in range(int((y1 - y0) / 0.022)): box('notch', (0.03, 0.008, 0.006), (0, y0 + 0.011 + i * 0.022, z + 0.008), M('black'), parent, 0.001)

def yolk47():
    r = root('yolk47')
    profile('receiver', [(-0.06, -0.02), (0.18, -0.02), (0.2, 0.035), (0.08, 0.055), (-0.06, 0.05)], 0.058, M('gunmetal'), r)
    profile('dustcover', [(-0.05, 0.05), (0.14, 0.055), (0.15, 0.072), (-0.04, 0.07)], 0.05, M('black'), r, bevel=0.006)
    profile('handguard', [(0.2, -0.012), (0.42, -0.008), (0.42, 0.042), (0.2, 0.045)], 0.068, M('orange'), r)
    for i in range(3): box('vent', (0.07, 0.03, 0.006), (0, 0.25 + i * 0.055, 0.044), M('black'), r, 0.002)
    cyl('gasTube', 0.011, 0.24, (0, 0.46, 0.05), M('gunmetal'), r)
    cyl('barrel', 0.012, 0.32, (0, 0.5, 0.018), M('steel'), r)
    cyl('brake', 0.017, 0.05, (0, 0.67, 0.018), M('black'), r, verts=8)
    box('frontSight', (0.012, 0.012, 0.05), (0, 0.6, 0.055), M('black'), r, 0.002)
    box('rearSight', (0.03, 0.02, 0.025), (0, 0.04, 0.072), M('black'), r, 0.002)
    profile('stock', [(-0.06, 0.045), (-0.33, 0.012), (-0.34, -0.085), (-0.29, -0.09), (-0.06, -0.02)], 0.05, M('orange'), r)
    box('buttpad', (0.054, 0.02, 0.1), (0, -0.338, -0.035), M('rubber'), r, 0.004)
    profile('grip', [(-0.01, -0.02), (0.035, -0.02), (0.0, -0.13), (-0.045, -0.13)], 0.044, M('black'), r)
    box('trigGuard', (0.008, 0.07, 0.006), (0, 0.05, -0.05), M('black'), r, 0.002)
    mag = profile('mag', [(0.07, -0.02), (0.13, -0.02), (0.09, -0.2), (0.03, -0.2)], 0.045, M('purple'), r)
    mag.name = 'mag'
    empty('muzzle', (0, 0.7, 0.018), r); empty('sight', (0, -0.04, 0.09), r)
    empty('grip', (0, -0.01, -0.07), r); empty('support', (0, 0.32, -0.02), r)
    return r

def double_yolker():
    r = root('doubleYolker')
    for x in (-0.024, 0.024): cyl('barrel', 0.024, 0.6, (x, 0.38, 0.03), M('steel'), r, verts=20)
    box('rib', (0.012, 0.58, 0.01), (0, 0.38, 0.058), M('black'), r, 0.002)
    profile('forend', [(0.1, -0.03), (0.42, -0.02), (0.42, 0.012), (0.1, 0.012)], 0.088, M('wood'), r)
    profile('action', [(-0.06, -0.035), (0.1, -0.035), (0.1, 0.06), (-0.06, 0.06)], 0.07, M('gunmetal'), r)
    box('hinge', (0.075, 0.03, 0.04), (0, 0.085, 0.015), M('steel'), r, 0.005)
    profile('stock', [(-0.06, 0.05), (-0.38, 0.0), (-0.39, -0.11), (-0.32, -0.12), (-0.12, -0.05), (-0.06, -0.035)], 0.06, M('wood'), r)
    box('buttpad', (0.064, 0.02, 0.12), (0, -0.386, -0.055), M('rubber'), r, 0.004)
    profile('grip', [(-0.03, -0.035), (0.02, -0.035), (-0.02, -0.12), (-0.07, -0.12)], 0.05, M('woodDark'), r)
    for x in (-0.012, 0.012): box('hammer', (0.012, 0.02, 0.03), (x, -0.045, 0.07), M('steel'), r, 0.002)
    box('bead', (0.012, 0.012, 0.012), (0, 0.66, 0.064), M('yolk'), r, 0.003)
    mag = box('mag', (0.07, 0.05, 0.04), (0, 0.02, 0.03), M('red'), r, 0.006)  # the shells, shown on reload
    mag.name = 'mag'
    empty('muzzle', (0, 0.68, 0.03), r); empty('sight', (0, -0.05, 0.08), r)
    empty('grip', (0, -0.04, -0.07), r); empty('support', (0, 0.3, -0.03), r)
    return r

def cage_free():
    r = root('cageFree')
    profile('receiver', [(-0.08, -0.03), (0.2, -0.03), (0.2, 0.045), (-0.08, 0.06)], 0.056, M('olive'), r)
    profile('handguard', [(0.2, -0.025), (0.5, -0.02), (0.5, 0.035), (0.2, 0.042)], 0.064, M('olive'), r)
    for i in range(4): box('slot', (0.068, 0.04, 0.008), (0, 0.24 + i * 0.065, -0.004), M('black'), r, 0.002)
    cyl('barrel', 0.012, 0.3, (0, 0.64, 0.012), M('steel'), r)
    cyl('muzzleBrake', 0.018, 0.06, (0, 0.8, 0.012), M('black'), r, verts=10)
    profile('stock', [(-0.08, 0.055), (-0.38, 0.03), (-0.39, -0.1), (-0.33, -0.11), (-0.18, -0.06), (-0.08, -0.03)], 0.052, M('olive'), r)
    box('cheek', (0.048, 0.14, 0.03), (0, -0.25, 0.05), M('black'), r, 0.008)
    profile('grip', [(-0.02, -0.03), (0.03, -0.03), (0.0, -0.14), (-0.05, -0.14)], 0.044, M('black'), r)
    mag = profile('mag', [(0.05, -0.03), (0.13, -0.03), (0.12, -0.15), (0.06, -0.15)], 0.044, M('black'), r); mag.name = 'mag'
    rail(r, -0.04, 0.26, 0.066, r)
    cyl('scopeTube', 0.022, 0.3, (0, 0.08, 0.115), M('black'), r, verts=20)
    cyl('scopeFront', 0.034, 0.07, (0, 0.24, 0.115), M('black'), r, verts=20, r2=0.024)
    cyl('scopeRear', 0.03, 0.05, (0, -0.08, 0.115), M('black'), r, verts=20, r2=0.024)
    cyl('lens', 0.03, 0.004, (0, 0.276, 0.115), M('glass'), r, verts=20)
    cyl('turret', 0.014, 0.03, (0, 0.08, 0.15), M('steel'), r, axis='Z', verts=12)
    for y in (-0.01, 0.17): box('ring', (0.05, 0.02, 0.05), (0, y, 0.09), M('gunmetal'), r, 0.004)
    empty('muzzle', (0, 0.83, 0.012), r); empty('sight', (0, -0.16, 0.115), r)
    empty('grip', (0, -0.02, -0.08), r); empty('support', (0, 0.36, -0.03), r)
    return r

def yolkzooka():
    r = root('yolkzooka')
    cyl('tube', 0.07, 0.9, (0, 0.18, 0.06), M('teal'), r, verts=24)
    cyl('band1', 0.074, 0.04, (0, 0.5, 0.06), M('yolk'), r, verts=24)
    cyl('band2', 0.074, 0.04, (0, -0.12, 0.06), M('yolk'), r, verts=24)
    cyl('bell', 0.09, 0.12, (0, 0.64, 0.06), M('yolk'), r, verts=24, r2=0.074)
    cyl('rearBell', 0.085, 0.1, (0, -0.3, 0.06), M('gunmetal'), r, verts=24, r2=0.072)
    profile('grip', [(0.0, -0.01), (0.05, -0.01), (0.02, -0.15), (-0.03, -0.15)], 0.046, M('black'), r)
    profile('foreGrip', [(0.26, -0.01), (0.3, -0.01), (0.29, -0.13), (0.25, -0.13)], 0.04, M('black'), r)
    box('shoulder', (0.05, 0.2, 0.05), (0, -0.12, -0.03), M('rubber'), r, 0.01)
    cyl('sightBox', 0.025, 0.14, (0.08, 0.12, 0.13), M('black'), r, verts=12)
    box('sightMount', (0.04, 0.05, 0.04), (0.055, 0.12, 0.105), M('gunmetal'), r, 0.004)
    mag = cyl('mag', 0.05, 0.16, (0, 0.6, 0.06), M('yolk'), r, verts=16, r2=0.02); mag.name = 'mag'  # the rocket nose in the tube
    empty('muzzle', (0, 0.72, 0.06), r); empty('sight', (0.08, -0.05, 0.13), r)
    empty('grip', (0, 0.02, -0.08), r); empty('support', (0, 0.27, -0.08), r)
    return r

def beater():
    r = root('beater')
    profile('body', [(-0.25, -0.03), (0.22, -0.03), (0.24, 0.06), (-0.24, 0.07)], 0.066, M('gunmetal'), r)
    profile('shroud', [(0.06, 0.06), (0.24, 0.06), (0.25, 0.09), (0.08, 0.1)], 0.05, M('blue'), r)
    box('topRail', (0.03, 0.34, 0.02), (0, -0.02, 0.085), M('black'), r, 0.003)
    cyl('barrel', 0.013, 0.1, (0, 0.29, 0.02), M('steel'), r)
    cyl('can', 0.02, 0.07, (0, 0.33, 0.02), M('black'), r, verts=12)
    profile('grip', [(0.04, -0.03), (0.09, -0.03), (0.07, -0.15), (0.02, -0.15)], 0.046, M('black'), r)
    mag = profile('mag', [(-0.14, -0.03), (-0.07, -0.03), (-0.1, -0.22), (-0.16, -0.21)], 0.046, M('yolk'), r); mag.name = 'mag'
    box('buttpad', (0.07, 0.02, 0.1), (0, -0.25, 0.015), M('rubber'), r, 0.004)
    box('foreGrip', (0.03, 0.03, 0.08), (0, 0.18, -0.06), M('black'), r, 0.006)
    box('sight', (0.02, 0.04, 0.03), (0, -0.12, 0.105), M('black'), r, 0.003)
    empty('muzzle', (0, 0.37, 0.02), r); empty('sight', (0, -0.18, 0.12), r)
    empty('grip', (0, 0.06, -0.08), r); empty('support', (0, 0.18, -0.09), r)
    return r

def poacher():
    r = root('poacher')
    profile('stock', [(-0.42, 0.0), (-0.42, -0.12), (-0.35, -0.13), (-0.14, -0.06), (-0.04, -0.06), (0.0, -0.11), (0.06, -0.11), (0.08, -0.04), (0.42, -0.03), (0.42, 0.025), (-0.1, 0.035), (-0.2, 0.05), (-0.42, 0.03)], 0.06, M('tan'), r)
    box('buttpad', (0.064, 0.02, 0.15), (0, -0.425, -0.05), M('rubber'), r, 0.004)
    profile('receiver', [(-0.1, 0.02), (0.14, 0.02), (0.14, 0.06), (-0.1, 0.065)], 0.045, M('gunmetal'), r)
    cyl('barrel', 0.013, 0.62, (0, 0.53, 0.035), M('gunmetal'), r)
    cyl('crown', 0.016, 0.03, (0, 0.85, 0.035), M('black'), r, verts=12)
    cyl('bolt', 0.009, 0.08, (0.045, -0.02, 0.05), M('steel'), r, axis='X')
    sphere('boltKnob', 0.015, (0.09, -0.02, 0.05), M('steel'), r)
    for y in (-0.03, 0.12): box('ring', (0.05, 0.02, 0.05), (0, y, 0.085), M('gunmetal'), r, 0.004)
    cyl('scopeTube', 0.025, 0.38, (0, 0.05, 0.12), M('black'), r, verts=20)
    cyl('objective', 0.042, 0.1, (0, 0.27, 0.12), M('black'), r, verts=24, r2=0.027)
    cyl('ocular', 0.034, 0.07, (0, -0.17, 0.12), M('black'), r, verts=24, r2=0.027)
    cyl('lens', 0.037, 0.004, (0, 0.322, 0.12), M('glass'), r, verts=24)
    cyl('turretTop', 0.015, 0.035, (0, 0.05, 0.16), M('steel'), r, axis='Z', verts=12)
    cyl('turretSide', 0.015, 0.035, (0.04, 0.05, 0.12), M('steel'), r, axis='X', verts=12)
    mag = box('mag', (0.03, 0.04, 0.03), (0, 0.04, 0.065), M('brass'), r, 0.004); mag.name = 'mag'  # the round, shown on reload
    empty('muzzle', (0, 0.87, 0.035), r); empty('sight', (0, -0.26, 0.12), r)
    empty('grip', (0, 0.0, -0.08), r); empty('support', (0, 0.3, -0.04), r)
    return r

def tri_boil():
    r = root('triBoil')
    profile('upper', [(-0.08, 0.0), (0.24, 0.0), (0.26, 0.06), (-0.06, 0.07)], 0.06, M('red'), r)
    profile('lower', [(-0.06, -0.035), (0.12, -0.035), (0.12, 0.002), (-0.06, 0.002)], 0.056, M('gunmetal'), r)
    profile('handguard', [(0.24, -0.015), (0.46, -0.01), (0.46, 0.05), (0.24, 0.055)], 0.066, M('gunmetal'), r)
    for i in range(3): box('fin', (0.072, 0.025, 0.012), (0, 0.29 + i * 0.06, 0.05), M('red'), r, 0.003)
    cyl('barrel', 0.012, 0.14, (0, 0.53, 0.025), M('steel'), r)
    cyl('flash', 0.017, 0.05, (0, 0.62, 0.025), M('black'), r, verts=6)
    rail(r, -0.04, 0.22, 0.075, r)
    box('carry', (0.03, 0.1, 0.035), (0, 0.06, 0.1), M('black'), r, 0.004)
    profile('stock', [(-0.06, 0.05), (-0.32, 0.04), (-0.33, -0.08), (-0.27, -0.09), (-0.06, -0.02)], 0.05, M('gunmetal'), r)
    box('stockPad', (0.054, 0.02, 0.12), (0, -0.33, -0.02), M('red'), r, 0.004)
    profile('grip', [(-0.02, -0.035), (0.03, -0.035), (0.0, -0.15), (-0.05, -0.15)], 0.044, M('black'), r)
    mag = profile('mag', [(0.04, -0.035), (0.11, -0.035), (0.1, -0.18), (0.05, -0.18)], 0.044, M('black'), r); mag.name = 'mag'
    empty('muzzle', (0, 0.65, 0.025), r); empty('sight', (0, -0.06, 0.12), r)
    empty('grip', (0, -0.02, -0.09), r); empty('support', (0, 0.36, -0.02), r)
    return r

def peck9mm():
    r = root('peck9mm')
    profile('slide', [(-0.07, 0.0), (0.12, 0.0), (0.125, 0.045), (-0.065, 0.05)], 0.034, M('gunmetal'), r)
    for i in range(5): box('serr', (0.036, 0.004, 0.03), (0, -0.05 + i * 0.01, 0.028), M('black'), r, 0.001)
    profile('frame', [(-0.06, -0.025), (0.11, -0.025), (0.11, 0.002), (-0.06, 0.002)], 0.032, M('black'), r)
    profile('grip', [(-0.06, -0.02), (-0.01, -0.02), (-0.03, -0.13), (-0.085, -0.125)], 0.036, M('black'), r)
    box('gripPanel', (0.038, 0.06, 0.08), (0, -0.045, -0.07), M('orange'), r, 0.006, rot=(math.radians(-14), 0, 0))
    box('trigGuard', (0.006, 0.05, 0.006), (0, 0.025, -0.045), M('black'), r, 0.002)
    box('frontSight', (0.008, 0.008, 0.012), (0, 0.11, 0.054), M('orange'), r, 0.002)
    box('rearSight', (0.026, 0.01, 0.012), (0, -0.055, 0.054), M('black'), r, 0.002)
    mag = box('mag', (0.026, 0.04, 0.02), (0, -0.045, -0.135), M('black'), r, 0.004); mag.name = 'mag'
    empty('muzzle', (0, 0.13, 0.025), r); empty('sight', (0, -0.12, 0.06), r)
    empty('grip', (0, -0.04, -0.07), r); empty('support', (0, -0.03, -0.08), r)
    return r

def whisk():
    r = root('whisk')
    cyl('handle', 0.018, 0.16, (0, -0.08, 0), M('red'), r, verts=16)
    cyl('ferrule', 0.021, 0.03, (0, 0.01, 0), M('steel'), r, verts=16)
    sphere('cap', 0.019, (0, -0.16, 0), M('red'), r)
    for k in range(8):
        a = k / 8 * math.pi
        curve = bpy.data.curves.new('wire', 'CURVE'); curve.dimensions = '3D'; curve.bevel_depth = 0.0035; curve.bevel_resolution = 2
        sp = curve.splines.new('BEZIER'); sp.bezier_points.add(2)
        pts = [(0, 0.02, 0), (0.05, 0.12, 0), (0, 0.2, 0)]
        for i, (x, y, z) in enumerate(pts):
            pt = sp.bezier_points[i]; pt.co = (x * math.cos(a), y, x * math.sin(a)); pt.handle_left_type = pt.handle_right_type = 'AUTO'
        o = bpy.data.objects.new('wire', curve); o.data.materials.append(M('steel')); link(o, r)
    empty('muzzle', (0, 0.2, 0), r)
    return r

def cluck_bomb():
    """The grenade: a fat olive egg-bomb with a red chicken comb and a brass pin ring."""
    r = root('grenade')
    body = sphere('body', 0.07, (0, 0, 0), M('olive'), r, scale=(1, 1, 1.18))
    for i in range(6):
        a = i / 6 * math.pi * 2
        box('groove', (0.006, 0.14, 0.006), (math.cos(a) * 0.069, 0, math.sin(a) * 0.069), M('black'), r, 0.001, rot=(0, -a, 0))
    cyl('neck', 0.028, 0.03, (0, 0, 0.09), M('gunmetal'), r, axis='Z')
    for i, (y, h) in enumerate([(-0.025, 0.04), (0.0, 0.052), (0.025, 0.04)]):
        sphere('comb', 0.018, (0, y, 0.11 + h / 2), M('comb'), r, scale=(0.6, 1, 1.4))
    box('lever', (0.012, 0.03, 0.08), (0.03, 0, 0.05), M('steel'), r, 0.003, rot=(0, math.radians(-12), 0))
    cyl('pin', 0.016, 0.004, (-0.04, 0, 0.1), M('brass'), r, axis='X', verts=16)
    return r

# ---------------- egg, gloves, hats ----------------
def egg():
    r = root('egg')
    # Turned profile: 0.62 tall, widest a little below the middle.
    bm = bmesh.new(); H, W = 0.62, 0.28; rings, seg = 28, 40
    verts = []
    for i in range(rings + 1):
        t = i / rings * math.pi
        z = H / 2 * (1 - math.cos(t)); rad = W * math.sin(t) * (1 + 0.1 * math.cos(t))
        row = []
        for j in range(seg):
            a = j / seg * math.pi * 2
            row.append(bm.verts.new((rad * math.cos(a), rad * math.sin(a), z)))
        verts.append(row)
    for i in range(rings):
        for j in range(seg):
            a, b, c, d = verts[i][j], verts[i][(j + 1) % seg], verts[i + 1][(j + 1) % seg], verts[i + 1][j]
            try: bm.faces.new((a, b, c, d))
            except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # UVs for the shell/crack texture: u around, v up.
    uv = bm.loops.layers.uv.new()
    for f in bm.faces:
        us = [(math.atan2(l.vert.co.y, l.vert.co.x) / (2 * math.pi)) % 1.0 for l in f.loops]
        for l, u in zip(f.loops, us):
            # The last column of faces wraps from u≈0.97 back to 0: give those corners u+1 (no seam smear).
            if max(us) - u > 0.5: u += 1.0
            l[uv].uv = (u, l.vert.co.z / H)
    o = mesh_obj('shell', bm, M('shell'), r)
    for p in o.data.polygons: p.use_smooth = True
    return r

def dome(name, r, loc, material, parent=None, scale=(1, 1, 1), seg=32, rings=16):
    """The top half of a sphere (hats sit on the egg; a full ball would poke through it)."""
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context='VERTS')
    o = mesh_obj(name, bm, material, parent); o.location = loc; o.scale = scale
    for p in o.data.polygons: p.use_smooth = True
    return o

def glove(name='glove'):
    """A puffy cartoon mitten made of metaballs (palm, fingers, a chunky thumb), meshed, plus a rolled cuff."""
    r = root(name)
    mb = bpy.data.metaballs.new('mitt'); mb.resolution = 0.006; mb.render_resolution = 0.006; mb.threshold = 0.6
    # Palm, fingers (a bit flatter and wider), a chunky thumb off the side, and the wrist.
    for (x, y, z, sx, sy, sz, rad) in [(0, 0, 0, 1.0, 1.2, 0.8, 0.075), (0, 0.055, -0.006, 1.05, 0.9, 0.72, 0.07), (-0.058, 0.012, 0.012, 0.6, 1.1, 0.62, 0.05), (0, -0.06, 0, 0.9, 0.8, 0.9, 0.06)]:
        e = mb.elements.new(); e.type = 'ELLIPSOID'; e.co = (x, y, z); e.radius = rad; e.stiffness = 2.0; e.size_x, e.size_y, e.size_z = sx, sy, sz
    o = bpy.data.objects.new('mitt', mb); bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    m = bpy.context.view_layer.objects.active; m.name = 'mitt'; m.data.materials.clear(); m.data.materials.append(M('white')); m.parent = r
    for p in m.data.polygons: p.use_smooth = True
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=0.04, radius2=0.044, depth=0.024)
    cuff = mesh_obj('cuff', bm, M('white'), r); cuff.location = (0, -0.1, 0); cuff.rotation_euler = (math.radians(90), 0, 0)
    sol = cuff.modifiers.new('thick', 'SOLIDIFY'); sol.thickness = 0.01
    for p in cuff.data.polygons: p.use_smooth = True
    return r

def hats():
    out = []
    c = root('hat_cap')
    dome('dome', 0.165, (0, 0, 0), M('red'), c, scale=(1, 1, 0.75))
    brim = cyl('brim', 0.11, 0.014, (0, 0.14, 0.006), M('red'), c, axis='Z', verts=24); brim.scale = (1, 0.8, 1)
    sphere('button', 0.018, (0, 0, 0.095), M('white'), c)
    out.append(c)
    b = root('hat_beanie')
    dome('knit', 0.168, (0, 0, 0.0), M('blue'), b, scale=(1, 1, 0.95))
    cyl('fold', 0.172, 0.05, (0, 0, -0.01), M('blue'), b, axis='Z', verts=32)
    sphere('pom', 0.05, (0, 0, 0.17), M('white'), b)
    out.append(b)
    ch = root('hat_chef')
    cyl('band', 0.15, 0.08, (0, 0, 0.04), M('white'), ch, axis='Z', verts=32)
    for i in range(6):
        a = i / 6 * math.pi * 2
        sphere('puff', 0.09, (math.cos(a) * 0.08, math.sin(a) * 0.08, 0.14), M('white'), ch)
    sphere('top', 0.1, (0, 0, 0.18), M('white'), ch)
    out.append(ch)
    t = root('hat_tophat')
    cyl('brim', 0.2, 0.016, (0, 0, 0.008), M('black'), t, axis='Z', verts=32)
    cyl('crown', 0.115, 0.22, (0, 0, 0.12), M('black'), t, axis='Z', verts=32, r2=0.12)
    cyl('band', 0.122, 0.035, (0, 0, 0.035), M('red'), t, axis='Z', verts=32)
    out.append(t)
    k = root('hat_crown')
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=0.13, radius2=0.12, depth=0.07)
    ring = mesh_obj('ring', bm, M('gold'), k); ring.location = (0, 0, 0.035)
    sol = ring.modifiers.new('thick', 'SOLIDIFY'); sol.thickness = 0.012
    for i in range(5):
        a = i / 5 * math.pi * 2
        cyl('spike', 0.03, 0.08, (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.1), M('gold'), k, axis='Z', verts=4, r2=0.0)
        sphere('gem', 0.012, (math.cos(a) * 0.128, math.sin(a) * 0.128, 0.04), M('red'), k)
    out.append(k)
    return out

# ---------------- props ----------------
def crate():
    r = root('crate')
    box('core', (0.8, 0.8, 0.8), (0, 0, 0.4), M('wood'), r, 0.01)
    for s in (-1, 1):
        for axis in range(2):
            for e in (-1, 1):
                if axis == 0: box('edge', (0.84, 0.08, 0.08), (0, s * 0.39, 0.4 + e * 0.38), M('woodDark'), r, 0.01)
                else: box('edge', (0.08, 0.84, 0.08), (s * 0.39, 0, 0.4 + e * 0.38), M('woodDark'), r, 0.01)
        box('post', (0.08, 0.08, 0.84), (s * 0.39, -0.39, 0.4), M('woodDark'), r, 0.01)
        box('post', (0.08, 0.08, 0.84), (s * 0.39, 0.39, 0.4), M('woodDark'), r, 0.01)
    for s in (-1, 1):
        box('brace', (0.82, 0.07, 0.07), (0, s * 0.405, 0.4), M('woodDark'), r, 0.01, rot=(0, math.radians(45), 0))
        box('brace', (0.07, 0.82, 0.07), (s * 0.405, 0, 0.4), M('woodDark'), r, 0.01, rot=(math.radians(-45), 0, 0))
    return r

def barrel():
    r = root('barrel')
    cyl('body', 0.3, 0.88, (0, 0, 0.44), M('teal'), r, axis='Z', verts=20)
    for z in (0.12, 0.44, 0.76): cyl('hoop', 0.31, 0.04, (0, 0, z), M('steel'), r, axis='Z', verts=20)
    cyl('lid', 0.27, 0.02, (0, 0, 0.885), M('gunmetal'), r, axis='Z', verts=20)
    cyl('bung', 0.04, 0.02, (0.12, 0.05, 0.895), M('steel'), r, axis='Z', verts=12)
    return r

def ammo_carton():
    r = root('ammo')
    box('tray', (0.36, 0.24, 0.08), (0, 0, 0.04), M('cardboard'), r, 0.012)
    box('lid', (0.36, 0.24, 0.03), (0, 0.02, 0.125), M('cardLight'), r, 0.012, rot=(math.radians(-14), 0, 0))
    for i in range(3):
        for j in range(2):
            sphere('cup', 0.045, (-0.11 + i * 0.11, -0.05 + j * 0.1, 0.085), M('cardboard'), r, scale=(1, 1, 0.7))
            sphere('egg', 0.035, (-0.11 + i * 0.11, -0.05 + j * 0.1, 0.12), M('cream'), r, scale=(0.9, 0.9, 1.15))
    return r

def spatula():
    r = root('spatula')
    box('blade', (0.22, 0.26, 0.016), (0, 0.2, 0), M('gold'), r, 0.006)
    for i in range(3): box('slot', (0.03, 0.16, 0.02), (-0.06 + i * 0.06, 0.2, 0), M('brass'), r, 0.004)
    cyl('neck', 0.016, 0.08, (0, 0.05, 0.0), M('gold'), r)
    cyl('handle', 0.024, 0.32, (0, -0.15, 0.0), M('woodDark'), r, verts=16)
    sphere('end', 0.026, (0, -0.31, 0), M('gold'), r)
    return r

def tree():
    r = root('tree')
    cyl('trunk', 0.16, 1.7, (0, 0, 0.85), M('bark'), r, axis='Z', verts=10, r2=0.1)
    for i, (x, y, z, s) in enumerate([(0, 0, 2.0, 0.85), (0.45, 0.1, 1.7, 0.6), (-0.4, -0.2, 1.8, 0.62), (0.05, -0.45, 1.65, 0.55), (-0.1, 0.4, 2.25, 0.55)]):
        o = sphere('leaves', s, (x, y, z), M('leaf'), r, seg=20, rings=12)
        d = o.modifiers.new('lumps', 'DISPLACE'); tex = bpy.data.textures.new('lump%d' % i, 'CLOUDS'); tex.noise_scale = 0.5; d.texture = tex; d.strength = 0.18
    for a in range(3):
        ang = a / 3 * math.pi * 2
        cyl('root', 0.06, 0.3, (math.cos(ang) * 0.14, math.sin(ang) * 0.14, 0.06), M('bark'), r, verts=6, r2=0.02, rot=(0, math.radians(70), ang))
    return r

def bush():
    r = root('bush')
    for i, (x, y, z, s) in enumerate([(0, 0, 0.25, 0.36), (0.25, 0.08, 0.2, 0.26), (-0.22, -0.06, 0.2, 0.27)]):
        o = sphere('leaves', s, (x, y, z), M('leaf'), r, seg=18, rings=10)
        d = o.modifiers.new('lumps', 'DISPLACE'); tex = bpy.data.textures.new('blump%d' % i, 'CLOUDS'); tex.noise_scale = 0.35; d.texture = tex; d.strength = 0.1
    return r

reset()
# (The guns, whisk and Cluck Bomb are now modelled in code: js/render/guns.js. The builders above are
# kept for reference; guns.glb is no longer exported or shipped.)
reset(); MATS.clear()
export('eggs', [egg(), glove('glove'), *hats()])
reset(); MATS.clear()
export('props', [crate(), barrel(), ammo_carton(), spatula(), tree(), bush()])
