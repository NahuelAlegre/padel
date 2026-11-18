"""Golpes. Anticipación lenta, impacto seco y un seguimiento que frena.

Cada golpe tiene la misma estructura: sale de la espera, se arma (el armado termina en una pausa,
que es el tramo que se puede estirar), descarga en un décimo de segundo, pasa por el impacto sin
frenar, sigue de largo y recién ahí frena y vuelve. Las poses van más lejos que las reales: más
giro, más flexión y más extensión, para que se lean en chico.

El personaje es diestro. Mira hacia -Y; su derecha es -X.
"""
from animbase import K, Clip, pose

PIE_L, PIE_R = (0.30, -0.12, 0.0), (-0.30, -0.12, 0.0)     # donde están los pies en la espera


def _golpe(name, dur, contact, keys, label, hold, side, **extra):
    faces = [(max(0.0, contact - 0.10), min(dur, contact + 0.16), 'esfuerzo')]
    return Clip(name, dur, keys, contact=contact, label=label, group='golpe', hold=hold, faces=faces, side=side, **extra)


# ---------------------------------------------------------------------------
# Derecha: giro completo de hombros, paso adentro, impacto adelante y pala al hombro contrario
# ---------------------------------------------------------------------------
def _derecha():
    atras = (-0.38, 0.16, 0.0)                    # el pie derecho se abre y carga el peso
    paso = (0.20, -0.44, 0.0)                     # el izquierdo entra en el golpe
    arm = pose(
        hips=(-0.11, 0.10, -0.17), hips_rot=(12, -56, 0), spine=(6, -20, 2), chest=(4, -26, 3), look=(-0.9, -3.0, 1.0),
        footR=atras, footR_rot=(-72, 0), footL=PIE_L, footL_rot=(-22, 22),
        handR=(-0.40, 0.52, 1.22), elbowR=(-0.6, 0.5, -0.6), racket=(-0.12, 0.42, 0.90), face=(-0.55, -0.80, -0.2),
        handL=(-0.04, -0.54, 1.30), elbowL=(0.5, 0.2, -0.8), fingersL=(-0.3, -0.9, 0.25), palmL=(0.2, 0.2, -1),
        braid=(14, 2, 22, 4),
    )
    load = pose(
        arm, hips=(-0.14, 0.13, -0.23), hips_rot=(15, -64, -3), chest=(4, -30, 4), footL_rot=(-26, 30),
        handR=(-0.45, 0.58, 1.12), racket=(-0.30, 0.60, 0.74), handL=(-0.08, -0.56, 1.26), braid=(18, 6, 28, 8),
    )
    drop = pose(
        hips=(-0.05, 0.02, -0.21), hips_rot=(13, -30, 0), spine=(6, -14, 0), chest=(4, -26, 0), look=(-1.0, -1.4, 0.95),
        footR=atras, footR_rot=(-60, 22), footL=(0.24, -0.30, 0.07), footL_rot=(-8, 14),
        handR=(-0.52, 0.28, 0.80), elbowR=(-0.5, 0.6, -0.6), racket=(-0.35, 0.80, -0.48), face=(-0.6, -0.5, -0.6),
        handL=(0.18, -0.46, 1.20), elbowL=(0.6, 0.3, -0.7), fingersL=(-0.2, -0.9, 0.1), palmL=(0, 0.3, -1),
        braid=(4, 4, 8, 6),
    )
    hit = pose(
        hips=(0.03, -0.13, -0.16), hips_rot=(10, -6, 0), spine=(5, 0, 0), chest=(4, 6, 0), look=(-0.82, -0.60, 0.95),
        footR=atras, footR_rot=(-34, 52), footL=paso, footL_rot=(-6, 0),
        handR=(-0.52, -0.46, 0.98), elbowR=(-0.3, 0.5, -0.8), racket=(-0.92, -0.36, -0.12), face=(0.1, -1, 0.08),
        handL=(0.33, -0.20, 1.10), elbowL=(0.7, 0.5, -0.6), fingersL=(-0.3, -0.8, -0.3), palmL=(-0.7, 0.6, 0),
        braid=(-20, 6, -32, 10),
    )
    follow = pose(
        hips=(0.07, -0.20, -0.10), hips_rot=(8, 26, 0), spine=(4, 14, 0), chest=(2, 26, 0), look=(-0.6, -1.6, 1.2),
        footR=(-0.35, 0.08, 0.035), footR_rot=(-16, 62), footL=paso, footL_rot=(-4, 0),
        handR=(0.20, -0.46, 1.44), elbowR=(-0.3, -0.6, -0.7), racket=(0.60, 0.10, 0.79), face=(0.3, -0.8, -0.5),
        handL=(0.30, -0.30, 1.22), elbowL=(0.8, 0.3, -0.5), fingersL=(-0.4, -0.5, 0.75), palmL=(-0.8, 0.5, -0.3),
        braid=(-26, 8, -36, 14),
    )
    end = pose(follow, hips=(0.07, -0.20, -0.07), hips_rot=(7, 32, 0), chest=(2, 30, 0), handR=(0.34, -0.22, 1.50),
               racket=(0.50, 0.52, 0.69), look=(0.0, -6.0, 1.9), braid=(12, 4, 20, 6),
               footR=(-0.30, -0.06, 0.0), footR_rot=(-10, 34), handL=(0.30, -0.24, 1.38), fingersL=(-0.2, -0.2, 0.95))
    return _golpe('derecha', 1.02, 0.52, [K(0.0, pose(), True), K(0.20, arm), K(0.39, load, True), K(0.46, drop), K(0.52, hit),
                                          K(0.61, follow), K(0.74, end, True), K(1.02, pose(), True)], 'Derecha', (0.20, 0.39), 'derecha')


# ---------------------------------------------------------------------------
# Revés: de costado, la mano izquierda acompaña la pala en el armado y después abre para atrás
# ---------------------------------------------------------------------------
def _reves():
    cruza = (0.02, -0.42, 0.0)                    # el pie derecho cruza adelante
    arm = pose(
        hips=(0.09, 0.03, -0.17), hips_rot=(12, 58, 0), spine=(6, 20, -2), chest=(4, 26, -3), look=(0.9, -3.0, 1.0),
        footR=cruza, footR_rot=(52, 0), footL=PIE_L, footL_rot=(76, 0),
        handR=(0.38, 0.12, 1.12), elbowR=(-0.2, -0.5, -0.8), racket=(0.30, 0.52, 0.80), face=(-0.5, 0.75, -0.4),
        handL=(0.47, 0.20, 1.22), elbowL=(0.6, 0.6, -0.5), fingersL=(-0.3, 0.3, 0.9), palmL=(-0.8, -0.5, 0),
        braid=(-14, 2, -22, 4),
    )
    load = pose(arm, hips=(0.11, 0.05, -0.23), hips_rot=(15, 66, 0), chest=(4, 30, -4), handR=(0.44, 0.20, 1.10), handL=(0.52, 0.28, 1.20),
                racket=(0.40, 0.62, 0.68), braid=(-18, 6, -28, 8))
    hit = pose(
        hips=(0.05, -0.12, -0.15), hips_rot=(12, 40, 0), spine=(6, 12, 0), chest=(4, 12, 0), look=(0.55, -0.92, 0.95),
        footR=cruza, footR_rot=(42, 0), footL=PIE_L, footL_rot=(68, 34),
        handR=(0.18, -0.66, 1.02), elbowR=(0.3, 0.2, -0.9), racket=(0.90, -0.42, -0.08), face=(0.1, 1.0, -0.12),
        handL=(0.40, 0.36, 1.12), elbowL=(0.7, 0.5, -0.5), fingersL=(0.5, 0.8, -0.3), palmL=(0, 0, -1),
        braid=(20, 6, 30, 10),
    )
    follow = pose(
        hips=(0.03, -0.18, -0.10), hips_rot=(10, 26, 0), spine=(4, 6, 0), chest=(2, 4, 0), look=(0.3, -2.0, 1.2),
        footR=cruza, footR_rot=(34, 0), footL=PIE_L, footL_rot=(60, 52),
        handR=(-0.36, -0.62, 1.28), elbowR=(0.2, 0.3, -0.9), racket=(-0.52, -0.50, 0.69), face=(-0.5, 0.75, 0.3),
        handL=(0.44, 0.46, 0.98), elbowL=(0.7, 0.5, -0.5), fingersL=(0.4, 0.85, -0.3), palmL=(0, 0, -1),
        braid=(24, 8, 34, 12),
    )
    end = pose(follow, handR=(-0.46, -0.52, 1.38), racket=(-0.60, -0.30, 0.74), hips_rot=(9, 20, 0), look=(0.0, -6.0, 1.9), braid=(-8, 4, -12, 6))
    return _golpe('reves', 1.02, 0.52, [K(0.0, pose(), True), K(0.20, arm), K(0.40, load, True), K(0.52, hit), K(0.62, follow),
                                        K(0.75, end, True), K(1.02, pose(), True)], 'Revés', (0.20, 0.40), 'reves')


# ---------------------------------------------------------------------------
# Voleas: gesto corto. Armado mínimo, paso adentro, golpe de bloqueo y freno inmediato
# ---------------------------------------------------------------------------
def _volea():
    paso = (0.12, -0.50, 0.0)
    arm = pose(
        hips=(-0.04, 0.03, -0.14), hips_rot=(16, -24, 0), spine=(8, -8, 0), chest=(5, -10, 0), look=(-0.5, -3.0, 1.5),
        footR_rot=(-34, 6), footL_rot=(2, 18),
        handR=(-0.36, -0.10, 1.36), elbowR=(-0.7, 0.5, -0.5), racket=(-0.22, 0.22, 0.95), face=(-0.25, -0.92, 0.3),
        handL=(0.16, -0.46, 1.26), elbowL=(0.7, 0.3, -0.6), fingersL=(-0.5, -0.6, 0.6), palmL=(-0.5, 0.6, -0.5),
        braid=(6, 2, 10, 4),
    )
    hit = pose(
        hips=(-0.02, -0.16, -0.20), hips_rot=(20, -8, 0), spine=(8, -2, 0), chest=(5, -2, 0), look=(-0.66, -0.80, 1.36),
        footR_rot=(-30, 44), footL=paso, footL_rot=(-4, 0),
        handR=(-0.44, -0.58, 1.26), elbowR=(-0.6, 0.5, -0.6), racket=(-0.62, -0.22, 0.75), face=(0.12, -0.96, 0.24),
        handL=(0.30, -0.26, 1.12), elbowL=(0.8, 0.4, -0.5), fingersL=(-0.2, -0.7, -0.4), palmL=(-0.7, 0.6, 0),
        braid=(-8, 8, -14, 12),
    )
    stop = pose(hit, hips=(-0.02, -0.19, -0.23), handR=(-0.38, -0.72, 1.14), racket=(-0.58, -0.40, 0.71), face=(0.10, -0.90, 0.42),
                handL=(0.32, -0.20, 1.08), braid=(-4, 12, -8, 18))
    return _golpe('volea', 0.66, 0.26, [K(0.0, pose(), True), K(0.11, arm), K(0.17, arm, True), K(0.26, hit), K(0.34, stop, True),
                                        K(0.44, stop, True), K(0.66, pose(), True)], 'Volea', (0.11, 0.17), 'derecha')


def _volea_reves():
    paso = (-0.06, -0.50, 0.0)
    arm = pose(
        hips=(0.04, 0.03, -0.14), hips_rot=(16, 28, 0), spine=(8, 10, 0), chest=(5, 12, 0), look=(0.5, -3.0, 1.5),
        footL_rot=(40, 6), footR_rot=(4, 18),
        handR=(0.22, -0.24, 1.22), elbowR=(-0.5, 0.3, -0.8), racket=(0.42, 0.10, 0.90), face=(-0.3, 0.9, -0.3),
        handL=(0.36, -0.20, 1.32), elbowL=(0.8, 0.3, -0.5), fingersL=(-0.5, -0.2, 0.8), palmL=(-0.7, -0.6, 0),
        braid=(-6, 2, -10, 4),
    )
    hit = pose(
        hips=(0.03, -0.16, -0.20), hips_rot=(20, 20, 0), spine=(8, 6, 0), chest=(5, 6, 0), look=(0.46, -0.84, 1.34),
        footL_rot=(36, 42), footR=paso, footR_rot=(18, 0),
        handR=(0.14, -0.64, 1.24), elbowR=(-0.4, 0.4, -0.8), racket=(0.66, -0.20, 0.72), face=(-0.1, 0.96, -0.24),
        handL=(0.40, 0.10, 1.18), elbowL=(0.8, 0.5, -0.4), fingersL=(0.6, 0.6, -0.4), palmL=(0, 0, -1),
        braid=(8, 8, 14, 12),
    )
    stop = pose(hit, hips=(0.03, -0.19, -0.23), handR=(0.04, -0.76, 1.12), racket=(0.60, -0.36, 0.71), face=(-0.1, 0.9, -0.42),
                handL=(0.42, 0.18, 1.12), braid=(4, 12, 8, 18))
    return _golpe('volea_reves', 0.66, 0.26, [K(0.0, pose(), True), K(0.11, arm), K(0.17, arm, True), K(0.26, hit), K(0.34, stop, True),
                                              K(0.44, stop, True), K(0.66, pose(), True)], 'Volea', (0.11, 0.17), 'reves')


# ---------------------------------------------------------------------------
# Bandeja: de costado, la mano izquierda señala la pelota, corte arriba y adelante sin saltar
# ---------------------------------------------------------------------------
def _bandeja():
    atras = (-0.30, 0.22, 0.0)
    ade = (0.16, -0.18, 0.0)
    arm = pose(
        hips=(-0.08, 0.08, -0.10), hips_rot=(0, -66, 0), spine=(-2, -12, 3), chest=(-4, -14, 5), look=(-0.2, -1.6, 3.4),
        footR=atras, footR_rot=(-80, 0), footL=ade, footL_rot=(-38, 0),
        handR=(-0.26, 0.26, 1.64), elbowR=(-0.8, 0.5, 0.1), racket=(0.10, 0.30, 0.95), face=(-0.7, -0.7, 0.1),
        handL=(0.14, -0.40, 1.82), elbowL=(0.7, -0.2, -0.6), fingersL=(0.0, -0.35, 0.94), palmL=(0.3, -0.9, -0.3),
        braid=(10, -6, 16, -10),
    )
    load = pose(arm, hips=(-0.12, 0.14, -0.19), hips_rot=(-4, -72, 0), chest=(-6, -16, 6), footL_rot=(-38, 16),
                handR=(-0.30, 0.32, 1.58), racket=(0.22, 0.42, 0.88), handL=(0.14, -0.38, 1.88), braid=(12, -10, 20, -16))
    hit = pose(
        hips=(-0.02, -0.06, -0.06), hips_rot=(8, -26, 0), spine=(4, -6, -3), chest=(4, -4, -5), look=(-0.30, -0.62, 2.20),
        footR=atras, footR_rot=(-52, 40), footL=ade, footL_rot=(-30, 0),
        handR=(-0.30, -0.32, 1.98), elbowR=(-0.7, 0.3, -0.3), racket=(-0.12, -0.36, 0.92), face=(0.0, -0.94, -0.34),
        handL=(0.20, -0.30, 1.36), elbowL=(0.7, 0.3, -0.5), fingersL=(-0.5, -0.4, -0.6), palmL=(-0.5, 0.8, 0),
        braid=(-6, 14, -10, 22),
    )
    follow = pose(
        hips=(0.02, -0.12, -0.10), hips_rot=(14, 10, 0), spine=(8, 8, 0), chest=(6, 12, 0), look=(-0.2, -2.0, 1.4),
        footR=atras, footR_rot=(-30, 56), footL=ade, footL_rot=(-26, 0),
        handR=(0.02, -0.60, 1.36), elbowR=(-0.5, 0.4, -0.6), racket=(0.42, -0.50, -0.20), face=(0.3, -0.5, -0.8),
        handL=(0.28, -0.22, 1.10), elbowL=(0.8, 0.3, -0.4), fingersL=(-0.2, -0.6, -0.6), palmL=(-0.8, 0.5, 0),
        braid=(-10, -8, -16, -14),
    )
    end = pose(follow, hips=(0.03, -0.12, -0.13), hips_rot=(16, 22, 0), chest=(6, 18, 0), handR=(0.26, -0.40, 0.98),
               racket=(0.55, 0.05, -0.83), face=(0.6, -0.6, 0.5), look=(0.0, -6.0, 1.9), braid=(8, 6, 14, 10))
    return _golpe('bandeja', 1.05, 0.52, [K(0.0, pose(), True), K(0.22, arm), K(0.40, load, True), K(0.52, hit), K(0.62, follow),
                                          K(0.76, end, True), K(1.05, pose(), True)], 'Bandeja', (0.22, 0.40), 'derecha')


# ---------------------------------------------------------------------------
# Remate: pose de trofeo bien abajo, salto con tijera, impacto arriba de todo y caída adelante
# ---------------------------------------------------------------------------
def _remate():
    atras = (-0.28, 0.18, 0.0)
    ade = (0.08, -0.22, 0.0)
    trophy = pose(
        hips=(-0.05, 0.07, -0.20), hips_rot=(-6, -64, 0), spine=(-6, -14, 4), chest=(-8, -16, 6), look=(-0.1, -1.2, 3.8),
        footL=ade, footL_rot=(-30, 0), footR=atras, footR_rot=(-76, 0),
        handR=(-0.18, 0.34, 1.60), elbowR=(-0.6, 0.7, 0.3), racket=(0.22, 0.28, 0.93), face=(-0.7, -0.6, 0.2),
        handL=(-0.04, -0.30, 1.78), elbowL=(0.5, -0.3, -0.6), fingersL=(0, -0.3, 0.95), palmL=(0.3, -0.9, -0.3),
        braid=(10, -6, 16, -10),
    )
    load = pose(trophy, hips=(-0.06, 0.09, -0.31), hips_rot=(-9, -68, 0), chest=(-10, -18, 7), footR_rot=(-76, 14), footL_rot=(-30, 10),
                handR=(-0.20, 0.36, 1.50), racket=(0.28, 0.36, 0.89), handL=(-0.06, -0.30, 1.72), braid=(12, -12, 20, -20))
    drop = pose(
        hips=(-0.02, 0.02, 0.08), hips_rot=(-5, -40, 0), spine=(-5, -8, 2), chest=(-7, -10, 4), look=(-0.1, -0.9, 3.8),
        footL=(0.08, -0.20, 0.10), footL_rot=(-25, 52), footR=(-0.26, 0.20, 0.12), footR_rot=(-60, 60),
        handR=(-0.30, 0.20, 1.86), elbowR=(-0.5, 0.2, 0.85), racket=(0.10, 0.48, -0.87), face=(-0.8, -0.5, 0.1),
        handL=(0.02, -0.36, 1.92), elbowL=(0.5, -0.3, -0.6), fingersL=(0, -0.4, 0.9), palmL=(0.3, -0.9, -0.3),
        braid=(6, -14, 10, -22),
    )
    hit = pose(
        hips=(0.0, -0.12, 0.30), hips_rot=(12, 6, 0), spine=(7, 8, -4), chest=(7, 12, -6), look=(-0.22, -0.56, 2.55),
        footL=(0.10, 0.30, 0.40), footL_rot=(-6, 78), footR=(-0.14, -0.26, 0.50), footR_rot=(-14, 30),
        handR=(-0.22, -0.40, 2.30), elbowR=(-0.6, 0.3, -0.2), racket=(-0.04, -0.36, 0.93), face=(0.0, -0.90, -0.44),
        handL=(0.18, -0.24, 1.62), elbowL=(0.7, 0.3, -0.5), fingersL=(-0.5, -0.3, -0.6), palmL=(-0.5, 0.8, 0),
        braid=(0, 18, 0, 28),
    )
    follow = pose(
        hips=(0.03, -0.20, 0.10), hips_rot=(30, 30, 0), spine=(14, 10, 0), chest=(10, 12, 0), look=(-0.1, -2.4, 0.8),
        footL=(0.12, 0.10, 0.16), footL_rot=(-5, 40), footR=(-0.16, -0.34, 0.26), footR_rot=(-12, 20),
        handR=(0.24, -0.56, 1.10), elbowR=(-0.4, 0.4, -0.6), racket=(0.55, 0.06, -0.83), face=(0.5, -0.8, 0.2),
        handL=(0.30, -0.16, 1.16), elbowL=(0.8, 0.3, -0.4), fingersL=(0, -0.4, -0.9), palmL=(-1, 0, 0),
        braid=(0, -18, 0, -30),
    )
    land = pose(
        hips=(0.02, -0.14, -0.24), hips_rot=(30, 16, 0), spine=(14, 5, 0), chest=(9, 6, 0), look=(0.0, -4.0, 1.2),
        footL=(0.16, 0.02, 0.0), footL_rot=(6, 8), footR=(-0.20, -0.40, 0.0), footR_rot=(-14, 0),
        handR=(0.24, -0.46, 0.76), elbowR=(-0.7, 0.3, -0.5), racket=(0.60, -0.10, -0.60), face=(0.6, 0.2, 0.7),
        handL=(0.34, -0.20, 0.98), elbowL=(0.9, 0.2, -0.4), fingersL=(0, -0.5, -0.8), palmL=(-1, 0, 0),
        braid=(0, 14, 0, 22),
    )
    return _golpe('remate', 1.30, 0.62, [K(0.0, pose(), True), K(0.24, trophy), K(0.43, load, True), K(0.54, drop), K(0.62, hit),
                                         K(0.72, follow), K(0.84, land, True), K(0.98, land, True), K(1.30, pose(), True)],
                  '¡Remate!', (0.24, 0.43), 'derecha')


# ---------------------------------------------------------------------------
# Globo: bien abajo, cara de la pala abierta, y todo el cuerpo sube detrás de la pelota
# ---------------------------------------------------------------------------
def _globo():
    atras = (-0.38, 0.14, 0.0)
    paso = (0.16, -0.36, 0.0)
    arm = pose(
        hips=(-0.10, 0.10, -0.26), hips_rot=(18, -46, 0), spine=(10, -16, 0), chest=(6, -20, 0), look=(-0.8, -2.6, 0.7),
        footR=atras, footR_rot=(-64, 0), footL=PIE_L, footL_rot=(-18, 18),
        handR=(-0.46, 0.34, 0.72), elbowR=(-0.5, 0.6, -0.6), racket=(-0.35, 0.66, -0.30), face=(-0.3, -0.3, -0.9),
        handL=(0.12, -0.50, 1.02), elbowL=(0.6, 0.2, -0.7), fingersL=(0.15, -0.95, 0.2), palmL=(0, 0.2, -1),
        braid=(12, 2, 18, 4),
    )
    load = pose(arm, hips=(-0.12, 0.12, -0.33), hips_rot=(20, -52, 0), handR=(-0.48, 0.40, 0.64), racket=(-0.40, 0.66, -0.44), braid=(14, 8, 22, 12))
    hit = pose(
        hips=(0.02, -0.08, -0.20), hips_rot=(8, -14, 0), spine=(2, -5, 0), chest=(-2, 0, 0), look=(-0.80, -0.56, 0.72),
        footR=atras, footR_rot=(-42, 34), footL=paso, footL_rot=(-8, 0),
        handR=(-0.48, -0.36, 0.82), elbowR=(-0.3, 0.5, -0.8), racket=(-0.85, -0.30, -0.42), face=(0.0, -0.76, 0.65),
        handL=(0.28, -0.28, 1.00), elbowL=(0.7, 0.5, -0.6), fingersL=(-0.3, -0.8, -0.3), palmL=(-0.7, 0.6, 0),
        braid=(-10, 6, -16, 10),
    )
    follow = pose(
        hips=(0.05, -0.14, 0.00), hips_rot=(-2, 10, 0), spine=(-6, 6, 0), chest=(-8, 8, 0), look=(-0.2, -2.6, 4.6),
        footR=(-0.24, -0.06, 0.0), footR_rot=(-18, 52), footL=paso, footL_rot=(-6, 22),
        handR=(-0.16, -0.46, 1.74), elbowR=(-0.6, 0.2, -0.6), racket=(0.04, -0.24, 0.97), face=(0.1, -0.9, 0.3),
        handL=(0.34, -0.04, 1.04), elbowL=(0.8, 0.4, -0.4), fingersL=(0.1, -0.5, -0.8), palmL=(-1, 0, 0),
        braid=(-4, 16, -8, 26),
    )
    end = pose(follow, hips=(0.05, -0.14, 0.03), handR=(-0.06, -0.40, 1.86), racket=(0.16, 0.0, 0.99), look=(-0.1, -3.0, 6.0), braid=(0, 6, 0, 10))
    return _golpe('globo', 1.08, 0.54, [K(0.0, pose(), True), K(0.22, arm), K(0.42, load, True), K(0.54, hit), K(0.68, follow),
                                        K(0.82, end, True), K(1.08, pose(), True)], 'Globo', (0.22, 0.42), 'derecha')


# ---------------------------------------------------------------------------
# Saque: de costado, deja caer la pelota y le pega por abajo después del pique
# ---------------------------------------------------------------------------
def _saque():
    ade = (0.08, -0.26, 0.0)
    atras = (-0.24, 0.14, 0.0)
    start = pose(
        hips=(-0.03, 0.02, -0.06), hips_rot=(7, -42, 0), spine=(4, -8, 0), chest=(4, -10, 0), look=(-0.25, -0.85, 0.2),
        footL=ade, footL_rot=(-26, 0), footR=atras, footR_rot=(-64, 0),
        handL=(-0.22, -0.44, 1.10), elbowL=(0.6, 0.2, -0.7), fingersL=(-0.55, -0.80, 0.1), palmL=(0, 0, 1),
        handR=(-0.36, 0.22, 0.98), elbowR=(-0.5, 0.7, -0.4), racket=(-0.25, 0.55, -0.50), face=(-0.8, -0.5, -0.3),
        braid=(8, 0, 12, 0),
    )
    release = pose(start, handL=(-0.22, -0.44, 1.05), fingersL=(-0.55, -0.80, -0.1), palmL=(0.2, 0.2, 1))
    back = pose(
        start, hips=(-0.08, 0.08, -0.14), hips_rot=(10, -56, 0), chest=(4, -16, 2),
        handR=(-0.46, 0.44, 1.14), racket=(-0.30, 0.52, 0.66), face=(-0.9, -0.2, -0.3),
        handL=(-0.06, -0.40, 0.98), fingersL=(-0.4, -0.8, -0.4), palmL=(-0.7, 0.5, 0.2), footL_rot=(-26, 14), braid=(12, 2, 18, 4),
    )
    hit = pose(
        hips=(0.03, -0.10, -0.13), hips_rot=(13, -14, 0), spine=(6, -3, 0), chest=(5, 2, 0), look=(-0.34, -0.66, 0.50),
        footL=ade, footL_rot=(-22, 0), footR=atras, footR_rot=(-40, 36),
        handR=(-0.24, -0.32, 0.86), elbowR=(-0.5, 0.5, -0.6), racket=(-0.20, -0.45, -0.87), face=(0.1, -0.85, 0.5),
        handL=(0.26, -0.28, 1.02), elbowL=(0.7, 0.5, -0.6), fingersL=(-0.3, -0.8, -0.3), palmL=(-0.7, 0.6, 0),
        braid=(-10, 6, -16, 10),
    )
    follow = pose(
        hips=(0.05, -0.15, -0.06), hips_rot=(8, 14, 0), spine=(3, 6, 0), chest=(2, 14, 0), look=(-0.1, -4.0, 1.6),
        footL=ade, footL_rot=(-16, 0), footR=atras, footR_rot=(-22, 54),
        handR=(-0.02, -0.52, 1.36), elbowR=(-0.6, 0.2, -0.6), racket=(0.28, -0.32, 0.90), face=(0.6, -0.7, 0.2),
        handL=(0.30, -0.08, 1.02), elbowL=(0.8, 0.4, -0.4), fingersL=(0.1, -0.5, -0.8), palmL=(-1, 0, 0),
        braid=(-14, 8, -20, 12),
    )
    end = pose(follow, handR=(0.06, -0.44, 1.44), racket=(0.36, -0.10, 0.93), look=(0.0, -6.0, 1.9), braid=(6, 4, 10, 6))
    return _golpe('saque', 1.40, 0.84, [K(0.0, start, True), K(0.20, release), K(0.56, back, True), K(0.76, pose(back, hips=(-0.04, 0.02, -0.18), hips_rot=(12, -36, 0), handR=(-0.50, 0.20, 0.84), racket=(-0.30, 0.75, -0.55), face=(-0.6, -0.5, -0.6), look=(-0.34, -0.66, 0.40))),
                                        K(0.84, hit), K(0.96, follow), K(1.08, end, True), K(1.40, pose(), True)],
                  'Saque', (0.30, 0.56), 'derecha', release=0.20)


# ---------------------------------------------------------------------------
# Estiradas: llegar con lo justo. Zancada larga, el cuerpo se tira detrás de la pala y el brazo libre equilibra
# ---------------------------------------------------------------------------
def _estirada():
    lejos = (-0.94, -0.22, 0.0)
    go = pose(
        hips=(-0.14, 0.02, -0.20), hips_rot=(16, -30, -8), spine=(9, -8, -4), chest=(6, -8, -4), look=(-1.6, -1.2, 0.6),
        footL_rot=(-10, 30), footR=(-0.50, -0.14, 0.10), footR_rot=(-50, 10),
        handR=(-0.62, -0.10, 0.98), elbowR=(-0.5, 0.6, -0.6), racket=(-0.70, 0.30, 0.64), face=(-0.3, -0.8, 0.5),
        handL=(0.30, -0.30, 1.16), elbowL=(0.8, 0.3, -0.5), fingersL=(0.3, -0.8, 0.4), palmL=(-0.4, 0.4, -0.8),
        braid=(16, 4, 26, 6),
    )
    hit = pose(
        hips=(-0.43, -0.08, -0.37), hips_rot=(18, -50, -12), spine=(10, -10, -12), chest=(6, -6, -10), look=(-1.62, -0.44, 0.56),
        footL_rot=(-34, 40), footR=lejos, footR_rot=(-62, 0), kneeR=(-12,),
        handR=(-1.32, -0.34, 0.62), elbowR=(-0.3, 0.5, -0.8), racket=(-0.95, -0.25, -0.18), face=(0.1, -0.85, 0.5),
        handL=(0.34, 0.26, 1.02), elbowL=(0.8, 0.5, -0.3), fingersL=(0.85, 0.5, -0.1), palmL=(0, 0, -1),
        braid=(26, 6, 40, 10),
    )
    past = pose(hit, hips=(-0.45, -0.10, -0.40), handR=(-1.30, -0.50, 0.74), racket=(-0.88, -0.42, 0.20), face=(0.15, -0.75, 0.65),
                handL=(0.38, 0.32, 0.96), braid=(-10, 10, -18, 16))
    back = pose(
        hips=(-0.22, -0.02, -0.22), hips_rot=(17, -18, -4), spine=(9, -4, -3), chest=(6, -4, -2), look=(-0.4, -5.0, 1.6),
        footL_rot=(6, 12), footR=(-0.60, -0.16, 0.0), footR_rot=(-40, 20),
        handR=(-0.50, -0.34, 0.96), elbowR=(-0.7, 0.4, -0.5), racket=(-0.30, -0.40, 0.86), face=(0.5, -0.8, 0.2),
        handL=(0.24, -0.34, 1.10), braid=(-14, 6, -22, 10),
    )
    return _golpe('estirada', 0.92, 0.36, [K(0.0, pose(), True), K(0.15, go), K(0.36, hit), K(0.47, past, True), K(0.66, back), K(0.92, pose(), True)],
                  None, (0.0, 0.10), 'derecha', reach=True)


def _estirada_reves():
    lejos = (0.94, -0.22, 0.0)                    # espejo de la otra: abre el pie izquierdo y cruza el brazo
    go = pose(
        hips=(0.14, 0.02, -0.20), hips_rot=(16, 34, 8), spine=(9, 12, 4), chest=(6, 14, 4), look=(1.6, -1.2, 0.6),
        footR_rot=(10, 30), footL=(0.50, -0.14, 0.10), footL_rot=(50, 10),
        handR=(0.40, -0.26, 1.02), elbowR=(-0.3, 0.2, -0.9), racket=(0.55, 0.30, 0.78), face=(-0.3, 0.9, -0.3),
        handL=(0.34, 0.06, 1.14), elbowL=(0.7, 0.6, -0.4), fingersL=(-0.5, 0.5, 0.6), palmL=(-0.8, -0.4, 0),
        braid=(-16, 4, -26, 6),
    )
    hit = pose(
        hips=(0.43, -0.08, -0.37), hips_rot=(18, 52, 12), spine=(10, 14, 12), chest=(6, 12, 10), look=(1.56, -0.52, 0.58),
        footR_rot=(34, 40), footL=lejos, footL_rot=(62, 0), kneeL=(12,),
        handR=(1.24, -0.46, 0.64), elbowR=(0.2, 0.3, -0.9), racket=(0.95, -0.22, -0.20), face=(-0.1, 0.85, -0.5),
        handL=(0.02, 0.50, 1.04), elbowL=(0.2, 0.9, -0.3), fingersL=(-0.6, 0.75, -0.1), palmL=(0, 0, -1),
        braid=(-26, 6, -40, 10),
    )
    past = pose(hit, hips=(0.45, -0.10, -0.40), handR=(1.18, -0.64, 0.78), racket=(0.86, -0.44, 0.26), face=(-0.1, 0.72, -0.68),
                handL=(-0.02, 0.56, 0.98), braid=(10, 10, 18, 16))
    back = pose(
        hips=(0.22, -0.02, -0.22), hips_rot=(17, 22, 4), spine=(9, 6, 3), chest=(6, 6, 2), look=(0.4, -5.0, 1.6),
        footR_rot=(-6, 12), footL=(0.60, -0.16, 0.0), footL_rot=(40, 20),
        handR=(0.36, -0.52, 0.98), elbowR=(-0.4, 0.4, -0.8), racket=(0.45, -0.25, 0.86), face=(-0.3, 0.9, -0.2),
        handL=(0.34, -0.14, 1.10), elbowL=(0.8, 0.4, -0.4), fingersL=(-0.3, -0.5, 0.6), palmL=(-0.7, 0.5, 0),
        braid=(14, 6, 22, 10),
    )
    return _golpe('estirada_reves', 0.92, 0.36, [K(0.0, pose(), True), K(0.15, go), K(0.36, hit), K(0.47, past, True), K(0.66, back),
                                                 K(0.92, pose(), True)], None, (0.0, 0.10), 'reves', reach=True)


def clips():
    return [_saque(), _derecha(), _reves(), _volea(), _volea_reves(), _bandeja(), _remate(), _globo(), _estirada(), _estirada_reves()]
