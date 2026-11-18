"""Exporta el personaje para la versión en tiempo real: malla, esqueleto, paletas y clips.

Uso: blender -b --factory-startup --python exportar.py -- ../assets/personaje.bin

Formato: 'PAD1', largo del JSON (uint32), JSON, relleno a 4 bytes y después los bloques binarios
(los desplazamientos del JSON son relativos al inicio de los bloques).
  - malla: posiciones int16 cuantizadas, normales int8, material, ancho de contorno,
    3 huesos y 2 pesos por vértice (el tercero es lo que falta para 255), índices uint16.
  - clips: muestreados a 30 fps. Rotación local por hueso (cuaternión int16) y posición de la
    pelvis, guardados por componente y como diferencias entre cuadros, que comprimen mejor.
"""
import json
import math
import os
import struct
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
out_path = argv[0]
FPS = 30

toon.clear_scene()
parts = personaje.build(1)
mats = {k: bpy.data.materials.new(k) for k in personaje.MATERIALS}
obj = comun.to_object(parts, 'personaje', mats)
mesh = obj.data
mesh.calc_loop_triangles()

# datos por vértice de Blender, en el mismo orden en que se unieron las piezas
weights, outline = [], []
for p in parts:
    weights += p.weights
    outline += p.outline
bone_index = {n: i for i, n in enumerate(rig.NAMES)}
mat_names = [m.name for m in mesh.materials]
mat_global = [personaje.MATERIALS.index(n) for n in mat_names]

corner_normals = [tuple(cn.vector) for cn in mesh.corner_normals]
verts, index_of, indices = [], {}, []
for tri in mesh.loop_triangles:
    mi = mat_global[mesh.polygons[tri.polygon_index].material_index]
    for li in tri.loops:
        vi = mesh.loops[li].vertex_index
        n = corner_normals[li]
        key = (vi, mi, round(n[0] * 40), round(n[1] * 40), round(n[2] * 40))
        if key not in index_of:
            index_of[key] = len(verts)
            verts.append((vi, mi, n))
        indices.append(index_of[key])
nv = len(verts)
assert nv < 65536, nv
print('VERTS', nv, 'TRIS', len(indices) // 3)

pos = np.array([tuple(mesh.vertices[v[0]].co) for v in verts], dtype=np.float64)
lo, hi = pos.min(axis=0), pos.max(axis=0)
center, half = (lo + hi) / 2, (hi - lo) / 2
qpos = np.round((pos - center) / half * 32767).astype(np.int16)
nrm = np.array([v[2] for v in verts], dtype=np.float64)
qn = np.round(nrm * 127).astype(np.int8)
mat = np.array([v[1] for v in verts], dtype=np.uint8)
outl = np.array([round(outline[v[0]] * 255) for v in verts], dtype=np.uint8)
joints = np.zeros((nv, 3), dtype=np.uint8)
wts = np.zeros((nv, 2), dtype=np.uint8)
for i, v in enumerate(verts):
    w = sorted(weights[v[0]].items(), key=lambda kv: -kv[1])[:3]
    total = sum(x[1] for x in w)
    q = [int(round(x[1] / total * 255)) for x in w]
    q[0] += 255 - sum(q)
    for k, (b, _val) in enumerate(w):
        joints[i, k] = bone_index[b]
    if len(q) > 0:
        wts[i, 0] = q[0]
    if len(q) > 1:
        wts[i, 1] = q[1]
idx = np.array(indices, dtype=np.uint16)

blobs = []
offset = 0


def add(arr):
    global offset
    b = arr.tobytes()
    pad = (-len(b)) % 4
    blobs.append(b + b'\0' * pad)
    off = offset
    offset += len(b) + pad
    return off


meta = {
    'version': 1,
    'mesh': {
        'nv': nv, 'ni': len(indices),
        'center': [float(x) for x in center], 'half': [float(x) for x in half],
        'pos': add(qpos), 'nrm': add(qn), 'mat': add(mat), 'out': add(outl), 'joints': add(joints), 'weights': add(wts), 'idx': add(idx),
    },
    'materials': personaje.MATERIALS,
    'flat': [m in toon.FLAT for m in personaje.MATERIALS],
    'palettes': {k: [toon.hex_rgb(v[m], linear=False) for m in personaje.MATERIALS] for k, v in personaje.PALETTES.items()},
    'ink': toon.hex_rgb(toon.INK, linear=False),
    'shadowTint': list(toon.SHADOW_TINT), 'lightGain': list(toon.LIGHT_GAIN), 'rimColor': list(toon.RIM_COLOR),
    'bones': {
        'names': rig.NAMES,
        'parents': [(-1 if rig.PARENTS[n] is None else rig.NAMES.index(rig.PARENTS[n])) for n in rig.NAMES],
        'rest': [[round(c, 5) for c in rig.REST[n]] for n in rig.NAMES],
    },
    'racketCenter': [0.0, -0.272, 0.0],
    'fps': FPS,
    'clips': [],
}

nb = len(rig.NAMES)
for clip in animaciones.all_clips():
    frames = int(round(clip.dur * FPS)) + (0 if clip.loop else 1)
    quats = np.zeros((frames, nb, 4), dtype=np.float64)
    hips = np.zeros((frames, 3), dtype=np.float64)
    prev = None
    for f in range(frames):
        solved = rig.solve(clip.sample(f / FPS))
        lq = rig.local_quats(solved)
        hips[f] = tuple(solved['hips'][0])
        for bi, n in enumerate(rig.NAMES):
            q = lq[n]
            v = np.array([q.x, q.y, q.z, q.w])
            if prev is not None and np.dot(v, prev[bi]) < 0:
                v = -v
            quats[f, bi] = v
        prev = quats[f].copy()
    qi = np.round(quats * 32767).astype(np.int32)
    hi_ = np.round(hips * 10000).astype(np.int32)
    # por componente y como diferencias entre cuadros
    tr = np.concatenate([qi.transpose(1, 2, 0).reshape(nb * 4, frames), hi_.transpose(1, 0)], axis=0)
    delta = np.concatenate([tr[:, :1], np.diff(tr, axis=1)], axis=1).astype(np.int16)
    entry = {'name': clip.name, 'dur': clip.dur, 'loop': clip.loop, 'frames': frames, 'data': add(delta), 'label': clip.label}
    if clip.contact is not None:
        s = rig.solve(clip.sample(clip.contact))
        entry['contact'] = clip.contact
        entry['hit'] = [round(c, 4) for c in rig.racket_center(s)]
    if clip.name == 'saque':
        hold = []
        for t in (0.0, 0.20):
            s = rig.solve(clip.sample(t))
            P, R = s['hand.L']
            hold.append([round(c, 4) for c in (P + R @ Vector((0.105, 0.0, -0.062)))])
        entry['ballHold'] = hold
        entry['release'] = 0.20
    meta['clips'].append(entry)
    print('CLIP', clip.name, frames, entry.get('hit'))

js = json.dumps(meta, separators=(',', ':')).encode('utf-8')
js += b' ' * ((-len(js)) % 4)
os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
with open(out_path, 'wb') as fh:
    fh.write(b'PAD1')
    fh.write(struct.pack('<I', len(js)))
    fh.write(js)
    for b in blobs:
        fh.write(b)
print('WROTE', out_path, 8 + len(js) + offset, 'bytes')
