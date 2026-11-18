"""Exporta el personaje para la versión en tiempo real: malla, esqueleto, paletas, caras y clips.

Uso: blender -b --factory-startup --python exportar.py -- ../assets/personaje.bin

Formato: 'PAD1', largo del JSON (uint32), JSON, relleno a 4 bytes y después los bloques binarios
(los desplazamientos del JSON son relativos al inicio de los bloques). `version` es 2: todo lo de
la versión 1 sigue en su lugar y con el mismo significado; lo nuevo se agrega.
  - malla: posiciones int16 cuantizadas, normales int8, material, ancho de contorno,
    3 huesos y 2 pesos por vértice (el tercero es lo que falta para 255), índices uint16.
    Los índices van ordenados: primero el cuerpo base, después cada pieza opcional. `ni` cubre el
    cuerpo y la trenza, que es lo que dibuja un lector de la versión 1.
  - morfos: diferencias de posición (int16, misma escala que las posiciones) de los vértices de la
    cara para cada expresión.
  - clips: muestreados a 30 fps. Rotación local por hueso (cuaternión int16) y posición de la
    pelvis, guardados por componente y como diferencias entre cuadros, que comprimen mejor.
El README de la carpeta («Contrato para el motor») describe cada campo.
"""
import json
import math
import os
import struct
import sys
import zlib

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
QUAT_STEP = int(os.environ.get('QUAT_STEP', '16'))      # los cuaterniones se redondean a múltiplos de esto (de 32767)

toon.clear_scene()
parts = personaje.build(1, pieces='todas')
mats = {k: bpy.data.materials.new(k) for k in personaje.MATERIALS}
obj = comun.to_object(parts, 'personaje', mats)
mesh = obj.data
mesh.calc_loop_triangles()

# datos por vértice de Blender, en el mismo orden en que se unieron las piezas
weights, outline, owner = [], [], []
for p in parts:
    weights += p.weights
    outline += p.outline
    owner += [p] * len(p.verts)
bone_index = {n: i for i, n in enumerate(rig.NAMES)}
mat_names = [m.name for m in mesh.materials]
mat_global = [personaje.MATERIALS.index(n) for n in mat_names]
head_c = Vector(personaje.HEAD) + Vector((0, 0.0, 0.12 * personaje.HS))

# grupos de triángulos, en el orden en que van al buffer de índices: cuerpo, cara y piezas
GROUPS = ['cuerpo', 'cara'] + personaje.PIEZAS


def group_of(part):
    if part.piece:
        return part.piece
    return 'cara' if part.name == 'face' else 'cuerpo'


tris = {g: [] for g in GROUPS}
for tri in mesh.loop_triangles:
    vi0 = mesh.loops[tri.loops[0]].vertex_index
    tris[group_of(owner[vi0])].append(tri)

corner_normals = [tuple(cn.vector) for cn in mesh.corner_normals]
verts, index_of, indices = [], {}, []
ranges, vranges = {}, {}
for g in GROUPS:
    i0, v0 = len(indices), len(verts)
    for tri in tris[g]:
        mi = mat_global[mesh.polygons[tri.polygon_index].material_index]
        for li in tri.loops:
            vi = mesh.loops[li].vertex_index
            if g == 'cara' or owner[vi].name == 'mustache':
                # calcos: una sola copia por vértice y una normal suave, la de una esfera centrada en la cabeza
                n = tuple((mesh.vertices[vi].co - head_c).normalized())
                key = (vi,)
            else:
                n = corner_normals[li]
                key = (vi, mi, round(n[0] * 40), round(n[1] * 40), round(n[2] * 40))
            if key not in index_of:
                index_of[key] = len(verts)
                verts.append((vi, mi, n))
            indices.append(index_of[key])
    ranges[g] = (i0, len(indices) - i0)
    vranges[g] = (v0, len(verts) - v0)
nv = len(verts)
assert nv < 65536, nv
base_ni = ranges['cuerpo'][1] + ranges['cara'][1]
print('VERTS', nv, 'TRIS', len(indices) // 3, '· base', vranges['cuerpo'][1] + vranges['cara'][1], 'verts,', base_ni // 3, 'tris')

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
sizes = {}          # nombre -> (bytes, bytes comprimidos), para el informe de peso


def add(arr, label=None):
    global offset
    b = arr.tobytes()
    pad = (-len(b)) % 4
    blobs.append(b + b'\0' * pad)
    off = offset
    offset += len(b) + pad
    if label:
        a, c = sizes.get(label, (0, 0))
        sizes[label] = (a + len(b), c + len(zlib.compress(b, 9)))
    return off


# expresiones de la cara: los mismos vértices, en otra posición
f0, fcount = vranges['cara']
face_start = next(i for i, p in enumerate(owner) if p.name == 'face')
neutral = [mesh.vertices[verts[i][0]].co.copy() for i in range(f0, f0 + fcount)]
morph = np.zeros((len(personaje.MORFOS), fcount, 3), dtype=np.float64)
for mi_, name in enumerate(personaje.MORFOS):
    alt = personaje.face_part(personaje.build.bvh, personaje.EXPRESIONES[name]).verts
    for k in range(fcount):
        morph[mi_, k] = tuple(alt[verts[f0 + k][0] - face_start] - neutral[k])
qmorph = np.round(morph / half * 32767).astype(np.int16)

meta = {
    'version': 2,
    'mesh': {
        'nv': nv, 'ni': base_ni + ranges['trenza'][1], 'nt': len(indices), 'base': base_ni,
        'center': [float(x) for x in center], 'half': [float(x) for x in half],
        'pos': add(qpos, 'malla'), 'nrm': add(qn, 'malla'), 'mat': add(mat, 'malla'), 'out': add(outl, 'malla'),
        'joints': add(joints, 'malla'), 'weights': add(wts, 'malla'), 'idx': add(idx, 'malla'),
        'piezas': [{'nombre': g, 'inicio': ranges[g][0], 'cantidad': ranges[g][1], 'vertices': vranges[g][1]} for g in personaje.PIEZAS],
        'morfos': {'inicio': f0, 'cantidad': fcount, 'nombres': personaje.MORFOS, 'datos': add(qmorph, 'caras')},
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
    'caras': ['normal'] + personaje.MORFOS,
    'personajes': {},
    'clips': [],
}

# personajes: se expanden los huesos con '.*' a los dos lados
for key, P in personaje.PERSONAJES.items():
    huesos = {}
    for b, v in P['huesos'].items():
        for name in ([b[:-2] + '.L', b[:-2] + '.R'] if b.endswith('.*') else [b]):
            assert name in rig.NAMES, name
            huesos[name] = {'s': list(v.get('s', (1.0, 1.0, 1.0))), 'd': list(v.get('d', (0.0, 0.0, 0.0)))}
    meta['personajes'][key] = {
        'nombre': P['nombre'], 'paleta': P['paleta'], 'piezas': P['piezas'], 'escala': P['escala'], 'tempo': P['tempo'],
        'amplitud': P['amplitud'], 'mania': P['mania'], 'huesos': huesos, 'postura': {b: list(v) for b, v in P['postura'].items()},
    }


def r4(v):
    return [round(float(c), 4) for c in v]


nb = len(rig.NAMES)
frames_total = 0
for clip in animaciones.all_clips():
    # en los golpes, las muestras se alinean con el impacto: así ese cuadro es exacto y la pala
    # llega justo a la pelota aunque el gesto sea muy rápido
    t0 = 0.0
    if clip.contact is not None:
        t0 = clip.contact - math.floor(clip.contact * FPS + 1e-6) / FPS
    if clip.loop:
        frames = int(round(clip.dur * FPS))
        assert abs(frames / FPS - clip.dur) < 1e-6, (clip.name, 'la duración de un loop tiene que ser un número entero de cuadros')
    else:
        frames = int(math.floor((clip.dur - t0) * FPS + 1e-6)) + 1
    quats = np.zeros((frames, nb, 4), dtype=np.float64)
    hips = np.zeros((frames, 3), dtype=np.float64)
    prev = None
    for f in range(frames):
        solved = rig.solve(clip.sample(t0 + f / FPS))
        lq = rig.local_quats(solved)
        hips[f] = tuple(solved['hips'][0])
        for bi, n in enumerate(rig.NAMES):
            q = lq[n]
            v = np.array([q.x, q.y, q.z, q.w])
            if prev is not None and np.dot(v, prev[bi]) < 0:
                v = -v
            quats[f, bi] = v
        prev = quats[f].copy()
    # menos bits por componente: las diferencias entre cuadros quedan más chicas y comprimen mejor
    top = 32767 // QUAT_STEP                  # sin este tope, un componente igual a 1 se pasa de los 16 bits
    qi = (np.clip(np.round(quats * (32767.0 / QUAT_STEP)), -top, top) * QUAT_STEP).astype(np.int32)
    hi_ = np.round(hips * 10000).astype(np.int32)
    # por componente y como diferencias entre cuadros
    tr = np.concatenate([qi.transpose(1, 2, 0).reshape(nb * 4, frames), hi_.transpose(1, 0)], axis=0)
    delta = np.concatenate([tr[:, :1], np.diff(tr, axis=1)], axis=1).astype(np.int16)
    entry = {'name': clip.name, 'dur': round(clip.dur, 5), 'loop': clip.loop, 'frames': frames, 't0': round(t0, 5),
             'data': add(delta, 'clips ' + clip.group), 'label': clip.label, 'grupo': clip.group}
    frames_total += frames
    if clip.contact is not None:
        s = rig.solve(clip.sample(clip.contact))
        Ph, Rh = s['hand.R']
        entry['contact'] = clip.contact
        entry['cuadro'] = int(round((clip.contact - t0) * FPS))
        entry['hit'] = r4(rig.racket_center(s))
        entry['mano'] = r4(Ph)
        entry['hombro'] = r4(s['upper_arm.R'][0])
        entry['eje'] = r4(Rh @ Vector((0, -1, 0)))          # del mango hacia la cabeza de la pala
        entry['normal'] = r4(Rh @ Vector((0, 0, -1)))       # normal de la cara de la pala que pega de derecha
        entry['lado'] = clip.extra.get('side')
        if clip.hold:
            entry['armado'] = [round(clip.hold[0], 4), round(clip.hold[1], 4)]
        if clip.extra.get('reach'):
            entry['estirada'] = True
    if clip.name == 'saque':
        rel = clip.extra['release']
        hold = []
        for t in (0.0, rel):
            s = rig.solve(clip.sample(t))
            P, R = s['hand.L']
            hold.append(r4(P + R @ Vector((0.105, 0.0, -0.062))))
        entry['ballHold'] = hold
        entry['release'] = rel
    if clip.stride:
        entry['zancada'] = round(clip.stride, 4)
        entry['dir'] = [round(c, 4) for c in clip.dir]
        entry['velocidad'] = round(clip.stride / clip.dur, 3)
        entry['entrada'] = round(clip.extra.get('entry', 0.0), 5)
    if clip.root_fn is not None:
        dist = [math.hypot(*clip.root(t0 + f / FPS)) for f in range(frames)]
        entry['raiz'] = {'dir': [round(c, 4) for c in clip.dir], 'dist': [round(d, 4) for d in dist], 'total': round(math.hypot(*clip.root(clip.dur)), 4)}
    if clip.steps:
        entry['apoyos'] = [[side, round(a, 4), round(b, 4)] for side, a, b in clip.steps]
    if 'link' in clip.extra:
        entry['enlace'] = {'clip': clip.extra['link']['clip'], 'fase': round(clip.extra['link']['phase'], 5)}
    for src, dst in (('land', 'aterrizaje'), ('cut', 'corte'), ('free', 'libre')):
        if src in clip.extra:
            entry[dst] = clip.extra[src]
    if clip.faces:
        entry['caras'] = [[round(a, 3), round(b, 3), name] for a, b, name in clip.faces]
    meta['clips'].append(entry)
    print('CLIP', clip.name, frames, entry.get('hit') or entry.get('zancada') or '')

js = json.dumps(meta, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
js += b' ' * ((-len(js)) % 4)
os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
with open(out_path, 'wb') as fh:
    fh.write(b'PAD1')
    fh.write(struct.pack('<I', len(js)))
    fh.write(js)
    for b in blobs:
        fh.write(b)
whole = open(out_path, 'rb').read()
print('WROTE', out_path, len(whole), 'bytes ·', len(zlib.compress(whole, 9)), 'comprimido ·', frames_total, 'cuadros de animación')
sizes['datos (JSON)'] = (len(js), len(zlib.compress(js, 9)))
for k in sorted(sizes):
    print('PESO %-22s %7d bytes  %7d comprimido' % (k, sizes[k][0], sizes[k][1]))
