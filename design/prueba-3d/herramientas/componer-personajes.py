"""Arma las capturas de la ronda de personajes (capturas/30-... en adelante). Necesita Pillow.

Uso: python herramientas/componer-personajes.py carpeta_revision carpeta_capturas carpeta_salida
  carpeta_revision  las hojas de «node blender/regenerar.mjs revision»
  carpeta_capturas  capturas sueltas de capturar-personajes.mjs y capturar.mjs (ver el README)
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

REV, CAP, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
FONDO = (27, 22, 44)


def fuente(px):
    for f in ('C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    return ImageFont.load_default()


def abrir(carpeta, nombre):
    return Image.open(os.path.join(carpeta, nombre)).convert('RGB')


def ancho(im, w):
    return im.resize((w, round(im.size[1] * w / im.size[0])), Image.LANCZOS)


def fila(ims, sep=8, fondo=FONDO):
    h = max(i.size[1] for i in ims)
    out = Image.new('RGB', (sum(i.size[0] for i in ims) + sep * (len(ims) - 1), h), fondo)
    x = 0
    for i in ims:
        out.paste(i, (x, 0))
        x += i.size[0] + sep
    return out


def columna(ims, sep=8, fondo=FONDO):
    w = max(i.size[0] for i in ims)
    out = Image.new('RGB', (w, sum(i.size[1] for i in ims) + sep * (len(ims) - 1)), fondo)
    y = 0
    for i in ims:
        out.paste(i, (0, y))
        y += i.size[1] + sep
    return out


def rotulo(im, texto, px=22, color=(255, 246, 230)):
    im = im.copy()
    d = ImageDraw.Draw(im)
    f = fuente(px)
    d.text((12, 8), texto, font=f, fill=color, stroke_width=3, stroke_fill=(27, 22, 44))
    return im


def guardar(im, nombre, q=86):
    path = os.path.join(OUT, nombre)
    im.save(path, quality=q, optimize=True)
    print(nombre, im.size, round(os.path.getsize(path) / 1024), 'KB')


# 30: el elenco, sacado de la página de revisión (solo el escenario)
def escenario(nombre, alto=0.50):
    im = abrir(CAP, nombre)
    return im.crop((0, 130, im.size[0], int(im.size[1] * alto)))       # sin el título de la página


elenco = [rotulo(ancho(escenario(f'elenco-{k}.png'), 420), n) for k, n in (('jugador', 'Jugador'), ('beto', 'Beto'), ('romina', 'Romina'), ('chela', 'Chela'))]
guardar(fila(elenco), '30-elenco.jpg')

# 31 a 34: todos los clips, en tiras (hojas de Blender)
for i, (hoja, nombres) in enumerate((
        ('clips-locomocion.png', 'Espera activa · correr · hacia atrás · lateral · split step · arranque · frenada'),
        ('clips-golpes-1.png', 'Saque · derecha · revés · volea · volea de revés'),
        ('clips-golpes-2.png', 'Bandeja · remate · globo · estirada · estirada de revés'),
        ('clips-gestos.png', 'Entre puntos · festejo · lamento · manía de la gorra · de la zapatilla · del saludo'))):
    guardar(rotulo(ancho(abrir(REV, hoja), 1800), nombres, 26), f'{31 + i}-{hoja[:-4]}.jpg', 82)

# 35: las caras
caras = [rotulo(ancho(abrir(REV, f'cara-{n}.png'), 560), t, 20) for n, t in (('normal', 'Normal'), ('parpadeo', 'Parpadeo'), ('esfuerzo', 'Esfuerzo'), ('alegria', 'Alegría'), ('fastidio', 'Fastidio'))]
guardar(columna([fila(caras[:3], fondo=(204, 194, 178)), fila(caras[3:], fondo=(204, 194, 178))], fondo=(204, 194, 178)), '35-caras.jpg')

# 36: la página de revisión
pag = [ancho(abrir(CAP, n), 430) for n in ('pagina-golpe.png', 'pagina-todos.png', 'pagina-cara.png', 'pagina-mania.png')]
guardar(fila(pag), '36-pagina-de-revision.jpg')

# 37: la malla liviana
guardar(columna([rotulo(ancho(abrir(REV, 'modelo-cuerpo.png'), 1500), 'Malla de juego: 4.205 vértices y 5.330 triángulos (antes 7.309 y 10.370)', 24, (39, 48, 74)),
                 fila([ancho(abrir(REV, 'modelo-pies.png'), 746), ancho(abrir(REV, 'modelo-manos.png'), 746)], fondo=(204, 194, 178))], fondo=(204, 194, 178)), '37-malla-liviana.jpg')

# 38: el peloteo con los clips nuevos (cámara de juego arriba, de cerca abajo)
ts = ['2_38', '3_1', '4_42', '6_5', '7_75', '9_75']
guardar(columna([fila([ancho(abrir(CAP, f'n-B-{t}.png'), 300) for t in ts], 6), fila([ancho(abrir(CAP, f'c-B-{t}.png'), 300) for t in ts], 6)]), '38-peloteo.jpg', 84)

# 39: los tres rivales en la cancha, al tamaño del juego (recorte ampliado)
riv = []
for k, n in (('beto', 'Beto'), ('romina', 'Romina'), ('chela', 'Chela')):
    im = abrir(CAP, f'rival-{k}.png')
    w, h = im.size
    riv.append(rotulo(im.crop((int(w * 0.02), int(h * 0.24), int(w * 0.62), int(h * 0.46))).resize((560, 348), Image.LANCZOS), n))
guardar(fila(riv), '39-rivales-en-la-cancha.jpg')

# 40: prueba de estilización (zapatillas grandes y tobillo fino), al tamaño del juego y de cerca
if os.path.exists(os.path.join(CAP, 'estilo-juego.png')):
    a = ancho(abrir(CAP, 'estilo-juego.png'), 1800)
    b = fila([rotulo(ancho(abrir(REV, 'modelo-pies.png'), 896), 'Normal', 22, (39, 48, 74)), rotulo(ancho(abrir(CAP, 'estilo-pies.png'), 896), 'Marcada', 22, (39, 48, 74))], fondo=(204, 194, 178))
    guardar(columna([rotulo(a, 'Izquierda: normal · derecha: zapatillas 1,30× y tobillo más fino (tamaño de juego, ampliado)', 24), b]), '40-prueba-de-estilizacion.jpg')
