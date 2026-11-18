"""Renderiza el personaje a hojas de sprites (versión A) con EEVEE.

Uso: blender -b --factory-startup --python render_sprites.py -- carpeta_temporal carpeta_salida [vista]

Dos vistas, cada una con la variante de color y la luz que le tocan en la cancha:
  espalda  jugador propio, visto desde atrás y arriba (41°, que es como lo ve la cámara del juego)
  frente   rival, visto de frente (26°)
Cada cuadro se recorta a su contenido y se acomoda en una hoja. El JSON guarda, por clip, los
cuadros con su rectángulo y el ancla (dónde cae el punto del piso bajo el personaje).
"""
import json
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
TMP, OUT = argv[0], argv[1]
ONLY = argv[2] if len(argv) > 2 else None
os.makedirs(TMP, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

VIEWS = {
    # ppm: píxeles por metro del sprite (resolución para la escala más grande que se muestra nítida)
    'espalda': dict(variant='jugador', cam=(0, 1, 0), elev=41.0, key=(0.5, 0.6, 0.62), sun=(0.42, -0.80, 0.43), ppm=96,
                    clips=['listo', 'correr', 'lateral_izq', 'lateral_der', 'saque', 'reves', 'remate', 'festejo']),
    'frente': dict(variant='rival', cam=(0, -1, 0), elev=26.3, key=(-0.5, -0.6, 0.62), sun=(-0.42, 0.80, 0.43), ppm=70,
                   clips=['listo', 'correr', 'lateral_izq', 'lateral_der', 'derecha', 'globo']),
}
FPS = {'listo': 8, 'correr': 16, 'lateral_izq': 16.67, 'lateral_der': 16.67}
STROKE_FPS = 15
CELL_M = (3.5, 3.9)          # celda en metros (ancho, alto en el plano de la imagen)
CENTER_Z = 1.15              # altura a la que apunta la cámara
OUTLINE = 0.026              # ≈ 1 px CSS de tinta a la escala por defecto


def frame_times(clip):
    if clip.loop:
        n = max(4, int(round(clip.dur * FPS.get(clip.name, 12))))
        return [clip.dur * i / n for i in range(n)], n / clip.dur
    n = int(round(clip.dur * STROKE_FPS)) + 1
    return [min(clip.dur, i / STROKE_FPS) for i in range(n)], STROKE_FPS


def render_view(name, V):
    toon.clear_scene()
    parts = personaje.build(2)
    mats = toon.make_materials(personaje.PALETTES[V['variant']], V['variant'] + '_', V['sun'])
    base = comun.to_object(parts, 'personaje', mats)
    arm = rig.build_armature()
    rig.bind(base, arm)
    toon.add_outline(base, OUTLINE)
    w, h = int(round(CELL_M[0] * V['ppm'] / 2) * 2), int(round(CELL_M[1] * V['ppm'] / 2) * 2)
    sc = toon.setup_scene((w, h), samples=32, transparent=True)
    toon.add_key_light(V['key'])
    el = math.radians(V['elev'])
    c = Vector((0, 0, CENTER_Z))
    d = Vector(V['cam']) * math.cos(el) + Vector((0, 0, math.sin(el)))
    toon.add_camera(c + d * 30, c, ortho_scale=CELL_M[0])
    # ancla: el origen del personaje (piso) queda debajo del centro de la imagen
    anchor = (w / 2.0, h / 2.0 + CENTER_Z * math.cos(el) * V['ppm'])
    frames = []
    for cname in V['clips']:
        clip = animaciones.CLIPS[cname]
        times, fps = frame_times(clip)
        for i, t in enumerate(times):
            rig.apply(arm, rig.solve(clip.sample(t)))
            path = os.path.join(TMP, f'{name}_{cname}_{i:02d}.png')
            sc.render.filepath = path
            bpy.ops.render.render(write_still=True)
            frames.append(dict(clip=cname, i=i, t=t, fps=fps, path=path))
        print('CLIP', name, cname, len(times))
    return frames, (w, h), anchor


def load_png(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)[::-1].copy()


def pack(name, V, frames, cell, anchor):
    rects = []
    for f in frames:
        a = load_png(f['path'])
        ys, xs = np.where(a[..., 3] > 0.01)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        f['img'] = a[y0:y1, x0:x1]
        f['ax'], f['ay'] = anchor[0] - x0, anchor[1] - y0
        rects.append(f)
    PAD, MAXW = 2, 2048
    order = sorted(rects, key=lambda r: -r['img'].shape[0])
    x = y = row_h = 0
    for r in order:
        hh, ww = r['img'].shape[:2]
        if x + ww + PAD > MAXW:
            x, y, row_h = 0, y + row_h + PAD, 0
        r['x'], r['y'] = x, y
        x += ww + PAD
        row_h = max(row_h, hh)
    W = max(r['x'] + r['img'].shape[1] for r in order)
    H = y + row_h
    W, H = int(math.ceil(W / 4) * 4), int(math.ceil(H / 4) * 4)
    atlas = np.zeros((H, W, 4), dtype=np.float32)
    for r in order:
        hh, ww = r['img'].shape[:2]
        atlas[r['y']:r['y'] + hh, r['x']:r['x'] + ww] = r['img']
    img = bpy.data.images.new('atlas', W, H, alpha=True)
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(np.clip(atlas[::-1], 0, 1).ravel())
    img.file_format = 'WEBP'
    path = os.path.join(OUT, name + '.webp')
    img.filepath_raw = path
    img.save(filepath=path, quality=90)
    clips = {}
    for f in frames:
        c = animaciones.CLIPS[f['clip']]
        e = clips.setdefault(f['clip'], dict(dur=c.dur, loop=c.loop, fps=round(f['fps'], 3), frames=[]))
        hh, ww = f['img'].shape[:2]
        e['frames'].append([int(f['x']), int(f['y']), int(ww), int(hh), round(float(f['ax']), 1), round(float(f['ay']), 1)])
    print('HOJA', name, W, H, len(frames), 'cuadros', os.path.getsize(path), 'bytes')
    return dict(file=name + '.webp', size=[W, H], ppm=V['ppm'], elev=V['elev'], variant=V['variant'], clips=clips)


def clip_meta():
    """Lo que necesita el peloteo: duración, impacto y dónde queda el centro de la pala."""
    out = []
    for clip in animaciones.all_clips():
        e = dict(name=clip.name, dur=clip.dur, loop=clip.loop, label=clip.label)
        if clip.contact is not None:
            s = rig.solve(clip.sample(clip.contact))
            e['contact'] = clip.contact
            e['hit'] = [round(c, 4) for c in rig.racket_center(s)]
        if clip.name == 'saque':
            hold = []
            for t in (0.0, 0.20):
                s = rig.solve(clip.sample(t))
                P, R = s['hand.L']
                hold.append([round(c, 4) for c in (P + R @ Vector((0.105, 0.0, -0.062)))])
            e['ballHold'] = hold
            e['release'] = 0.20
        out.append(e)
    return out


meta_path = os.path.join(OUT, 'sprites.json')
meta = json.load(open(meta_path, encoding='utf-8')) if os.path.exists(meta_path) else {'views': {}}
for name, V in VIEWS.items():
    if ONLY and name != ONLY:
        continue
    frames, cell, anchor = render_view(name, V)
    meta['views'][name] = pack(name, V, frames, cell, anchor)
meta['clips'] = clip_meta()
meta['outline'] = OUTLINE
with open(meta_path, 'w', encoding='utf-8') as fh:
    json.dump(meta, fh, separators=(',', ':'))
print('OK sprites')
