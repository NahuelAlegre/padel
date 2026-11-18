"""Base de las animaciones: pose de partida, claves, interpolación y clips.

Convención del personaje: mira hacia -Y, su derecha es -X y arriba es +Z. Metros y grados.
Una pose es un diccionario de controles (ver rig.solve). Los pies se ubican por la bola del pie:
(x, y, altura sobre el piso) y (giro, talón levantado). La cabeza mira a un punto (`look`).

Hay dos formas de escribir un clip:
  - con claves: poses en instantes dados, unidas con curvas. Las claves con hold=True frenan
    (anticipación, final del gesto); las demás se atraviesan sin frenar, como el impacto.
  - con una función: pose = fn(t). Se usa en la locomoción, donde el pie apoyado tiene que
    moverse exactamente a la velocidad del piso para no patinar.

Un clip que se desplaza declara cuánto: `stride` (metros por ciclo) y `dir` en los loops, o
`root_fn(t)` en las transiciones. El clip se anima en el lugar; el desplazamiento va aparte.
"""
import math

from mathutils import Vector

import rig

FEET = ('footL', 'footR')
FEET_ROT = ('footL_rot', 'footR_rot')
MIRA = (0.0, -8.0, 2.35)        # a dónde mira si no hay nada mejor: al otro lado de la red


def lerp(a, b, t):
    return a + (b - a) * t


def lerpv(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def ramp(a, b, x):
    """Smoothstep entre a y b (vale también con a > b)."""
    if a == b:
        return 0.0 if x < a else 1.0
    return smooth((x - a) / (b - a))


def curve(pts, x):
    """Curva suave (Catmull-Rom) por puntos (x, valor) ordenados. El valor puede ser un número o una tupla."""
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        if a[0] <= x <= b[0]:
            p0, p3 = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 2)]
            u = (x - a[0]) / ((b[0] - a[0]) or 1e-9)

            def cr(v0, v1, v2, v3):
                # tangentes que respetan la separación desigual entre puntos
                m1 = 0.5 * ((v1 - v0) / ((a[0] - p0[0]) or 1e9) + (v2 - v1) / (b[0] - a[0])) * (b[0] - a[0]) if i > 0 else (v2 - v1)
                m2 = 0.5 * ((v2 - v1) / (b[0] - a[0]) + (v3 - v2) / ((p3[0] - b[0]) or 1e9)) * (b[0] - a[0]) if i + 2 < len(pts) else (v2 - v1)
                u2, u3 = u * u, u * u * u
                return (2 * u3 - 3 * u2 + 1) * v1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * v2 + (u3 - u2) * m2
            if isinstance(a[1], tuple):
                return tuple(cr(p0[1][k], a[1][k], b[1][k], p3[1][k]) for k in range(len(a[1])))
            return cr(p0[1], a[1], b[1], p3[1])
    return pts[-1][1]


def hermite(p0, m0, p1, m1, u):
    u2, u3 = u * u, u * u * u
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1


# Posición de espera activa: piernas flexionadas, peso adelante, pala arriba con las dos manos.
LISTO = dict(
    hips=(0.0, 0.055, -0.125), hips_rot=(19, 0, 0), spine=(10, 0, 0), chest=(6, 0, 0), head=(0, 0, 0), look=MIRA,
    footL=(0.30, -0.12, 0.0), footL_rot=(18, 9), kneeL=(0,), footR=(-0.30, -0.12, 0.0), footR_rot=(-18, 9), kneeR=(0,),
    handR=(-0.08, -0.40, 0.99), elbowR=(-0.8, 0.3, -0.5), racket=(0.42, -0.40, 0.82), face=(0.8, 0.55, -0.1),
    handL=(0.115, -0.455, 1.095), elbowL=(0.8, 0.3, -0.5), fingersL=(-0.55, -0.45, 0.70), palmL=(-0.6, 0.7, 0.2),
    braid=(0, 0, 0, 0),
)


def pose(base=None, **kw):
    p = dict(LISTO if base is None else base)
    p.update(kw)
    return p


def mix(a, b, w, only=None, skip=()):
    """Mezcla dos poses control por control. `only`/`skip` limitan qué controles se mezclan."""
    out = dict(a)
    for k in a:
        if k in skip or (only is not None and k not in only):
            continue
        out[k] = lerpv(a[k], b[k], w)
    return out


def add(p, **kw):
    """Suma desplazamientos a algunos controles de una pose."""
    out = dict(p)
    for k, d in kw.items():
        out[k] = tuple(x + y for x, y in zip(out[k], d))
    return out


def anchor(p, bone, offset):
    """Punto del espacio del personaje que cae en `offset` del marco de un hueso, con la pose p.

    Sirve para llevar una mano a la cabeza, al pie o a la pala sin adivinar coordenadas.
    """
    P, R = rig.solve(p)[bone]
    return tuple(P + R @ Vector(offset))


def _tangent(pa, pb, pc, ta, tb, tc, clamp):
    d1 = (pb - pa) / max(1e-6, tb - ta)
    d2 = (pc - pb) / max(1e-6, tc - tb)
    if clamp and d1 * d2 <= 1e-12:
        return 0.0
    return 0.5 * (d1 + d2)


class Clip:
    """Un clip de animación.

    group: 'base' | 'locomocion' | 'golpe' | 'reaccion' | 'mania'
    contact: instante del impacto (golpes). hold: (t0, t1) del armado, el tramo que se puede estirar.
    stride, dir: metros por ciclo y dirección (x, y) en ejes del personaje, para los loops que avanzan.
    root_fn: t -> (dx, dy) recorridos desde el inicio, para las transiciones que avanzan.
    steps: apoyos [(pie, desde, hasta)] en segundos (en los loops, dentro del ciclo).
    extra: metadatos que pasan tal cual al exportador.
    """

    def __init__(self, name, dur, keys=None, fn=None, loop=False, contact=None, label=None, group='base',
                 stride=None, dir=None, root_fn=None, steps=None, hold=None, faces=None, **extra):
        self.name, self.dur, self.loop, self.contact, self.label, self.group = name, dur, loop, contact, label, group
        self.keys = sorted(keys, key=lambda k: k[0]) if keys else None     # (t, pose, hold)
        self.fn = fn
        self.stride, self.dir, self.root_fn = stride, dir, root_fn
        self.steps, self.hold, self.faces, self.extra = steps, hold, faces or [], extra

    def root(self, t):
        """Desplazamiento de la raíz desde el inicio del clip, en ejes del personaje."""
        if self.root_fn is not None:
            return self.root_fn(max(0.0, min(self.dur, t)))
        if self.stride:
            d = self.stride * t / self.dur
            return (self.dir[0] * d, self.dir[1] * d)
        return (0.0, 0.0)

    def sample(self, t):
        if self.loop:
            t = t % self.dur
        else:
            t = max(0.0, min(self.dur, t))
        if self.fn is not None:
            return self.fn(t)
        ks = self.keys
        n = len(ks)

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
        e1 = (not self.loop) and i == 0
        e2 = (not self.loop) and i + 1 >= n - 1
        out = {}
        for name in k1[1]:
            a, b = k1[1][name], k2[1][name]
            p0, p3 = k0[1][name], k3[1][name]
            foot = name in FEET
            clamp = foot or name in FEET_ROT
            vals = []
            for c in range(len(a)):
                # un pie apoyado no se mueve: en una clave con el pie en el piso, la velocidad es cero
                g1 = k1[2] or e1 or (foot and a[2] <= 1e-4)
                g2 = k2[2] or e2 or (foot and b[2] <= 1e-4)
                m1 = 0.0 if g1 else _tangent(p0[c], a[c], b[c], k0[0], k1[0], k2[0], clamp)
                m2 = 0.0 if g2 else _tangent(a[c], b[c], p3[c], k1[0], k2[0], k3[0], clamp)
                uu = u
                if foot and c < 2:
                    # al despegar, el pie primero se levanta y después se va; al caer, primero llega y después baja
                    if a[2] <= 1e-4 < b[2]:
                        uu = u * u * (2.0 - u)
                    elif b[2] <= 1e-4 < a[2]:
                        uu = 1.0 - (1.0 - u) ** 2 * (1.0 + u)
                vals.append(hermite(a[c], span * m1, b[c], span * m2, uu))
            if foot and a[2] <= 1e-4 and b[2] <= 1e-4:
                # el pie cambia de lugar entre dos claves apoyadas: da el paso por el aire, no arrastra
                dist = math.hypot(b[0] - a[0], b[1] - a[1])
                if dist > 0.004:
                    vals[2] += min(0.15, 0.03 + 0.20 * dist) * math.sin(math.pi * u)
            out[name] = tuple(vals)
        return out


def K(t, p, hold=False):
    return (t, p, hold)


def ball_of(solved, side):
    """Posición real de la bola del pie después de resolver la pierna."""
    return solved['toe.' + side][0]


def slip(clip, fps=120, ground=0.004):
    """Cuánto patina cada pie: lo que se mueve la bola del pie respecto del piso mientras está apoyada.

    Devuelve {pie: (máximo por cuadro en mm, total en mm, fracción del clip apoyado)}.
    """
    n = int(round(clip.dur * fps))
    out = {}
    prev = {}
    acc = {s: [0.0, 0.0, 0] for s in 'LR'}
    rest_z = rig.REST['toe.L'].z
    for f in range(n + 1):
        t = f / fps
        if clip.loop and f == n:
            t = clip.dur - 1e-9
        s = rig.solve(clip.sample(t))
        rx, ry = clip.root(t)
        for side in 'LR':
            b = ball_of(s, side)
            down = (b.z - rest_z) < ground
            w = (b.x + rx, b.y + ry)
            if down and prev.get(side) is not None:
                d = math.hypot(w[0] - prev[side][0], w[1] - prev[side][1]) * 1000.0
                acc[side][0] = max(acc[side][0], d)
                acc[side][1] += d
                acc[side][2] += 1
            prev[side] = w if down else None
    for side in 'LR':
        out[side] = (acc[side][0], acc[side][1], acc[side][2] / float(n))
    return out
