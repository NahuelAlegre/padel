# Pádel

Juego de pádel para navegador, pensado primero para el celular en vertical. Simple de jugar, accesible y lindo de ver.

Las decisiones de diseño del proyecto están en [CLAUDE.md](CLAUDE.md). Este README cubre el motor y el **prototipo jugable en gris**: formas simples y arte provisorio para probar cómo se sienten las mecánicas antes de integrar el arte final.

## Cómo correrlo

Hace falta Node 22.12 o más nuevo.

```bash
npm install
```

```bash
npm run dev
```

Abre en `http://localhost:5173/padel/`. En una computadora el juego se muestra como una columna vertical centrada; se puede jugar con el mouse (arrastrar es deslizar) o con el teclado.

### Probarlo en el celular

El celular y la computadora tienen que estar en la misma red wifi.

```bash
npm run dev:host
```

Vite muestra una dirección del estilo `http://192.168.x.x:5173/padel/`: esa es la que se abre en el celular. Para probar el build de producción, que es lo que se publica:

```bash
npm run build
```

```bash
npm run preview:host
```

### Todos los comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo con recarga en caliente. |
| `npm run dev:host` | Lo mismo, visible desde otros dispositivos de la red. |
| `npm run build` | Chequea tipos y genera `dist/`. |
| `npm run preview` | Sirve `dist/` tal como va a quedar publicado. |
| `npm test` | Tests de física, reglas, puntuación, golpes, gestos y cámara (Vitest). |
| `npm run sim` | Juega cientos de partidos sin pantalla e imprime estadísticas de balance. |
| `npm run smoke` | Abre el build en un Chrome con emulación de celular y lo juega con toques reales. |
| `npm run perf` | Mide los cuadros por segundo con emulación de celular y CPU frenada. |

`smoke` y `perf` usan un Chrome o Edge ya instalado (o el que indique `CHROME_PATH`) y necesitan que antes se haya corrido `npm run build`.

Atajos en la URL: `?demo` arranca un partido de IA contra IA, `?loop` lo repite al terminar y `?fps` muestra el contador de cuadros y el error de timing de cada golpe en milisegundos.

## Cómo se juega

Un partido corto de 1 contra 1 contra la máquina, a 2 juegos por defecto, con punto de oro.

**Modo asistido (por defecto).** El jugador corre solo hacia la pelota. Vos decidís cuándo y hacia dónde pegar, con el pulgar en la mitad de abajo de la pantalla:

| Gesto | Golpe |
| --- | --- |
| Deslizar | Drive hacia donde apunta el deslizamiento. |
| Deslizar largo hacia arriba | Globo. |
| Deslizar hacia abajo | Dejada. |
| Tocar | Golpe seguro al centro. |

El contexto completa el resto: un drive tomado en el aire cerca de la red sale como volea, y una pelota alta cerca de la red sale como remate. Sobre el jugador aparece cómo salió el golpe y cuál fue.

**El timing.** Un anillo se cierra sobre el punto donde vas a pegar. Cuanto más cerca del cierre levantás el dedo, mejor sale el golpe:

- **Perfecto** (±70 ms): más rápido y preciso.
- **Bien** (±160 ms): normal.
- **Temprano o tarde**: el golpe sale igual, pero flojo, corto y con mucho más riesgo de irse o quedar en la red.
- Pasados 220 ms la pelota ya se fue. Si después rebota en una pared, hay una segunda oportunidad.

Deslizar antes de tiempo no falla el golpe: el jugador arma la raqueta y pega cuando llega la pelota. Un deslizamiento nuevo reemplaza al anterior.

El movimiento asistido suele esperar la pelota más cómoda, que muchas veces es la que vuelve del vidrio de fondo. Si deslizás cuando la pelota te está pasando al lado, le pegás ahí mismo: es más temprano y más difícil de controlar, pero le saca tiempo al rival.

**Modo joystick (Opciones → Controles).** Pensado para un futuro modo competitivo: un joystick flotante de un lado de la pantalla mueve al jugador y el otro pulgar pega con los mismos gestos. El lado del joystick se puede cambiar.

**Teclado.** Flechas o WASD para moverse (en modo joystick) y apuntar; espacio o J para pegar, K para el globo, L para la dejada; P o Escape para pausar.

**Opciones.** Dificultad (fácil, normal, difícil), velocidad del juego (70 %, 85 %, 100 %), largo del partido, marca de dónde pica la pelota, anillo de timing, reducir movimiento, vibración, cámara (tres encuadres para comparar) y resolución.

## Arquitectura

```
src/
  config.ts          Todos los números ajustables del juego, en un solo lugar
  core/              Utilidades sin estado de juego: matemática, azar con semilla, estadísticas de cuadros
  sim/               La simulación. No sabe nada de pantalla, DOM ni dispositivos
    ball.ts            Física de la pelota: gravedad, pique, vidrio, reja, red
    court.ts           Geometría de la cancha y perfiles de las paredes
    rules.ts           Reglas del punto: qué pique vale, qué es falta, quién puede pegar
    score.ts           15/30/40, punto de oro, juegos, sets y rotación del saque
    shots.ts           Qué velocidad darle a la pelota para que caiga donde se apuntó
    trajectory.ts      Predicción: simula el futuro de la pelota con la misma física y reglas
    intercept.ts       Dónde y cuándo le conviene pegar a cada jugador
    formation.ts       Dónde se para cada jugador, para equipos de 1 o de 2
    player.ts          Estado y movimiento de un jugador
    match.ts           El partido: une todo y avanza de a un paso fijo
  control/           Quién decide por cada jugador
    human.ts           Lee la entrada abstracta
    ai.ts              La máquina, con niveles
    autopilot.ts       Movimiento asistido, compartido por la IA y por el modo asistido
  input/             Táctil, mouse y teclado, traducidos a "quiero este golpe" y "me muevo hacia acá"
  render/            Todo lo que se ve
    scene.ts           El contrato entre el juego y cualquier renderer
    camera.ts          Proyección pseudo-3D y encuadre automático
    prototype/         El renderer actual, de formas grises
  ui/                Marcador, menús, opciones y textos (DOM)
  app/               El pegamento: bucle principal, armado de la escena, flujo de pantallas
tests/               Tests y simulaciones de balance
scripts/             Medición de rendimiento y prueba de humo en un navegador real
```

Las dependencias van en un solo sentido: `sim` no importa nada de `render`, `input` ni `ui`. Se puede correr un partido entero en Node, y eso es lo que hacen los tests.

### Simulación a paso fijo, render interpolado

La simulación avanza siempre de a 1/120 de segundo (`Match.step`). El bucle principal acumula el tiempo real y corre los pasos que hagan falta; después dibuja un cuadro mezclando las posiciones de los dos últimos pasos según cuánto falta para el siguiente. Así el juego se comporta igual a 30, 60 o 120 cuadros por segundo, y la velocidad ajustable es solo un multiplicador del tiempo que entra al acumulador.

La simulación es determinista: no usa `Math.random` sino un generador con semilla, así que el mismo partido se puede repetir exactamente. Hay un test que lo verifica.

### Render separado de la lógica

Un renderer no lee la simulación. Recibe un `Scene` por cuadro (pelota, jugadores con su animación abstracta, ayudas visuales) y los eventos de lo que pasó (golpe con su calidad, pique, pared, punto). Para integrar el arte final alcanza con escribir otra clase que implemente `Renderer` ([src/render/scene.ts](src/render/scene.ts)) y cambiar una línea en [src/app/game.ts](src/app/game.ts). El renderer gris vive entero en [src/render/prototype/](src/render/prototype/).

El marcador, los mensajes y los menús son DOM encima del canvas: texto nítido a cualquier resolución, botones de verdad, foco de teclado y lectores de pantalla sin trabajo extra.

### Equipos de N jugadores, un controlador por jugador

Un `Match` recibe dos equipos con la cantidad de jugadores que sea, y cada jugador trae su `Controller`. Nada asume 1 contra 1: el saque rota entre todos los jugadores, las formaciones salen de una tabla en coordenadas del equipo y, cuando hay más de un jugador, el partido decide quién va a cada pelota. Hoy `npm run sim` y los tests ya juegan partidos de dobles con cuatro IA. Para tener dobles de verdad falta el encuadre y decidir cómo se maneja al compañero, no reescribir.

### Una sola física para todo

`stepBall` es una función pura. El partido la usa para mover la pelota y `predictTrajectory` la usa para simular su futuro, con las mismas reglas. De esa predicción salen:

- la marca de dónde va a picar (y sigue a la pelota después de un vidrio),
- el punto y el momento en que conviene pegar, incluso después de un rebote en la pared,
- el movimiento de la IA y el movimiento asistido del jugador,
- la decisión de dejar pasar una pelota que se va afuera sola.

La IA no hace trampa: ve lo mismo que el movimiento asistido de la persona. Lo que cambia con el nivel es cuánto tarda en reaccionar, qué tan rápido corre, qué tan bien hace el timing y qué tan bien elige el golpe.

### Los errores salen de la física

La calidad del golpe no mueve el punto de pique: desvía el lanzamiento (dirección, ángulo y velocidad). Un drive plano y rápido tiene poco margen sobre la red y antes del vidrio; un golpe seguro, alto y al centro, perdona mucho. Las pelotas a la red, largas y anchas salen solas de tres números, y la presión (pelota rápida, estirado, pelota baja, peloteo largo) los agranda.

### Cámara

Proyección de perspectiva con inclinación ([src/render/camera.ts](src/render/camera.ts)). La distancia focal no se elige a mano: `Camera.fit` la calcula para que la cancha completa entre en la pantalla, con lugar arriba para el marcador y una franja libre abajo para el pulgar. En vertical la cámara de la maqueta anterior (22°) dejaba la cancha en una franja finita, así que se reencuadró más alta y más lejos. Hay tres encuadres en Opciones para comparar en el celular: baja (38°), media (45°, por defecto) y alta (52°).

### Canvas

El canvas sigue el tamaño que le da el CSS. Su resolución interna es la densidad de la pantalla con tope en 2, por una escala que baja sola si el dispositivo no llega a los cuadros por segundo. Cada bajada es una prueba: si no mejora, se deshace, para no borronear el juego cuando el límite lo pone el ahorro de batería y no los píxeles. La cancha se dibuja una sola vez en una capa cacheada.

## Parámetros para iterar

Casi todo lo que define cómo se siente el juego está en [src/config.ts](src/config.ts):

| Qué | Dónde |
| --- | --- |
| Ventanas de timing, compensación de latencia, adelanto del anillo | `timing` |
| Velocidad, altura y profundidad de cada golpe | `shots.specs` |
| Cuánto se castiga cada calidad de timing | `shots.quality` |
| Velocidad y alcance de los jugadores | `player` |
| Niveles de la IA | `ai` |
| Largo del partido, pausas, aceleración de los peloteos largos | `rules` |
| Gestos: distancias, ángulos, zona táctil, joystick | `CONTROLS` |
| Física: gravedad, restitución del piso, del vidrio y de la reja | `physics` |
| Medidas de la cancha y de las paredes | `court` |

El encuadre, el tamaño visual de la pelota y de los jugadores están en [src/render/view.ts](src/render/view.ts).

`npm run sim` sirve para ver el efecto de un cambio sin jugar: muestra cuántos golpes dura un punto, cómo terminan y qué porcentaje de partidos gana un jugador simulado según qué tan bien hace el timing. Con los valores actuales:

| Jugador simulado | contra Fácil | contra Normal | contra Difícil |
| --- | --- | --- | --- |
| Principiante (timing ±160 ms) | gana 80 % | gana 17 % | gana 2 % |
| Promedio (±100 ms) | gana 98 % | gana 75 % | gana 10 % |
| Experto (±50 ms) | gana 100 % | gana 100 % | gana 67 % |

Un punto dura de promedio unos 5 golpes contra Fácil, entre 6 y 9 contra Normal y entre 7 y 13 contra Difícil. Un partido a 2 juegos dura entre 2 y 5 minutos. Son 60 partidos por casilla con un jugador simulado que apunta al lado libre el 60 % de las veces: sirve para comparar cambios, no reemplaza probarlo con gente.

## Rendimiento

Objetivo: 60 cuadros por segundo en un Android de gama media de hace unos cinco años.

**Medición.** `npm run perf` abre el build de producción en Chrome, emula un celular en vertical (360×800 CSS, densidad 3, táctil), frena la CPU con el protocolo DevTools y deja correr un partido de IA contra IA durante 12 segundos por cada nivel de freno. El canvas queda en 720×1600 por el tope de densidad.

Resultados en Chrome 157 headless, sobre un Ryzen 7 8700G:

| CPU | Cuadros por segundo | Tiempo entre cuadros (mediana / p99 / peor) | Cuadros de más de 17,5 ms | Trabajo de JavaScript por cuadro |
| --- | --- | --- | --- | --- |
| 1× | 240 | 4,2 / 4,4 / 4,4 ms | 0 % | 0,09 ms |
| 4× | 240 | 4,2 / 4,4 / 4,4 ms | 0 % | 0,55 ms |
| 6× | 240 | 4,2 / 4,4 / 8,3 ms | 0 % | 0,70 ms |
| 12× | 172 | 4,2 / 12,6 / 33,4 ms | 0,2 % | 1,68 ms |
| 20× | 54 | 16,7 / 45,8 / 71,0 ms | 43,5 % | 5,30 ms |

Chrome headless pinta a 240 cuadros por segundo, así que "240" significa que no perdió ninguno. Con la CPU frenada 4× el JavaScript del juego usa 0,55 ms de los 16,7 ms que hay por cuadro a 60 cuadros por segundo. Hasta 6× no se pierde ningún cuadro, con 12× el 99,8 % sigue por debajo de 17,5 ms, y el juego recién cae debajo de 60 cuadros por segundo con un freno de 20×. Los niveles altos varían de una corrida a otra: en otras, 20× dio entre 45 y 122 cuadros por segundo. La prueba de humo, con toques reales, también pasa completa con la CPU frenada 4× (`npm run smoke -- --throttle 4`).

**Qué no dice esta medición.** Frenar la CPU no frena la GPU ni el rasterizado, y una computadora de escritorio frenada 4× sigue siendo más rápida que el celular objetivo. Es una cota optimista. Falta medir en un teléfono real: con `?fps` el juego muestra cuadros por segundo, el peor cuadro del último segundo y el trabajo por cuadro.

**Navegador integrado de la app.** También lo corrí ahí con emulación móvil vertical (375×812, canvas de 750×1624). El trabajo por cuadro dio entre 0,2 y 0,4 ms. Los cuadros por segundo de esa prueba no sirven: el panel del navegador estaba oculto y, en ese estado, el navegador limita las animaciones a unos 15 por segundo. Tampoco ofrece freno de CPU, por eso la medición con freno se hizo con el script.

**Peso.** La descarga inicial es de 26 KB comprimidos: 23,4 KB de JavaScript, 1,9 KB de CSS y 0,9 KB de HTML. No hay imágenes, fuentes ni dependencias en tiempo de ejecución.

## Verificación

- `npm test`: 111 tests. Cubren la física de la pelota (pique, vidrio, reja, red, salida de la cancha), que la predicción coincide exactamente con la simulación, las reglas (pique antes de pared, doble pique, saque cruzado, faltas, let), la puntuación (punto de oro, ventaja, rotación del saque en singles y dobles), el cálculo de los golpes, el timing, los gestos, la cámara y partidos completos entre IA, también de dobles.
- `npm run smoke`: 21 verificaciones en un Chrome con emulación de celular. Toca "Jugar", juega un partido entero deslizando con un dedo y levantándolo cuando se cierra el anillo, pausa, entra a Opciones, prueba el modo joystick con dos dedos y, en tamaño de escritorio, el mouse, el teclado y la pausa automática. Guarda capturas de cada etapa en `.smoke/`.

## Accesibilidad

- Nada depende solo del color: los equipos se distinguen por tono y contorno, el jugador propio tiene un anillo bajo los pies, el timing se lee por la forma del anillo y por una palabra, y la opción elegida lleva una marca además del relleno.
- Reducir movimiento (toma la preferencia del sistema): sin estela, sin pausa de impacto y sin mensajes que se desplazan.
- Ayudas que se pueden apagar: marca de dónde pica la pelota y anillo de timing.
- Velocidad del juego ajustable al 70 % y al 85 %.
- Pausa en cualquier momento, con el botón, con P o Escape, y automática al cambiar de pestaña o de aplicación.
- Se juega sin sonido: todavía no hay ninguno, y toda la información es visual.
- Menús con botones reales, foco visible y regiones que anuncian el marcador y el resultado de cada punto.

## Publicación

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) corre los tests, hace el build y publica `dist/` en GitHub Pages cada vez que se hace push a `main`. La base del sitio es `/padel/` ([vite.config.ts](vite.config.ts)). Todavía no se ejecutó nunca: hay que activar Pages con origen "GitHub Actions" en la configuración del repositorio.

## Pendientes conocidos

- **Probarlo en un celular real.** Las ventanas de timing, el adelanto del anillo (60 ms) y la compensación de latencia (30 ms) son un punto de partida razonado, no medido.
- No hay sonido.
- El saque no tiene timing: entra casi siempre. Las faltas existen (hay segundo saque y doble falta), pero son raras.
- La pelota no tiene efecto. Con eso, un remate bien colocado gana por tiempo y no porque "salga por tres".
- Dobles funciona en la simulación, pero falta el encuadre y la interfaz para jugarlo.
- La red no tiene postes con hueco ni puertas, y la pelota no choca con los jugadores.
- `npm audit` marca una vulnerabilidad de severidad alta en `picomatch`, que llega por Vite y Vitest. Son herramientas de desarrollo: no entra en lo que se publica, y todavía no hay versión corregida.
