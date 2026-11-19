# Estudio de animaciones

**En una línea:** cada situación del juego, para mirarla sin jugar. Va en loop, en cámara lenta o cuadro por cuadro, desde la cámara del juego, de cerca o de costado, con cualquier personaje. Está pensado para revisar las animaciones en el celular y dar devoluciones.

**Cómo se abre.**

- `?estudio` abre en la derecha común. `?estudio=bloqueo` va directo a una situación: el nombre como en la lista, sin tildes ni mayúsculas (`no-llego`, `tension`, `perdon`, `split`, `zancada`…).
- También desde el juego: Opciones → Experimental → Estudio de animaciones → Abrir.
- La ✕ vuelve al juego.
- Una vez publicado: `https://nahuelalegre.github.io/padel/?estudio`.

## Las situaciones

| Grupo | Situaciones |
| --- | --- |
| Golpes | Baja, Zancada revés, Estirada, Derecha, Volea, Bandeja, Remate, Globo, Saque, Estocada (a la carrera) |
| IA | Bloqueo, Apurado, No llegó, Sorprendido, Tensión, Robo, Perdón |
| Cuerpo | Split step, Festejo (y lamento), Manías |
| Correr | Adelante, Atrás, Lateral |

Cada una se muestra de cada lado de la red (cerca y lejos), si la demo la tiene de los dos lados.

## Los controles

- **Arriba**, sobre el cielo, lo que se mira:
  - la situación (un toque abre la lista);
  - la cámara: Juego, Zoom o Costado (solo en 3D);
  - 3D o 2D;
  - el lado: Cerca o Lejos;
  - el personaje: Vos, Beto, Romina o Chela.
- **Abajo**, bajo el pulgar: repetir, cuadro anterior, pausa, cuadro siguiente y velocidad (1×, ½×, ¼×). En la compu, la barra espaciadora, las flechas y la R hacen lo mismo.
- **La línea amarilla** es el loop, y la marca blanca su instante clave: el contacto, el golpe al aire, el final del punto.

## Cómo funciona

- **Es el juego de verdad.** El estudio arranca una demo de la computadora contra sí misma, siempre la misma: dobles, el alcance real y la alineación de quien nunca tocó las opciones. Después la juega sin dibujarla, más de 200 s de partido en menos de un segundo. De cada situación guarda el mejor ejemplo de cada lado como una copia del partido un momento antes. Mostrarla es seguir jugando desde esa copia con el mismo `advance` del juego (las mismas reglas, el mismo render, la misma cancha), y el loop vuelve a la copia. Si en una demo falta algo, busca en la siguiente (semillas 7, 1, 2, 3, 4 y 5).
- **Lo que la demo no tiene, se arma** («armada», dice arriba): un jugador movido a mano, cuadro a cuadro, sobre una cancha que espera un saque, y el mismo render lo dibuja. Pasa con:
  - **la estocada a la carrera**, porque la IA y el movimiento asistido frenan para pegar;
  - **las manías**, porque en la demo no las hace nadie;
  - **el robo y el «perdón»**, cuando la demo no tuvo ninguno, porque son raros.
- **El personaje** cambia solo cómo se ve el jugador en pantalla: la jugada es la misma.
- **Las cámaras.** «Zoom» es la cámara del juego llevada a 6,5 m del jugador. «Costado» está 7 m a su izquierda, a la altura del hombro. La cancha son las fotos horneadas apoyadas sobre sus planos, así que se sostiene desde ahí, un poco estirada. El vidrio de fondo propio no se dibuja en estas cámaras, porque quedaría en el medio.
- **No toca la simulación ni la IA.** Lo único nuevo afuera del estudio son ganchos:
  - en el render: a quién mirar, desde dónde, con qué aspecto y una reacción de robo;
  - en el juego: la demo fija, el render y la escena visibles, y el bucle que se puede detener;
  - en la plataforma: volver a abrir con otros parámetros y anotarlos en la dirección.

## El peso

- **El estudio es un archivo aparte**, `assets/studio-[hash].js`: 22,6 KB, 8,4 KB comprimido. Se baja solo con `?estudio`; jugando no se pide (lo verifica el smoke).
  - El juego es un solo script clásico, para que abra también desde un archivo, y un `import()` dinámico no generaría un archivo aparte.
  - Por eso `npm run build` arma primero el estudio (`vite.studio.config.ts`), y después el juego aprende su nombre.
- **Lo que el juego carga para él** (el cargador, los ganchos y la demo fija): 0,9 KB comprimido, de 88,6 a 89,5 KB.

## Para revisar desde la compu

`npm run build` y después `node scripts/studio.mjs`: capturas del estudio a la densidad de un celular (360 × 800, DPR 3), con la lista de situaciones y cada situación en su instante clave. Opciones: `--situaciones bloqueo,estocada`, `--camara juego|zoom|costado`, `--lejos` y `--2d`.

## Lo que no hace

- **«Antes / después»:** muestra la versión publicada, nada más.
- **En 2D la cámara no se mueve:** la cancha simple es una sola foto plana.
- **Desde el costado la cancha se ve estirada**, sobre todo el fondo, porque está horneada para la cámara del juego.
- **Los ejemplos salen de la demo.** Si cambia la IA, cambian también: se buscan cada vez que se abre.
- **El tiempo de búsqueda:** 0,7 s en la PC de prueba. En un celular de gama media no está medido; se estima entre 2 y 4 s, con un aviso en pantalla.
