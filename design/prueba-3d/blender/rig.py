"""Esqueleto y resolución de poses.

Una pose es un diccionario de controles (pelvis, columna, pies, manos, pala). `solve` la
convierte en la transformación de cada hueso: posición de su articulación y rotación en el
espacio del personaje. Piernas y brazos se resuelven con cinemática inversa de dos huesos.

La misma salida sirve para deformar la malla en Blender (sprites) y para exportar la animación
al navegador (tiempo real).
"""
import math

from mathutils import Matrix, Quaternion, Vector

import personaje

NAMES, REST, PARENTS = personaje.skeleton()
I3 = Matrix.Identity(3)


def rot(lean=0.0, twist=0.0, side=0.0):
    """side (rolido a la izquierda), después lean (inclinación hacia adelante), después twist (giro a la izquierda)."""
    return (Matrix.Rotation(math.radians(twist), 3, 'Z') @ Matrix.Rotation(math.radians(lean), 3, 'X')
            @ Matrix.Rotation(math.radians(side), 3, 'Y'))


def frame(y, z_hint):
    y = Vector(y).normalized()
    z = Vector(z_hint) - y * Vector(z_hint).dot(y)
    if z.length < 1e-5:
        z = Vector((0, 0, 1)) - y * y.z
        if z.length < 1e-5:
            z = Vector((1, 0, 0))
    z.normalize()
    x = y.cross(z)
    m = Matrix((x, y, z))
    m.transpose()
    return m


def align(rest_y, rest_z, pose_y, pose_z):
    return frame(pose_y, pose_z) @ frame(rest_y, rest_z).transposed()


def ik2(a, t, l1, l2, pole):
    d = Vector(t) - Vector(a)
    dist = max(abs(l1 - l2) + 1e-4, min(l1 + l2 - 1e-4, d.length))
    dr = d.normalized() if d.length > 1e-6 else Vector((0, 0, -1))
    ca = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    sa = math.sqrt(max(0.0, 1 - ca * ca))
    bend = Vector(pole) - dr * Vector(pole).dot(dr)
    if bend.length < 1e-5:
        bend = Vector((0, -1, 0)) - dr * (-dr.y)
    bend.normalize()
    mid = Vector(a) + dr * (l1 * ca) + bend * (l1 * sa)
    return mid, Vector(a) + dr * dist, bend


BALL = {s: REST['toe' + s] - REST['foot' + s] for s in ('.L', '.R')}
L_THIGH = (REST['shin.L'] - REST['thigh.L']).length
L_SHIN = (REST['foot.L'] - REST['shin.L']).length
L_UPPER = (REST['forearm.L'] - REST['upper_arm.L']).length
L_FORE = (REST['hand.L'] - REST['forearm.L']).length

DEFAULT = {
    'hips': (0.0, 0.0, 0.0), 'hips_rot': (0.0, 0.0, 0.0),
    'spine': (0.0, 0.0, 0.0), 'chest': (0.0, 0.0, 0.0), 'head': (0.0, 0.0, 0.0),
    'footL': (0.10, -0.12, 0.0), 'footL_rot': (8.0, 0.0), 'kneeL': (0.0,),
    'footR': (-0.10, -0.12, 0.0), 'footR_rot': (-8.0, 0.0), 'kneeR': (0.0,),
    'handR': (-0.26, -0.06, 0.92), 'elbowR': (-0.5, 0.7, -0.5), 'racket': (0.1, -0.75, -0.65), 'face': (1.0, 0.0, 0.0),
    'handL': (0.26, -0.04, 0.90), 'elbowL': (0.5, 0.7, -0.5), 'fingersL': (0.0, -0.25, -1.0), 'palmL': (-1.0, 0.0, 0.0),
    'braid': (0.0, 0.0, 0.0, 0.0),   # empuje extra: (x, y) de la mitad y de la punta
}


def solve(pose):
    """Devuelve {hueso: (P, R)}: posición de la articulación y rotación, en el espacio del personaje."""
    p = dict(DEFAULT)
    p.update(pose)
    out = {}

    def child(name, parent, R_local):
        Pp, Rp = out[parent]
        P = Pp + Rp @ (REST[name] - REST[parent])
        out[name] = (P, Rp @ R_local)
        return out[name]

    hl, ht, hs = p['hips_rot']
    out['hips'] = (REST['hips'] + Vector(p['hips']), rot(hl, ht, hs))
    child('spine', 'hips', rot(*p['spine']))
    child('chest', 'spine', rot(*p['chest']))
    l, t, s = p['head']
    child('neck', 'chest', rot(l * 0.4, t * 0.4, s * 0.4))
    child('head', 'neck', rot(l * 0.6, t * 0.6, s * 0.6))

    # trenza: tiende a colgar; sigue un poco a la cabeza y se apoya en la espalda
    Rh = out['head'][1]
    Rc = out['chest'][1]
    bx1, by1, bx2, by2 = p['braid']
    qh, qc, qi = Rh.to_quaternion(), Rc.to_quaternion(), Quaternion()
    r1 = qi.slerp(qh, 0.55).to_matrix() @ rot(-by1 * 0.5, 0, bx1 * 0.5)
    r2 = qi.slerp(qc, 0.55).to_matrix() @ rot(-by1, 0, bx1)
    r3 = qi.slerp(qc, 0.45).to_matrix() @ rot(-by2, 0, bx2)
    P1 = out['head'][0] + Rh @ (REST['braid1'] - REST['head'])
    out['braid1'] = (P1, r1)
    P2 = P1 + r1 @ (REST['braid2'] - REST['braid1'])
    out['braid2'] = (P2, r2)
    out['braid3'] = (P2 + r2 @ (REST['braid3'] - REST['braid2']), r3)

    # piernas
    for side, sx in (('.L', 1.0), ('.R', -1.0)):
        k = 'L' if sx > 0 else 'R'
        bx, by, lift = p['foot' + k]
        yaw, heel = p['foot' + k + '_rot']
        Rf = Matrix.Rotation(math.radians(yaw), 3, 'Z') @ Matrix.Rotation(math.radians(heel), 3, 'X')
        ball = Vector((bx, by, REST['toe' + side].z + lift))
        ankle = ball - Rf @ BALL[side]
        Ph, Rhips = out['hips']
        hip = Ph + Rhips @ (REST['thigh' + side] - REST['hips'])
        kn = p['knee' + k][0]
        fwd = Matrix.Rotation(math.radians(yaw * 0.75 + ht * 0.25 + kn), 3, 'Z') @ Vector((0, -1, 0))
        pole = fwd + Vector((0.12 * sx, 0, 0.0))
        knee, ank, bend = ik2(hip, ankle, L_THIGH, L_SHIN, pole)
        ry = (REST['shin' + side] - REST['thigh' + side])
        out['thigh' + side] = (hip, align(ry, (0, -1, 0), knee - hip, bend))
        ry2 = (REST['foot' + side] - REST['shin' + side])
        out['shin' + side] = (knee, align(ry2, (0, -1, 0), ank - knee, bend))
        out['foot' + side] = (ank, Rf)
        planted = max(0.0, min(1.0, 1.0 - lift / 0.06))
        Rt = Matrix.Rotation(math.radians(yaw), 3, 'Z') @ Matrix.Rotation(math.radians(heel * (1 - planted)), 3, 'X')
        out['toe' + side] = (ank + Rf @ BALL[side], Rt)

    # brazos
    Pc, Rc = out['chest']
    for side, sx in (('.L', 1.0), ('.R', -1.0)):
        k = 'L' if sx > 0 else 'R'
        target = Vector(p['hand' + k])
        sh_rest = Pc + Rc @ (REST['upper_arm' + side] - REST['chest'])
        d = target - sh_rest
        dl = Rc.transposed() @ d
        el = math.degrees(math.asin(max(-1, min(1, dl.z / max(1e-5, dl.length)))))
        shrug = max(0.0, min(1.0, (el - 10.0) / 55.0)) * 27.0
        prot = max(-0.4, min(1.0, -dl.y / max(1e-5, dl.length))) * 13.0
        Rcl = Matrix.Rotation(math.radians(-sx * shrug), 3, 'Y') @ Matrix.Rotation(math.radians(-sx * prot), 3, 'Z')
        Pcl, Rclw = child('clav' + side, 'chest', Rcl)
        sh = Pcl + Rclw @ (REST['upper_arm' + side] - REST['clav' + side])
        elbow, wrist, bend = ik2(sh, target, L_UPPER, L_FORE, p['elbow' + k])
        ax = Vector((sx, 0, 0))
        out['upper_arm' + side] = (sh, align(ax, (0, 1, 0), elbow - sh, bend))
        Rfore = align(ax, (0, 1, 0), wrist - elbow, bend)
        out['forearm' + side] = (elbow, Rfore)
        if k == 'R':
            Rhand = align((0, -1, 0), (0, 0, -1), p['racket'], p['face'])
        else:
            Rhand = align((1, 0, 0), (0, 0, -1), p['fingersL'], p['palmL'])
        out['hand' + side] = (wrist, Rhand)
    Ph, Rhd = out['hand.R']
    out['racket'] = (Ph + Rhd @ (REST['racket'] - REST['hand.R']), Rhd)
    return out


def racket_center(solved):
    """Centro de la cara de la pala (para alinear el golpe con la pelota)."""
    P, R = solved['racket']
    return P + R @ Vector((0, -0.272 - 0.0, 0))


# ---------------------------------------------------------------------------
# Blender
# ---------------------------------------------------------------------------

def build_armature(name='rig'):
    import bpy
    arm = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    for n in NAMES:
        b = arm.edit_bones.new(n)
        b.head = REST[n]
        b.tail = REST[n] + Vector((0, 0.05, 0))   # apuntando a +Y con roll 0: rotación de reposo identidad
        b.roll = 0.0
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def bind(mesh_obj, arm_obj):
    mod = mesh_obj.modifiers.new('rig', 'ARMATURE')
    mod.object = arm_obj
    # el esqueleto deforma antes que el contorno
    import bpy
    while mesh_obj.modifiers[0] != mod:
        with bpy.context.temp_override(object=mesh_obj):
            bpy.ops.object.modifier_move_up(modifier=mod.name)
    return mod


def apply(arm_obj, solved, offset=(0, 0, 0), yaw=0.0):
    """Lleva la pose resuelta a los huesos (todos sin padre, con rotación de reposo identidad)."""
    Ryaw = Matrix.Rotation(math.radians(yaw), 3, 'Z')
    off = Vector(offset)
    for n in NAMES:
        P, R = solved[n]
        pb = arm_obj.pose.bones[n]
        rest = pb.bone.matrix_local
        world = Matrix.Translation(Ryaw @ P + off) @ (Ryaw @ R).to_4x4()
        pb.matrix_basis = rest.inverted() @ world @ Matrix.Translation(-REST[n]) @ rest


def local_quats(solved):
    """Rotación local de cada hueso respecto de su padre (para exportar)."""
    q = {}
    for n in NAMES:
        R = solved[n][1]
        par = PARENTS[n]
        Rl = (solved[par][1].transposed() @ R) if par else R
        q[n] = Rl.to_quaternion()
    return q
