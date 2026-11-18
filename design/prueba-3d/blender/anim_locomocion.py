"""Locomoción que no patina.

Cada ciclo es una función de la fase (0..1). Mientras un pie está apoyado, su bola se mueve en
línea recta y a velocidad constante en contra del avance: exactamente lo que recorre el piso.
Por eso, si quien dibuja avanza la fase con la distancia real (fase += distancia / zancada), el pie
queda clavado sea cual sea la velocidad. Al terminar el vuelo, el pie ya viene a la velocidad del
piso, así que tampoco frena al caer.

Zancada = metros que avanza el personaje en un ciclo completo (dos pasos), a escala 1.
"""
import math

from animbase import (K, MIRA, Clip, add, curve, hermite, lerp, lerpv, mix, pose, ramp, smooth)

TAU = 2.0 * math.pi

# ---------------------------------------------------------------------------
# Correr hacia adelante: zancada larga, bien inclinado, rodillas arriba y talón a la cola
# ---------------------------------------------------------------------------
CORRER = dict(T=13 / 30.0, S=1.80, D=0.32, y_td=-0.25)        # los loops duran un número entero de cuadros a 30 fps


def _correr_foot(p):
    """Bola del pie en el ciclo de correr: (y, altura, talón, cuánto va en el aire). p = 0 al apoyar."""
    C = CORRER
    S, D = C['S'], C['D']
    p %= 1.0
    if p < D:
        u = p / D
        heel = lerp(9.0, 3.0, ramp(0.0, 0.4, u)) + 55.0 * ramp(0.42, 1.0, u) ** 1.4
        return C['y_td'] + S * p, 0.0, heel, 0.0
    u = (p - D) / (1.0 - D)
    m = S * (1.0 - D)                       # misma velocidad que el piso al despegar y al caer
    y = hermite(C['y_td'] + S * D, m, C['y_td'], m, u)
    lift = 0.30 * math.sin(math.pi * u ** 0.85) ** 1.25
    heel = curve([(0.0, 58.0), (0.28, 98.0), (0.60, 34.0), (0.86, -8.0), (1.0, 9.0)], u)
    return y, lift, heel, math.sin(math.pi * u)


def correr_pose(ph):
    D = CORRER['D']
    s = math.cos(TAU * ph)                   # +1 cuando el pie izquierdo apoya adelante
    sn = math.sin(TAU * ph)
    sa = math.cos(TAU * (ph - 0.035))        # los brazos, con un pelo de atraso
    bob = -math.cos(2 * TAU * (ph - D / 2))  # -1 en el medio del apoyo, +1 en el aire
    yl, ll, hl, al = _correr_foot(ph)
    yr, lr, hr, ar = _correr_foot(ph + 0.5)
    f = (sa + 1) / 2                         # 1: mano derecha adelante
    return pose(
        hips=(0.014 * sn, -0.02, -0.065 + 0.034 * bob), hips_rot=(15, -9 * s, -3 * sn),
        spine=(10, 9 * s, 0), chest=(8, 16 * s, 0), head=(0, 0, 0), look=MIRA,
        footL=(0.075 + 0.02 * al, yl, ll), footL_rot=(4, hl), kneeL=(0,),
        footR=(-0.075 - 0.02 * ar, yr, lr), footR_rot=(-4, hr), kneeR=(0,),
        handR=lerpv((-0.31, 0.10, 1.00), (-0.17, -0.52, 1.23), f), elbowR=(-0.5, 0.8, -0.3),
        racket=lerpv((0.05, 0.38, 0.92), (0.15, -0.28, 0.95), f), face=(0.3, -0.9, 0.1),
        handL=lerpv((0.19, -0.50, 1.25), (0.31, 0.10, 1.00), f), elbowL=(0.5, 0.8, -0.3),
        fingersL=lerpv((-0.15, -0.55, 0.80), (0.10, 0.25, -0.95), f), palmL=(-1, 0, 0),
        braid=(-10 * sn, 9 + 5 * bob, -16 * sn, 12 + 8 * bob),
    )


def _correr():
    C = CORRER
    T, D = C['T'], C['D']
    return Clip('correr', T, fn=lambda t: correr_pose(t / T), loop=True, group='locomocion', stride=C['S'], dir=(0.0, -1.0),
                steps=[('L', 0.0, D * T), ('R', 0.5 * T, (0.5 + D) * T)], entry=8 / 13.0)


# ---------------------------------------------------------------------------
# Carrera hacia atrás: pasos cortos sobre las puntas, cola atrás, pala arriba y la vista en la pelota alta
# ---------------------------------------------------------------------------
ATRAS = dict(T=12 / 30.0, S=1.30, D=0.40, y_td=0.26)


def _atras_foot(p):
    C = ATRAS
    S, D = C['S'], C['D']
    p %= 1.0
    if p < D:
        u = p / D
        return C['y_td'] - S * p, 0.0, curve([(0.0, 30.0), (0.5, 13.0), (1.0, 26.0)], u), 0.0
    u = (p - D) / (1.0 - D)
    m = -S * (1.0 - D)
    y = hermite(C['y_td'] - S * D, m, C['y_td'], m, u)
    lift = 0.085 * math.sin(math.pi * u ** 0.9) ** 1.2
    heel = curve([(0.0, 26.0), (0.45, 44.0), (1.0, 30.0)], u)
    return y, lift, heel, math.sin(math.pi * u)


def atras_pose(ph):
    D = ATRAS['D']
    s = math.cos(TAU * ph)
    sn = math.sin(TAU * ph)
    bob = -math.cos(2 * TAU * (ph - D / 2))
    yl, ll, hl, al = _atras_foot(ph)
    yr, lr, hr, ar = _atras_foot(ph + 0.5)
    return pose(
        hips=(0.016 * sn, 0.075, -0.115 + 0.018 * bob), hips_rot=(15, 7 * s, -2 * sn),
        spine=(7, -6 * s, 0), chest=(2, -6 * s, 0), head=(0, 0, 0), look=(0.0, -6.0, 4.2),
        footL=(0.12 + 0.015 * al, yl, ll), footL_rot=(12, hl), kneeL=(0,),
        footR=(-0.12 - 0.015 * ar, yr, lr), footR_rot=(-12, hr), kneeR=(0,),
        handR=(-0.27, -0.26 + 0.04 * s, 1.27 + 0.012 * bob), elbowR=(-0.8, 0.5, -0.3),
        racket=(-0.08, -0.05, 0.99), face=(0.25, -0.95, 0.15),
        handL=(0.33, -0.36 - 0.05 * s, 1.08 - 0.012 * bob), elbowL=(0.8, 0.5, -0.4),
        fingersL=(0.25, -0.75, 0.60), palmL=(-0.5, 0.3, -0.8),
        braid=(-6 * sn, -14 + 4 * bob, -10 * sn, -22 + 6 * bob),
    )


def _atras():
    C = ATRAS
    T, D = C['T'], C['D']
    return Clip('correr_atras', T, fn=lambda t: atras_pose(t / T), loop=True, group='locomocion', stride=C['S'], dir=(0.0, 1.0),
                steps=[('L', 0.0, D * T), ('R', 0.5 * T, (0.5 + D) * T)], entry=0.55)


# ---------------------------------------------------------------------------
# Paso lateral: galope de costado sin cruzar los pies. Cae el pie que va adelante, cierra el de
# atrás, empuja y vuela. La cadera queda baja y el torso mira siempre a la red.
# ---------------------------------------------------------------------------
LATERAL = dict(T=12 / 30.0, S=1.35, D=0.36, lag=0.20, lead=0.46, trail=-0.12)


def _lateral_foot(p, x_td, heels_st, heels_sw, lift_max):
    C = LATERAL
    S, D = C['S'], C['D']
    p %= 1.0
    if p < D:
        return x_td - S * p, 0.0, curve(heels_st, p / D)
    u = (p - D) / (1.0 - D)
    m = -S * (1.0 - D)
    x = hermite(x_td - S * D, m, x_td, m, u)
    return x, lift_max * math.sin(math.pi * u ** 0.9) ** 1.2, curve(heels_sw, u)


def lateral_pose(ph, sign):
    """sign = +1: hacia la izquierda del personaje (+X). -1: hacia su derecha."""
    C = LATERAL
    xa, la, ha = _lateral_foot(ph, C['lead'], [(0.0, 13.0), (0.5, 6.0), (1.0, 24.0)],
                               [(0.0, 24.0), (0.4, 34.0), (0.8, 8.0), (1.0, 13.0)], 0.11)
    xb, lb, hb = _lateral_foot(ph - C['lag'], C['trail'], [(0.0, 14.0), (0.45, 8.0), (1.0, 46.0)],
                               [(0.0, 46.0), (0.35, 30.0), (0.8, 10.0), (1.0, 14.0)], 0.09)
    hop = math.cos(TAU * (ph - 0.80))        # +1 en el medio del vuelo
    push = ramp(0.30, 0.56, ph) * ramp(0.72, 0.56, ph)      # el empujón de la pierna de atrás
    if sign > 0:
        fl, fr = (xa, -0.12, la), (xb, -0.10, lb)
        rl, rr = (16, ha), (-14, hb)
    else:
        fl, fr = (-xb, -0.10, lb), (-xa, -0.12, la)
        rl, rr = (14, hb), (-16, ha)
    return pose(
        hips=(sign * (0.035 + 0.03 * math.cos(TAU * (ph - 0.05))), 0.06, -0.165 + 0.034 * hop),
        hips_rot=(19, 3 * sign, sign * (3 + 3 * push)), spine=(10, -2 * sign, -sign * 2 * push), chest=(6, -1 * sign, 0),
        head=(0, 0, 0), look=MIRA,
        footL=fl, footL_rot=rl, kneeL=(0,), footR=fr, footR_rot=rr, kneeR=(0,),
        handR=(-0.09 - 0.02 * sign * push, -0.40, 0.995 + 0.035 * hop), elbowR=(-0.8, 0.3, -0.5),
        racket=(0.42, -0.40, 0.82), face=(0.8, 0.55, -0.1),
        handL=(0.115 - 0.02 * sign * push, -0.455, 1.095 + 0.035 * hop), elbowL=(0.8, 0.3, -0.5),
        fingersL=(-0.55, -0.45, 0.70), palmL=(-0.6, 0.7, 0.2),
        braid=(-13 * sign - 5 * sign * hop, 4 + 6 * hop, -21 * sign - 8 * sign * hop, 6 + 9 * hop),
    )


def _lateral(sign, name):
    C = LATERAL
    T, D, lag = C['T'], C['D'], C['lag']
    lead, trail = ('L', 'R') if sign > 0 else ('R', 'L')
    return Clip(name, T, fn=lambda t: lateral_pose(t / T, sign), loop=True, group='locomocion', stride=C['S'], dir=(float(sign), 0.0),
                steps=[(lead, 0.0, D * T), (trail, lag * T, (lag + D) * T)], entry=0.28)


# ---------------------------------------------------------------------------
# Split step: el saltito de preparación. Se usa para caer justo cuando el rival le pega.
# ---------------------------------------------------------------------------
def _split_step():
    base = pose()
    dip = pose(hips=(0.0, 0.06, -0.165), hips_rot=(21, 0, 0), handR=(-0.08, -0.40, 0.955), handL=(0.115, -0.455, 1.06), braid=(0, 4, 0, 6))
    off = pose(hips=(0.0, 0.045, -0.075), hips_rot=(16, 0, 0), footL_rot=(18, 38), footR_rot=(-18, 38),
               handR=(-0.08, -0.40, 1.03), handL=(0.115, -0.455, 1.135), braid=(0, -4, 0, -6))
    air = pose(hips=(0.0, 0.045, -0.035), hips_rot=(15, 0, 0), footL=(0.325, -0.12, 0.050), footL_rot=(20, 26),
               footR=(-0.325, -0.12, 0.050), footR_rot=(-20, 26), handR=(-0.10, -0.40, 1.07), handL=(0.135, -0.455, 1.17),
               braid=(0, -8, 0, -12))
    land = pose(hips=(0.0, 0.05, -0.105), hips_rot=(18, 0, 0), footL=(0.33, -0.12, 0.0), footL_rot=(21, 20),
                footR=(-0.33, -0.12, 0.0), footR_rot=(-21, 20), handR=(-0.10, -0.40, 1.02), handL=(0.135, -0.455, 1.12),
                braid=(0, 2, 0, 4))
    sink = pose(land, hips=(0.0, 0.065, -0.215), hips_rot=(24, 0, 0), spine=(11, 0, 0), footL_rot=(21, 5), footR_rot=(-21, 5),
                handR=(-0.13, -0.41, 0.925), elbowR=(-0.95, 0.2, -0.4), handL=(0.165, -0.46, 1.03), elbowL=(0.95, 0.2, -0.4),
                braid=(0, 12, 0, 18))
    up = pose(land, hips=(0.0, 0.055, -0.13), hips_rot=(19, 0, 0), footL_rot=(21, 9), footR_rot=(-21, 9),
              handR=(-0.09, -0.40, 0.985), handL=(0.125, -0.455, 1.09))
    # pasitos de acomodo para volver al ancho de la posición de espera
    back1 = pose(up, footL=(0.30, -0.12, 0.0), footL_rot=(18, 9), hips=(-0.008, 0.055, -0.125))
    return Clip('split_step', 0.80, [K(0.0, base, True), K(0.09, dip), K(0.165, off), K(0.25, air), K(0.335, land), K(0.43, sink, True),
                                     K(0.56, up, True), K(0.68, back1), K(0.80, pose(), True)],
                group='locomocion', steps=[('L', 0.0, 0.165), ('R', 0.0, 0.165), ('L', 0.335, 0.80), ('R', 0.335, 0.80)],
                land=0.335, cut=0.45)


# ---------------------------------------------------------------------------
# Arranque: de la espera a correr. El cuerpo se deja caer hacia adelante, el pie derecho da el
# primer paso y el izquierdo empuja. Termina exactamente en un cuadro del ciclo de correr.
# ---------------------------------------------------------------------------
ARRANQUE = dict(T=0.30, link=8 / 13.0)      # termina en un cuadro exacto del ciclo de correr (13 cuadros)


def _run_speed():
    return CORRER['S'] / CORRER['T']


def _arranque_dist(t):
    T = ARRANQUE['T']
    return 0.5 * _run_speed() * T * min(1.0, max(0.0, t / T)) ** 2      # aceleración constante


def arranque_pose(t):
    T, link = ARRANQUE['T'], ARRANQUE['link']
    C = CORRER
    Tc, S, D = C['T'], C['S'], C['D']
    ph = link - (T - t) / Tc                     # fase del ciclo de correr que le corresponde a este instante
    run = correr_pose(ph)
    w = ramp(0.03, 0.27, t)
    p = mix(pose(), run, w, skip=('footL', 'footR', 'footL_rot', 'footR_rot'))
    d = _arranque_dist
    # anticipación: se hunde y se inclina antes de salir
    ant = ramp(0.0, 0.09, t) * ramp(0.24, 0.10, t)
    p = add(p, hips=(0.0, -0.03 * ant, -0.055 * ant), hips_rot=(9 * ant, 0, 0))
    # pie izquierdo: apoyado y empujando hasta que despega; después se une al vuelo del ciclo
    t_off = T - (link - D) * Tc                  # cuando el ciclo de correr lo levanta
    if t <= t_off:
        u = t / t_off
        p['footL'] = (0.30, -0.12 + d(t), 0.0)
        p['footL_rot'] = (lerp(18, 6, smooth(u)), lerp(9, 58, ramp(0.25, 1.0, u) ** 1.3))
    else:
        u = (t - t_off) / (T - t_off)
        y_off = -0.12 + d(t_off)
        cy, cl, ch, _a = _correr_foot(ph)
        cy0, _l, _h, _a0 = _correr_foot(D)
        k = smooth(u)
        p['footL'] = (lerp(0.30, run['footL'][0], k), cy + (y_off - cy0) * (1 - k), cl)
        p['footL_rot'] = (lerp(6, 4, k), ch)
    # pie derecho: primer paso. Sale enseguida y cae donde lo necesita el ciclo de correr.
    t_up, t_down = 0.045, T - (link - 0.5) * Tc
    y_end = _correr_foot(link + 0.5)[0]
    y_land = y_end - (d(T) - d(t_down))
    if t <= t_up:
        p['footR'] = (-0.30, -0.12 + d(t), 0.0)
        p['footR_rot'] = (-18, lerp(9, 30, smooth(t / t_up)))
    elif t < t_down:
        u = (t - t_up) / (t_down - t_up)
        y0 = -0.12 + d(t_up)
        v_land = _run_speed() * (t_down / T)     # velocidad del piso en el momento de caer
        y = hermite(y0, 0.0, y_land, v_land * (t_down - t_up), u)
        p['footR'] = (lerp(-0.30, -0.075, smooth(u)), y, 0.13 * math.sin(math.pi * u ** 0.8) ** 1.2)
        p['footR_rot'] = (lerp(-18, -4, smooth(u)), curve([(0.0, 30.0), (0.35, 52.0), (0.8, 2.0), (1.0, 9.0)], u))
    else:
        p['footR'] = (-0.075, y_land + d(t) - d(t_down), 0.0)
        p['footR_rot'] = (-4, _correr_foot(ph + 0.5)[2])
    return p


def _arranque():
    T = ARRANQUE['T']
    t_off = T - (ARRANQUE['link'] - CORRER['D']) * CORRER['T']
    t_down = T - (ARRANQUE['link'] - 0.5) * CORRER['T']
    return Clip('arranque', T, fn=arranque_pose, group='locomocion', dir=(0.0, -1.0),
                root_fn=lambda t: (0.0, -_arranque_dist(t)), steps=[('L', 0.0, t_off), ('R', 0.0, 0.045), ('R', t_down, T)],
                link={'clip': 'correr', 'phase': ARRANQUE['link']})


# ---------------------------------------------------------------------------
# Frenada: de correr a la espera. El pie izquierdo clava el talón bien adelante, el cuerpo se
# echa atrás, el derecho cae abierto y las rodillas absorben.
# ---------------------------------------------------------------------------
FRENADA = dict(T=14 / 30.0, brake=0.22, start=9 / 13.0, t_l=0.075, t_r=0.21)      # sale de un cuadro exacto del ciclo de correr


def _frenada_dist(t):
    Tb = FRENADA['brake']
    v = _run_speed()
    t = min(Tb, max(0.0, t))
    return v * t - 0.5 * v * t * t / Tb                 # frena con desaceleración constante


def frenada_pose(t):
    F = FRENADA
    Tb, start, t_l, t_r = F['brake'], F['start'], F['t_l'], F['t_r']
    S, D = CORRER['S'], CORRER['D']
    d = _frenada_dist
    Dtot = d(Tb)
    # el ciclo de correr sigue cada vez más lento: su fase avanza con la distancia
    ph = start + d(t) / S
    run = correr_pose(ph)
    w = ramp(0.0, 0.26, t)
    p = mix(run, pose(), w, skip=('footL', 'footR', 'footL_rot', 'footR_rot'))
    brake = ramp(0.0, 0.11, t) * ramp(0.36, 0.15, t)       # se echa atrás
    sink = ramp(0.07, 0.24, t) * ramp(0.45, 0.27, t)       # las rodillas absorben
    p = add(p, hips=(0.0, 0.075 * brake, -0.04 * brake - 0.085 * sink), hips_rot=(-15 * brake + 5 * sink, 0, 0),
            spine=(-6 * brake, 0, 0), handR=(-0.06 * brake, -0.07 * brake, 0.08 * brake - 0.05 * sink),
            handL=(0.08 * brake, -0.07 * brake, 0.07 * brake - 0.05 * sink), braid=(0, -16 * brake + 10 * sink, 0, -26 * brake + 16 * sink))
    # pie izquierdo: venía en el aire; cae de talón, abierto y bien adelante, y queda clavado mientras
    # el cuerpo le pasa por arriba
    y_land_l = -0.12 - (Dtot - d(t_l))
    if t < t_l:
        u = t / t_l
        y0, l0, h0, _a = _correr_foot(start)
        k = smooth(u)
        p['footL'] = (lerp(run['footL'][0], 0.30, k), lerp(y0, y_land_l, u ** 0.8), lerp(l0, 0.036, u ** 1.5))
        p['footL_rot'] = (lerp(4, 18, k), lerp(h0, -17, k))
    else:
        roll = ramp(t_l, t_l + 0.06, t)                      # del talón a la planta
        p['footL'] = (0.30, y_land_l + d(t) - d(t_l), 0.036 * (1 - roll))
        p['footL_rot'] = (18, -17 * (1 - roll) + 9 * ramp(0.30, 0.45, t))
    # pie derecho: sigue apoyado como en el ciclo hasta que despega; después cae abierto, a la par
    pr = (ph + 0.5) % 1.0
    y_land_r = -0.12 - (Dtot - d(t_r))
    if pr < D and t < t_r:
        y, lift, heel, _a = _correr_foot(pr)
        p['footR'] = (-0.075, y, lift)
        p['footR_rot'] = (-4, heel)
    elif t < t_r:
        t0, y0 = getattr(frenada_pose, 'off_fixed', (0.0, 0.0))
        u = (t - t0) / (t_r - t0)
        k = smooth(u)
        p['footR'] = (lerp(-0.075, -0.30, k), hermite(y0, 0.25, y_land_r, 0.0, u), 0.10 * math.sin(math.pi * u ** 0.85) ** 1.1)
        p['footR_rot'] = (lerp(-4, -18, k), curve([(0.0, 58.0), (0.3, 70.0), (0.8, 4.0), (1.0, 12.0)], u))
    else:
        p['footR'] = (-0.30, y_land_r + d(t) - d(t_r), 0.0)
        p['footR_rot'] = (-18, lerp(12, 9, ramp(t_r, t_r + 0.12, t)))
    return p


def _frenada_setup():
    """Busca el instante en que el pie derecho despega (la fase avanza con la distancia, no con el tiempo)."""
    F = FRENADA
    lo, hi = 0.0, F['t_r']
    target = (CORRER['D'] - ((F['start'] + 0.5) % 1.0)) * CORRER['S']      # distancia que le falta al apoyo
    for _ in range(50):
        mid = (lo + hi) / 2
        if _frenada_dist(mid) < target:
            lo = mid
        else:
            hi = mid
    y = _correr_foot(CORRER['D'] - 1e-9)[0]
    frenada_pose.off_fixed = (lo, y)
    return lo


def _frenada():
    F = FRENADA
    t_off = _frenada_setup()
    return Clip('frenada', F['T'], fn=frenada_pose, group='locomocion', dir=(0.0, -1.0),
                root_fn=lambda t: (0.0, -_frenada_dist(t)), steps=[('R', 0.0, t_off), ('L', F['t_l'], F['T']), ('R', F['t_r'], F['T'])],
                link={'clip': 'correr', 'phase': F['start']}, free=F['brake'])


def clips():
    return [_correr(), _atras(), _lateral(+1, 'lateral_izq'), _lateral(-1, 'lateral_der'), _split_step(), _arranque(), _frenada()]
