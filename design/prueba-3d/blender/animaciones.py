"""Todos los clips del personaje.

Las poses y la interpolación están en animbase.py. Los clips se reparten por tema:
  anim_locomocion.py  correr, correr hacia atrás, paso lateral, split step, arranque y frenada
  anim_golpes.py      derecha, revés, voleas, bandeja, remate, globo, saque y estiradas
  anim_gestos.py      espera, festejo, lamento y manías
Los clips de la ronda 1, que usa la versión de sprites, quedaron en animaciones_a.py.
"""
import anim_locomocion
from animbase import K, LISTO, Clip, pose   # noqa: F401  (se usan desde otros scripts)

try:
    import anim_golpes
except ImportError:
    anim_golpes = None
try:
    import anim_gestos
except ImportError:
    anim_gestos = None


# ---------------------------------------------------------------------------
# Listo: rebote corto sobre las puntas de los pies, con el peso que va de un pie al otro
# ---------------------------------------------------------------------------
def _listo():
    lo = pose()
    hi = pose(hips=(0.014, 0.05, -0.092), footL_rot=(18, 15), footR_rot=(-18, 15), handR=(-0.075, -0.405, 1.02),
              handL=(0.12, -0.46, 1.125), spine=(9, 2, 0), braid=(0, -4, 0, -6))
    lo2 = pose(hips=(-0.014, 0.055, -0.13), spine=(10, -2, 0), braid=(0, 3, 0, 5))
    hi2 = pose(hi, hips=(-0.008, 0.05, -0.095), spine=(9, -1, 0))
    return Clip('listo', 1.0, [K(0.0, lo), K(0.25, hi), K(0.5, lo2), K(0.75, hi2)], loop=True, group='base')


def all_clips():
    out = [_listo()] + anim_locomocion.clips()
    if anim_golpes:
        out += anim_golpes.clips()
    if anim_gestos:
        out += anim_gestos.clips()
    return out


CLIPS = {c.name: c for c in all_clips()}
