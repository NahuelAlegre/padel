"""Arma las capturas del README a partir de las que saca capturar.mjs y de las hojas de Blender.

Uso: python herramientas/componer.py carpeta_con_png carpeta_capturas
Necesita Pillow.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

SRC, DST = sys.argv[1], sys.argv[2]
os.makedirs(DST, exist_ok=True)
BG = (27, 22, 44)
CREMA = (255, 246, 230)


def font(size):
    for name in ('C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(name):
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


def load(name):
    return Image.open(os.path.join(SRC, name)).convert('RGB')


def pair(a, b, title, out, scale=0.75, labels=('A · sprites prerrenderizados', 'B · 3D toon en tiempo real'), quality=86):
    """Dos capturas lado a lado, con una franja de título."""
    a = a.resize((round(a.width * scale), round(a.height * scale)), Image.LANCZOS)
    b = b.resize((round(b.width * scale), round(b.height * scale)), Image.LANCZOS)
    gap, top = 14, 58
    w, h = a.width + b.width + gap, max(a.height, b.height) + top
    img = Image.new('RGB', (w, h), BG)
    img.paste(a, (0, top))
    img.paste(b, (a.width + gap, top))
    d = ImageDraw.Draw(img)
    d.text((12, 6), title, fill=CREMA, font=font(20))
    d.text((12, 32), labels[0], fill=(255, 200, 61), font=font(15))
    d.text((a.width + gap + 12, 32), labels[1], fill=(255, 200, 61), font=font(15))
    img.save(os.path.join(DST, out), quality=quality)
    print(out, img.size)


moments = [('1', 'Saque', '01-saque'), ('2_4', 'Derecha del rival', '02-derecha'), ('3_87', 'Rebote en el vidrio', '03-vidrio'),
           ('4_42', 'Revés después de la pared', '04-reves'), ('5_96', 'Globo', '05-globo'), ('7_75', 'Remate', '06-remate')]
for t, title, name in moments:
    pair(load(f'A-{t}.png'), load(f'B-{t}.png'), title, name + '.jpg')
pair(load('e0-A-4_42.png'), load('e0-B-4_42.png'), 'Escala 1,0 (tamaño real)', '07-escala-1_0.jpg')
pair(load('e2-A-7_75.png'), load('e2-B-7_75.png'), 'Escala 1,7', '08-escala-1_7.jpg')
pair(load('c-A-4_42.png'), load('c-B-4_42.png'), '«Ver de cerca»: A amplía la imagen, B mueve la cámara', '09-ver-de-cerca.jpg')
pair(load('c-A-6_9.png'), load('c-B-6_9.png'), '«Ver de cerca», corriendo a la red', '10-ver-de-cerca-2.jpg')
pair(load('u-A-5_9.png'), load('u-B-5_9.png'), 'Con los ajustes abiertos', '11-ajustes.jpg')

# detalle a tamaño de juego: recortes ampliados 3x de cada personaje
boxes = [('2_4', (170, 580, 430, 800), 'rival, derecha'), ('4_42', (150, 1080, 410, 1340), 'jugador, salida de pared'), ('7_75', (270, 800, 530, 1060), 'jugador, remate'),
         ('5_96', (480, 560, 740, 780), 'rival, globo')]
tiles = []
for t, box, label in boxes:
    for v in 'AB':
        im = load(f'{v}-{t}.png').crop(box)
        im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
        ImageDraw.Draw(im).text((8, 6), f'{v} · {label}', fill=CREMA, font=font(17))
        tiles.append(im)
tw, th = tiles[0].width, max(t.height for t in tiles)
sheet = Image.new('RGB', (tw * 4 + 18, th * 2 + 6), BG)
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % 4) * (tw + 6), (i // 4) * (th + 6)))
sheet.save(os.path.join(DST, '12-detalle-a-escala-de-juego.jpg'), quality=88)
print('12-detalle', sheet.size)

# modelo y animaciones (renders de Blender)
for src, out, scale in (('m_cuerpo.png', '13-modelo-cuerpo.jpg', 1.0), ('m_cara.png', '14-modelo-cara.jpg', 1.0), ('m_pies.png', '15-modelo-pies.jpg', 1.0),
                        ('m_manos.png', '16-modelo-manos.jpg', 1.0), ('a_derecha.png', '17-clip-derecha.jpg', 1.0), ('a_remate.png', '18-clip-remate.jpg', 1.0),
                        ('a_reves.png', '19-clip-reves.jpg', 1.0)):
    im = load(src)
    im.save(os.path.join(DST, out), quality=86)
    print(out, im.size)


# cámara: cancha entera (fija) arriba y cámara que acompaña abajo, en cuatro momentos
def grid(rows, title, out, labels, scale=0.5, quality=86):
    tiles = [[load(n) for n in row] for row in rows]
    tw, th = round(tiles[0][0].width * scale), round(tiles[0][0].height * scale)
    gap, top, left = 10, 40, 0
    img = Image.new('RGB', (len(rows[0]) * (tw + gap) - gap, top + len(rows) * (th + 30 + gap)), BG)
    d = ImageDraw.Draw(img)
    d.text((10, 8), title, fill=CREMA, font=font(20))
    for r, row in enumerate(tiles):
        y = top + r * (th + 30 + gap)
        for c, im in enumerate(row):
            x = c * (tw + gap)
            d.text((x + 6, y + 4), labels[r][c], fill=(255, 200, 61), font=font(14))
            img.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 30))
    img.save(os.path.join(DST, out), quality=quality)
    print(out, img.size)


cam_t = [('3_2', 'pelota al fondo propio'), ('4_42', 'salida de pared'), ('6_9', 'globo en el aire'), ('9_3', 'juego en la red')]
if os.path.exists(os.path.join(SRC, 'f-B-3_2.png')):
    grid([[f'f-B-{t}.png' for t, _ in cam_t], [f'B-{t}.png' for t, _ in cam_t]], 'Cámara: cancha entera (arriba) y cámara que acompaña (abajo), versión B', '21-camara.jpg',
         [[f'Cancha entera · {n}' for _, n in cam_t], [f'Acompaña · {n}' for _, n in cam_t]])
    pair(load('A-9_3.png'), load('B-9_3.png'), 'Cámara que acompaña, con el juego en la red', '22-camara-en-la-red.jpg')

# ayudas: recortes ampliados
if os.path.exists(os.path.join(SRC, 'ap-A-4_3.png')):
    crops = [('3_2', '', (60, 880, 480, 1300), 'marca de pique'), ('4_36', '', (40, 900, 460, 1320), 'brillo de timing'),
             ('4_43', '', (40, 900, 460, 1320), 'destello del golpe'), ('4_3', 'ap-', (250, 560, 670, 980), 'marca de objetivo'),
             ('4_3', 'v-', (0, 760, 420, 1180), 'nombre del golpe especial')]
    tiles = []
    for t, pre, box, label in crops:
        for v in 'AB':
            name = f'{pre}{v}-{t}.png'
            if not os.path.exists(os.path.join(SRC, name)):
                continue
            im = load(name).crop(box)
            ImageDraw.Draw(im).text((8, 6), f'{v} · {label}', fill=CREMA, font=font(19))
            tiles.append((v, im))
    cols = len(tiles) // 2
    tw, th = tiles[0][1].size
    sheet = Image.new('RGB', (cols * (tw + 6) - 6, th * 2 + 6), BG)
    for row, v in enumerate('AB'):
        for c, (_, im) in enumerate([x for x in tiles if x[0] == v]):
            sheet.paste(im, (c * (tw + 6), row * (th + 6)))
    sheet.save(os.path.join(DST, '23-ayudas.jpg'), quality=88)
    print('23-ayudas', sheet.size)
