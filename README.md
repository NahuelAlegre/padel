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

Abre en `http://localhost:5173/`. En una computadora el juego se muestra como una columna vertical centrada; se juega con el mouse y el teclado.

### Probarlo en el celular

El celular y la computadora tienen que estar en la misma red wifi.

```bash
npm run dev:host
```

Vite muestra una dirección del estilo `http://192.168.x.x:5173/`: esa es la que se abre en el celular. Para probar el build de producción, que es lo que se publica:

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
| `npm test` | Tests de física, reglas, puntuación, golpes, gestos, guardado y arquitectura (Vitest). |
| `npm run sim` | Juega cientos de partidos sin pantalla e imprime estadísticas de balance. |
| `npm run smoke` | Abre el build en un Chrome con emulación de celular y lo juega con toques reales. |
| `npm run perf` | Mide los cuadros por segundo con emulación de celular y CPU frenada. |

`smoke` y `perf` usan un Chrome o Edge ya instalado (o el que indique `CHROME_PATH`) y necesitan que antes se haya corrido `npm run build`.

Atajos de desarrollo en la URL: `?demo` arranca un partido de IA contra IA, `?loop` lo repite al terminar, `?fps` muestra el contador de cuadros y el error de timing de cada golpe en milisegundos, y `?record` guarda las entradas del partido para poder repetirlo.

## Cómo se juega

**La primera vez no hay menú.** El juego abre directo en la cancha, con tu saque listo y un pulgar fantasma que muestra el gesto. El primer peloteo es el tutorial: el rival devuelve una pelota lenta hacia donde estás y deja pasar la siguiente, hasta que ganás un punto. Una vez que te salió el primer golpe, las visitas siguientes abren en la pantalla de inicio, con "Partida rápida" como botón principal, abajo, donde ya está el pulgar.

| Formato | Qué es |
| --- | --- |
| Partida rápida | A 2 juegos, con punto de oro. Entre 2 y 5 minutos. |
| Partido | Un set a 4 juegos, con punto de oro y tie-break corto (a 5 puntos) si llegan 3 a 3. |

El partido se guarda al empezar cada punto. Si cerrás el juego o te llaman por teléfono, al volver aparece "Seguir el partido" con el marcador tal como estaba.

### Los dos esquemas de control

Se eligen en Opciones → Controles y se pueden cambiar en medio de un partido. En los dos el jugador se mueve **solo cuando vos lo movés**: si soltás, se queda quieto. Los toques valen en la mitad de abajo de la pantalla.

**Dos pulgares (por defecto).**

| Pulgar | Gesto | Qué hace |
| --- | --- | --- |
| Izquierdo | Apoyar y arrastrar | Joystick flotante: aparece donde apoyás. Soltar es quedarse quieto. |
| Derecho | Mantener apretado y arrastrar | Apunta. Una marca sobre la cancha rival muestra dónde va a ir la pelota. |
| Derecho | Soltar | Pega. |

Con el pulgar derecho, arrastrar a los costados elige el lado, hacia arriba pide más profundidad, bien arriba es un globo y hacia abajo es una chiquita. La marca lo muestra: anillo doble para el globo, anillo chico para la chiquita, y arriba el nombre del golpe que va a salir. El lado del joystick se puede invertir para zurdos.

**Una mano.** Un solo pulgar hace las dos cosas, y lo que las distingue es la velocidad del gesto:

| Gesto | Qué hace |
| --- | --- |
| Apoyar y arrastrar | Joystick flotante. Soltar despacio es quedarse quieto. |
| Deslizamiento rápido | Pega. La dirección apunta y el largo da la profundidad: largo hacia arriba es un globo, hacia abajo una chiquita. |
| Toque | Golpe cómodo al medio. |

Salir del joystick con un latigazo también es un golpe, para no tener que levantar el dedo antes.

**Teclado y mouse.** Flechas o WASD para moverse. J, K y L pegan a la izquierda, al medio y a la derecha; U, I y O son los globos; M es la chiquita y la barra espaciadora una pelota cómoda al medio. P o Escape pausan. El mouse apunta igual que el pulgar derecho: mantener, arrastrar y soltar. Con el esquema de una mano, el mouse hace de pulgar.

### El golpe lo decide la situación

Vos solo decís a dónde querés la pelota. El nombre del golpe lo pone el contexto, nunca un menú, y aparece escrito cuando lo ejecutás:

| Situación | Golpe |
| --- | --- |
| Pelota alta, cerca de la red | Remate |
| Pelota alta, desde media cancha | Bandeja, o víbora si apuntás a un costado |
| En el aire, cerca de la red | Volea |
| Después de un rebote en la pared | Salida de pared |
| La pelota ya te pasó, contra tu vidrio | Contrapared |
| Pediste por arriba | Globo |
| Pediste corto | Chiquita, o dejada si es en el aire |
| Todo lo demás | Derecha o revés |

### El timing

Un anillo se cierra sobre el punto donde vas a pegar. Lo que cuenta es el momento en que soltás (o deslizás) respecto de la llegada de la pelota:

- **Perfecto** (±60 ms): más rápido y preciso.
- **Bien** (±150 ms): normal.
- **Temprano**: si soltás antes de que la pelota esté a tu alcance, el golpe queda **armado** y sale solo cuando llega, tan bien como uno bueno. Lo único que perdés es el perfecto. Así se puede elegir a dónde pegar bastante antes de que llegue la pelota.
- **Tarde** (hasta 240 ms): la pelota vuelve, pero floja, alta y corta.

Un timing mediocre no manda la pelota afuera. Los errores salen del riesgo que elegís (apuntar cerca de las paredes agranda la dispersión, y el halo de la marca lo muestra) y de no llegar. Las ventanas están medidas en tiempo de juego: con la velocidad al 60 % son ±100 ms y ±250 ms reales. No hay cámara lenta ni pausas para apuntar.

**La ayuda está en el alcance, no en el movimiento.** Alcanza con acercarse: la persona llega a pelotas que pasan a 1,6 m (la máquina, a 1,25 m) y el jugador se estira para llegar. Cuanto más estirado, menos preciso el golpe. Unas pisadas en el piso marcan dónde conviene pararse; son un consejo.

**Qué pelota se juega.** Si desde donde estás parado la pelota pasa dos veces a tu alcance (antes y después del vidrio de fondo, por ejemplo), el anillo marca la más cómoda, con el mismo criterio que usa la máquina. Desde el fondo eso suele ser dejarla picar y esperar la salida de pared. La contrapared queda como último recurso: sale cuando la pelota ya te pasó y no va a volver.

### Rivales

| Rival | Estilo | Para quién |
| --- | --- | --- |
| Lola | Tranquila: se queda en el fondo y devuelve todo al medio. Reacciona tarde y corre poco. | El primer rival. Se le puede ganar el primer día. |
| Tincho | Globero: tira muchos globos y sube a la red detrás. | Parejo para alguien que ya le agarró la mano. |
| Mora | Atacante: saca y sube, volea y remata lo que quede corto. | Difícil. |

Ninguno hace trampa: predicen la pelota con la misma física que la marca de pique, y se equivocan en el timing y en la puntería como una persona.

### Entre punto y punto

La pausa dura un segundo como mucho y se saltea con un toque. Al terminar el partido, "Revancha" es el botón principal y ya tiene el foco.

### Opciones

Esquema de control y lado del joystick, velocidad del juego (60 %, 80 %, 100 %), movimiento asistido, guía de dónde pararse, marca de dónde pica, anillo de timing, reducir movimiento, vibración, cámara (tres encuadres para comparar), resolución, pantalla completa y contador de cuadros. Abajo se ven los datos guardados en el dispositivo.

**Movimiento asistido** es una opción de accesibilidad y viene apagada: el jugador corre solo hacia la pelota y la persona solo pega.

## Arquitectura

```
src/
  config.ts          Todos los números ajustables del juego, en un solo lugar
  core/              Utilidades sin estado de juego: matemática, azar con semilla, estadísticas de cuadros
  sim/               La simulación. No sabe nada de pantalla, DOM, reloj ni dispositivos
    ball.ts            Física de la pelota: gravedad, pique, vidrio, reja, red
    court.ts           Geometría de la cancha y perfiles de las paredes
    rules.ts           Reglas del punto: qué pique vale, qué es falta, quién puede pegar
    score.ts           15/30/40, punto de oro, juegos, sets, tie-break y rotación del saque
    shots.ts           Qué golpe sale según la situación y qué velocidad darle para que caiga donde se apuntó
    trajectory.ts      Predicción: simula el futuro de la pelota con la misma física y reglas
    intercept.ts       Dónde y cuándo le conviene pegar a cada jugador
    formation.ts       Dónde se para cada jugador, para equipos de 1 o de 2
    player.ts          Estado y movimiento de un jugador
    replay.ts          Grabación de las entradas y repetición exacta de un partido
    match.ts           El partido: une todo y avanza de a un paso fijo
  control/           Quién decide por cada jugador
    human.ts           Lee la entrada abstracta
    ai.ts              Los rivales, cada uno con su estilo
    autopilot.ts       Movimiento automático, compartido por la IA y por el movimiento asistido
  input/             Táctil, mouse y teclado, traducidos a "quiero la pelota acá" y "me muevo hacia allá"
  platform/          Lo único que conoce el navegador: guardado, vibración, sonido, pantalla, ciclo de vida
  render/            Todo lo que se ve
    scene.ts           El contrato entre el juego y cualquier renderer
    camera.ts          Proyección pseudo-3D y encuadre automático
    prototype/         El renderer actual, de formas grises
  ui/                Marcador, menús, opciones y textos (DOM)
  app/               El pegamento: bucle principal, armado de la escena, flujo de pantallas, guardado
tests/               Tests y simulaciones de balance
scripts/             Medición de rendimiento y prueba de punta a punta en un navegador real
```

Las dependencias van en un solo sentido: `sim` no importa nada de `render`, `input`, `ui` ni `platform`. Se puede correr un partido entero en Node, y eso es lo que hacen los tests. Un test de arquitectura ([tests/platform.test.ts](tests/platform.test.ts)) falla si alguien rompe esa regla.

### Simulación a paso fijo, render interpolado

La simulación avanza siempre de a 1/120 de segundo (`Match.step`). El bucle principal acumula el tiempo real y corre los pasos que hagan falta; después dibuja un cuadro mezclando las posiciones de los dos últimos pasos según cuánto falta para el siguiente. Así el juego se comporta igual a 30, 60 o 120 cuadros por segundo, y la velocidad ajustable es solo un multiplicador del tiempo que entra al acumulador.

### Determinista y repetible

La simulación no usa `Math.random`, el reloj ni el navegador: todo el azar sale de un generador con semilla. Con la misma semilla y las mismas entradas el partido es idéntico, golpe por golpe. `InputRecorder` guarda las entradas de cada jugador paso por paso (solo cuando cambian) junto con la semilla y la versión de la física (`PHYSICS_VERSION`), y `ReplayController` las vuelve a jugar. Eso sirve hoy para depurar y más adelante para repeticiones, partidos fantasma o validar resultados. Cualquier cambio que altere la física tiene que subir `PHYSICS_VERSION`: las grabaciones y los partidos guardados con otra versión se descartan en vez de reproducirse mal.

### Render separado de la lógica

Un renderer no lee la simulación. Recibe un `Scene` por cuadro (pelota, jugadores con su animación abstracta y hacia dónde se estiran, marca de pique, anillo de timing, marca de objetivo con el golpe que va a salir, pisadas, lo que hacen los pulgares, tutorial) y los eventos de lo que pasó (golpe con su nombre y calidad, pique, pared, punto). Para integrar el arte final alcanza con escribir otra clase que implemente `Renderer` ([src/render/scene.ts](src/render/scene.ts)) y cambiar una línea en [src/app/game.ts](src/app/game.ts). El renderer gris vive entero en [src/render/prototype/](src/render/prototype/).

El marcador, los mensajes y los menús son DOM encima del canvas: texto nítido a cualquier resolución, botones de verdad, foco de teclado y lectores de pantalla sin trabajo extra.

### Equipos de N jugadores, un controlador por jugador

Un `Match` recibe dos equipos con la cantidad de jugadores que sea, y cada jugador trae su `Controller`. Nada asume 1 contra 1: el saque rota entre todos los jugadores, las formaciones salen de una tabla en coordenadas del equipo y, cuando hay más de un jugador, el partido decide quién va a cada pelota. `npm run sim` y los tests ya juegan partidos de dobles con cuatro IA. Para tener dobles de verdad falta el encuadre y decidir cómo se maneja al compañero, no reescribir.

### Una sola física para todo

`stepBall` es una función pura. El partido la usa para mover la pelota y `predictTrajectory` la usa para simular su futuro, con las mismas reglas. De esa predicción salen:

- la marca de dónde va a picar, que sigue a la pelota después de un vidrio,
- el punto y el momento del contacto, incluso después de un rebote en la pared,
- las pisadas que aconsejan dónde pararse,
- el movimiento de los rivales y el movimiento asistido,
- la decisión de dejar pasar una pelota que se va afuera sola.

### El golpe en dos tiempos

Pedir un golpe no es pegar: **arma** al jugador con una intención (lado, profundidad, por arriba o no). El contacto ocurre cuando la pelota llega, y ahí `resolveShot` decide qué golpe sale y a dónde va. Es una función pura, así que la marca de objetivo muestra exactamente lo que va a pasar. El error de timing es la diferencia entre el momento en que se pidió el golpe y el del contacto.

Para un jugador que se mueve a mano, el contacto se recalcula en cada paso para el lugar donde está parado (`contactNear`): la pelota a su alcance que quede mejor ubicada y sea más cómoda. Un jugador automático, en cambio, elige el contacto y corre hacia él (`planIntercept`).

### Los errores salen de la física

La calidad del golpe no mueve el punto de pique: desvía el lanzamiento (dirección, ángulo y velocidad). Un drive plano y rápido tiene poco margen sobre la red y antes del vidrio; un golpe alto y al centro perdona mucho. La dispersión crece con lo estirado que llega el jugador, con la velocidad de la pelota que viene, con las pelotas bajas, con el riesgo del lugar al que se apunta y con el largo del peloteo: después de 5 golpes el punto se va acelerando, así que ninguno dura para siempre.

### Cámara

Proyección de perspectiva con inclinación ([src/render/camera.ts](src/render/camera.ts)). La distancia focal no se elige a mano: `Camera.fit` la calcula para que la cancha completa entre en la pantalla, con lugar arriba para el marcador, una franja libre abajo para los pulgares y lo que el dispositivo reserve (notch, barra de inicio). Hay tres encuadres en Opciones para comparar en el celular: baja (38°), media (45°, por defecto) y alta (52°).

### Canvas

El canvas sigue el tamaño que le da el CSS. Su resolución interna es la densidad de la pantalla con tope en 2, por una escala que baja sola si el dispositivo no llega a los cuadros por segundo. Cada bajada es una prueba: si no mejora, se deshace, para no borronear el juego cuando el límite lo pone el ahorro de batería y no los píxeles. La cancha se dibuja una sola vez en una capa cacheada, y los textos del canvas (el nombre del golpe) se pintan una vez y después se copian.

## Preparado para ser una app (PWA y Capacitor)

Todavía no hay manifest, service worker ni proyecto de Capacitor. Lo que sí está es la base para que agregarlos no obligue a tocar el juego:

**Zonas seguras.** La página pide `viewport-fit=cover`. El marcador, la pausa, las ayudas y los menús se corren con `env(safe-area-inset-*)`. El canvas no puede leer esas variables, así que la plataforma las mide con un elemento invisible y `Camera.fit` baja la cancha y sube la zona de los pulgares. La prueba de punta a punta lo verifica emulando un notch de 47 px y una barra de inicio de 34 px.

**Nada depende de la dirección de la página.** No hay rutas ni estado en la URL, y `location` solo se lee para los atajos de desarrollo. El build usa rutas relativas (`base: './'`) y un único script clásico en vez de un módulo, porque los navegadores no cargan módulos desde `file://`. Así el mismo `dist/` funciona en una subcarpeta de GitHub Pages, en `capacitor://localhost`, en `https://localhost` y abierto desde el disco. La prueba de punta a punta abre `dist/index.html` desde `file://` y juega.

**Lo que depende del dispositivo está detrás de interfaces chicas** ([src/platform/types.ts](src/platform/types.ts)). El juego recibe un `Platform` y no toca nada más:

| Interfaz | Hoy en el navegador | En una app nativa |
| --- | --- | --- |
| `storage` | `localStorage`, con memoria como respaldo si está bloqueado. Pide `navigator.storage.persist()`. | Preferences |
| `haptics` | `navigator.vibrate` | Haptics, con impactos de verdad |
| `sound` | Silencio: el juego ya avisa qué sonido toca y con qué fuerza | Audio nativo o Web Audio |
| `display` | Zonas seguras, reducir movimiento, pantalla completa y bloqueo vertical | StatusBar y ScreenOrientation |
| `lifecycle` | `visibilitychange` y `pagehide` | App: pausa, vuelta y botón "atrás" de Android |
| `analytics` | Guarda los últimos eventos en memoria; no sale nada del dispositivo | Lo que se decida, con consentimiento |
| `launch` | Tiempo desde que cargó y atajos de la URL | Parámetros de arranque |

El guardado es asíncrono a propósito: los nativos lo son, y así cambiarlo no toca a quien lo usa. Un test falla si aparece `localStorage`, `navigator`, `location`, pantalla completa, orientación o visibilidad fuera de `src/platform`.

**Todo viaja en el build.** Son tres archivos: un HTML, un CSS y un JavaScript. El ícono es un SVG embebido y las fuentes son las del sistema. No hay nada de CDNs. Un test revisa que el código no tenga direcciones de internet ni llamadas de red, y la prueba de punta a punta mira el tráfico: solo se piden esos tres archivos.

**Se pausa sola** cuando la app pasa a segundo plano, y el partido queda guardado.

Lo que falta para la PWA: el manifest (nombre, íconos, `display: standalone`, orientación vertical), los íconos y un service worker que guarde esos tres archivos para jugar sin conexión. Para Capacitor: crear el proyecto con `webDir: 'dist'`, escribir un `createNativePlatform()` con los plugins de la tabla y usarlo en [src/main.ts](src/main.ts) en lugar de `createWebPlatform()`. Hay que probar en dispositivos reales que `env(safe-area-inset-*)` llegue bien dentro del WebView de Android.

## Lo que se guarda en el dispositivo

No hay cuentas ni registro. Son tres documentos JSON chicos, detrás de `platform.storage` ([src/app/persistence.ts](src/app/persistence.ts)):

- **Opciones.**
- **Partido en curso**: formato, rival, marcador, quién saca y qué intento de saque es. Se guarda al empezar cada punto y se borra al terminar el partido.
- **Perfil**: solo cuentas. Partidos empezados, terminados y ganados, por rival; puntos; golpes por calidad de timing; revanchas; y cuántos segundos pasaron desde abrir el juego hasta el primer golpe.

`exportData` e `importData` pasan todo a un único texto y de vuelta, para llevarse el progreso a otro dispositivo. Todavía no hay un botón que los use.

El juego avisa por `platform.analytics` de los momentos que importan para medir retención (`open`, `match_start`, `first_hit`, `first_point_won`, `intro_done`, `rematch`, `match_end`). Hoy quedan en memoria y no se envía nada.

## Parámetros para iterar

Casi todo lo que define cómo se siente el juego está en [src/config.ts](src/config.ts):

| Qué | Dónde |
| --- | --- |
| Ventanas de timing, compensación de latencia | `timing` |
| Velocidad, altura y profundidad de cada golpe | `shots.specs` |
| Cuánto cuesta cada calidad de timing, estirarse, el riesgo | `shots.quality` y los `*Penalty` |
| Velocidad y alcance de los jugadores, desde dónde se remata o se volea | `player` |
| Rivales | `rivals` |
| Formatos de partido | `FORMATS` |
| Pausas, aceleración de los peloteos largos | `rules` |
| Gestos: joystick, distancias para apuntar, qué es un deslizamiento rápido | `CONTROLS` |
| Física: gravedad, restitución del piso, del vidrio y de la reja | `physics` |
| Medidas de la cancha y de las paredes | `court` |

El alcance extra de la persona (`HUMAN_REACH`) está en [src/app/game.ts](src/app/game.ts). El encuadre y el tamaño visual de la pelota y de los jugadores, en [src/render/view.ts](src/render/view.ts).

`npm run sim` sirve para ver el efecto de un cambio sin jugar. Usa un jugador simulado que pasa por la misma entrada que una persona: empuja el joystick hacia las pisadas, con demora y con error, y suelta el golpe mirando el anillo. Con los valores actuales, sobre 40 partidas rápidas por casilla:

| Jugador simulado | contra Lola | contra Tincho | contra Mora |
| --- | --- | --- | --- |
| Principiante (timing ±160 ms, se para a 70 cm del lugar ideal) | gana 70 % | gana 5 % | gana 0 % |
| Promedio (±100 ms, 45 cm) | gana 98 % | gana 43 % | gana 15 % |
| Experto (±50 ms, 25 cm) | gana 100 % | gana 100 % | gana 88 % |

Un punto dura de promedio entre 5 y 7 golpes contra Lola, entre 8 y 14 contra Tincho y entre 8 y 16 contra Mora. Una partida rápida dura entre 2 y 5 minutos y medio de juego. Con movimiento asistido el jugador promedio le gana a Tincho 37 de 40. Cerca de la mitad de los golpes son salidas de pared y entre el 2 % y el 4 % contraparedes.

Estos números sirven para comparar cambios. No dicen cómo le va a una persona de verdad: nadie midió todavía qué tan bien se mueve alguien con el joystick.

## Rendimiento

Objetivo: 60 cuadros por segundo en un Android de gama media de hace unos cinco años.

**Medición.** `npm run perf` abre el build de producción en Chrome, emula un celular en vertical (360×800 CSS, densidad 3, táctil), frena la CPU con el protocolo DevTools y deja correr un partido de IA contra IA durante 12 segundos por cada nivel de freno. El canvas queda en 720×1600 por el tope de densidad.

Resultados en Chrome 157 headless, sobre un Ryzen 7 8700G:

| CPU | Cuadros por segundo | Tiempo entre cuadros (mediana / p99 / peor) | Cuadros de más de 17,5 ms | Trabajo de JavaScript por cuadro |
| --- | --- | --- | --- | --- |
| 1× | 240 | 4,2 / 4,4 / 4,5 ms | 0 % | 0,08 ms |
| 4× | 240 | 4,2 / 4,4 / 4,5 ms | 0 % | 0,38 ms |
| 6× | 239 | 4,2 / 4,4 / 41,7 ms | 0 % | 0,50 ms |
| 12× | 230 | 4,2 / 8,4 / 37,6 ms | 0 % | 1,12 ms |
| 20× | 107 | 8,4 / 20,9 / 45,7 ms | 3,0 % | 2,72 ms |

Chrome headless pinta a 240 cuadros por segundo, así que "240" significa que no perdió ninguno. Con la CPU frenada 4× el JavaScript del juego usa 0,38 ms de los 16,7 ms que hay por cuadro a 60 cuadros por segundo. Los niveles altos varían de una corrida a otra.

Con una persona jugando hay un poco más de trabajo, porque el contacto se recalcula en cada paso y se dibujan la marca de objetivo y los controles. Medido con dos dedos emulados moviéndose todo el tiempo: 0,12 ms por cuadro sin freno, 0,48 ms con 4× y 0,70 ms con 6×, sin ningún cuadro de más de 17,5 ms. La prueba de punta a punta también pasa completa con la CPU frenada 4× (`npm run smoke -- --throttle 4`).

**Qué no dice esta medición.** Frenar la CPU no frena la GPU ni el rasterizado, y una computadora de escritorio frenada 4× sigue siendo más rápida que el celular objetivo. Es una cota optimista. Falta medir en un teléfono real: con `?fps` (o la opción "Mostrar fps") el juego muestra cuadros por segundo, el peor cuadro del último segundo y el trabajo por cuadro.

**Peso.** La descarga inicial es de 34 KB comprimidos: 31,0 KB de JavaScript, 2,0 KB de CSS y 0,8 KB de HTML. No hay imágenes, fuentes ni dependencias en tiempo de ejecución.

## Verificación

- `npm test`: 183 tests. Cubren la física de la pelota (pique, vidrio, reja, red, salida de la cancha), que la predicción coincide exactamente con la simulación, las reglas (pique antes de pared, doble pique, saque cruzado, faltas, let), la puntuación (punto de oro, tie-break, rotación del saque en singles y dobles), qué golpe sale en cada situación, el timing y el golpe armado, el movimiento a mano y el asistido, los gestos de los dos esquemas, el tutorial, guardar y seguir un partido, la repetición exacta de un partido grabado, la cámara, partidos completos entre IA (también de dobles) y las reglas de arquitectura.
- `npm run smoke`: 46 verificaciones en un Chrome con emulación de celular, con toques reales. Hace la primera visita, juega un partido entero con dos dedos a la vez (uno en el joystick, el otro manteniendo, apuntando y soltando), pausa y saltea la espera entre puntos, pasa por el inicio y las opciones, juega con una mano, cierra el juego a mitad de un partido y lo retoma, emula un notch, prueba mouse y teclado en tamaño de escritorio, abre el build desde `file://` y revisa que no se pida nada de afuera. Guarda capturas de cada etapa en `.smoke/`.

Los dedos de la prueba los maneja un programa que lee el estado del partido. Sirve para saber que los controles funcionan de punta a punta; no para saber cómo se sienten.

## Accesibilidad

- Nada depende solo del color: los equipos se distinguen por tono y contorno, el jugador propio tiene un anillo bajo los pies, el timing se lee por la forma del anillo y por una palabra, la marca de objetivo cambia de forma según el golpe, y la opción elegida lleva una marca además del relleno.
- Reducir movimiento (toma la preferencia del sistema): sin estela, sin pausa de impacto y sin mensajes que se desplazan.
- Ayudas que se pueden apagar: marca de dónde pica la pelota, anillo de timing y guía de dónde pararse.
- Movimiento asistido, para quien no pueda o no quiera manejar el joystick.
- Dos esquemas de control, uno de ellos para una sola mano, y joystick de cualquiera de los dos lados.
- Velocidad del juego ajustable al 60 % y al 80 %; las ventanas de timing se agrandan en la misma proporción.
- Pausa en cualquier momento, con el botón, con P o Escape, y automática al cambiar de pestaña o de aplicación.
- Se juega sin sonido: todavía no hay ninguno, y toda la información es visual.
- Menús con botones reales, foco visible y regiones que anuncian el marcador y el resultado de cada punto.

## Publicación

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) corre los tests, hace el build y publica `dist/` en GitHub Pages cada vez que se hace push a `main`. El repositorio ya tiene Pages configurado con origen "GitHub Actions", así que el primer push a `main` publica. Como el build usa rutas relativas, no hay que configurar la base del sitio.

## Pendientes conocidos

- **Probarlo en un celular real.** Es lo más importante que falta. Las ventanas de timing, el adelanto del anillo, la compensación de latencia (30 ms), el tamaño del joystick y lo que separa "arrastrar" de "deslizar rápido" son un punto de partida razonado, no medido.
- No hay sonido. El juego ya pide cada sonido por lo que pasó (`platform.sound.play('hit', fuerza)`); falta quien los haga sonar.
- El resumen de fin de partido muestra solo el resultado: faltan los números del partido y un "Siguiente rival".
- No hay botón para exportar o importar los datos guardados, ni pantalla de privacidad. No se envía nada a ningún lado.
- El saque no tiene timing: entra casi siempre. Las faltas existen (hay segundo saque y doble falta), pero son raras.
- La pelota no tiene efecto. Con eso, un remate bien colocado gana por tiempo y no porque "salga por tres".
- Los rivales tienen estilo de juego pero no personalidad visible: no anticipan su golpe con un gesto ni reaccionan al punto.
- Dobles funciona en la simulación, pero falta el encuadre y la interfaz para jugarlo.
- La red no tiene postes con hueco ni puertas, y la pelota no choca con los jugadores.
- `npm audit` marca una vulnerabilidad de severidad alta en `picomatch`, que llega por Vite y Vitest. Son herramientas de desarrollo: no entra en lo que se publica.
