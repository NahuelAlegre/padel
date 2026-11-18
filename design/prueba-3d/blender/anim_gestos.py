"""Gestos: espera entre puntos, festejo, lamento y manías.

Todos son cortos y no bloquean: los de un tiro duran 0,8 s o menos y se pueden cortar en cualquier
cuadro. Las manías son clips compartidos; cada personaje usa la suya con su tempo y su amplitud
(ver `personajes` en exportar.py).
"""
from animbase import K, Clip, anchor, pose


# ---------------------------------------------------------------------------
# Espera entre puntos: suelta el cuerpo, peso sobre una pierna, mano a la cintura, la pala cuelga
# ---------------------------------------------------------------------------
def _espera():
    a = pose(
        hips=(0.09, 0.02, -0.035), hips_rot=(4, -6, -4), spine=(3, 3, 2), chest=(1, 3, 2), look=(-1.6, -8.0, 2.2),
        footL_rot=(18, 0), footR_rot=(-18, 7),
        handR=(-0.36, -0.04, 0.80), elbowR=(-0.9, 0.4, 0.0), racket=(0.15, -0.50, -0.85), face=(0.9, 0.3, -0.3),
        handL=(0.245, 0.03, 1.02), elbowL=(1.0, 0.4, 0.0), fingersL=(-0.3, -0.6, -0.74), palmL=(-0.9, 0.1, 0.4),
        braid=(0, 0, 0, 0),
    )
    b = pose(a, hips=(0.092, 0.02, -0.028), chest=(-1, 3, 2), handR=(-0.357, -0.05, 0.806), look=(-0.4, -8.0, 2.3), braid=(0, -2, 0, -3))
    c = pose(a, hips=(0.078, 0.02, -0.033), hips_rot=(4, -4, -3), spine=(4, 2, 1), look=(1.5, -8.0, 2.0),
             handR=(-0.35, -0.075, 0.812), racket=(0.10, -0.38, -0.92), braid=(0, 2, 0, 3))
    d = pose(c, hips=(0.082, 0.02, -0.027), chest=(-1, 3, 2), look=(0.6, -8.0, 2.2), handR=(-0.353, -0.06, 0.81))
    return Clip('espera', 2.0, [K(0.0, a), K(0.5, b), K(1.0, c), K(1.5, d)], loop=True, group='reaccion')


# ---------------------------------------------------------------------------
# Festejo: se junta, salta y clava la pala arriba
# ---------------------------------------------------------------------------
def _festejo():
    dip = pose(hips=(0.0, 0.06, -0.21), hips_rot=(23, 0, 0), spine=(12, 0, 0), look=(0.0, -6.0, 1.6),
               handR=(-0.22, -0.30, 0.90), elbowR=(-0.9, 0.3, -0.3), racket=(0.20, -0.30, 0.93), face=(0.6, -0.75, 0.0),
               handL=(0.24, -0.34, 0.98), elbowL=(0.9, 0.3, -0.3), fingersL=(-0.2, -0.5, 0.84), palmL=(-0.9, 0.3, 0.0), braid=(0, 8, 0, 12))
    up = pose(
        hips=(0.0, 0.0, 0.10), hips_rot=(2, 7, 0), spine=(-2, 4, 0), chest=(-7, 6, 0), look=(0.0, -6.0, 3.4),
        footL=(0.26, -0.10, 0.11), footL_rot=(14, 44), footR=(-0.25, -0.05, 0.14), footR_rot=(-16, 52),
        handR=(-0.30, -0.10, 1.98), elbowR=(-0.9, 0.2, -0.2), racket=(-0.05, -0.10, 0.99), face=(0.2, -0.95, 0.1),
        handL=(0.31, -0.20, 1.22), elbowL=(0.8, 0.3, -0.6), fingersL=(-0.3, -0.2, 0.93), palmL=(-0.9, -0.4, 0.0),
        braid=(0, -12, 0, -20),
    )
    land = pose(hips=(0.0, 0.06, -0.20), hips_rot=(20, 4, 0), look=(0.0, -6.0, 2.4), footL_rot=(18, 6), footR_rot=(-18, 6),
                handR=(-0.30, -0.16, 1.80), elbowR=(-0.9, 0.2, -0.2), racket=(-0.02, -0.16, 0.99), face=(0.2, -0.95, 0.1),
                handL=(0.30, -0.26, 1.10), elbowL=(0.8, 0.3, -0.6), fingersL=(-0.3, -0.2, 0.93), palmL=(-0.9, -0.4, 0.0), braid=(0, 14, 0, 22))
    settle = pose(land, hips=(0.0, 0.055, -0.115), hips_rot=(17, 2, 0), handR=(-0.24, -0.24, 1.46), racket=(0.10, -0.26, 0.96),
                  handL=(0.24, -0.34, 1.08), braid=(0, -2, 0, -4))
    return Clip('festejo', 0.80, [K(0.0, pose(), True), K(0.10, dip), K(0.27, up), K(0.44, land), K(0.58, settle, True), K(0.80, pose(), True)],
                group='reaccion', faces=[(0.08, 0.74, 'alegria')])


# ---------------------------------------------------------------------------
# Lamento: se desinfla, mira el piso y niega con la cabeza
# ---------------------------------------------------------------------------
def _lamento():
    down = pose(
        hips=(0.02, 0.07, -0.075), hips_rot=(10, 0, 0), spine=(17, 0, 3), chest=(15, 0, 2), look=(0.35, -0.9, 0.0),
        footL_rot=(18, 0), footR_rot=(-18, 0),
        handR=(-0.35, -0.16, 0.70), elbowR=(-0.8, 0.5, -0.2), racket=(0.05, -0.35, -0.94), face=(0.9, -0.3, 0.1),
        handL=(0.35, -0.14, 0.74), elbowL=(0.8, 0.5, -0.2), fingersL=(0.0, -0.2, -0.98), palmL=(-1, 0, 0),
        braid=(0, 14, 0, 22),
    )
    no1 = pose(down, hips=(0.02, 0.07, -0.085), look=(-0.40, -0.9, 0.0), braid=(8, 10, 12, 16))
    no2 = pose(down, hips=(0.02, 0.07, -0.08), look=(0.30, -0.9, 0.05), braid=(-8, 10, -12, 16))
    return Clip('lamento', 0.80, [K(0.0, pose(), True), K(0.22, down), K(0.36, no1), K(0.50, no2), K(0.58, no2, True), K(0.80, pose(), True)],
                group='reaccion', faces=[(0.10, 0.72, 'fastidio')])


# ---------------------------------------------------------------------------
# Manía 1: se acomoda la gorra (o la visera, o la vincha) con dos dedos
# ---------------------------------------------------------------------------
def _mania_gorra():
    body = dict(spine=(8, 3, 0), chest=(2, 6, 0), handR=(-0.15, -0.36, 0.95), racket=(0.30, -0.42, 0.86))
    hand = dict(elbowL=(0.9, -0.3, -0.3), fingersL=(-0.80, 0.25, 0.55), palmL=(0.3, -0.5, -0.8))
    p_reach = pose(look=(0.4, -6.0, 2.0), **body)
    reach = pose(p_reach, handL=anchor(p_reach, 'head', (0.150, -0.165, 0.185)), **hand)
    p_tug = pose(look=(0.3, -3.0, 0.6), **body)
    tug = pose(p_tug, handL=anchor(p_tug, 'head', (0.150, -0.170, 0.170)), hips=(0.0, 0.055, -0.135), braid=(0, 6, 0, 9), **hand)
    p_back = pose(look=(0.2, -7.0, 2.4), **body)
    back = pose(p_back, handL=anchor(p_back, 'head', (0.155, -0.165, 0.190)), **hand)
    return Clip('mania_gorra', 0.46, [K(0.0, pose(), True), K(0.15, reach), K(0.23, tug), K(0.31, back), K(0.46, pose(), True)],
                group='mania')


# ---------------------------------------------------------------------------
# Manía 2: dos golpecitos con la pala en la suela de la zapatilla
# ---------------------------------------------------------------------------
def _mania_zapatilla():
    lift = pose(
        hips=(0.11, 0.04, -0.09), hips_rot=(14, -14, 5), spine=(8, -10, -4), chest=(5, -14, -5), look=(-0.42, 0.20, 0.30),
        footL_rot=(18, 0), footR=(-0.33, 0.10, 0.27), footR_rot=(-38, 72), kneeR=(-14,),
        handR=(-0.40, 0.03, 0.66), elbowR=(-0.8, 0.5, 0.1), racket=(0.05, 0.55, -0.83), face=(0.9, 0.3, 0.25),
        handL=(0.44, -0.22, 1.12), elbowL=(0.9, 0.3, -0.3), fingersL=(0.5, -0.6, 0.5), palmL=(-0.3, 0.3, -0.9),
        braid=(8, 6, 12, 10),
    )
    tap = pose(lift, handR=(-0.385, 0.075, 0.62), footR=(-0.335, 0.09, 0.285), braid=(10, 8, 14, 12))
    return Clip('mania_zapatilla', 0.56, [K(0.0, pose(), True), K(0.17, lift), K(0.22, tap), K(0.28, lift), K(0.33, tap), K(0.39, lift),
                                          K(0.56, pose(), True)], group='mania')


# ---------------------------------------------------------------------------
# Manía 3: saludo a la tribuna. Gira, levanta la mano y la mueve dos veces
# ---------------------------------------------------------------------------
def _mania_saludo():
    up = pose(
        hips=(0.02, 0.05, -0.085), hips_rot=(12, 16, 0), spine=(7, 8, 2), chest=(3, 14, 3), look=(4.0, -2.0, 1.7),
        footL_rot=(22, 4), footR_rot=(-14, 12),
        handR=(-0.20, -0.30, 0.92), elbowR=(-0.8, 0.4, -0.3), racket=(0.25, -0.35, 0.90), face=(0.7, -0.6, 0.0),
        handL=(0.47, -0.17, 1.70), elbowL=(1.0, 0.1, -0.4), fingersL=(0.15, 0.0, 0.99), palmL=(0.6, -0.8, 0.0),
        braid=(-10, 4, -16, 6),
    )
    wa = pose(up, handL=(0.54, -0.17, 1.69), fingersL=(0.42, 0.0, 0.91), braid=(-6, 4, -10, 6))
    wb = pose(up, handL=(0.41, -0.17, 1.71), fingersL=(-0.22, 0.0, 0.97), braid=(-12, 4, -18, 6))
    return Clip('mania_saludo', 0.70, [K(0.0, pose(), True), K(0.17, up), K(0.26, wa), K(0.35, wb), K(0.44, wa), K(0.53, wb),
                                       K(0.70, pose(), True)], group='mania', faces=[(0.12, 0.62, 'alegria')])


def clips():
    return [_espera(), _festejo(), _lamento(), _mania_gorra(), _mania_zapatilla(), _mania_saludo()]
