"""Cancha y club al atardecer. Se renderiza con Cycles en capas, desde la cámara del juego.

Uso: blender -b --factory-startup --python cancha.py -- carpeta_salida [modo] [muestras]
  modo: vista (un solo render de revisión, todo junto) | capas (las capas en EXR)

Ejes: x a lo ancho (-5..5), y a lo largo (-10 fondo propio .. +10 fondo rival, red en 0), z arriba.
Son los mismos ejes que usa el motor del juego.

Capas (cada una es un render con otra visibilidad de cámara; las sombras y los rebotes de luz
los siguen dando todos los objetos):
  piso     cancha, vereda y pasto, con todas las sombras
  entorno  club, árboles, cerco, bancos, columnas de luz
  paredes  vidrio, postes y reja del fondo rival y de los costados
  red      red y postes
  cerca    pared del fondo propio
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '.'
MODE = argv[1] if len(argv) > 1 else 'vista'
SAMPLES = int(argv[2]) if len(argv) > 2 else 96
SCALE = float(argv[3]) if len(argv) > 3 else 1.0

# --- Cámara del juego (referencia 390 x 844 px CSS) -----------------------------------
CAM_POS = Vector((0.0, -25.91, 16.52))
CAM_PITCH = 30.0                 # grados hacia abajo
F_CSS = 790.9                    # distancia focal en px CSS para 390 px de ancho
DESIGN = (390, 844)
OVER_X, OVER_Y = 1.12, 1.20      # margen para paneo, zoom y pantallas más altas
DPR = 2
RES = (int(round(DESIGN[0] * DPR * OVER_X / 2) * 2), int(round(DESIGN[1] * DPR * OVER_Y / 2) * 2))
SUN_DIR = Vector((-0.42, 0.80, 0.43)).normalized()   # hacia el sol: atrás y a la izquierda

random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
COL = {}


def collection(name):
    if name not in COL:
        c = bpy.data.collections.new(name)
        sc.collection.children.link(c)
        COL[name] = c
    return COL[name]


def srgb(h):
    h = h.lstrip('#')
    v = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v] + [1.0]


# ---------------------------------------------------------------------------
# Materiales
# ---------------------------------------------------------------------------
def principled(name, color, rough=0.8, metal=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = srgb(color) if isinstance(color, str) else color
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = srgb(emit)
        b.inputs['Emission Strength'].default_value = emit_strength
    return m


def noise_color(mat, c1, c2, scale=3.0, detail=4.0, bump=0.0, scale2=None, c3=None):
    """Mezcla dos colores con ruido; opcionalmente una segunda escala y relieve."""
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    n1 = nt.nodes.new('ShaderNodeTexNoise')
    n1.inputs['Scale'].default_value = scale
    n1.inputs['Detail'].default_value = detail
    nt.links.new(tc.outputs['Object'], n1.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.32
    ramp.color_ramp.elements[0].color = srgb(c1)
    ramp.color_ramp.elements[1].position = 0.68
    ramp.color_ramp.elements[1].color = srgb(c2)
    nt.links.new(n1.outputs['Fac'], ramp.inputs['Fac'])
    col = ramp.outputs['Color']
    if scale2:
        n2 = nt.nodes.new('ShaderNodeTexNoise')
        n2.inputs['Scale'].default_value = scale2
        n2.inputs['Detail'].default_value = 2.0
        nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1.0
        r2 = nt.nodes.new('ShaderNodeValToRGB')
        r2.color_ramp.elements[0].position = 0.35
        r2.color_ramp.elements[0].color = srgb(c3 or '#d8d8d8')
        r2.color_ramp.elements[1].position = 0.65
        r2.color_ramp.elements[1].color = (1, 1, 1, 1)
        nt.links.new(n2.outputs['Fac'], r2.inputs['Fac'])
        nt.links.new(col, mix.inputs[6])
        nt.links.new(r2.outputs['Color'], mix.inputs[7])
        col = mix.outputs[2]
    nt.links.new(col, b.inputs['Base Color'])
    if bump:
        bp = nt.nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = bump
        nt.links.new(n1.outputs['Fac'], bp.inputs['Height'])
        nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    return mat


M = {}
M['turf'] = noise_color(principled('turf', '#4a72bd', 0.95), '#466eb8', '#5078c4', scale=0.35, detail=2.0, scale2=60.0, c3='#ececf2')
M['line'] = principled('line', '#f4f0e8', 0.85)
M['curb'] = noise_color(principled('curb', '#b9a99a', 0.9), '#b3a293', '#c6b7a8', scale=2.0)
M['steel'] = principled('steel', '#2a2d3a', 0.42, 0.7)
M['steel_light'] = principled('steel_light', '#4a4f60', 0.5, 0.6)
M['lawn'] = noise_color(principled('lawn', '#6f8f45', 1.0), '#5d7f3c', '#86a352', scale=0.9, detail=5.0, scale2=14.0, c3='#dcdccc')
M['wood'] = noise_color(principled('wood', '#9a6a45', 0.7), '#8a5c3a', '#aa7850', scale=6.0)
M['plaster'] = noise_color(principled('plaster', '#e6d6c2', 0.92), '#dccbb6', '#eaddc9', scale=1.2)
M['roof'] = noise_color(principled('roof', '#b9583c', 0.85), '#a94e36', '#c8664a', scale=3.5, bump=0.3)
M['window'] = principled('window', '#ffd9a0', 0.4, emit='#ffc878', emit_strength=5.5)
M['door'] = principled('door', '#3f6f78', 0.6)
M['awning'] = principled('awning', '#f08a5d', 0.85)
M['cream'] = principled('cream', '#f3e7d3', 0.85)
M['foliage_dark'] = noise_color(principled('foliage_dark', '#2f5a3a', 0.95), '#27503a', '#3d6b3c', scale=1.6, detail=4.0)
M['foliage'] = noise_color(principled('foliage', '#4f7f3f', 0.95), '#43733b', '#6b9648', scale=1.4, detail=4.0)
M['hedge'] = noise_color(principled('hedge', '#3f6f3c', 0.95), '#366638', '#4f7f42', scale=2.2, detail=5.0, bump=0.6)
M['jacaranda'] = noise_color(principled('jacaranda', '#8f78d6', 0.95), '#7a63c8', '#ac98e6', scale=1.8, detail=4.0)
M['trunk'] = principled('trunk', '#5a4336', 0.9)
M['pot'] = principled('pot', '#b5603f', 0.8)
M['bag'] = principled('bag', '#d8433a', 0.75)
M['bag2'] = principled('bag2', '#2f6f8a', 0.75)
M['bulb'] = principled('bulb', '#ffe2ad', 0.4, emit='#ffcf8a', emit_strength=30.0)
M['lamp'] = principled('lamp', '#fff3dc', 0.4, emit='#ffe9c4', emit_strength=6.0)
M['netband'] = principled('netband', '#f2eee6', 0.85)
M['parasol'] = principled('parasol', '#f3e3c8', 0.85)
M['petals'] = principled('petals', '#b9a6ee', 0.95)


def tiles_material():
    m = principled('tiles', '#c9714c', 0.78)
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.offset = 0.0
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = 0.012
    br.inputs['Mortar Smooth'].default_value = 0.2
    br.inputs['Bias'].default_value = 0.0
    br.inputs['Brick Width'].default_value = 0.50
    br.inputs['Row Height'].default_value = 0.50
    br.inputs['Color1'].default_value = srgb('#c9805f')
    br.inputs['Color2'].default_value = srgb('#b97152')
    br.inputs['Mortar'].default_value = srgb('#96624f')
    nt.links.new(tc.outputs['Object'], br.inputs['Vector'])
    n1 = nt.nodes.new('ShaderNodeTexNoise')
    n1.inputs['Scale'].default_value = 0.35
    nt.links.new(tc.outputs['Object'], n1.inputs['Vector'])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1.0
    r2 = nt.nodes.new('ShaderNodeValToRGB')
    r2.color_ramp.elements[0].position = 0.3
    r2.color_ramp.elements[0].color = srgb('#d9cfc8')
    r2.color_ramp.elements[1].position = 0.7
    r2.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(n1.outputs['Fac'], r2.inputs['Fac'])
    nt.links.new(br.outputs['Color'], mix.inputs[6])
    nt.links.new(r2.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.25
    nt.links.new(br.outputs['Fac'], bp.inputs['Height'])
    bp.invert = True
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m


M['tiles'] = tiles_material()


def glass_material():
    """Vidrio fino: deja pasar la luz casi sin teñir, refleja más cuanto más rasante se mira y
    lleva dos franjas diagonales de brillo, que es como se dibuja un vidrio."""
    m = bpy.data.materials.new('glass')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    tr.inputs['Color'].default_value = (0.93, 0.97, 0.98, 1)
    gl = nt.nodes.new('ShaderNodeBsdfGlossy')
    gl.inputs['Roughness'].default_value = 0.02
    gl.inputs['Color'].default_value = (1, 1, 1, 1)
    fr = nt.nodes.new('ShaderNodeFresnel')
    fr.inputs['IOR'].default_value = 1.5
    boost = nt.nodes.new('ShaderNodeMath')
    boost.operation = 'MULTIPLY'
    boost.inputs[1].default_value = 1.5
    nt.links.new(fr.outputs[0], boost.inputs[0])
    clamp = nt.nodes.new('ShaderNodeClamp')
    clamp.inputs['Max'].default_value = 0.8
    nt.links.new(boost.outputs[0], clamp.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(clamp.outputs[0], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(gl.outputs[0], mix.inputs[2])
    # franjas: onda sobre (x + y + z) en metros
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sp = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sp.inputs[0])
    a1 = nt.nodes.new('ShaderNodeMath')
    a1.operation = 'ADD'
    nt.links.new(sp.outputs['X'], a1.inputs[0])
    nt.links.new(sp.outputs['Y'], a1.inputs[1])
    a2 = nt.nodes.new('ShaderNodeMath')
    a2.operation = 'ADD'
    nt.links.new(a1.outputs[0], a2.inputs[0])
    nt.links.new(sp.outputs['Z'], a2.inputs[1])
    fr2 = nt.nodes.new('ShaderNodeMath')
    fr2.operation = 'FRACT'
    sc2 = nt.nodes.new('ShaderNodeMath')
    sc2.operation = 'MULTIPLY'
    sc2.inputs[1].default_value = 0.5          # una franja doble cada 2 m (un paño)
    nt.links.new(a2.outputs[0], sc2.inputs[0])
    nt.links.new(sc2.outputs[0], fr2.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0, 0, 0, 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (0, 0, 0, 1)
    for pos_, val in ((0.30, 0.0), (0.33, 1.0), (0.43, 1.0), (0.46, 0.0), (0.52, 0.0), (0.54, 0.7), (0.58, 0.7), (0.60, 0.0)):
        e = cr.elements.new(pos_)
        e.color = (val, val, val, 1)
    nt.links.new(fr2.outputs[0], ramp.inputs['Fac'])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (1.0, 0.93, 0.85, 1)
    em.inputs['Strength'].default_value = 1.0
    st = nt.nodes.new('ShaderNodeMath')
    st.operation = 'MULTIPLY'
    st.inputs[1].default_value = 0.055
    nt.links.new(ramp.outputs['Color'], st.inputs[0])
    mix2 = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(st.outputs[0], mix2.inputs[0])
    nt.links.new(mix.outputs[0], mix2.inputs[1])
    nt.links.new(em.outputs[0], mix2.inputs[2])
    nt.links.new(mix2.outputs[0], out.inputs['Surface'])
    return m


def mesh_material(name, color, alpha, pitch=0.25, line=0.12):
    """Reja o red como velo semitransparente con una grilla suave (sin trama fina, que parpadea)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    df = nt.nodes.new('ShaderNodeBsdfDiffuse')
    df.inputs['Color'].default_value = srgb(color)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.offset = 0.0
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = pitch * line
    br.inputs['Mortar Smooth'].default_value = 0.6
    br.inputs['Brick Width'].default_value = pitch
    br.inputs['Row Height'].default_value = pitch
    sp = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sp.inputs[0])
    ad = nt.nodes.new('ShaderNodeMath')
    ad.operation = 'ADD'
    nt.links.new(sp.outputs['X'], ad.inputs[0])
    nt.links.new(sp.outputs['Y'], ad.inputs[1])
    cb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(ad.outputs[0], cb.inputs['X'])
    nt.links.new(sp.outputs['Z'], cb.inputs['Y'])
    nt.links.new(cb.outputs[0], br.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = 0.0
    ramp.inputs['From Max'].default_value = 1.0
    ramp.inputs['To Min'].default_value = alpha * 0.75
    ramp.inputs['To Max'].default_value = min(1.0, alpha * 2.2)
    nt.links.new(br.outputs['Fac'], ramp.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(ramp.outputs[0], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(df.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m, br


M['glass'] = glass_material()
M['fence'], _ = mesh_material('fence', '#2c3040', 0.17, pitch=0.25, line=0.16)
M['netmesh'], _ = mesh_material('netmesh', '#1c1f2a', 0.40, pitch=0.11, line=0.22)


# ---------------------------------------------------------------------------
# Geometría
# ---------------------------------------------------------------------------
def add_obj(name, verts, faces, mat, coll, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    me.materials.append(M[mat] if isinstance(mat, str) else mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    collection(coll).objects.link(o)
    return o


def box(name, lo, hi, mat, coll):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return add_obj(name, v, f, mat, coll)


def quad(name, pts, mat, coll):
    return add_obj(name, pts, [(0, 1, 2, 3)], mat, coll)


def tube(name, a, b, r, mat, coll, n=8):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
    x = d.cross(up).normalized()
    y = d.cross(x)
    v, f = [], []
    for p in (a, b):
        for k in range(n):
            th = 2 * math.pi * k / n
            v.append(p + (x * math.cos(th) + y * math.sin(th)) * r)
    for k in range(n):
        f.append((k, (k + 1) % n, n + (k + 1) % n, n + k))
    f.append(tuple(reversed(range(n))))
    f.append(tuple(range(n, 2 * n)))
    return add_obj(name, v, f, mat, coll, smooth=True)


def blob(name, center, radii, mat, coll, sub=3, rough=0.18, freq=0.9, seed=0.0, taper=0.0):
    """Esfera irregular para copas de árboles y arbustos."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    c = Vector(center)
    for v in bm.verts:
        p = v.co.copy()
        n = noise.noise(p * freq * 2.2 + Vector((seed, seed * 1.7, 0))) * rough + noise.noise(p * freq * 5.5 + Vector((0, seed, seed))) * rough * 0.4
        k = 1.0 + n
        if taper:
            t = (p.z + 1) / 2
            k *= (1 - taper * t)
        v.co = Vector((p.x * radii[0] * k, p.y * radii[1] * k, p.z * radii[2] * (1.0 + n * 0.3))) + c
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M[mat])
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    collection(coll).objects.link(o)
    return o


# --- Piso ---------------------------------------------------------------
HW, HL = 5.0, 10.0
SERVICE = 6.95
box('turf', (-HW, -HL, -0.05), (HW, HL, 0.0), 'turf', 'piso')
LW = 0.05
for y in (-SERVICE, SERVICE):
    box('line', (-HW, y - LW / 2, 0.0), (HW, y + LW / 2, 0.004), 'line', 'piso')
box('line_c', (-LW / 2, -SERVICE - 0.2, 0.0), (LW / 2, SERVICE + 0.2, 0.004), 'line', 'piso')
# zócalo de hormigón bajo las paredes
CW = 0.22
for sx in (-1, 1):
    box('curb', (sx * HW if sx > 0 else -HW - CW, -HL - CW, -0.05), (HW + CW if sx > 0 else -HW, HL + CW, 0.035), 'curb', 'piso')
for sy in (-1, 1):
    box('curb', (-HW, sy * HL if sy > 0 else -HL - CW, -0.05), (HW, HL + CW if sy > 0 else -HL, 0.035), 'curb', 'piso')
# vereda de baldosas y pasto
TX, TY0, TY1 = 9.6, -19.0, 17.2
ground_v = [(-TX, TY0, 0), (TX, TY0, 0), (TX, TY1, 0), (-TX, TY1, 0)]
add_obj('tiles', [(x, y, -0.02) for x, y, _ in ground_v], [(0, 1, 2, 3)], 'tiles', 'piso')
add_obj('lawn', [(-60, -60, -0.06), (60, -60, -0.06), (60, 21.5, -0.06), (-60, 21.5, -0.06)], [(0, 1, 2, 3)], 'lawn', 'piso')

# --- Paredes ----------------------------------------------------------------
POST = 0.07


def wall_panel(name, a, b, z0, z1, mat, coll):
    """Panel vertical fino entre dos puntos del piso."""
    ax, ay = a
    bx, by = b
    return quad(name, [(ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1)], mat, coll)


def post(x, y, h, coll, r=POST / 2, mat='steel'):
    return box('post', (x - r, y - r, 0.0), (x + r, y + r, h), mat, coll)


def rail(a, b, z, coll, r=0.025, mat='steel'):
    ax, ay = a
    bx, by = b
    return tube('rail', (ax, ay, z), (bx, by, z), r, mat, coll, n=6)


def back_wall(y, coll, slim=False):
    xs = [-5, -3, -1, 1, 3, 5]
    if slim:
        # fondo propio: vidrio panorámico. Sin reja arriba y con costuras finas, para no tapar al jugador.
        for x in xs:
            if abs(x) < 4.9:
                box('seam', (x - 0.010, y - 0.010, 0.0), (x + 0.010, y + 0.010, 3.0), 'steel_light', coll)
            else:
                post(x, y, 3.0, coll)
        for a, b in zip(xs[:-1], xs[1:]):
            wall_panel('glass', (a, y), (b, y), 0.04, 3.0, 'glass', coll)
        rail((-5, y), (5, y), 3.0, coll, r=0.022)
        return
    for x in xs:
        post(x, y, 4.0, coll)
    for a, b in zip(xs[:-1], xs[1:]):
        wall_panel('glass', (a, y), (b, y), 0.04, 3.0, 'glass', coll)
        wall_panel('fence', (a, y), (b, y), 3.0, 4.0, 'fence', coll)
    rail((-5, y), (5, y), 3.0, coll)
    rail((-5, y), (5, y), 4.0, coll, r=0.03)


def side_wall(x, coll_far, coll_near):
    ys = [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10]
    for a, b in zip(ys[:-1], ys[1:]):
        coll = coll_far
        from_back = HL - max(abs(a), abs(b))
        if from_back < 1.0:
            glass, top = 3.0, 4.0
        elif from_back < 3.0:
            glass, top = 2.0, 3.0
        else:
            glass, top = 0.0, 3.0
        if glass > 0:
            wall_panel('glass', (x, a), (x, b), 0.04, glass, 'glass', coll)
        wall_panel('fence', (x, a), (x, b), max(glass, 0.04), top, 'fence', coll)
        rail((x, a), (x, b), top, coll, r=0.03)
        if glass > 0:
            rail((x, a), (x, b), glass, coll)
    for y in ys:
        from_back = HL - abs(y)
        h = 4.0 if from_back < 2.5 else 3.0
        post(x, y, h, coll_far)


back_wall(HL, 'paredes')
back_wall(-HL, 'cerca', slim=True)
side_wall(-HW, 'paredes', 'paredes')
side_wall(HW, 'paredes', 'paredes')

# --- Red --------------------------------------------------------------------
NET_C, NET_P = 0.88, 0.92
nv, nf = [], []
segs = 20
for i in range(segs + 1):
    x = -HW + 2 * HW * i / segs
    k = abs(x) / HW
    top = NET_C + (NET_P - NET_C) * k * k
    nv += [(x, 0, 0.02), (x, 0, top - 0.055), (x, 0, top)]
for i in range(segs):
    a = i * 3
    nf.append((a, a + 3, a + 4, a + 1))
net = add_obj('net', nv, nf, 'netmesh', 'red')
band = add_obj('netband', nv, [(i * 3 + 1, i * 3 + 4, i * 3 + 5, i * 3 + 2) for i in range(segs)], 'netband', 'red')
for sx in (-1, 1):
    tube('netpost', (sx * (HW - 0.02), 0, 0), (sx * (HW - 0.02), 0, NET_P + 0.06), 0.045, 'steel', 'red', n=10)
box('strap', (-0.025, -0.004, 0.02), (0.025, 0.004, NET_C), 'netband', 'red')

# --- Columnas de luz y guirnaldas ----------------------------------------------
POLES = [(-5.75, -7.0), (5.75, -7.0), (-5.75, 7.0), (5.75, 7.0)]
for (x, y) in POLES:
    tube('pole', (x, y, 0), (x, y, 6.4), 0.07, 'steel', 'entorno', n=8)
    sx = -1 if x > 0 else 1
    tube('arm', (x, y, 6.3), (x + sx * 0.7, y, 6.55), 0.04, 'steel', 'entorno', n=6)
    for dy in (-0.35, 0.35):
        box('lamp_body', (x + sx * 0.45, y + dy - 0.26, 6.48), (x + sx * 0.95, y + dy + 0.26, 6.62), 'steel', 'entorno')
        quad('lamp_face', [(x + sx * 0.47, y + dy - 0.23, 6.475), (x + sx * 0.93, y + dy - 0.23, 6.475), (x + sx * 0.93, y + dy + 0.23, 6.475),
                           (x + sx * 0.47, y + dy + 0.23, 6.475)], 'lamp', 'entorno')


def garland(a, b, sag, n_bulbs, coll='entorno'):
    a, b = Vector(a), Vector(b)
    prev = None
    for i in range(25):
        t = i / 24
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        if prev is not None:
            tube('wire', prev, p, 0.008, 'steel', coll, n=4)
        prev = p
    for i in range(n_bulbs):
        t = (i + 0.5) / n_bulbs
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t) + 0.06
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.055)
        me = bpy.data.meshes.new('bulb')
        bm.to_mesh(me)
        bm.free()
        me.materials.append(M['bulb'])
        o = bpy.data.objects.new('bulb', me)
        o.location = p
        collection(coll).objects.link(o)


garland((-5.75, 7.0, 5.2), (5.75, 7.0, 5.2), 0.9, 15)
garland((-5.75, 7.0, 5.2), (-9.2, 15.5, 3.4), 0.7, 10)
garland((5.75, 7.0, 5.2), (8.3, 17.9, 3.3), 0.7, 11)
garland((-5.75, -7.0, 5.2), (-5.75, 7.0, 5.2), 1.1, 16)
garland((5.75, -7.0, 5.2), (5.75, 7.0, 5.2), 1.1, 16)

# --- Club: buffet, cerco, árboles --------------------------------------------
# casita del buffet, atrás a la derecha
bx0, bx1, by0, by1, bh = 2.4, 13.5, 18.0, 25.0, 3.3
box('casa', (bx0, by0, 0), (bx1, by1, bh), 'plaster', 'entorno')
ridge = bh + 2.1
ov = 0.55
roof_v = [(bx0 - ov, by0 - ov, bh - 0.05), (bx1 + ov, by0 - ov, bh - 0.05), (bx1 + ov, by1 + ov, bh - 0.05), (bx0 - ov, by1 + ov, bh - 0.05),
          (bx0 + 1.6, (by0 + by1) / 2, ridge), (bx1 - 1.6, (by0 + by1) / 2, ridge)]
add_obj('techo', roof_v, [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4)], 'roof', 'entorno')
box('alero', (bx0 - ov, by0 - ov, bh - 0.14), (bx1 + ov, by1 + ov, bh - 0.04), 'cream', 'entorno')
for wx in (3.5, 5.6, 9.6, 11.7):
    box('ventana', (wx, by0 - 0.03, 1.05), (wx + 1.25, by0 + 0.02, 2.45), 'window', 'entorno')
    box('marco', (wx + 0.6, by0 - 0.05, 1.05), (wx + 0.65, by0 - 0.02, 2.45), 'door', 'entorno')
    box('marco', (wx, by0 - 0.05, 1.72), (wx + 1.25, by0 - 0.02, 1.77), 'door', 'entorno')
    box('alfeizar', (wx - 0.08, by0 - 0.12, 0.97), (wx + 1.33, by0, 1.05), 'cream', 'entorno')
box('puerta', (7.45, by0 - 0.04, 0.0), (8.75, by0 + 0.02, 2.45), 'door', 'entorno')
box('puerta_vidrio', (7.6, by0 - 0.06, 1.2), (8.6, by0 - 0.03, 2.25), 'window', 'entorno')
# toldo sobre la puerta
add_obj('toldo', [(6.6, by0, 2.95), (9.6, by0, 2.95), (9.6, by0 - 1.5, 2.45), (6.6, by0 - 1.5, 2.45)], [(0, 1, 2, 3), (3, 2, 1, 0)], 'awning', 'entorno')

# cerco verde del fondo y de los costados
for i in range(14):
    x = -9.4 + i * 0.95
    if 1.6 < x < 13.6:
        continue
    blob('cerco', (x, 17.3, 0.85), (0.72, 0.62, 0.98), 'hedge', 'entorno', sub=2, rough=0.14, seed=i * 3.1)
for sx in (-1, 1):
    for i in range(12):
        y = -2.0 + i * 1.62
        if sx > 0 and y > 15.5:
            continue
        blob('cerco_l', (sx * 9.3, y, 0.8), (0.62, 0.92, 0.92), 'hedge', 'entorno', sub=2, rough=0.14, seed=i * 2.3 + sx)


def cypress(x, y, h, r, seed):
    tube('tronco', (x, y, 0), (x, y, 1.2), 0.16, 'trunk', 'entorno', n=6)
    blob('cipres', (x, y, 0.8 + h / 2), (r, r, h / 2), 'foliage_dark', 'entorno', sub=3, rough=0.10, freq=1.6, seed=seed, taper=0.55)


def round_tree(x, y, h, r, mat, seed, lobes=5):
    rnd = random.Random(seed)
    tube('tronco', (x, y, 0), (x, y, h * 0.58), 0.24, 'trunk', 'entorno', n=8)
    for i in range(3):
        a = 2 * math.pi * i / 3 + rnd.random()
        tube('rama', (x, y, h * (0.42 + 0.06 * i)), (x + math.cos(a) * r * 0.55, y + math.sin(a) * r * 0.55, h * 0.80), 0.12, 'trunk', 'entorno', n=6)
    # copa: un lóbulo central, un anillo medio y un anillo de borde, todo achatado
    for count, dist, size, zc in ((1, 0.0, 0.66, 1.00), (6, 0.48, 0.50, 0.93), (9, 0.86, 0.36, 0.84)):
        for i in range(count):
            a = 2 * math.pi * i / count + rnd.random() * 0.7
            d = r * dist * (0.88 + 0.24 * rnd.random())
            sz = r * size * (0.9 + 0.25 * rnd.random())
            blob('copa', (x + math.cos(a) * d, y + math.sin(a) * d, h * zc + 0.35 * rnd.random()), (sz, sz, sz * 0.62), mat, 'entorno',
                 sub=3, rough=0.13, seed=seed + i * 1.9 + count)


# cipreses a la izquierda y detrás; un jacarandá en flor (noviembre) y árboles redondos
for (x, y, h, r, s) in [(-11.2, 19.5, 12.5, 1.25, 1), (-9.3, 21.0, 10.5, 1.1, 2), (-13.4, 21.6, 14.0, 1.35, 3), (-7.2, 22.5, 9.0, 1.0, 4),
                        (15.6, 20.5, 13.0, 1.3, 5), (17.4, 23.0, 11.0, 1.15, 6), (-12.6, 6.0, 11.0, 1.2, 7), (-13.2, 11.5, 12.8, 1.3, 8),
                        (13.0, 9.0, 11.6, 1.2, 9)]:
    cypress(x, y, h, r, s)
round_tree(-3.4, 22.6, 8.4, 3.6, 'jacaranda', 11, lobes=6)
round_tree(-17.0, 16.0, 7.5, 3.4, 'foliage', 21)
round_tree(12.6, 15.2, 6.4, 2.6, 'foliage', 31)
round_tree(1.2, 28.0, 9.5, 4.2, 'foliage', 41, lobes=6)
round_tree(-21.0, 24.0, 9.0, 4.0, 'foliage_dark', 51, lobes=6)
round_tree(21.0, 27.0, 9.5, 4.2, 'foliage', 61, lobes=6)
for (x, y, h, r, sd) in [(-11.5, -9.5, 8.5, 3.8, 71), (-14.5, -15.5, 9.5, 4.4, 81), (-10.0, -19.5, 8.0, 3.6, 91)]:
    round_tree(x, y, h, r, 'foliage', sd, lobes=6)
# pétalos caídos del jacarandá sobre la vereda
rnd = random.Random(3)
pv, pf = [], []
for i in range(140):
    px, py = -3.4 + rnd.gauss(0, 2.4), 20.2 + rnd.gauss(0, 1.9)
    if py > 21.4 or py < 10.3 or abs(px) > 9.4:
        continue
    s = 0.05 + 0.05 * rnd.random()
    a = rnd.random() * 3.14
    k = len(pv)
    for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        pv.append((px + (dx * math.cos(a) - dy * math.sin(a)) * s, py + (dx * math.sin(a) + dy * math.cos(a)) * s, 0.004))
    pf.append((k, k + 1, k + 2, k + 3))
add_obj('petalos', pv, pf, 'petals', 'piso')


def bench(x, y, rot, coll='entorno'):
    c, s = math.cos(rot), math.sin(rot)

    def T(px, py, pz):
        return (x + px * c - py * s, y + px * s + py * c, pz)
    objs = []
    for i in range(3):
        v = [T(-0.8, -0.2 + i * 0.15, 0.45), T(0.8, -0.2 + i * 0.15, 0.45), T(0.8, -0.08 + i * 0.15, 0.45), T(-0.8, -0.08 + i * 0.15, 0.45)]
        v2 = [(a, b, z + 0.04) for a, b, z in v]
        objs.append(add_obj('banco', v + v2, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], 'wood', coll))
    for i in range(2):
        v = [T(-0.8, 0.26, 0.6 + i * 0.2), T(0.8, 0.26, 0.6 + i * 0.2), T(0.8, 0.30, 0.6 + i * 0.2), T(-0.8, 0.30, 0.6 + i * 0.2)]
        v2 = [(a, b, z + 0.14) for a, b, z in v]
        objs.append(add_obj('respaldo', v + v2, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], 'wood', coll))
    for px in (-0.7, 0.7):
        tube('pata', T(px, -0.15, 0), T(px, -0.15, 0.45), 0.03, 'steel', coll, n=6)
        tube('pata', T(px, 0.28, 0), T(px, 0.28, 0.95), 0.03, 'steel', coll, n=6)
    return objs


bench(7.3, 4.2, math.radians(90))
bench(7.3, -1.5, math.radians(90))
bench(-7.3, 2.5, math.radians(-90))
# bolsos y botella sobre un banco
blob('bolso', (7.25, 4.55, 0.66), (0.22, 0.36, 0.19), 'bag', 'entorno', sub=2, rough=0.05)
blob('bolso2', (-7.25, 2.2, 0.64), (0.2, 0.32, 0.17), 'bag2', 'entorno', sub=2, rough=0.05)
tube('botella', (7.25, 3.75, 0.49), (7.25, 3.75, 0.72), 0.04, 'bag2', 'entorno', n=8)
# macetas en las esquinas
for (x, y) in [(-6.6, 11.6), (6.6, 11.6), (-6.6, -11.4), (6.6, -11.4), (-8.6, -6.5), (8.6, 9.5)]:
    tube('maceta', (x, y, 0), (x, y, 0.5), 0.33, 'pot', 'entorno' if y > -10.2 else 'frente', n=12)
    blob('planta', (x, y, 0.92), (0.5, 0.5, 0.48), 'foliage', 'entorno' if y > -10.2 else 'frente', sub=2, rough=0.22, seed=x + y)
# mesas con sombrilla junto al buffet
for (x, y) in [(-6.0, 14.4), (-1.6, 14.9)]:
    tube('mesa_pie', (x, y, 0), (x, y, 2.35), 0.035, 'steel', 'entorno', n=6)
    tube('mesa', (x, y, 0.70), (x, y, 0.74), 0.55, 'cream', 'entorno', n=16)
    cone_v = [(x, y, 2.5)] + [(x + 1.25 * math.cos(2 * math.pi * k / 8), y + 1.25 * math.sin(2 * math.pi * k / 8), 2.1) for k in range(8)]
    add_obj('sombrilla', cone_v, [(0, k + 1, (k + 1) % 8 + 1) for k in range(8)] + [tuple(range(8, 0, -1))], 'parasol', 'entorno')
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.4
        tube('silla', (x + 0.85 * math.cos(a), y + 0.85 * math.sin(a), 0), (x + 0.85 * math.cos(a), y + 0.85 * math.sin(a), 0.46), 0.2, 'wood', 'entorno', n=8)

# primer plano: banco con bolso, abajo a la izquierda
bench(-3.9, -12.6, math.radians(180), 'frente')
blob('bolso_f', (-4.3, -12.6, 0.66), (0.36, 0.22, 0.19), 'bag', 'frente', sub=2, rough=0.05)
tube('botella_f', (-3.4, -12.55, 0.49), (-3.4, -12.55, 0.74), 0.04, 'bag2', 'frente', n=8)

# ---------------------------------------------------------------------------
# Luz
# ---------------------------------------------------------------------------
sun_data = bpy.data.lights.new('sol', 'SUN')
sun_data.energy = 6.2
sun_data.color = (1.0, 0.60, 0.33)
sun_data.angle = math.radians(1.5)
sun = bpy.data.objects.new('sol', sun_data)
sc.collection.objects.link(sun)
sun.rotation_euler = SUN_DIR.to_track_quat('Z', 'Y').to_euler()

world = bpy.data.worlds.new('cielo')
sc.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
wout = nt.nodes.new('ShaderNodeOutputWorld')
bg = nt.nodes.new('ShaderNodeBackground')
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
nt.links.new(tc.outputs['Generated'], sep.inputs[0])
ramp = nt.nodes.new('ShaderNodeValToRGB')
cr = ramp.color_ramp
cr.elements[0].position = 0.40
cr.elements[0].color = srgb('#3b3a66')          # bajo el horizonte: violeta oscuro (rebote frío)
cr.elements[1].position = 1.0
cr.elements[1].color = srgb('#5b6fd0')          # cenit
for pos_, colr in ((0.50, '#ffb37a'), (0.56, '#f79aa0'), (0.68, '#a58bd8')):
    e = cr.elements.new(pos_)
    e.color = srgb(colr)
mapr = nt.nodes.new('ShaderNodeMapRange')
mapr.inputs['From Min'].default_value = -1.0
mapr.inputs['From Max'].default_value = 1.0
nt.links.new(sep.outputs['Z'], mapr.inputs['Value'])
nt.links.new(mapr.outputs[0], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.0
nt.links.new(bg.outputs[0], wout.inputs['Surface'])

# focos de la cancha, apenas encendidos: suman un toque cálido sin pelear con el sol
for (x, y) in POLES:
    d = bpy.data.lights.new('foco', 'SPOT')
    d.energy = 1900
    d.color = (1.0, 0.86, 0.66)
    d.spot_size = math.radians(95)
    d.spot_blend = 0.6
    d.shadow_soft_size = 0.35
    o = bpy.data.objects.new('foco', d)
    sx = -1 if x > 0 else 1
    o.location = (x + sx * 0.7, y, 6.45)
    target = Vector((x * 0.25, y * 0.55, 0))
    o.rotation_euler = (Vector(o.location) - target).to_track_quat('Z', 'Y').to_euler()
    sc.collection.objects.link(o)
# luz cálida que sale por las ventanas del buffet
d = bpy.data.lights.new('buffet', 'AREA')
d.energy = 380
d.color = (1.0, 0.72, 0.42)
d.size = 6.0
o = bpy.data.objects.new('buffet', d)
o.location = (8.0, by0 - 0.4, 1.9)
o.rotation_euler = (math.radians(100), 0, 0)
sc.collection.objects.link(o)

# ---------------------------------------------------------------------------
# Cámara y render
# ---------------------------------------------------------------------------
cam_data = bpy.data.cameras.new('camara')
cam = bpy.data.objects.new('camara', cam_data)
sc.collection.objects.link(cam)
cam.location = CAM_POS
cam.rotation_euler = (math.radians(90 - CAM_PITCH), 0, 0)
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.sensor_width = 36.0
cam_data.lens = F_CSS * DPR * 36.0 / RES[0]
cam_data.clip_start, cam_data.clip_end = 0.5, 400
sc.camera = cam

sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'HIP'
    prefs.get_devices()
    for dv in prefs.devices:
        dv.use = dv.type == 'HIP' and '7800' in dv.name
    sc.cycles.device = 'GPU'
except Exception as ex:
    print('GPU no disponible:', ex)
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 6
sc.cycles.transparent_max_bounces = 12
sc.cycles.film_transparent_glass = True
sc.cycles.film_transparent_roughness = 0.2
sc.render.resolution_x = int(RES[0] * SCALE)
sc.render.resolution_y = int(RES[1] * SCALE)
sc.render.resolution_percentage = 100
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'OPEN_EXR'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.image_settings.color_depth = '16'
sc.view_settings.view_transform = 'Standard'

LAYERS = ['piso', 'entorno', 'paredes', 'red', 'cerca', 'frente']


def show_only(names):
    for name in LAYERS:
        if name not in COL:
            continue
        for o in COL[name].objects:
            o.visible_camera = name in names


os.makedirs(OUT, exist_ok=True)
if MODE == 'vista':
    show_only(LAYERS)
    sc.render.filepath = os.path.join(OUT, 'vista.exr')
    bpy.ops.render.render(write_still=True)
else:
    for name in LAYERS:
        if name not in COL:
            continue
        show_only([name])
        sc.render.filepath = os.path.join(OUT, name + '.exr')
        bpy.ops.render.render(write_still=True)
        print('CAPA', name)
print('RES', sc.render.resolution_x, sc.render.resolution_y, 'LENS', cam_data.lens)
