"""Mide cuánto patinan los pies en cada clip, antes de exportar.

Uso: blender -b --factory-startup --python verificar_pasos.py [-- clip ...]

Para cada pie suma lo que se mueve la bola del pie respecto del piso mientras está apoyada,
con la raíz avanzando lo que declara el clip. También avisa si una pierna no llega a su objetivo.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import animaciones
import animbase
import rig

only = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
worst = 0.0
print('PASOS clip                 pie  máx mm/cuadro  total mm  apoyado  estirada')
for clip in animaciones.all_clips():
    if only and clip.name not in only:
        continue
    res = animbase.slip(clip)
    # piernas que no alcanzan: la bola del pie resuelta queda lejos de la pedida
    miss = {'L': 0.0, 'R': 0.0}
    n = int(round(clip.dur * 120))
    for f in range(n + 1):
        t = min(clip.dur - 1e-9, f / 120.0) if clip.loop else f / 120.0
        p = dict(rig.DEFAULT)
        p.update(clip.sample(t))
        s = rig.solve(p)
        for side in 'LR':
            want = p['foot' + side]
            got = s['toe.' + side][0]
            d = math.hypot(got.x - want[0], got.y - want[1], got.z - (rig.REST['toe.L'].z + want[2]))
            miss[side] = max(miss[side], d * 1000.0)
    for side in 'LR':
        mx, total, frac = res[side]
        worst = max(worst, mx)
        print('PASOS %-20s %s   %8.2f     %8.1f   %5.0f %%   %6.1f mm' % (clip.name, side, mx, total, frac * 100, miss[side]))
print('PASOS peor caso: %.2f mm por cuadro a 120 fps' % worst)
