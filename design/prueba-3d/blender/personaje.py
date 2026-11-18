"""Personaje base de la prueba 3D: jugadora de pádel estilizada, modelo propio.

Se construye en pose T mirando hacia -Y (izquierda del personaje = +X, arriba = +Z), en metros.
La ropa tapa todas las uniones: las piernas entran en el short, los brazos en las mangas, el
cuello en la remera, la muñeca en la muñequera y el tobillo en la media. Por eso cada pieza es
un tubo cerrado simple y no hace falta soldar nada.

RES controla el detalle: 1 = malla de juego (tiempo real), 2 = malla para renderizar sprites.
"""
import math

from mathutils import Matrix, Vector

from comun import (Part, band_decal, bvh_of, catmull, circle_pts, decal, ellipsoid, lerp, plate, ring_point,
                   smooth, sweep)

HS = 1.18                      # escala de la cabeza (≈ 6,3 cabezas de alto)
HEAD = Vector((0.0, 0.006, 1.462))

# Articulaciones en reposo (lado izquierdo; el derecho es el espejo en X).
JOINTS = {
    'hips': (0.0, 0.0, 0.95),
    'spine': (0.0, 0.008, 1.07),
    'chest': (0.0, 0.008, 1.22),
    'neck': (0.0, 0.014, 1.405),
    'head': tuple(HEAD),
    'clav.L': (0.035, 0.0, 1.375),
    'upper_arm.L': (0.178, 0.0, 1.382),
    'forearm.L': (0.448, 0.0, 1.382),
    'hand.L': (0.692, 0.0, 1.382),
    'thigh.L': (0.095, 0.004, 0.925),
    'shin.L': (0.087, -0.004, 0.495),
    'foot.L': (0.081, 0.014, 0.088),
    'toe.L': (0.081, -0.1205, 0.034),
    'braid1': (0.0, 0.125, 1.63),
    'braid2': (0.0, 0.158, 1.47),
    'braid3': (0.0, 0.150, 1.31),
}
PARENT = {
    'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
    'clav.L': 'chest', 'upper_arm.L': 'clav.L', 'forearm.L': 'upper_arm.L', 'hand.L': 'forearm.L',
    'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L', 'toe.L': 'foot.L',
    'braid1': 'head', 'braid2': 'braid1', 'braid3': 'braid2',
}
HAND_K = 1.20                  # manos algo sobredimensionadas (se leen mejor en chico)
SHOE_K = 1.13                  # zapatillas grandes: la pierna se ensancha al llegar al pie
WRIST = Vector(JOINTS['hand.L'])
GRIP0 = Vector((0.762, 0.0, 1.352))  # centro del mango dentro del puño, antes de escalar la mano
GRIP = WRIST + (GRIP0 - WRIST) * HAND_K
ANKLE0 = Vector((0.081, 0.014, 0.0))


def scale_about(part, center, k, pred=None):
    for i, v in enumerate(part.verts):
        if pred is None or pred(v):
            part.verts[i] = center + (v - center) * k
    return part


def skeleton():
    """Devuelve (nombres en orden padre→hijo, posiciones, padres), con los dos lados y la pala."""
    names, pos, par = [], {}, {}
    order = ['hips', 'spine', 'chest', 'neck', 'head', 'braid1', 'braid2', 'braid3']
    for b in order:
        names.append(b)
        pos[b] = Vector(JOINTS[b])
        par[b] = PARENT[b]
    for side, sx in (('.L', 1.0), ('.R', -1.0)):
        for b in ('clav', 'upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe'):
            j = Vector(JOINTS[b + '.L'])
            names.append(b + side)
            pos[b + side] = Vector((j.x * sx, j.y, j.z))
            p = PARENT[b + '.L']
            par[b + side] = p.replace('.L', side) if p.endswith('.L') else p
    names.append('racket')
    pos['racket'] = Vector((-GRIP.x, GRIP.y, GRIP.z))
    par['racket'] = 'hand.R'
    return names, pos, par


# ---------------------------------------------------------------------------
# Perfiles
# ---------------------------------------------------------------------------
# Pierna izquierda: z, centro x, centro y, rx, radio frente, radio atrás
LEG = [
    (0.930, 0.095, 0.004, 0.083, 0.086, 0.092),
    (0.800, 0.094, 0.003, 0.079, 0.083, 0.086),
    (0.680, 0.092, 0.000, 0.067, 0.075, 0.071),
    (0.575, 0.089, -0.003, 0.054, 0.061, 0.056),
    (0.525, 0.088, -0.004, 0.047, 0.052, 0.049),
    (0.495, 0.087, -0.005, 0.0455, 0.0545, 0.0455),   # rodilla: la rótula empuja al frente
    (0.458, 0.086, -0.003, 0.042, 0.047, 0.044),
    (0.405, 0.085, 0.002, 0.044, 0.040, 0.054),
    (0.345, 0.084, 0.005, 0.046, 0.037, 0.062),       # gemelo
    (0.265, 0.083, 0.008, 0.038, 0.033, 0.047),
    (0.185, 0.082, 0.011, 0.030, 0.029, 0.035),
    (0.125, 0.081, 0.013, 0.0265, 0.027, 0.030),      # tobillo fino
    (0.088, 0.081, 0.014, 0.030, 0.029, 0.032),       # maléolos
    (0.050, 0.081, 0.014, 0.029, 0.029, 0.031),
]


def profile_at(table, z):
    """Interpola una tabla de perfiles ordenada por z descendente."""
    if z >= table[0][0]:
        return table[0]
    if z <= table[-1][0]:
        return table[-1]
    for i in range(len(table) - 1):
        a, b = table[i], table[i + 1]
        if a[0] >= z >= b[0]:
            t = (a[0] - z) / (a[0] - b[0])
            p0 = table[max(0, i - 1)]
            p3 = table[min(len(table) - 1, i + 2)]
            return tuple(catmull(p0[k], a[k], b[k], p3[k], t) if k else z for k in range(len(a)))
    return table[-1]


# Cabeza (local al hueso `head`, antes de escalar por HS): dz, cy, rx, rf, rb, e
HEADP = [
    (0.004, 0.006, 0.050, 0.058, 0.062, 1.9),
    (0.014, 0.000, 0.060, 0.080, 0.074, 1.8),
    (0.028, -0.002, 0.068, 0.090, 0.082, 1.8),
    (0.055, -0.001, 0.077, 0.096, 0.090, 1.9),
    (0.085, 0.000, 0.083, 0.098, 0.097, 2.0),
    (0.118, 0.000, 0.086, 0.096, 0.103, 2.0),
    (0.150, 0.000, 0.086, 0.097, 0.105, 2.0),
    (0.185, 0.002, 0.082, 0.092, 0.103, 2.0),
    (0.215, 0.004, 0.070, 0.076, 0.090, 2.0),
    (0.238, 0.006, 0.048, 0.050, 0.062, 2.0),
]


def head_profile(dz):
    t = HEADP
    if dz <= t[0][0]:
        return t[0]
    if dz >= t[-1][0]:
        return t[-1]
    for i in range(len(t) - 1):
        a, b = t[i], t[i + 1]
        if a[0] <= dz <= b[0]:
            u = (dz - a[0]) / (b[0] - a[0])
            p0, p3 = t[max(0, i - 1)], t[min(len(t) - 1, i + 2)]
            return tuple(catmull(p0[k], a[k], b[k], p3[k], u) if k else dz for k in range(len(a)))
    return t[-1]


def head_point(dz, ang, grow=0.0):
    """Punto de la superficie de la cabeza (mundo) a una altura local dz y un ángulo de anillo."""
    _dz, cy, rx, rf, rb, e = head_profile(dz)
    x, y = ring_point(ang, rx + grow, rf + grow, rb + grow, e)
    return HEAD + Vector((x, cy + y, dz)) * HS


def H(x, y, dz):
    """Coordenadas locales de la cabeza → mundo."""
    return HEAD + Vector((x, y, dz)) * HS


# ---------------------------------------------------------------------------
# Piezas
# ---------------------------------------------------------------------------

def build(res=1):
    """Arma todas las piezas. Devuelve la lista de Part."""
    R = res
    st = 1 if R < 2 else 2          # subdivisiones a lo largo

    def N(n):
        return int(round(n * (1.0 if R < 2 else 1.6) / 2)) * 2

    parts = []

    # --- Pierna izquierda -------------------------------------------------
    leg = Part('leg.L')
    sweep(leg, [dict(p=(cx, cy, z), rx=rx, rf=rf, rb=rb) for z, cx, cy, rx, rf, rb in [profile_at(LEG, 0.865)] + LEG[1:]],
          n=N(10), steps=st + 1, mat='skin', cap0='flat', cap1='flat')

    def w_leg(co, m):
        knee = smooth(0.545, 0.445, co.z)
        ank = smooth(0.118, 0.070, co.z)
        return {'thigh.L': 1 - knee, 'shin.L': knee * (1 - ank), 'foot.L': knee * ank}
    leg.set_weights(w_leg)
    parts.append(leg)

    # --- Media ------------------------------------------------------------
    sock = Part('sock.L')
    secs = []
    for z in (0.238, 0.232, 0.205, 0.16, 0.115, 0.075, 0.055):
        _z, cx, cy, rx, rf, rb = profile_at(LEG, z)
        g = 0.0075 if z > 0.2 else 0.0052
        secs.append(dict(p=(cx, cy, z), rx=rx + g, rf=rf + g, rb=rb + g, sharp=z > 0.2))
    sweep(sock, secs, n=N(10), steps=st, mat='sock', cap0='flat', cap1='flat')
    sock.set_weights(lambda co, m: {'shin.L': 1 - smooth(0.118, 0.070, co.z), 'foot.L': smooth(0.118, 0.070, co.z)})
    parts.append(sock)

    # --- Zapatilla --------------------------------------------------------
    x0 = 0.081
    toe_w = lambda co, m: {'foot.L': 1 - smooth(-0.085, -0.125, co.y), 'toe.L': smooth(-0.085, -0.125, co.y)}

    sole = Part('sole.L')
    SOLE = [  # y, medio ancho, z abajo, z arriba
        (0.094, 0.022, 0.004, 0.036), (0.078, 0.036, 0.000, 0.037), (0.045, 0.042, 0.000, 0.036),
        (0.000, 0.040, 0.000, 0.034), (-0.050, 0.043, 0.000, 0.031), (-0.105, 0.053, 0.000, 0.029),
        (-0.155, 0.052, 0.002, 0.029), (-0.190, 0.043, 0.007, 0.031), (-0.210, 0.027, 0.012, 0.032),
    ]
    sweep(sole, [dict(p=(x0, y, (zb + zt) / 2), rx=w, ry=(zt - zb) / 2, e=5.0) for y, w, zb, zt in SOLE],
          n=N(10), steps=st, mat='shoe_sole', front=(0, 0, -1), capk=0.9)
    sole.set_weights(toe_w)
    parts.append(scale_about(sole, ANKLE0, SHOE_K))

    upper = Part('upper.L')
    UP = [  # y, medio ancho, altura sobre z=0.028
        (0.088, 0.017, 0.048), (0.072, 0.031, 0.078), (0.045, 0.037, 0.088), (0.010, 0.037, 0.082),
        (-0.030, 0.037, 0.086), (-0.070, 0.041, 0.066), (-0.110, 0.047, 0.047), (-0.148, 0.047, 0.036),
        (-0.180, 0.040, 0.030), (-0.199, 0.025, 0.022),
    ]

    def up_mat(s, ang):
        if s >= 6.9:
            return 'shoe_cap'
        if s < 1.6 and 0.6 < ang < math.pi - 0.6:
            return 'shoe_accent'
        return 'shoe_upper'
    sweep(upper, [dict(p=(x0, y, 0.028), rx=w, rb=h, rf=0.014, e=2.7, sharp=(i in (7,)))
                  for i, (y, w, h) in enumerate(UP)],
          n=N(12), steps=st, mat=up_mat, front=(0, 0, -1), capk=0.8)
    upper.set_weights(toe_w)
    parts.append(scale_about(upper, ANKLE0, SHOE_K))

    collar = Part('collar.L')
    csecs = []
    for k in range(10):
        th = 2 * math.pi * k / 10
        csecs.append(dict(p=(x0 + 0.035 * math.cos(th), 0.018 + 0.047 * math.sin(th), 0.112 + 0.007 * math.sin(th)),
                          rx=0.0105, ry=0.0125))
    sweep(collar, csecs, n=N(6), steps=1, closed=True, mat='shoe_collar', frames=lambda s: (0, 0, 1))
    collar.rigid('foot.L')
    parts.append(scale_about(collar, ANKLE0, SHOE_K))

    tongue = Part('tongue.L')
    sweep(tongue, [dict(p=(x0, -0.050, 0.094), rx=0.022, ry=0.008, e=3), dict(p=(x0, -0.034, 0.112), rx=0.025, ry=0.009, e=3),
                   dict(p=(x0, -0.020, 0.134), rx=0.023, ry=0.008, e=3)], n=N(8), steps=st, mat='shoe_tongue', front=(0, -1, 0.2), capk=0.5)
    tongue.rigid('foot.L')
    parts.append(scale_about(tongue, ANKLE0, SHOE_K))

    for y in (-0.062, -0.086, -0.110):
        # cordones: barras que siguen el lomo del empeine
        hh = [h for yy, w, h in UP]
        yy = [u[0] for u in UP]
        i = max(k for k in range(len(yy) - 1) if yy[k] >= y)
        t = (yy[i] - y) / (yy[i] - yy[i + 1])
        top = 0.028 + lerp(hh[i], hh[i + 1], t)
        wd = lerp(UP[i][1], UP[i + 1][1], t) * 0.62
        lace = Part('lace.L')
        sweep(lace, [dict(p=(x0 - wd, y, top - 0.012), r=0.0042), dict(p=(x0, y, top + 0.0015), r=0.0046),
                     dict(p=(x0 + wd, y, top - 0.012), r=0.0042)], n=N(6), steps=st, mat='shoe_tongue', front=(0, -1, 0), capk=0.6)
        lace.set_weights(toe_w)
        lace.set_outline(0.0)
        parts.append(scale_about(lace, ANKLE0, SHOE_K))

    # --- Short ------------------------------------------------------------
    shorts = Part('shorts')
    SH = [(1.098, 0.120, 0.087, 0.093, 2.2, True), (1.066, 0.126, 0.091, 0.097, 2.2, True), (1.00, 0.144, 0.098, 0.110, 2.2, False),
          (0.94, 0.166, 0.103, 0.123, 2.3, False), (0.885, 0.150, 0.098, 0.116, 2.4, False), (0.842, 0.105, 0.086, 0.098, 2.4, False)]
    sweep(shorts, [dict(p=(0, 0.004, z), rx=rx, rf=rf, rb=rb, e=e, sharp=sh) for z, rx, rf, rb, e, sh in SH],
          n=N(14), steps=st, mat=lambda s, a: 'shorts_band' if s < 1.0 else 'shorts', cap0='flat', cap1='round', capk=0.25)

    def w_shorts(co, m):
        sp = smooth(1.03, 1.10, co.z) * 0.6
        return {'hips': 1 - sp, 'spine': sp}
    shorts.set_weights(w_shorts)
    parts.append(shorts)

    # perneras: nacen en la cadera y bajan hasta el ruedo; arriba siguen a la pelvis y abajo al muslo,
    # así la tela acompaña la pierna sin despegarse del short
    sleg = Part('shorts_leg.L')
    SL = [dict(p=(0.056, 0.006, 1.020), rx=0.078, rf=0.084, rb=0.092), dict(p=(0.080, 0.006, 0.955), rx=0.092, rf=0.098, rb=0.113),
          dict(p=(0.092, 0.005, 0.900), rx=0.091, rf=0.095, rb=0.107)]
    for z in (0.84, 0.775, 0.752):
        _z, cx, cy, rx, rf, rb = profile_at(LEG, z)
        g = 0.0065 if z > 0.8 else 0.0090
        SL.append(dict(p=(cx, cy, z), rx=rx + g, rf=rf + g, rb=rb + g, sharp=z < 0.76))
    sweep(sleg, SL, n=N(10), steps=st + 1, mat='shorts', cap0='flat', cap1='flat')
    sleg.set_weights(lambda co, m: {'hips': 1 - smooth(0.965, 0.855, co.z), 'thigh.L': smooth(0.965, 0.855, co.z)})
    parts.append(sleg)

    # --- Remera -----------------------------------------------------------
    shirt = Part('shirt')
    SHIRT = [  # z, rx, rf, rb, e
        (0.995, 0.160, 0.116, 0.124, 2.3), (1.030, 0.156, 0.113, 0.121, 2.3), (1.100, 0.137, 0.101, 0.106, 2.2),
        (1.190, 0.143, 0.108, 0.105, 2.3), (1.275, 0.160, 0.124, 0.111, 2.5), (1.345, 0.171, 0.113, 0.110, 2.8),
        (1.395, 0.172, 0.090, 0.095, 3.0), (1.428, 0.122, 0.070, 0.077, 2.4), (1.448, 0.074, 0.060, 0.064, 2.0),
        (1.459, 0.066, 0.056, 0.060, 2.0),
    ]

    def shirt_at(z):
        t = SHIRT
        for i in range(len(t) - 1):
            a, b = t[i], t[i + 1]
            if a[0] <= z <= b[0]:
                u = (z - a[0]) / (b[0] - a[0])
                p0, p3 = t[max(0, i - 1)], t[min(len(t) - 1, i + 2)]
                return tuple(catmull(p0[k], a[k], b[k], p3[k], u) if k else z for k in range(5))
        return t[-1]
    stripes = [(1.208, 1.236), (1.250, 1.292)]
    zs = [0.995, 1.012, 1.05, 1.10, 1.155, 1.208, 1.236, 1.250, 1.292, 1.33, 1.365, 1.395, 1.415, 1.432, 1.448, 1.459]
    if R >= 2:
        extra = []
        for a, b in zip(zs[:-1], zs[1:]):
            if b - a > 0.03:
                extra.append((a + b) / 2)
        zs = sorted(zs + extra)

    def shirt_mat(s, ang):
        z = lerp(zs[int(s)], zs[min(len(zs) - 1, int(s) + 1)], s - int(s))
        for a, b in stripes:
            if a < z < b:
                return 'shirt_stripe'
        if z > 1.448:
            return 'shirt_trim'
        if z < 1.012:
            return 'shirt_trim'
        return 'shirt'
    sweep(shirt, [dict(p=(0, 0.008, z), rx=shirt_at(z)[1], rf=shirt_at(z)[2], rb=shirt_at(z)[3], e=shirt_at(z)[4], sharp=True)
                  for z in zs], n=N(16), steps=1, mat=shirt_mat, cap0='flat', cap1='flat')

    def w_shirt(co, m):
        hips = 1 - smooth(1.00, 1.10, co.z)
        chest = smooth(1.13, 1.25, co.z)
        spine = max(0.0, 1 - hips - chest)
        neck = smooth(1.425, 1.455, co.z) * smooth(0.10, 0.06, abs(co.x)) * 0.5
        cl = smooth(0.09, 0.165, abs(co.x)) * smooth(1.30, 1.385, co.z) * 0.75
        b = 'clav.L' if co.x > 0 else 'clav.R'
        return {'hips': hips, 'spine': spine, 'chest': chest * (1 - cl) * (1 - neck), b: chest * cl, 'neck': chest * neck}
    shirt.set_weights(w_shirt)
    parts.append(shirt)

    sleeve = Part('sleeve.L')
    sweep(sleeve, [dict(p=(0.135, 0.0, 1.376), r=0.050), dict(p=(0.190, 0.0, 1.380), rx=0.058, ry=0.056),
                   dict(p=(0.250, 0.0, 1.380), rx=0.055, ry=0.054), dict(p=(0.300, 0.0, 1.380), rx=0.0535, ry=0.0525, sharp=True),
                   dict(p=(0.320, 0.0, 1.380), rx=0.054, ry=0.053, sharp=True)],
          n=N(10), steps=st + 1, mat=lambda s, a: 'shirt_trim' if s > 3.0 else 'shirt', cap0='round', cap1='flat')
    sleeve.set_weights(lambda co, m: {'clav.L': smooth(0.20, 0.15, co.x) * 0.6, 'upper_arm.L': 1 - smooth(0.20, 0.15, co.x) * 0.6})
    parts.append(sleeve)

    # --- Brazo y palma (una sola pieza: no hay costura en la muñeca) ---------
    def arm_w(co, m):
        el = smooth(0.410, 0.486, co.x)
        wr = smooth(0.672, 0.712, co.x)
        return {'upper_arm.L': 1 - el, 'forearm.L': el * (1 - wr), 'hand.L': el * wr}

    ARM = [(0.240, 0.049, 0.049, 0.049, 2.0), (0.300, 0.047, 0.047, 0.046, 2.0), (0.360, 0.043, 0.043, 0.041, 2.0),
           (0.420, 0.037, 0.037, 0.037, 2.0), (0.448, 0.036, 0.035, 0.039, 2.0), (0.500, 0.040, 0.041, 0.040, 2.0),
           (0.570, 0.034, 0.036, 0.036, 2.0), (0.640, 0.0245, 0.0305, 0.0305, 2.1), (0.692, 0.0200, 0.0285, 0.0285, 2.3)]
    PALM = [(0.725, 0.0165, 0.040, 0.038, 2.7), (0.760, 0.0155, 0.045, 0.042, 3.0), (0.787, 0.0125, 0.043, 0.040, 3.0)]
    az = 1.382

    def arm_part(name, grip):
        arm = Part(name)
        secs = [dict(p=(x, 0, az), rx=rx, rf=rf, rb=rb, e=e) for x, rx, rf, rb, e in ARM]
        if grip:
            # puño: la palma se acorta y se curva sobre el mango
            secs += [dict(p=(0.722, 0, az - 0.002), rx=0.0185, rf=0.040, rb=0.038, e=2.7),
                     dict(p=(0.752, 0, az + 0.000), rx=0.0185, rf=0.044, rb=0.041, e=3.0),
                     dict(p=(0.778, 0, az - 0.006), rx=0.0150, rf=0.042, rb=0.039, e=3.0)]
        else:
            secs += [dict(p=(x, 0, az), rx=rx, rf=rf, rb=rb, e=e) for x, rx, rf, rb, e in PALM]
        sweep(arm, secs, n=N(8), steps=st + 1, mat='skin', cap0='flat', cap1='round', capk=0.7)
        arm.set_weights(arm_w)
        return scale_about(arm, WRIST, HAND_K, lambda v: v.x > WRIST.x)

    def finger(part, pts, r0, r1, n=6):
        secs = []
        for i, p in enumerate(pts):
            t = i / (len(pts) - 1)
            secs.append(dict(p=p, r=lerp(r0, r1, t)))
        sweep(part, secs, n=N(n) if R >= 2 else n, steps=st, mat='skin', front=(0, 0, 1), cap0='flat', cap1='round', capk=0.9)

    # mano abierta (izquierda)
    armL = arm_part('arm.L', False)
    handL = Part('fingers.L')
    for y, x, L, spread in ((-0.030, 0.781, 0.074, -5), (-0.0095, 0.787, 0.082, -1), (0.011, 0.783, 0.076, 3), (0.030, 0.773, 0.060, 8)):
        pts = [Vector((x - 0.012, y, az))]
        ang, pos = 0.0, Vector((x, y, az))
        pts.append(pos.copy())
        sp = math.radians(spread)
        for seg, bend in ((0.45, 14), (0.30, 22), (0.25, 18)):
            ang += math.radians(bend)
            d = Vector((math.cos(ang) * math.cos(sp), math.sin(sp), -math.sin(ang)))
            pos = pos + d * (L * seg)
            pts.append(pos.copy())
        finger(handL, pts, 0.0098, 0.0072)
    tb = Vector((0.716, -0.030, az - 0.004))
    td = Vector((0.52, -0.82, -0.22)).normalized()
    finger(handL, [tb - td * 0.012, tb + td * 0.018, tb + td * 0.042 + Vector((0.004, 0, -0.004)), tb + td * 0.064 + Vector((0.012, 0, -0.010))], 0.0128, 0.0088)
    handL.rigid('hand.L').set_outline(0.45)
    scale_about(handL, WRIST, HAND_K)
    parts += [armL, handL]

    # mano que agarra la pala (se arma del lado izquierdo y se espeja)
    armG = arm_part('arm.G', True)
    handG = Part('fingers.G')
    cx, cz, rr = GRIP0.x, GRIP0.z, 0.0268
    for y in (-0.031, -0.0105, 0.010, 0.029):
        pts = []
        for a in (62, 30, -8, -52, -98, -140, -176):
            a = math.radians(a)
            pts.append(Vector((cx + rr * math.cos(a) * (1.12 if a > 0.4 else 1.0), y, cz + rr * math.sin(a) * (1.18 if a > 0.4 else 1.0))))
        finger(handG, pts, 0.0100, 0.0082)
    finger(handG, [Vector((0.726, -0.034, az - 0.006)), Vector((0.742, -0.047, az + 0.001)), Vector((0.766, -0.052, az + 0.000)),
                   Vector((0.787, -0.049, az - 0.012)), Vector((0.794, -0.045, az - 0.028))], 0.0125, 0.0090)
    handG.rigid('hand.L').set_outline(0.45)
    scale_about(handG, WRIST, HAND_K)
    # derecha = espejo del puño; izquierda = mano abierta
    parts_right_hand = [armG.mirrored('arm.R'), handG.mirrored('fingers.R')]

    # --- Muñequera ----------------------------------------------------------
    band = Part('wrist.L')
    sweep(band, [dict(p=(0.646, 0, az), rx=0.0295, ry=0.0355, e=2.2, sharp=True), dict(p=(0.662, 0, az), rx=0.0290, ry=0.0355, e=2.2, sharp=True),
                 dict(p=(0.682, 0, az), rx=0.0275, ry=0.0350, e=2.3, sharp=True), dict(p=(0.698, 0, az), rx=0.0265, ry=0.0350, e=2.3, sharp=True)],
          n=N(10), steps=1, mat=lambda s, a: 'wrist_stripe' if 1.0 < s < 2.0 else 'wrist', cap0='flat', cap1='flat')
    band.rigid('forearm.L')
    parts.append(band)

    # --- Cabeza y cuello ------------------------------------------------------
    head = Part('head')
    hsecs = [dict(p=(0, 0.018, 1.385), rx=0.053, rf=0.050, rb=0.055), dict(p=(0, 0.013, 1.430), rx=0.047, rf=0.046, rb=0.050),
             dict(p=(0, 0.009, 1.462), rx=0.047, rf=0.047, rb=0.054)]
    for dz, cy, rx, rf, rb, e in HEADP:
        hsecs.append(dict(p=H(0, cy, dz), rx=rx * HS, rf=rf * HS, rb=rb * HS, e=e))
    sweep(head, hsecs, n=N(16), steps=st + 1, mat='skin', cap0='flat', cap1='round', capk=0.55)

    def w_head(co, m):
        hd = smooth(1.445, 1.490, co.z)
        ch = smooth(1.425, 1.395, co.z)
        return {'head': hd, 'neck': (1 - hd) * (1 - ch), 'chest': (1 - hd) * ch}
    head.set_weights(w_head)
    parts.append(head)
    bvh = bvh_of(head)

    # nariz: cuña redondeada, sin contorno para que no quede un aro alrededor
    nose = Part('nose')
    sweep(nose, [dict(p=H(0, -0.086, 0.124), rx=0.0070, ry=0.0060), dict(p=H(0, -0.099, 0.108), rx=0.0090, ry=0.0080),
                 dict(p=H(0, -0.1085, 0.090), rx=0.0128, ry=0.0105)], n=N(6), steps=st + 1, mat='skin', cap0='flat', cap1='round', capk=0.85)
    nose.rigid('head').set_outline(0.0)
    parts.append(nose)

    for sx in (1, -1):
        ear = Part('ear')
        ellipsoid(ear, H(sx * 0.0865, 0.014, 0.103), (0.011 * HS, 0.017 * HS, 0.027 * HS), n=N(8), rings=4 if R < 2 else 6, mat='skin')
        ear.rigid('head').set_outline(0.55)
        parts.append(ear)

    # cara: calcos proyectados sobre la cabeza
    face = Part('face')
    zeye, off = 0.1165, 0.0
    for sx in (1, -1):
        ex = sx * 0.0335
        cz = HEAD.z + zeye * HS
        # blanco: abajo redondo, arriba más chato (lo corta el párpado)
        white = []
        for k in range(14):
            th = 2 * math.pi * k / 14
            rz = 0.0088 if math.sin(th) > 0 else 0.0118
            x, z = ring_point(th, 0.0170, rz, rz, 2.4)
            white.append((ex * HS + x * HS, -0.4, cz + z * HS))
        decal(face, bvh, white, 0.0011, mat='eye_white')
        ix = ex - sx * 0.0016
        decal(face, bvh, circle_pts(ix * HS, cz + 0.0002 * HS, 0.0086 * HS, 0.0090 * HS, -0.4, n=10), 0.0019, mat='ink')
        decal(face, bvh, circle_pts((ix + 0.0032) * HS, cz + 0.0036 * HS, 0.0025 * HS, 0.0025 * HS, -0.4, n=6), 0.0026, mat='eye_white')
        # párpado superior: arco grueso con una pestaña corta hacia afuera
        lid = []
        for k in range(8):
            th = math.radians(lerp(178, 2, k / 7))
            lid.append((ex * HS + 0.0182 * HS * math.cos(th), -0.4, cz + 0.0015 * HS + 0.0094 * HS * math.sin(th)))
        wl = [0.0030, 0.0046, 0.0058, 0.0062, 0.0062, 0.0058, 0.0046, 0.0030]
        if sx > 0:
            wl[-1] = 0.0052          # pestaña del lado de afuera
        else:
            wl[0] = 0.0052
        band_decal(face, bvh, lid, [w * HS for w in wl], 0.0023, mat='ink')
        # ceja: baja hacia el entrecejo (decidida) y se afina hacia afuera
        brow = [((sx * 0.0110) * HS, -0.4, HEAD.z + 0.1345 * HS), ((sx * 0.0235) * HS, -0.4, HEAD.z + 0.1425 * HS),
                ((sx * 0.0390) * HS, -0.4, HEAD.z + 0.1470 * HS), ((sx * 0.0545) * HS, -0.4, HEAD.z + 0.1415 * HS)]
        band_decal(face, bvh, brow, [0.0070 * HS, 0.0084 * HS, 0.0070 * HS, 0.0032 * HS], 0.0017, mat='brow')
    mouth = [(-0.0200 * HS, -0.4, HEAD.z + 0.0545 * HS), (-0.0100 * HS, -0.4, HEAD.z + 0.0508 * HS), (0.0020 * HS, -0.4, HEAD.z + 0.0500 * HS),
             (0.0130 * HS, -0.4, HEAD.z + 0.0528 * HS), (0.0215 * HS, -0.4, HEAD.z + 0.0580 * HS)]
    band_decal(face, bvh, mouth, [0.0026 * HS, 0.0042 * HS, 0.0046 * HS, 0.0040 * HS, 0.0022 * HS], 0.0015, mat='mouth')
    face.rigid('head').set_outline(0.0)
    parts.append(face)

    # --- Pelo -------------------------------------------------------------
    def hairline(ang):
        """Altura local del nacimiento del pelo según el ángulo (0 = +X, 90° = nuca, 270° = frente)."""
        d = math.degrees(ang) % 360
        if d > 180:
            f = abs(d - 270)   # 0 en el frente, 90 en los costados
            pts = [(0, 0.176), (28, 0.172), (48, 0.158), (62, 0.128), (74, 0.100), (90, 0.130)]
        else:
            f = abs(d - 90)    # 0 en la nuca, 90 en los costados
            pts = [(0, 0.040), (35, 0.046), (62, 0.072), (80, 0.110), (90, 0.130)]
        for (a0, h0), (a1, h1) in zip(pts[:-1], pts[1:]):
            if a0 <= f <= a1:
                return lerp(h0, h1, smooth(a0, a1, f))
        return pts[-1][1]

    hair = Part('hair')
    nh = N(18)
    dzs = [0.030, 0.050, 0.070, 0.090, 0.110, 0.128, 0.146, 0.162, 0.176, 0.190, 0.205]
    if R >= 2:
        dzs = sorted(dzs + [(a + b) / 2 for a, b in zip(dzs[:-1], dzs[1:])])
    grid = []
    for dz in dzs:
        row = []
        for k in range(nh):
            ang = 2 * math.pi * k / nh
            hl = hairline(ang)
            back = max(0.0, math.sin(ang))
            grow = 0.0075 + 0.0075 * back + 0.003 * smooth(0.15, 0.205, dz)
            if dz >= hl:
                co = head_point(dz, ang, grow)
                vis = 1.0
            else:
                # debajo del nacimiento: se pega al borde y se mete en la cabeza
                co = head_point(hl, ang, grow * (1.0 if dz > hl - 0.025 else -0.6))
                co.z -= (0.0 if dz > hl - 0.025 else 0.01)
                vis = 0.0
            row.append(hair.add_vert(co, s=dz, a=ang, u=vis))
        grid.append(row)
    for i in range(len(grid) - 1):
        for k in range(nh):
            k2 = (k + 1) % nh
            hair.add_face((grid[i][k], grid[i][k2], grid[i + 1][k2], grid[i + 1][k]), 'hair')
    # coronilla: cúpula elíptica lisa desde dz = 0.205 (sin seguir el perfil de la cabeza, que arriba hace un escalón)
    for phi in (20, 38, 55, 71):
        row = []
        for k in range(nh):
            ang = 2 * math.pi * k / nh
            back = max(0.0, math.sin(ang))
            base = head_point(0.205, ang, 0.0105 + 0.0075 * back)
            c = H(0, 0.006, 0.205)
            co = c + (base - c) * math.cos(math.radians(phi)) + Vector((0, 0, 0.071 * HS * math.sin(math.radians(phi))))
            row.append(hair.add_vert(co, s=0.25, a=ang, u=1))
        for k in range(nh):
            k2 = (k + 1) % nh
            hair.add_face((grid[-1][k], grid[-1][k2], row[k2], row[k]), 'hair')
        grid.append(row)
    top = hair.add_vert(H(0, 0.006, 0.205 + 0.0725), s=0.262, a=0, u=1)
    for k in range(nh):
        hair.add_face((grid[-1][k], grid[-1][(k + 1) % nh], top), 'hair')
    hair.rigid('head')
    parts.append(hair)

    # trenza: tubo con bultos alternados; nace arriba de la tira de la visera
    braid = Part('braid')
    path = [Vector((0, 0.078, 1.668)), Vector((0, 0.128, 1.652)), Vector((0, 0.158, 1.585)), Vector((0, 0.163, 1.490)),
            Vector((0, 0.156, 1.390)), Vector((0, 0.150, 1.290)), Vector((0, 0.147, 1.205)), Vector((0, 0.146, 1.150))]
    samples = 30 if R < 2 else 54
    bsecs, tie_s = [], None
    for i in range(samples + 1):
        t = i / samples
        f = t * (len(path) - 1)
        j = min(len(path) - 2, int(f))
        u = f - j
        p = catmull(path[max(0, j - 1)], path[j], path[j + 1], path[min(len(path) - 1, j + 2)], u)
        base = lerp(0.033, 0.021, smooth(0.05, 0.80, t))
        if t > 0.86:
            base = lerp(0.020, 0.006, smooth(0.86, 1.0, t))      # mechón final
        bulge = 1.0 + (0.20 * abs(math.sin(math.pi * t * 9.0)) if 0.10 < t < 0.80 else 0.0)
        zig = 0.0075 * math.sin(math.pi * t * 9.0) if 0.10 < t < 0.80 else 0.0
        tie = 0.80 <= t <= 0.86
        r = 0.0165 if tie else base * bulge
        bsecs.append(dict(p=p + Vector((zig, 0, 0)), rx=r, ry=r * 0.86, sharp=tie))
    n_b = len(bsecs)
    sweep(braid, bsecs, n=N(8), steps=1, mat=lambda s, a: 'hair_tie' if 0.80 <= s / (n_b - 1) < 0.86 else 'hair', front=(0, 1, 0), cap0='flat', cap1='round')

    def w_braid(co, m):
        z = co.z
        a = smooth(1.66, 1.58, z)
        b = smooth(1.52, 1.42, z)
        c = smooth(1.36, 1.26, z)
        return {'head': 1 - a, 'braid1': a * (1 - b), 'braid2': a * b * (1 - c), 'braid3': a * b * c}
    braid.set_weights(w_braid)
    parts.append(braid)

    # --- Vincha ------------------------------------------------------------
    # Con la cámara alta del juego una visera tapa los ojos: va una vincha, que además se lee de espaldas.
    band_h = Part('headband')
    vsecs = []
    nv = 16
    for k in range(nv):
        ang = 2 * math.pi * k / nv
        dz = 0.1735 + 0.006 * math.sin(ang)      # sobre el nacimiento del pelo; sube un poco hacia la nuca
        vsecs.append(dict(p=head_point(dz, ang, 0.0105 + 0.007 * max(0.0, math.sin(ang))), rx=0.0050, ry=0.0135 * HS, e=4.0))
    sweep(band_h, vsecs, n=N(6), steps=1 if R < 2 else 2, closed=True, mat='headband', frames=lambda s: (0, 0, 1))
    band_h.rigid('head')
    parts.append(band_h)

    # --- Espejo del lado izquierdo ---------------------------------------------
    out = []
    for p in parts:
        out.append(p)
        if p.name.endswith('.L') and p.name not in ('arm.L', 'fingers.L'):
            out.append(p.mirrored())
    out += parts_right_hand

    # --- Pala (mano derecha) ----------------------------------------------------
    rk = Part('racket')
    RK = [  # y, medio ancho, medio espesor, e, sharp
        (0.058, 0.0215, 0.0195, 2.4, False), (0.044, 0.0190, 0.0172, 2.4, False), (-0.080, 0.0180, 0.0162, 2.4, True),
        (-0.086, 0.0205, 0.0172, 3.0, True), (-0.118, 0.036, 0.0180, 4.0, False), (-0.165, 0.084, 0.0190, 7.0, False),
        (-0.215, 0.115, 0.0190, 8.0, False), (-0.272, 0.126, 0.0190, 8.0, False), (-0.330, 0.115, 0.0190, 8.0, False),
        (-0.376, 0.086, 0.0185, 7.0, False), (-0.400, 0.048, 0.0170, 5.0, False),
    ]

    def rk_mat(s, ang):
        if s < 2.0:
            return 'racket_grip'
        if s < 4.6:
            return 'racket_frame'
        return 'racket_frame' if abs(math.cos(ang)) > 0.6 or s > 9.9 else 'racket_face'
    sweep(rk, [dict(p=(GRIP.x, y, GRIP.z), rx=w, ry=h, e=e, sharp=sh) for y, w, h, e, sh in RK],
          n=12 if R < 2 else 20, steps=st + 1, mat=rk_mat, front=(0, 0, -1), ang0=0.0, capk=0.5)
    # agujeros: calcos oscuros en las dos caras
    holes = []
    pitch = 0.031
    for row in range(-4, 5):
        for col in range(-4, 5):
            hx = (col + (0.5 if row % 2 else 0.0)) * pitch
            hy = -0.272 + row * pitch * 0.866
            if (hx / 0.092) ** 2 + ((hy + 0.272) / 0.098) ** 2 < 1.0:
                holes.append((hx, hy))
    for hx, hy in holes:
        for sgn in (1, -1):
            c = rk.add_vert((GRIP.x + hx, hy, GRIP.z + sgn * 0.0198), s=20, a=0, u=0)
            ring = [rk.add_vert((GRIP.x + hx + 0.0072 * math.cos(2 * math.pi * k / 6), hy + 0.0072 * math.sin(2 * math.pi * k / 6), GRIP.z + sgn * 0.0198), s=20, a=0, u=0)
                    for k in range(6)]
            for k in range(6):
                f = (c, ring[k], ring[(k + 1) % 6])
                rk.add_face(f if sgn > 0 else tuple(reversed(f)), 'racket_hole')
    rk.rigid('racket_tmp')
    rkR = rk.mirrored('racket')
    rkR.rigid('racket')
    out.append(rkR)
    return out


def count(parts):
    v = sum(len(p.verts) for p in parts)
    t = sum(sum(len(f) - 2 for f in p.faces) for p in parts)
    return v, t


# ---------------------------------------------------------------------------
# Paletas (sRGB hex). Un solo modelo, dos variantes de color.
# ---------------------------------------------------------------------------
PALETTES = {
    'rival': {   # Romina, «la Topadora»: rojo bombero, amarillo y negro
        'skin': '#e6a076', 'hair': '#33211d', 'hair_tie': '#f2c230', 'brow': '#2a1a17', 'ink': '#241717', 'eye_white': '#fbf6ee', 'mouth': '#8b332f',
        'shirt': '#d93a2e', 'shirt_stripe': '#f4c531', 'shirt_trim': '#b02a22', 'shorts': '#28242e', 'shorts_band': '#3d3745',
        'sock': '#f6f1e8', 'shoe_upper': '#d93a2e', 'shoe_cap': '#f7f2ea', 'shoe_sole': '#f7f2ea', 'shoe_accent': '#28242e',
        'shoe_collar': '#28242e', 'shoe_tongue': '#f7f2ea', 'wrist': '#f4c531', 'wrist_stripe': '#d93a2e', 'headband': '#f7f2ea',
        'racket_face': '#2b2631', 'racket_frame': '#d93a2e', 'racket_grip': '#f1ece3', 'racket_hole': '#121016',
    },
    'jugador': {  # equipo propio: crema, coral y verde petróleo
        'skin': '#efb890', 'hair': '#6a3a22', 'hair_tie': '#ff7a59', 'brow': '#4a2716', 'ink': '#2a1a17', 'eye_white': '#fbf6ee', 'mouth': '#9a4038',
        'shirt': '#f6efe2', 'shirt_stripe': '#ff7a59', 'shirt_trim': '#ff7a59', 'shorts': '#1f5263', 'shorts_band': '#173f4d',
        'sock': '#f6f1e8', 'shoe_upper': '#ff7a59', 'shoe_cap': '#f7f2ea', 'shoe_sole': '#f7f2ea', 'shoe_accent': '#1f5263',
        'shoe_collar': '#1f5263', 'shoe_tongue': '#f7f2ea', 'wrist': '#ff7a59', 'wrist_stripe': '#f6efe2', 'headband': '#ff7a59',
        'racket_face': '#ffd166', 'racket_frame': '#1f5263', 'racket_grip': '#f1ece3', 'racket_hole': '#b98a2c',
    },
}
MATERIALS = list(PALETTES['rival'].keys())
