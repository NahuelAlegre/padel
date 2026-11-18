"""«Revelado» de los renders de la cancha: curva de tonos, bruma, resplandor, cielo y exportación.

Uso: blender -b --factory-startup --python revelar.py -- carpeta_exr modo [carpeta_salida]
  modo: vista  -> vista.png (todo junto, para revisar)
        capas  -> capas WebP recortadas + cancha.json en carpeta_salida

El cielo se pinta por código (degradé, sol, nubes y sierras): es un telón, no parte de la escena 3D,
porque con la cámara real del juego el horizonte queda fuera de cuadro.
"""
import json
import math
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, MODE = argv[0], argv[1]
DST = argv[2] if len(argv) > 2 else SRC

EXPOSURE = 0.86
SUN_SCREEN = (0.275, 0.268)      # posición aparente del sol en el cuadro de diseño (x, y de 0 a 1)
HORIZON = 0.305                  # altura del horizonte pintado, en el cuadro de diseño
OVER_X, OVER_Y = 1.12, 1.20


def load(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)[::-1].copy()      # fila 0 = arriba


def save(arr, path, quality=90):
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1), dtype=arr.dtype)], axis=2)
    img = bpy.data.images.new('out', w, h, alpha=True)
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(np.clip(arr[::-1], 0, 1).astype(np.float32).ravel())
    ext = os.path.splitext(path)[1].lower()
    img.file_format = {'.png': 'PNG', '.webp': 'WEBP', '.jpg': 'JPEG'}[ext]
    img.filepath_raw = path
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)


def to_srgb(y):
    y = np.clip(y, 0, 1)
    return np.where(y <= 0.0031308, 12.92 * y, 1.055 * np.power(y, 1 / 2.4) - 0.055)


def tone(rgb):
    """Curva fílmica suave (aproximación ACES) y un poco más de saturación."""
    x = rgb * EXPOSURE
    y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)
    y = np.clip(y, 0, 1)
    lum = (y * np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).sum(axis=2, keepdims=True)
    y = lum + (y - lum) * 1.16
    return to_srgb(y)


def value_noise(w, h, fx, fy, seed):
    rng = np.random.default_rng(seed)
    gx, gy = int(fx) + 2, int(fy) + 2
    grid = rng.random((gy, gx)).astype(np.float32)
    xs = np.linspace(0, fx, w, dtype=np.float32)
    ys = np.linspace(0, fy, h, dtype=np.float32)
    x0, y0 = np.floor(xs).astype(int), np.floor(ys).astype(int)
    tx, ty = xs - x0, ys - y0
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = grid[np.ix_(y0, x0)]
    b = grid[np.ix_(y0, x0 + 1)]
    c = grid[np.ix_(y0 + 1, x0)]
    d = grid[np.ix_(y0 + 1, x0 + 1)]
    top = a + (b - a) * tx[None, :]
    bot = c + (d - c) * tx[None, :]
    return top + (bot - top) * ty[:, None]


def fbm(w, h, fx, fy, seed, octaves=4):
    out = np.zeros((h, w), dtype=np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        out += value_noise(w, h, fx * 2 ** o, fy * 2 ** o, seed + o * 17) * amp
        total += amp
        amp *= 0.5
    return out / total


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def ramp(t, stops):
    """Degradé por tramos con transición suave. stops: [(posición, color hex)]."""
    out = np.zeros(t.shape + (3,), dtype=np.float32)
    out[...] = hexc(stops[0][1])
    for (p0, c0), (p1, c1) in zip(stops[:-1], stops[1:]):
        k = np.clip((t - p0) / (p1 - p0), 0, 1)
        k = k * k * (3 - 2 * k)
        m = t >= p0
        out[m] = (hexc(c0) + (hexc(c1) - hexc(c0)) * k[..., None])[m]
    return out


def design_coords(w, h):
    """Coordenadas del cuadro de diseño (0..1) para cada píxel del render con margen."""
    xs = (np.arange(w, dtype=np.float32) + 0.5) / w
    ys = (np.arange(h, dtype=np.float32) + 0.5) / h
    u = (xs - 0.5) * OVER_X + 0.5
    v = (ys - 0.5) * OVER_Y + 0.5
    return np.meshgrid(u, v)


def paint_sky(w, h):
    u, v = design_coords(w, h)
    sky = ramp(v, [(-0.12, '#4f5bb5'), (0.03, '#6f6cc6'), (0.12, '#a784cf'), (0.19, '#e796a6'), (0.255, '#ffb07c'),
                   (HORIZON, '#ffd89c'), (0.36, '#f6b990'), (0.50, '#c99ab0')])
    aspect = (844 * OVER_Y) / (390 * OVER_X)
    dx, dy = (u - SUN_SCREEN[0]), (v - SUN_SCREEN[1]) * (844 / 390)
    d = np.sqrt(dx * dx + dy * dy)
    glow = np.exp(-d * 3.2)[..., None]
    sky = sky + glow * np.array([0.55, 0.36, 0.14], dtype=np.float32)
    # nubes: bandas largas, iluminadas desde abajo
    n = fbm(w, h, 3.2, 3.2 * aspect * 3.4, 11, 5)
    n2 = fbm(w, h, 7.0, 7.0 * aspect * 3.0, 29, 4)
    band = np.exp(-((v - 0.105) / 0.085) ** 2) * 0.9 + np.exp(-((v - 0.215) / 0.035) ** 2) * 0.55
    cov = np.clip((n * 0.7 + n2 * 0.3 - 0.50 + band * 0.10) * 5.5, 0, 1) * np.clip(band * 1.6, 0, 1)
    cov = cov * cov * (3 - 2 * cov)
    under = np.clip((n - np.roll(n, -max(1, h // 160), axis=0)) * 18 + 0.5, 0, 1)        # borde inferior encendido
    warm = ramp(v, [(0.0, '#c9a2dc'), (0.14, '#f7a9b0'), (0.25, '#ffc592')])
    cool = ramp(v, [(0.0, '#8674c4'), (0.2, '#b98bc0')])
    cloud = cool + (warm - cool) * under[..., None]
    cloud = cloud + glow * np.array([0.35, 0.22, 0.08], dtype=np.float32)
    sky = sky + (cloud - sky) * (cov * 0.85)[..., None]
    # sol
    disc = np.clip((0.021 - d) / 0.004, 0, 1)[..., None]
    sky = sky + (np.array([1.0, 0.97, 0.86], dtype=np.float32) - sky) * disc
    # sierras lejanas en dos planos, con bruma
    for i, (base, amp_, col, seed) in enumerate(((HORIZON + 0.004, 0.020, '#b58cc0', 5), (HORIZON + 0.022, 0.026, '#8f79b8', 9))):
        prof = value_noise(w, 1, 2.2 + i * 1.3, 1, seed)[0] * 0.65 + value_noise(w, 1, 6.5 + i * 3, 1, seed + 3)[0] * 0.35
        line = base - (prof - 0.5) * amp_ * 2
        m = np.clip((v - line[None, :]) / 0.0022, 0, 1)[..., None]
        hill = hexc(col)[None, None, :] + glow * np.array([0.5, 0.3, 0.12], dtype=np.float32)
        sky = sky + (hill - sky) * m
    return np.clip(sky, 0, 1)


def sun_glow(w, h):
    """Resplandor del sol que se suma por encima de todo lo lejano (como un bloom ya horneado)."""
    u, v = design_coords(w, h)
    dx, dy = (u - SUN_SCREEN[0]), (v - SUN_SCREEN[1]) * (844 / 390)
    d = np.sqrt(dx * dx + dy * dy)
    return np.exp(-d * 2.4)


def haze_mask(w, h):
    """Bruma: crece hacia arriba del cuadro (más lejos) y se apaga sobre la cancha."""
    _u, v = design_coords(w, h)
    return np.clip((0.44 - v) / 0.36, 0, 1) ** 1.5


def over(dst, src_rgb, src_a):
    return dst + (src_rgb - dst) * src_a[..., None]


def finish(rgb, w, h, seed=3, grain=0.012):
    """Viñeta (igual para todas las capas) y un grano muy fino contra el bandeado."""
    u, v = design_coords(w, h)
    vig = 1 - 0.20 * np.clip(((u - 0.5) * 1.25) ** 2 + ((v - 0.52) * 1.15) ** 2, 0, 1)
    rgb = rgb * vig[..., None]
    if grain:
        rng = np.random.default_rng(seed)
        rgb = rgb + (rng.random((h, w, 1)).astype(np.float32) - 0.5) * grain
    return np.clip(rgb, 0, 1)


def blur(img, radius):
    """Desenfoque gaussiano separable (núcleo chico; para radios grandes se reduce antes)."""
    k = max(1, int(radius * 2.5))
    xs = np.arange(-k, k + 1, dtype=np.float32)
    ker = np.exp(-(xs / radius) ** 2 / 2)
    ker /= ker.sum()
    out = img
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[axis] = (k, k)
        p = np.pad(out, pad, mode='edge')
        acc = np.zeros_like(out)
        for i, kv in enumerate(ker):
            sl = [slice(None)] * out.ndim
            sl[axis] = slice(i, i + out.shape[axis])
            acc += p[tuple(sl)] * kv
        out = acc
    return out


def bloom(layer):
    """Halo de lo muy brillante (lamparitas, ventanas, focos): se calcula sobre los valores lineales."""
    rgb = layer[..., :3]
    peak = rgb.max(axis=2)
    mask = np.clip((peak - 4.5) / 9.0, 0, 1)[..., None] * np.clip(rgb, 0, 30)
    h, w = mask.shape[:2]
    small = mask[: h // 4 * 4, : w // 4 * 4].reshape(h // 4, 4, w // 4, 4, 3).mean(axis=(1, 3))
    k = w / 874.0
    g = blur(small, 1.6 * k) * 0.55 + blur(small, 5.5 * k) * 0.85
    g = np.repeat(np.repeat(g, 4, axis=0), 4, axis=1)
    out = np.zeros_like(rgb)
    out[: g.shape[0], : g.shape[1]] = g
    return blur(out, 1.5)


def develop(layer, name, w, h):
    """EXR premultiplicado -> (rgb sRGB sin premultiplicar, alfa), con halo, bruma y resplandor."""
    a = np.clip(layer[..., 3], 0, 1)
    rgb = layer[..., :3] / np.maximum(a, 1e-4)[..., None]
    if name == 'entorno':
        halo = bloom(layer)
        hl = np.clip(halo.max(axis=2) * 0.8, 0, 1)
        rgb = rgb * a[..., None] + halo * 1.0
        a = np.clip(a + hl * (1 - a), 0, 1)
        rgb = rgb / np.maximum(a, 1e-4)[..., None]
    rgb = tone(rgb)
    if name in ('piso', 'entorno', 'paredes'):
        hz = haze_mask(w, h) * (0.55 if name == 'entorno' else 0.42)
        glow = sun_glow(w, h)
        haze_col = np.array([1.0, 0.80, 0.62], dtype=np.float32)
        rgb = rgb + (haze_col - rgb) * (hz * (0.35 + 0.65 * glow))[..., None]
        rgb = rgb + (glow * hz * 0.30)[..., None] * np.array([1.0, 0.72, 0.42], dtype=np.float32)
    return np.clip(rgb, 0, 1), a


if MODE == 'vista':
    ex = load(os.path.join(SRC, 'vista.exr'))
    h, w = ex.shape[:2]
    rgb, a = develop(ex, 'entorno', w, h)
    out = over(paint_sky(w, h), rgb, a)
    out = finish(out, w, h)
    save(out, os.path.join(DST, 'vista.png'))
    print('OK vista', w, h)


if MODE == 'capas':
    os.makedirs(DST, exist_ok=True)
    order = ['piso', 'entorno', 'paredes', 'red', 'cerca', 'frente']
    quality = {'cielo': 82, 'piso': 84, 'entorno': 88, 'paredes': 86, 'red': 86, 'cerca': 86, 'frente': 88}
    first = load(os.path.join(SRC, 'piso.exr'))
    h, w = first.shape[:2]
    meta = {
        'render': [w, h], 'design': [390, 844], 'over': [OVER_X, OVER_Y], 'dpr': 2,
        'camera': {'pos': [0.0, -25.91, 16.52], 'pitch': 30.0, 'f': 790.9},
        'sunDir': [-0.42, 0.80, 0.43], 'horizon': HORIZON, 'layers': [],
    }
    sky = finish(paint_sky(w, h), w, h, grain=0.010)
    comp = sky.copy()
    # el cielo solo hace falta arriba; se guarda a media resolución (es todo degradé)
    sky_h = int(h * 0.50)
    half = sky[:sky_h // 2 * 2, : w // 2 * 2].reshape(sky_h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))
    save(half, os.path.join(DST, 'cielo.webp'), quality['cielo'])
    meta['layers'].append({'name': 'cielo', 'file': 'cielo.webp', 'x': 0, 'y': 0, 'w': w // 2 * 2, 'h': sky_h // 2 * 2, 'scale': 2})
    for name in order:
        path = os.path.join(SRC, name + '.exr')
        if not os.path.exists(path):
            continue
        ex = first if name == 'piso' else load(path)
        rgb, a = develop(ex, name, w, h)
        rgb = finish(rgb, w, h, grain=0.010 if name == 'piso' else 0.0)
        comp = over(comp, rgb, a)
        ys, xs = np.where(a > 0.004)
        x0, x1, y0, y1 = max(0, xs.min() - 2), min(w, xs.max() + 3), max(0, ys.min() - 2), min(h, ys.max() + 3)
        x0, y0 = x0 // 2 * 2, y0 // 2 * 2
        crop = np.concatenate([rgb[y0:y1, x0:x1], a[y0:y1, x0:x1, None]], axis=2)
        if name == 'piso':
            crop[..., 3] = np.where(crop[..., 3] > 0.5, 1.0, crop[..., 3])
        save(crop, os.path.join(DST, name + '.webp'), quality[name])
        meta['layers'].append({'name': name, 'file': name + '.webp', 'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0), 'scale': 1})
        print('CAPA', name, int(x0), int(y0), int(x1 - x0), int(y1 - y0))
    with open(os.path.join(DST, 'cancha.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, separators=(',', ':'))
    save(comp, os.path.join(SRC, 'vista.png'))
    # recorte al cuadro de diseño, para juzgar la composición que ve el usuario
    dx, dy = int(w * (1 - 1 / OVER_X) / 2), int(h * (1 - 1 / OVER_Y) / 2)
    save(comp[dy:h - dy, dx:w - dx], os.path.join(SRC, 'vista_cuadro.png'))
    print('OK capas', w, h)
