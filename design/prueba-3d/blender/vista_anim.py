"""Tira de cuadros de un clip, para revisar poses.

Uso: blender -b --factory-startup --python vista_anim.py -- salida.png clip vista [n] [variante] [t0,t1,...]
  vista: espalda | frente | lado | arriba
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
out, clip_name, view = argv[0], argv[1], argv[2]
n = int(argv[3]) if len(argv) > 3 else 8
variant = argv[4] if len(argv) > 4 else ('jugador' if view == 'espalda' else 'rival')
times = [float(x) for x in argv[5].split(',')] if len(argv) > 5 else None

VIEWS = {  # dirección hacia la cámara, hacia la luz principal y hacia el sol (ejes del personaje)
    'espalda': dict(cam=(0, 1, 0), elev=29, key=(0.5, 0.6, 0.62), sun=(0.5, -0.65, 0.42)),
    'frente': dict(cam=(0, -1, 0), elev=24, key=(-0.5, -0.6, 0.62), sun=(-0.5, 0.65, 0.42)),
    'lado': dict(cam=(-1, 0, 0), elev=8, key=(-0.6, -0.5, 0.62), sun=(0.5, 0.65, 0.42)),
    'arriba': dict(cam=(0, 1, 0), elev=80, key=(0.5, 0.6, 0.62), sun=(0.5, -0.65, 0.42)),
}
V = VIEWS[view]
clip = animaciones.CLIPS[clip_name]
if times is None:
    times = [clip.dur * i / (n if clip.loop else n - 1) for i in range(n)]
n = len(times)

toon.clear_scene()
parts = personaje.build(1)
mats = toon.make_materials(personaje.PALETTES[variant], variant + '_', V['sun'])
base = comun.to_object(parts, 'personaje', mats)
arm = rig.build_armature()
rig.bind(base, arm)
toon.add_outline(base, 0.011)

spacing = 1.75
right = Vector(V['cam']).cross(Vector((0, 0, 1))) * -1.0   # derecha de la cámara
for i, t in enumerate(times):
    a = arm if i == 0 else arm.copy()
    m = base if i == 0 else base.copy()
    if i:
        bpy.context.scene.collection.objects.link(a)
        bpy.context.scene.collection.objects.link(m)
        m.modifiers['rig'].object = a
    off = right * ((i - (n - 1) / 2) * spacing)
    a.location = off
    m.location = off
    rig.apply(a, rig.solve(clip.sample(t)))

width, h = spacing * n, 2.6
px = min(2000, (420 if n <= 4 else 285) * n)
sc = toon.setup_scene((px, int(px * h / width)), samples=16, transparent=True)
toon.add_key_light(V['key'])
el = math.radians(V['elev'])
c = Vector((0, 0, 1.12))
d = Vector(V['cam']) * math.cos(el) + Vector((0, 0, math.sin(el)))
toon.add_camera(c + d * 30, c, ortho_scale=width)
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
print('OK', out, [round(t, 2) for t in times])
