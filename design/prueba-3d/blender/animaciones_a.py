"""Clips de la ronda 1, congelados para la versión de sprites (A). Los clips actuales están en animaciones.py.

Clips de animación como poses clave (datos), interpoladas con curvas.

Convención del personaje: mira hacia -Y, su derecha es -X y arriba es +Z. Metros y grados.
Cada pose parte de LISTO y cambia solo lo que hace falta. Las claves con hold=True frenan
(anticipación y remate del gesto); las demás se atraviesan sin frenar, como el impacto.
Los pies se ubican por la bola del pie: (x, y, altura sobre el piso) y (giro, talón levantado).
"""
import math

from mathutils import Vector

import rig

LISTO = dict(
    hips=(0.0, 0.045, -0.085), hips_rot=(16, 0, 0), spine=(9, 0, 0), chest=(7, 0, 0), head=(-38, 0, 0),
    footL=(0.27, -0.13, 0.0), footL_rot=(16, 7), kneeL=(0,), footR=(-0.27, -0.13, 0.0), footR_rot=(-16, 7), kneeR=(0,),
    handR=(-0.07, -0.37, 1.00), elbowR=(-0.8, 0.3, -0.5), racket=(0.40, -0.42, 0.82), face=(0.8, 0.55, -0.1),
    handL=(0.11, -0.43, 1.10), elbowL=(0.8, 0.3, -0.5), fingersL=(-0.55, -0.45, 0.70), palmL=(-0.6, 0.7, 0.2),
    braid=(0, 0, 0, 0),
)


def pose(base=LISTO, **kw):
    p = dict(base)
    p.update(kw)
    return p


class Clip:
    def __init__(self, name, dur, keys, loop=False, contact=None, label=None):
        self.name, self.dur, self.loop, self.contact, self.label = name, dur, loop, contact, label
        self.keys = sorted(keys, key=lambda k: k[0])     # (t, pose, hold)

    def sample(self, t):
        ks = self.keys
        n = len(ks)
        if self.loop:
            t = t % self.dur
        else:
            t = max(0.0, min(self.dur, t))

        def key(i):
            if self.loop:
                k = ks[i % n]
                return (k[0] + self.dur * (i // n), k[1], k[2])
            return ks[max(0, min(n - 1, i))]
        i = 0
        while i + 1 < n and ks[i + 1][0] <= t:
            i += 1
        if not self.loop and i >= n - 1:
            return dict(ks[-1][1])
        k0, k1, k2, k3 = key(i - 1), key(i), key(i + 1), key(i + 2)
        span = (k2[0] - k1[0]) or 1e-6
        u = (t - k1[0]) / span
        h00, h10 = 2 * u ** 3 - 3 * u ** 2 + 1, u ** 3 - 2 * u ** 2 + u
        h01, h11 = -2 * u ** 3 + 3 * u ** 2, u ** 3 - u ** 2
        out = {}
        for name in k1[1]:
            a, b = k1[1][name], k2[1][name]
            p0, p3 = k0[1][name], k3[1][name]
            vals = []
            for c in range(len(a)):
                def tan(pa, pb, pc, ta, tb, tc, hold, edge):
                    if hold or edge:
                        return 0.0
                    return 0.5 * ((pb - pa) / max(1e-6, tb - ta) + (pc - pb) / max(1e-6, tc - tb))
                e1 = (not self.loop) and i == 0
                e2 = (not self.loop) and i + 1 >= n - 1
                m1 = tan(p0[c], a[c], b[c], k0[0], k1[0], k2[0], k1[2], e1)
                m2 = tan(a[c], b[c], p3[c], k1[0], k2[0], k3[0], k2[2], e2)
                vals.append(h00 * a[c] + h10 * span * m1 + h01 * b[c] + h11 * span * m2)
            out[name] = tuple(vals)
        return out


def K(t, p, hold=False):
    return (t, p, hold)


# ---------------------------------------------------------------------------
# Listo: rebote corto sobre las puntas de los pies
# ---------------------------------------------------------------------------
def _listo():
    lo = pose()
    hi = pose(hips=(0.012, 0.04, -0.055), footL_rot=(16, 13), footR_rot=(-16, 13), handR=(-0.065, -0.375, 1.025),
              handL=(0.115, -0.435, 1.125), spine=(8, 2, 0), head=(-21, -1, 0), braid=(0, -4, 0, -6))
    lo2 = pose(hips=(-0.012, 0.045, -0.09), spine=(9, -2, 0), head=(-22, 1, 0), braid=(0, 3, 0, 5))
    hi2 = pose(hi, hips=(-0.006, 0.04, -0.058))
    return Clip('listo', 1.0, [K(0.0, lo), K(0.25, hi), K(0.5, lo2), K(0.75, hi2)], loop=True)


# ---------------------------------------------------------------------------
# Correr hacia adelante (trote corto) y desplazamiento lateral
# ---------------------------------------------------------------------------
def _foot_run(ph):
    ph = ph % 1.0
    if ph < 0.42:
        u = ph / 0.42
        return rig_lerp(-0.34, 0.14, u), 0.0, rig_lerp(-14, 30, u * u)
    u = (ph - 0.42) / 0.58
    s = u * u * (3 - 2 * u)
    return rig_lerp(0.14, -0.34, s), 0.05 + 0.20 * math.sin(math.pi * u) ** 0.8, rig_lerp(62, -14, u)


def rig_lerp(a, b, t):
    return a + (b - a) * t


def _correr():
    keys = []
    n = 8
    dur = 0.50
    for i in range(n):
        ph = i / n
        yl, ll, hl = _foot_run(ph)
        yr, lr, hr = _foot_run(ph + 0.5)
        s = math.sin(2 * math.pi * (ph + 0.08))
        c2 = math.cos(4 * math.pi * (ph + 0.03))
        p = pose(
            hips=(0.012 * s, 0.02, -0.075 + 0.030 * c2), hips_rot=(15, 7 * s, 2.5 * s), spine=(8, -5 * s, 0), chest=(6, -9 * s, 0),
            head=(-20, 5 * s, 0),
            footL=(0.085, yl, ll), footL_rot=(3, hl), footR=(-0.085, yr, lr), footR_rot=(-3, hr),
            handR=(-0.25, -0.16 - 0.17 * s, 1.04 - 0.05 * s), elbowR=(-0.5, 0.75, -0.4), racket=(0.18, -0.55 - 0.1 * s, 0.80), face=(0.9, 0.3, -0.1),
            handL=(0.25, -0.14 + 0.17 * s, 1.02 + 0.05 * s), elbowL=(0.5, 0.75, -0.4), fingersL=(-0.1, -0.75, 0.3 - 0.4 * s), palmL=(-1, 0, 0),
            braid=(-10 * s, 9 + 5 * c2, -16 * s, 12 + 8 * c2),
        )
        keys.append(K(ph * dur, p))
    return Clip('correr', dur, keys, loop=True)


def _lateral(sign, name):
    """Paso lateral: sign=+1 hacia la izquierda del personaje (+X), -1 hacia su derecha."""
    keys = []
    n = 8
    dur = 0.42
    D = 0.34
    for i in range(n):
        ph = i / n
        # pie que lidera: vuela en la primera mitad; el otro, en la segunda
        def path(p0):
            p0 = p0 % 1.0
            if p0 < 0.5:
                u = p0 / 0.5
                return -D / 2 + D * (u * u * (3 - 2 * u)), 0.075 * math.sin(math.pi * u), 10 + 14 * math.sin(math.pi * u)
            u = (p0 - 0.5) / 0.5
            return D / 2 - D * u, 0.0, 6 + 22 * u * u
        dl, liftl, heell = path(ph)
        dt, liftt, heelt = path(ph + 0.5)
        lead_x, trail_x = 0.30 + dl, -0.20 + dt
        bounce = abs(math.sin(2 * math.pi * ph))
        if sign > 0:
            fl, fr = (lead_x, -0.13, liftl), (trail_x, -0.13, liftt)
            hl_, hr_ = heell, heelt
        else:
            fl, fr = (-trail_x, -0.13, liftt), (-lead_x, -0.13, liftl)
            hl_, hr_ = heelt, heell
        sway = math.sin(2 * math.pi * ph)
        p = pose(
            hips=(0.03 * sign, 0.045, -0.10 + 0.035 * bounce), hips_rot=(16, 4 * sign, 4 * sign), spine=(9, 3 * sign, 2 * sign), chest=(7, 4 * sign, 0),
            head=(-22, 6 * sign, 0),
            footL=fl, footL_rot=(16, hl_), footR=fr, footR_rot=(-16, hr_),
            handR=(-0.07, -0.37, 1.00 + 0.03 * bounce), handL=(0.11, -0.43, 1.10 + 0.03 * bounce),
            braid=(-12 * sign, 4 + 6 * bounce, -20 * sign - 6 * sway, 6 + 9 * bounce),
        )
        keys.append(K(ph * dur, p))
    return Clip(name, dur, keys, loop=True)


# ---------------------------------------------------------------------------
# Derecha: armado con giro de hombros, impacto adelante y terminación cruzada
# ---------------------------------------------------------------------------
def _derecha():
    arm = pose(
        hips=(-0.07, 0.07, -0.12), hips_rot=(10, -48, 0), spine=(6, -18, 0), chest=(4, -24, 0), head=(-12, 62, 0),
        footR=(-0.33, 0.10, 0.0), footR_rot=(-62, 0), footL=(0.10, -0.20, 0.0), footL_rot=(-18, 12),
        handR=(-0.36, 0.42, 1.16), elbowR=(-0.5, 0.6, -0.6), racket=(-0.20, 0.50, 0.84), face=(-0.9, -0.1, -0.3),
        handL=(0.16, -0.50, 1.20), elbowL=(0.6, 0.2, -0.7), fingersL=(0.15, -0.95, 0.2), palmL=(0, 0.2, -1),
        braid=(14, 2, 22, 4),
    )
    load = pose(arm, hips=(-0.09, 0.09, -0.15), hips_rot=(12, -54, 0), handR=(-0.40, 0.46, 1.10), racket=(-0.30, 0.62, 0.72),
                chest=(4, -28, 0), head=(-12, 68, 0))
    hit = pose(
        hips=(0.03, -0.06, -0.10), hips_rot=(8, -12, 0), spine=(5, -4, 0), chest=(4, 2, 0), head=(4, -20, 0),
        footR=(-0.28, 0.06, 0.0), footR_rot=(-38, 38), footL=(0.10, -0.20, 0.0), footL_rot=(-14, 0),
        handR=(-0.46, -0.28, 1.02), elbowR=(-0.3, 0.5, -0.8), racket=(-0.93, -0.30, -0.18), face=(0.0, -1, 0.05),
        handL=(0.24, -0.30, 1.04), elbowL=(0.7, 0.5, -0.6), fingersL=(-0.3, -0.8, -0.3), palmL=(-0.7, 0.6, 0),
        braid=(-18, 6, -30, 10),
    )
    follow = pose(
        hips=(0.06, -0.12, -0.07), hips_rot=(8, 22, 0), spine=(4, 12, 0), chest=(2, 22, 0), head=(0, -40, 0),
        footR=(-0.22, 0.02, 0.0), footR_rot=(-10, 55), footL=(0.10, -0.20, 0.0), footL_rot=(-10, 0),
        handR=(0.22, -0.38, 1.40), elbowR=(-0.3, -0.6, -0.7), racket=(0.50, 0.30, 0.81), face=(0.3, -0.8, -0.5),
        handL=(0.30, -0.02, 1.02), elbowL=(0.8, 0.4, -0.4), fingersL=(0.1, -0.5, -0.8), palmL=(-1, 0, 0),
        braid=(-24, 8, -34, 14),
    )
    end = pose(follow, handR=(0.30, -0.26, 1.46), racket=(0.45, 0.55, 0.70), hips=(0.05, -0.10, -0.06), hips_rot=(8, 26, 0), braid=(10, 4, 18, 6))
    return Clip('derecha', 1.0, [K(0.0, pose(), True), K(0.20, arm), K(0.38, load, True), K(0.52, hit), K(0.64, follow), K(0.76, end, True),
                                 K(1.0, pose(), True)], contact=0.52, label='Derecha')


# ---------------------------------------------------------------------------
# Globo: armado bajo y agachado, cara de la pala abierta, terminación arriba
# ---------------------------------------------------------------------------
def _globo():
    arm = pose(
        hips=(-0.07, 0.08, -0.20), hips_rot=(14, -44, 0), spine=(8, -16, 0), chest=(6, -20, 0), head=(-18, 58, 0),
        footR=(-0.34, 0.10, 0.0), footR_rot=(-60, 0), footL=(0.10, -0.22, 0.0), footL_rot=(-18, 8),
        handR=(-0.40, 0.36, 0.84), elbowR=(-0.5, 0.6, -0.6), racket=(-0.35, 0.65, -0.20), face=(-0.3, -0.3, -0.9),
        handL=(0.18, -0.48, 1.08), elbowL=(0.6, 0.2, -0.7), fingersL=(0.15, -0.95, 0.2), palmL=(0, 0.2, -1),
        braid=(12, 2, 18, 4),
    )
    hit = pose(
        hips=(0.02, -0.05, -0.14), hips_rot=(8, -14, 0), spine=(3, -5, 0), chest=(0, 0, 0), head=(-14, -16, 0),
        footR=(-0.29, 0.07, 0.0), footR_rot=(-40, 30), footL=(0.10, -0.22, 0.0), footL_rot=(-14, 0),
        handR=(-0.46, -0.30, 0.86), elbowR=(-0.3, 0.5, -0.8), racket=(-0.85, -0.30, -0.42), face=(0.0, -0.82, 0.57),
        handL=(0.24, -0.30, 1.02), elbowL=(0.7, 0.5, -0.6), fingersL=(-0.3, -0.8, -0.3), palmL=(-0.7, 0.6, 0),
        braid=(-10, 6, -16, 10),
    )
    follow = pose(
        hips=(0.04, -0.08, -0.02), hips_rot=(0, 10, 0), spine=(-4, 6, 0), chest=(-6, 8, 0), head=(-30, -14, 0),
        footR=(-0.24, 0.04, 0.0), footR_rot=(-16, 48), footL=(0.10, -0.22, 0.0), footL_rot=(-10, 6),
        handR=(-0.14, -0.44, 1.66), elbowR=(-0.6, 0.2, -0.6), racket=(0.05, -0.25, 0.97), face=(0.1, -0.9, 0.3),
        handL=(0.30, -0.04, 1.04), elbowL=(0.8, 0.4, -0.4), fingersL=(0.1, -0.5, -0.8), palmL=(-1, 0, 0),
        braid=(-4, 14, -8, 22),
    )
    end = pose(follow, handR=(-0.06, -0.40, 1.74), racket=(0.15, -0.05, 0.99), braid=(0, 6, 0, 10))
    return Clip('globo', 1.1, [K(0.0, pose(), True), K(0.24, arm), K(0.42, pose(arm, hips=(-0.08, 0.09, -0.23)), True), K(0.56, hit),
                               K(0.72, follow), K(0.86, end, True), K(1.1, pose(), True)], contact=0.56, label='Globo')


# ---------------------------------------------------------------------------
# Revés: de costado, la pala baja de atrás hacia adelante y el brazo libre abre
# ---------------------------------------------------------------------------
def _reves():
    arm = pose(
        hips=(0.08, 0.05, -0.12), hips_rot=(10, 55, 0), spine=(6, 20, 0), chest=(4, 25, 0), head=(-8, -68, 0),
        footR=(0.06, -0.26, 0.0), footR_rot=(48, 0), footL=(0.30, 0.12, 0.0), footL_rot=(78, 0),
        handR=(0.34, 0.16, 1.28), elbowR=(-0.2, -0.5, -0.8), racket=(0.30, 0.50, 0.81), face=(-0.4, 0.3, -0.85),
        handL=(0.40, 0.10, 1.36), elbowL=(0.6, 0.6, -0.5), fingersL=(-0.3, 0.3, 0.9), palmL=(-0.8, -0.5, 0),
        braid=(-14, 2, -22, 4),
    )
    load = pose(arm, hips=(0.10, 0.07, -0.15), hips_rot=(12, 60, 0), handR=(0.38, 0.22, 1.32), handL=(0.44, 0.16, 1.40), racket=(0.36, 0.56, 0.75))
    hit = pose(
        hips=(0.05, -0.10, -0.11), hips_rot=(12, 42, 0), spine=(6, 14, 0), chest=(4, 14, 0), head=(0, -56, 0),
        footR=(0.06, -0.30, 0.0), footR_rot=(40, 0), footL=(0.30, 0.10, 0.0), footL_rot=(70, 30),
        handR=(0.18, -0.62, 1.02), elbowR=(0.3, 0.2, -0.9), racket=(0.85, -0.40, -0.30), face=(0.1, 1.0, -0.15),
        handL=(0.36, 0.34, 1.12), elbowL=(0.7, 0.5, -0.5), fingersL=(0.5, 0.8, -0.3), palmL=(0, 0, -1),
        braid=(18, 6, 28, 10),
    )
    follow = pose(
        hips=(0.03, -0.14, -0.08), hips_rot=(10, 30, 0), spine=(4, 8, 0), chest=(2, 6, 0), head=(0, -36, 0),
        footR=(0.06, -0.30, 0.0), footR_rot=(34, 0), footL=(0.28, 0.08, 0.0), footL_rot=(60, 46),
        handR=(-0.36, -0.60, 1.22), elbowR=(0.2, 0.3, -0.9), racket=(-0.55, -0.50, 0.67), face=(-0.5, 0.75, 0.3),
        handL=(0.40, 0.42, 1.00), elbowL=(0.7, 0.5, -0.5), fingersL=(0.4, 0.85, -0.3), palmL=(0, 0, -1),
        braid=(22, 8, 32, 12),
    )
    end = pose(follow, handR=(-0.44, -0.52, 1.30), racket=(-0.62, -0.36, 0.70), braid=(-8, 4, -12, 6))
    return Clip('reves', 1.0, [K(0.0, pose(), True), K(0.20, arm), K(0.38, load, True), K(0.52, hit), K(0.64, follow), K(0.76, end, True),
                               K(1.0, pose(), True)], contact=0.52, label='Revés')


# ---------------------------------------------------------------------------
# Remate: pose de trofeo, salto e impacto arriba, caída con el cuerpo hacia adelante
# ---------------------------------------------------------------------------
def _remate():
    trophy = pose(
        hips=(-0.04, 0.06, -0.15), hips_rot=(-6, -62, 0), spine=(-6, -14, 4), chest=(-8, -16, 6), head=(-28, 70, 0),
        footL=(0.06, -0.22, 0.0), footL_rot=(-30, 0), footR=(-0.26, 0.16, 0.0), footR_rot=(-75, 0),
        handR=(-0.16, 0.34, 1.62), elbowR=(-0.6, 0.7, 0.3), racket=(0.20, 0.25, 0.95), face=(-0.7, -0.6, 0.2),
        handL=(-0.03, -0.30, 1.76), elbowL=(0.5, -0.3, -0.6), fingersL=(0, -0.3, 0.95), palmL=(0.3, -0.9, -0.3),
        braid=(10, -6, 16, -10),
    )
    drop = pose(
        hips=(-0.02, 0.02, -0.02), hips_rot=(-4, -40, 0), spine=(-4, -8, 2), chest=(-6, -10, 4), head=(-30, 44, 0),
        footL=(0.06, -0.22, 0.0), footL_rot=(-25, 42), footR=(-0.26, 0.16, 0.0), footR_rot=(-60, 46),
        handR=(-0.30, 0.20, 1.68), elbowR=(-0.5, 0.2, 0.85), racket=(0.10, 0.50, -0.86), face=(-0.8, -0.5, 0.1),
        handL=(0.02, -0.34, 1.70), elbowL=(0.5, -0.3, -0.6), fingersL=(0, -0.4, 0.9), palmL=(0.3, -0.9, -0.3),
        braid=(6, -14, 10, -22),
    )
    hit = pose(
        hips=(0.0, -0.10, 0.20), hips_rot=(10, 5, 0), spine=(6, 8, -4), chest=(6, 12, -6), head=(-10, -10, 0),
        footL=(0.08, -0.10, 0.22), footL_rot=(-10, 35), footR=(-0.14, 0.34, 0.42), footR_rot=(-20, 70),
        handR=(-0.22, -0.40, 2.04), elbowR=(-0.6, 0.3, -0.2), racket=(-0.05, -0.42, 0.90), face=(0.0, -0.9, -0.42),
        handL=(0.16, -0.22, 1.50), elbowL=(0.7, 0.3, -0.5), fingersL=(-0.5, -0.3, -0.6), palmL=(-0.5, 0.8, 0),
        braid=(0, 16, 0, 26),
    )
    follow = pose(
        hips=(0.03, -0.16, -0.06), hips_rot=(26, 30, 0), spine=(12, 10, 0), chest=(8, 12, 0), head=(-22, -30, 0),
        footL=(0.12, -0.24, 0.0), footL_rot=(-5, 0), footR=(-0.16, 0.26, 0.16), footR_rot=(-15, 60),
        handR=(0.22, -0.52, 0.86), elbowR=(-0.4, 0.4, -0.6), racket=(0.55, 0.10, -0.83), face=(0.5, -0.8, 0.2),
        handL=(0.30, -0.14, 1.00), elbowL=(0.8, 0.3, -0.4), fingersL=(0, -0.4, -0.9), palmL=(-1, 0, 0),
        braid=(0, -18, 0, -30),
    )
    settle = pose(
        hips=(0.0, -0.02, -0.13), hips_rot=(20, 10, 0), spine=(10, 3, 0), chest=(8, 4, 0), head=(-22, -8, 0),
        footL=(0.20, -0.16, 0.0), footL_rot=(8, 0), footR=(-0.26, -0.10, 0.0), footR_rot=(-18, 10),
        handR=(0.10, -0.42, 0.92), elbowR=(-0.7, 0.3, -0.5), racket=(0.50, -0.30, 0.20), face=(0.6, 0.6, -0.4),
        handL=(0.22, -0.30, 1.02), braid=(0, 8, 0, 12),
    )
    return Clip('remate', 1.25, [K(0.0, pose(), True), K(0.26, trophy), K(0.44, pose(trophy, hips=(-0.05, 0.07, -0.19)), True), K(0.55, drop),
                                 K(0.64, hit), K(0.78, follow), K(0.96, settle, True), K(1.25, pose(), True)], contact=0.64, label='¡Remate!')


# ---------------------------------------------------------------------------
# Saque: de costado, deja caer la pelota y le pega por abajo después del pique
# ---------------------------------------------------------------------------
def _saque():
    start = pose(
        hips=(-0.02, 0.02, -0.05), hips_rot=(6, -40, 0), spine=(4, -8, 0), chest=(4, -10, 0), head=(4, 44, 0),
        footL=(0.08, -0.24, 0.0), footL_rot=(-25, 0), footR=(-0.20, 0.12, 0.0), footR_rot=(-60, 0),
        handL=(-0.22, -0.42, 1.08), elbowL=(0.6, 0.2, -0.7), fingersL=(-0.55, -0.80, 0.1), palmL=(0, 0, 1),
        handR=(-0.34, 0.22, 0.98), elbowR=(-0.5, 0.7, -0.4), racket=(-0.25, 0.55, -0.50), face=(-0.8, -0.5, -0.3),
        braid=(8, 0, 12, 0),
    )
    release = pose(start, handL=(-0.22, -0.42, 1.03), fingersL=(-0.55, -0.80, -0.1), palmL=(0.2, 0.2, 1))
    back = pose(
        start, hips=(-0.06, 0.06, -0.09), hips_rot=(8, -50, 0), head=(14, 52, 0),
        handR=(-0.42, 0.40, 1.10), racket=(-0.30, 0.55, 0.60), face=(-0.9, -0.2, -0.3),
        handL=(-0.10, -0.38, 0.96), fingersL=(-0.4, -0.8, -0.4), palmL=(-0.7, 0.5, 0.2), braid=(12, 2, 18, 4),
    )
    hit = pose(
        hips=(0.02, -0.08, -0.11), hips_rot=(12, -15, 0), spine=(6, -3, 0), chest=(5, 2, 0), head=(16, -14, 0),
        footL=(0.08, -0.24, 0.0), footL_rot=(-22, 0), footR=(-0.24, 0.08, 0.0), footR_rot=(-40, 30),
        handR=(-0.22, -0.30, 0.88), elbowR=(-0.5, 0.5, -0.6), racket=(-0.20, -0.45, -0.87), face=(0.1, -0.85, 0.5),
        handL=(0.24, -0.30, 1.02), elbowL=(0.7, 0.5, -0.6), fingersL=(-0.3, -0.8, -0.3), palmL=(-0.7, 0.6, 0),
        braid=(-10, 6, -16, 10),
    )
    follow = pose(
        hips=(0.03, -0.12, -0.06), hips_rot=(8, 12, 0), spine=(3, 6, 0), chest=(2, 12, 0), head=(-12, -26, 0),
        footL=(0.08, -0.24, 0.0), footL_rot=(-16, 0), footR=(-0.20, -0.02, 0.02), footR_rot=(-20, 30),
        handR=(-0.04, -0.50, 1.32), elbowR=(-0.6, 0.2, -0.6), racket=(0.25, -0.35, 0.90), face=(0.6, -0.7, 0.2),
        handL=(0.28, -0.08, 1.02), elbowL=(0.8, 0.4, -0.4), fingersL=(0.1, -0.5, -0.8), palmL=(-1, 0, 0),
        braid=(-14, 8, -20, 12),
    )
    return Clip('saque', 1.45, [K(0.0, start, True), K(0.20, release), K(0.56, back, True), K(0.88, hit), K(1.04, follow), K(1.16, follow, True),
                                K(1.45, pose(), True)], contact=0.88, label='Saque')


# ---------------------------------------------------------------------------
# Festejo corto: puño apretado
# ---------------------------------------------------------------------------
def _festejo():
    up = pose(
        hips=(0.0, 0.02, -0.03), hips_rot=(4, 8, 0), spine=(0, 4, 0), chest=(-4, 6, 0), head=(-24, -6, 0),
        footL=(0.20, -0.13, 0.0), footL_rot=(14, 0), footR=(-0.22, -0.13, 0.0), footR_rot=(-14, 0),
        handL=(0.30, -0.22, 1.42), elbowL=(0.7, 0.3, -0.7), fingersL=(-0.2, 0.2, 0.95), palmL=(-0.9, -0.4, 0),
        handR=(-0.34, -0.10, 0.98), elbowR=(-0.6, 0.6, -0.4), racket=(-0.35, -0.50, -0.80), face=(0.8, -0.5, -0.2),
        braid=(0, 10, 0, 16),
    )
    pump = pose(up, handL=(0.26, -0.26, 1.28), hips=(0.0, 0.02, -0.08), chest=(4, 6, 0), braid=(0, -8, 0, -12))
    return Clip('festejo', 0.9, [K(0.0, pose(), True), K(0.22, up, True), K(0.36, pump), K(0.50, up, True), K(0.9, pose(), True)], label=None)


def all_clips():
    return [_listo(), _correr(), _lateral(+1, 'lateral_izq'), _lateral(-1, 'lateral_der'), _saque(), _derecha(), _reves(), _globo(),
            _remate(), _festejo()]


CLIPS = {c.name: c for c in all_clips()}
