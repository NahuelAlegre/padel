"""Utilidades de modelado por script (Blender 5.x, sin addons).

Todo el personaje sale de tres generadores:
  - sweep(): un tubo que sigue un camino, con secciones superelípticas que cambian a lo largo.
  - plate(): una placa fina a partir de una superficie paramétrica.
  - decal(): un polígono plano proyectado sobre otra malla (ojos, cejas, boca).

Las piezas se guardan en `Part` (vértices, caras, material por cara, pesos por hueso y ancho de
contorno por vértice) y recién al final se convierten en una malla de Blender.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


def smooth(a, b, x):
    """Smoothstep entre a y b (vale también con a > b)."""
    if a == b:
        return 0.0 if x < a else 1.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


class Part:
    """Una pieza de malla con sus datos por vértice y por cara."""

    def __init__(self, name):
        self.name = name
        self.verts = []    # Vector
        self.faces = []    # tuplas de índices
        self.fmat = []     # nombre de material por cara
        self.meta = []     # dict por vértice: s (índice de sección), a (ángulo), u (0..1)
        self.weights = []  # dict hueso -> peso, por vértice
        self.outline = []  # 0..1 por vértice: cuánto contorno lleva

    def add_vert(self, co, **meta):
        self.verts.append(Vector(co))
        self.meta.append(meta)
        self.weights.append({})
        self.outline.append(1.0)
        return len(self.verts) - 1

    def add_face(self, idx, mat):
        self.faces.append(tuple(idx))
        self.fmat.append(mat)

    def set_weights(self, fn):
        """fn(co, meta) -> dict hueso->peso. Se normaliza."""
        for i, co in enumerate(self.verts):
            w = {k: v for k, v in fn(co, self.meta[i]).items() if v > 1e-4}
            total = sum(w.values()) or 1.0
            self.weights[i] = {k: v / total for k, v in w.items()}
        return self

    def rigid(self, bone):
        for i in range(len(self.verts)):
            self.weights[i] = {bone: 1.0}
        return self

    def set_outline(self, fn):
        for i, co in enumerate(self.verts):
            self.outline[i] = fn(co, self.meta[i]) if callable(fn) else fn
        return self

    def transform(self, m):
        for i, co in enumerate(self.verts):
            self.verts[i] = m @ co
        if m.determinant() < 0:
            self.faces = [tuple(reversed(f)) for f in self.faces]
        return self

    def mirrored(self, name=None):
        """Copia espejada en X; los huesos .L pasan a .R y viceversa."""
        def swap(b):
            if b.endswith('.L'):
                return b[:-2] + '.R'
            if b.endswith('.R'):
                return b[:-2] + '.L'
            return b
        p = Part(name or self.name.replace('.L', '.R'))
        p.verts = [Vector((-v.x, v.y, v.z)) for v in self.verts]
        p.faces = [tuple(reversed(f)) for f in self.faces]
        p.fmat = list(self.fmat)
        p.meta = [dict(m) for m in self.meta]
        p.weights = [{swap(k): v for k, v in w.items()} for w in self.weights]
        p.outline = list(self.outline)
        return p

    def extend(self, other):
        off = len(self.verts)
        self.verts += [v.copy() for v in other.verts]
        self.meta += [dict(m) for m in other.meta]
        self.weights += [dict(w) for w in other.weights]
        self.outline += list(other.outline)
        self.faces += [tuple(i + off for i in f) for f in other.faces]
        self.fmat += list(other.fmat)
        return self


def _sec(d):
    """Normaliza una sección: p, rx, rf (frente), rb (atrás), e (exponente), sharp."""
    r = d.get('r')
    rx = d.get('rx', r)
    ry = d.get('ry', r if r is not None else rx)
    return {
        'p': Vector(d['p']), 'rx': rx, 'rf': d.get('rf', ry), 'rb': d.get('rb', ry),
        'e': d.get('e', 2.0), 'sharp': d.get('sharp', False),
    }


def spline_sections(secs, steps):
    """Interpola las secciones con Catmull-Rom. Devuelve (lista, índice fraccionario)."""
    S = [_sec(s) for s in secs]
    n = len(S)
    out = []

    def get(i, j):
        # vecino i visto desde el tramo j..j+1, respetando secciones 'sharp' y extremos
        if i < 0:
            return None
        if i >= n:
            return None
        return S[i]

    for i in range(n - 1):
        a, b = S[i], S[i + 1]
        pa = S[i - 1] if (i - 1 >= 0 and not a['sharp']) else None
        pb = S[i + 2] if (i + 2 < n and not b['sharp']) else None
        k = steps if not (a['sharp'] and b['sharp']) else 1
        for j in range(k):
            t = j / k
            cur = {}
            for key in ('p', 'rx', 'rf', 'rb', 'e'):
                v0 = pa[key] if pa else a[key] - (b[key] - a[key])
                v3 = pb[key] if pb else b[key] + (b[key] - a[key])
                cur[key] = catmull(v0, a[key], b[key], v3, t)
            cur['s'] = i + t
            out.append(cur)
    last = dict(S[-1])
    last['s'] = float(n - 1)
    out.append(last)
    return out


def ring_point(theta, rx, rf, rb, e):
    c, s = math.cos(theta), math.sin(theta)
    k = 2.0 / e
    x = rx * math.copysign(abs(c) ** k, c)
    y = (rb if s >= 0 else rf) * math.copysign(abs(s) ** k, s)
    return x, y


def sweep(part, secs, n=10, steps=2, cap0='round', cap1='round', closed=False, mat='mat',
          front=(0, -1, 0), ang0=0.0, capk=0.75, frames=None, twist=None):
    """Tubo a lo largo de un camino.

    secs: lista de dicts {p, r | rx, ry | rf, rb, e, sharp}. El eje local X es lateral, el local Y
    apunta 'atrás' (contrario a `front`) y la tangente sigue el camino. rf es el radio hacia el
    frente y rb hacia atrás. mat puede ser un nombre o fn(s, ang) -> nombre.
    """
    S = spline_sections(secs, steps) if steps > 1 else [dict(_sec(s), s=float(i)) for i, s in enumerate(secs)]
    m = len(S)
    fr = Vector(front).normalized()
    rings = []
    base = len(part.verts)
    total_len = sum((S[i + 1]['p'] - S[i]['p']).length for i in range(m - 1)) or 1.0
    acc = 0.0
    prev_y = None
    for i, s in enumerate(S):
        if closed:
            tan = S[(i + 1) % m]['p'] - S[(i - 1) % m]['p']
        elif i == 0:
            tan = S[1]['p'] - S[0]['p']
        elif i == m - 1:
            tan = S[-1]['p'] - S[-2]['p']
        else:
            tan = S[i + 1]['p'] - S[i - 1]['p']
        tan.normalize()
        if frames is not None:
            yb = Vector(frames(s['s'])).normalized()
            yb = (yb - tan * yb.dot(tan)).normalized()
        else:
            yb = -fr - tan * (-fr).dot(tan)
            if yb.length < 1e-4:
                yb = prev_y.copy() if prev_y else Vector((0, 1, 0))
            yb.normalize()
        prev_y = yb
        xl = yb.cross(tan).normalized()
        if i > 0:
            acc += (s['p'] - S[i - 1]['p']).length
        tw = twist(s['s']) if twist else 0.0
        ring = []
        for k in range(n):
            th = ang0 + tw + 2 * math.pi * k / n
            x, y = ring_point(th, s['rx'], s['rf'], s['rb'], s['e'])
            co = s['p'] + xl * x + yb * y
            ring.append(part.add_vert(co, s=s['s'], a=(ang0 + 2 * math.pi * k / n) % (2 * math.pi), u=acc / total_len))
        rings.append((ring, s, tan, xl, yb))

    def mat_of(sv, ang):
        return mat(sv, ang) if callable(mat) else mat

    count = m if closed else m - 1
    for i in range(count):
        ra, sa = rings[i][0], rings[i][1]
        rb_, sb = rings[(i + 1) % m][0], rings[(i + 1) % m][1]
        smid = (sa['s'] + (sb['s'] if i + 1 < m else sa['s'] + 1)) * 0.5
        for k in range(n):
            k2 = (k + 1) % n
            ang = (ang0 + 2 * math.pi * (k + 0.5) / n) % (2 * math.pi)
            part.add_face((ra[k], ra[k2], rb_[k2], rb_[k]), mat_of(smid, ang))

    def cap(ring_data, sign, kind, sval):
        ring, s, tan, xl, yb = ring_data
        if kind == 'none':
            return
        ravg = (s['rx'] + (s['rf'] + s['rb']) * 0.5) * 0.5
        cur = ring
        if kind == 'round':
            for phi in (math.radians(38), math.radians(68)):
                sc, off = math.cos(phi), math.sin(phi) * ravg * capk
                new = []
                for k in range(n):
                    th = ang0 + 2 * math.pi * k / n
                    x, y = ring_point(th, s['rx'] * sc, s['rf'] * sc, s['rb'] * sc, s['e'])
                    co = s['p'] + xl * x + yb * y + tan * (sign * off)
                    new.append(part.add_vert(co, s=sval, a=(th) % (2 * math.pi), u=0.0 if sign < 0 else 1.0))
                for k in range(n):
                    k2 = (k + 1) % n
                    ang = (ang0 + 2 * math.pi * (k + 0.5) / n) % (2 * math.pi)
                    if sign > 0:
                        part.add_face((cur[k], cur[k2], new[k2], new[k]), mat_of(sval, ang))
                    else:
                        part.add_face((cur[k2], cur[k], new[k], new[k2]), mat_of(sval, ang))
                cur = new
            pole_off = ravg * capk
        else:
            pole_off = 0.0
        pole = part.add_vert(s['p'] + tan * (sign * pole_off), s=sval, a=0.0, u=0.0 if sign < 0 else 1.0)
        for k in range(n):
            k2 = (k + 1) % n
            ang = (ang0 + 2 * math.pi * (k + 0.5) / n) % (2 * math.pi)
            if sign > 0:
                part.add_face((cur[k], cur[k2], pole), mat_of(sval, ang))
            else:
                part.add_face((cur[k2], cur[k], pole), mat_of(sval, ang))

    if not closed:
        cap(rings[0], -1, cap0, S[0]['s'])
        cap(rings[-1], +1, cap1, S[-1]['s'])
    return part


def plate(part, fn, nu, nv, thickness, mat='mat', mat_edge=None):
    """Placa fina: fn(u, v) -> (punto, normal) con u, v en 0..1. Cierra el borde."""
    top, bot = [], []
    for i in range(nu + 1):
        rt, rb_ = [], []
        for j in range(nv + 1):
            p, nrm = fn(i / nu, j / nv)
            p, nrm = Vector(p), Vector(nrm).normalized()
            rt.append(part.add_vert(p + nrm * thickness * 0.5, s=i / nu, a=j / nv, u=i / nu))
            rb_.append(part.add_vert(p - nrm * thickness * 0.5, s=i / nu, a=j / nv, u=i / nu))
        top.append(rt)
        bot.append(rb_)
    me = mat_edge or mat
    for i in range(nu):
        for j in range(nv):
            part.add_face((top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]), mat)
            part.add_face((bot[i][j], bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j]), mat)
    for i in range(nu):
        part.add_face((top[i][0], bot[i][0], bot[i + 1][0], top[i + 1][0]), me)
        part.add_face((top[i][nv], top[i + 1][nv], bot[i + 1][nv], bot[i][nv]), me)
    for j in range(nv):
        part.add_face((top[0][j], top[0][j + 1], bot[0][j + 1], bot[0][j]), me)
        part.add_face((top[nu][j], bot[nu][j], bot[nu][j + 1], top[nu][j + 1]), me)
    return part


def ellipsoid(part, center, radii, n=8, rings=5, mat='mat', axis='Z'):
    """Elipsoide simple (para orejas, moño, pelota)."""
    c = Vector(center)
    secs = []
    for i in range(rings + 1):
        phi = -math.pi / 2 + math.pi * i / rings
        r = max(1e-4, math.cos(phi))
        secs.append((math.sin(phi), r))
    idx = []
    for h, r in secs[1:-1]:
        ring = []
        for k in range(n):
            th = 2 * math.pi * k / n
            if axis == 'Z':
                co = (radii[0] * r * math.cos(th), radii[1] * r * math.sin(th), radii[2] * h)
            elif axis == 'Y':
                co = (radii[0] * r * math.sin(th), radii[1] * h, radii[2] * r * math.cos(th))
            else:
                co = (radii[0] * h, radii[1] * r * math.cos(th), radii[2] * r * math.sin(th))
            ring.append(part.add_vert(c + Vector(co), s=h, a=th, u=(h + 1) / 2))
        idx.append(ring)
    def pole(sign):
        if axis == 'Z':
            return c + Vector((0, 0, radii[2] * sign))
        if axis == 'Y':
            return c + Vector((0, radii[1] * sign, 0))
        return c + Vector((radii[0] * sign, 0, 0))
    p0 = part.add_vert(pole(-1), s=-1, a=0, u=0)
    p1 = part.add_vert(pole(+1), s=1, a=0, u=1)
    for i in range(len(idx) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            part.add_face((idx[i][k], idx[i][k2], idx[i + 1][k2], idx[i + 1][k]), mat)
    for k in range(n):
        k2 = (k + 1) % n
        part.add_face((idx[0][k2], idx[0][k], p0), mat)
        part.add_face((idx[-1][k], idx[-1][k2], p1), mat)
    return part


def bvh_of(part):
    return BVHTree.FromPolygons([tuple(v) for v in part.verts], [tuple(f) for f in part.faces], all_triangles=False)


def decal(part, bvh, outline_pts, offset, mat='mat', direction=(0, 1, 0), origin_dist=0.5, center=None):
    """Polígono (lista de puntos 3D en un plano frente a la superficie) proyectado sobre `bvh`.

    Se arma como abanico desde el centro. `offset` lo separa de la superficie para que no parpadee.
    """
    d = Vector(direction).normalized()
    pts = [Vector(p) for p in outline_pts]
    c = Vector(center) if center is not None else sum(pts, Vector()) / len(pts)

    def proj(p):
        hit, nrm, _i, _d = bvh.ray_cast(p - d * origin_dist, d)
        if hit is None:
            return p, -d
        return hit + nrm * offset, nrm

    ci = part.add_vert(proj(c)[0], s=0, a=0, u=0)
    ring = [part.add_vert(proj(p)[0], s=1, a=0, u=1) for p in pts]
    for k in range(len(ring)):
        part.add_face((ci, ring[k], ring[(k + 1) % len(ring)]), mat)
    return part


def band_decal(part, bvh, center_pts, widths, offset, mat='mat', direction=(0, 1, 0), up=(0, 0, 1)):
    """Trazo grueso (ceja, párpado, boca): una tira que sigue `center_pts` con ancho variable."""
    d = Vector(direction).normalized()
    upv = Vector(up)
    pts = [Vector(p) for p in center_pts]
    rows = []
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        tan = (b - a).normalized()
        side = d.cross(tan).normalized()
        if side.dot(upv) < 0:
            side = -side
        w = widths[i] * 0.5
        row = []
        for q in (p - side * w, p + side * w):
            hit, nrm, _i, _d = bvh.ray_cast(q - d * 0.5, d)
            row.append(part.add_vert((hit + nrm * offset) if hit is not None else q, s=i, a=0, u=i / max(1, len(pts) - 1)))
        rows.append(row)
    for i in range(len(rows) - 1):
        a0, a1 = rows[i]
        b0, b1 = rows[i + 1]
        part.add_face((a0, b0, b1, a1), mat)
    return part


def circle_pts(cx, cz, rx, rz, y, n=12, rot=0.0, e=2.0):
    out = []
    for k in range(n):
        th = 2 * math.pi * k / n
        x, z = ring_point(th, rx, rz, rz, e)
        xr = x * math.cos(rot) - z * math.sin(rot)
        zr = x * math.sin(rot) + z * math.cos(rot)
        out.append((cx + xr, y, cz + zr))
    return out


# ---------------------------------------------------------------------------
# De Part a malla de Blender
# ---------------------------------------------------------------------------

def to_object(parts, name, materials, collection=None, sharp_angle=50.0):
    """Une las piezas en un objeto con ranuras de material y grupos de vértices."""
    verts, faces, fmat, weights, outline = [], [], [], [], []
    for p in parts:
        off = len(verts)
        verts += [tuple(v) for v in p.verts]
        faces += [tuple(i + off for i in f) for f in p.faces]
        fmat += p.fmat
        weights += p.weights
        outline += p.outline
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    names = []
    for m in fmat:
        if m not in names:
            names.append(m)
    for m in names:
        mesh.materials.append(materials[m])
    for poly, m in zip(mesh.polygons, fmat):
        poly.material_index = names.index(m)
        poly.use_smooth = True
    try:
        mesh.set_sharp_from_angle(angle=math.radians(sharp_angle))
    except Exception as ex:  # API vieja
        print('set_sharp_from_angle no disponible:', ex)
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    groups = {}
    for i, w in enumerate(weights):
        for bone, val in w.items():
            if bone not in groups:
                groups[bone] = obj.vertex_groups.new(name=bone)
            groups[bone].add([i], val, 'REPLACE')
    og = obj.vertex_groups.new(name='_outline')
    for i, val in enumerate(outline):
        og.add([i], max(0.0, min(1.0, val)), 'REPLACE')
    return obj
