"""Hojas de revisión de los clips: tiras de cuadros, varias por corrida.

Uso: blender -b --factory-startup --python revisar.py -- carpeta_salida trabajo [trabajo ...]
  trabajo = clip:vista[:n[:t0,t1,...]][@personaje]
  vista   = frente | espalda | lado | lado2 | arriba | juego (como ve la cámara del juego al rival)
            | propio (como ve al jugador propio)
  n       = cantidad de cuadros repartidos en el clip (8 si falta); con tiempos explícitos se ignora
  personaje = jugador | rival | beto | romina | chela (si el modelo los define)
Dibuja una línea de piso y, en los golpes, la pelota en el punto de impacto del cuadro más cercano.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np
from mathutils import Vector

import animaciones
import comun
import personaje
import rig
import toon

argv = sys.argv[sys.argv.index('--') + 1:]
out_dir, jobs = argv[0], argv[1:]
os.makedirs(out_dir, exist_ok=True)

VIEWS = {  # hacia la cámara, altura, hacia la luz principal y hacia el sol (ejes del personaje)
    'frente': dict(cam=(0, -1, 0), elev=8, key=(-0.5, -0.6, 0.62), sun=(-0.5, 0.65, 0.42)),
    'juego': dict(cam=(0, -1, 0), elev=26, key=(-0.5, -0.6, 0.62), sun=(-0.5, 0.65, 0.42)),
    'espalda': dict(cam=(0, 1, 0), elev=12, key=(0.5, 0.6, 0.62), sun=(0.5, -0.65, 0.42)),
    'propio': dict(cam=(0, 1, 0), elev=41, key=(0.5, 0.6, 0.62), sun=(0.5, -0.65, 0.42)),
    'lado': dict(cam=(-1, 0, 0), elev=6, key=(-0.6, -0.5, 0.62), sun=(0.5, 0.65, 0.42)),
    'lado2': dict(cam=(1, 0, 0), elev=6, key=(0.6, -0.5, 0.62), sun=(-0.5, 0.65, 0.42)),
    'arriba': dict(cam=(0, 1, 0), elev=80, key=(0.5, 0.6, 0.62), sun=(0.5, -0.65, 0.42)),
    'tres': dict(cam=(-0.7, -0.7, 0), elev=14, key=(-0.6, -0.5, 0.62), sun=(0.2, 0.75, 0.42)),
}
SPACING = 1.9
HEIGHT = 2.75
PX_PER_FRAME = int(os.environ.get('PX', '240'))      # con PX=64 el personaje queda del tamaño en que se ve jugando


def build(variant, sun):
    who = personaje.PERSONAJES.get(variant)
    parts = personaje.build(1, pieces=who['piezas'] if who else personaje.PIEZAS_BASE)
    palettes = personaje.PALETTES
    mats = toon.make_materials(palettes[who['paleta'] if who else (variant if variant in palettes else 'rival')], variant + '_', sun)
    base = comun.to_object(parts, 'personaje', mats)
    arm = rig.build_armature()
    rig.bind(base, arm)
    toon.add_outline(base, 0.011)
    return base, arm


def flat_material(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*rgb, 1)
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def run(job):
    who = 'rival'
    if '@' in job:
        job, who = job.split('@')
    f = job.split(':')
    clip_name, view = f[0], f[1]
    n = int(f[2]) if len(f) > 2 and f[2] else 8
    times = [float(x) for x in f[3].split(',')] if len(f) > 3 else None
    clip = animaciones.CLIPS[clip_name]
    V = VIEWS[view]
    if times is None:
        times = [clip.dur * i / (n if clip.loop else n - 1) for i in range(n)]
    n = len(times)
    toon.clear_scene()
    base, arm = build(who, V['sun'])
    cam_dir = Vector(V['cam'])
    right = cam_dir.cross(Vector((0, 0, 1))) * -1.0
    hit_i = None
    if clip.contact is not None:
        hit_i = min(range(n), key=lambda i: abs(times[i] - clip.contact))
    for i, t in enumerate(times):
        a = arm if i == 0 else arm.copy()
        m = base if i == 0 else base.copy()
        if i:
            bpy.context.scene.collection.objects.link(a)
            bpy.context.scene.collection.objects.link(m)
            m.modifiers['rig'].object = a
        off = right * ((i - (n - 1) / 2) * SPACING)
        a.location = off
        m.location = off
        solved = rig.solve(clip.sample(t))
        rig.apply(a, solved)
        if i == hit_i and abs(times[i] - clip.contact) < 0.02:
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.045, segments=12, ring_count=8, location=off + rig.racket_center(solved))
            bpy.context.object.data.materials.append(flat_material('pelota', (0.83, 0.93, 0.12)))
    # piso: una franja fina para ver dónde apoyan los pies
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, -0.012))
    floor = bpy.context.object
    floor.scale = (SPACING * n * (abs(right.x) + 0.02) + 4.0 * abs(cam_dir.x), SPACING * n * (abs(right.y) + 0.02) + 4.0 * abs(cam_dir.y), 0.02)
    floor.data.materials.append(flat_material('piso', (0.16, 0.25, 0.42)))
    width = SPACING * n
    px = min(2400, PX_PER_FRAME * n)
    sc = toon.setup_scene((px, int(px * HEIGHT / width)), samples=16, transparent=True)
    toon.add_key_light(V['key'])
    el = math.radians(V['elev'])
    c = Vector((0, 0, 1.12))
    d = cam_dir * math.cos(el) + Vector((0, 0, math.sin(el)))
    toon.add_camera(c + d * 30, c, ortho_scale=width)
    out = os.path.join(out_dir, clip_name + '_' + view + ('' if who == 'rival' else '_' + who) + '.png')
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(out)
    w, hh = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(hh, w, 4)
    bg = np.array([0.36, 0.52, 0.72], dtype=np.float32)   # azul cancha, para juzgar el contraste real
    a[..., :3] = a[..., :3] * a[..., 3:4] + bg * (1 - a[..., 3:4])
    a[..., 3] = 1
    img.pixels[:] = a.ravel()
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    print('OK', out, [round(t, 3) for t in times])
    return out


OUTS = []
for j in jobs:
    OUTS.append(run(j))
sheet = os.environ.get('HOJA')
if sheet and OUTS:
    # todas las tiras apiladas en una sola imagen
    rows = []
    for path in OUTS:
        img = bpy.data.images.load(path)
        w, hh = img.size
        rows.append(np.array(img.pixels[:], dtype=np.float32).reshape(hh, w, 4))
    W = max(r.shape[1] for r in rows)
    padded = []
    for r in reversed(rows):                      # Blender guarda de abajo hacia arriba
        if r.shape[1] < W:
            pad = np.zeros((r.shape[0], W - r.shape[1], 4), dtype=np.float32)
            pad[..., :3] = (0.36, 0.52, 0.72)
            pad[..., 3] = 1
            r = np.concatenate([r, pad], axis=1)
        padded.append(r)
    full = np.concatenate(padded, axis=0)
    out = bpy.data.images.new('hoja', W, full.shape[0], alpha=True)
    out.pixels[:] = full.ravel()
    out.filepath_raw = os.path.join(out_dir, sheet)
    out.file_format = 'PNG'
    out.save()
    print('HOJA', os.path.join(out_dir, sheet))
