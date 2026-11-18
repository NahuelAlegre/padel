"""Hoja de revisión del modelo: el personaje girado en varias vistas, en una sola imagen.

Uso: blender -b --factory-startup --python vista.py -- salida.png [variante] [res] [zona]
  zona: todo | cara | pies | manos
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector

import comun
import personaje
import toon

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = argv[0] if argv else '//vista.png'
variant = argv[1] if len(argv) > 1 else 'rival'
res = int(argv[2]) if len(argv) > 2 else 2
zone = argv[3] if len(argv) > 3 else 'todo'
custom = [float(a) for a in argv[4].split(',')] if len(argv) > 4 else None

toon.clear_scene()
sun = (-0.55, 0.62, 0.56)            # el sol queda atrás y a la izquierda del personaje
parts = personaje.build(res)
print('VERTS/TRIS', personaje.count(parts))
mats = toon.make_materials(personaje.PALETTES[variant], variant + '_', sun)
base = comun.to_object(parts, 'personaje', mats)
toon.add_outline(base, 0.0105 if zone == 'todo' else 0.004)

angles = custom or {'todo': [0, 35, 90, 180, 215], 'cara': [0, 30, 90], 'pies': [0, 40, 110, 180], 'manos': [0, 90, 180, 270]}[zone]
spacing = {'todo': 1.9, 'cara': 0.42, 'pies': 0.62, 'manos': 0.75}[zone]
objs = []
for i, a in enumerate(angles):
    o = base if i == 0 else base.copy()
    if i:
        bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (0, 0, math.radians(a))
    o.location = ((i - (len(angles) - 1) / 2) * spacing, 0, 0)
    objs.append(o)

width = spacing * len(angles)
if zone == 'todo':
    center, h = Vector((0, 0, 0.90)), 1.95
elif zone == 'cara':
    center, h = Vector((0, 0, 1.60)), 0.44
elif zone == 'pies':
    center, h = Vector((0, 0, 0.27)), 0.62
else:
    center, h = Vector((0, 0, 1.36)), 0.5
px = 1500
sc = toon.setup_scene((px, int(px * h / width)), samples=32, transparent=False)
sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.63, 0.57, 0.50, 1)
sc.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
for o in objs:
    o.visible_shadow = True
# el fondo no tiene que iluminar: el Shader to RGB solo debe ver la luz principal
sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.0
sc.render.film_transparent = True
toon.add_key_light((-0.35, -0.75, 0.62))
elev = math.radians(12)
toon.add_camera(center + Vector((0, -30 * math.cos(elev), 30 * math.sin(elev))), center, ortho_scale=width)
sc.render.filepath = out
bpy.ops.render.render(write_still=True)

# fondo liso, para leer mejor la silueta
import numpy as np
img = bpy.data.images.load(out)
w, hh = img.size
a = np.array(img.pixels[:], dtype=np.float32).reshape(hh, w, 4)
bg = np.array([0.80, 0.76, 0.70], dtype=np.float32)
a[..., :3] = a[..., :3] * a[..., 3:4] + bg * (1 - a[..., 3:4])
a[..., 3] = 1
img.pixels[:] = a.ravel()
img.filepath_raw = out
img.file_format = 'PNG'
img.save()
print('OK', out)
