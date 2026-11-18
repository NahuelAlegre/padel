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
| `npm test` | Tests de física, reglas, puntuación, golpes, gestos, personajes, guardado y arquitectura (Vitest). |
| `npm run sim` | Juega cientos de partidos sin pantalla e imprime estadísticas de balance. |
| `npm run smoke` | Abre el build en un Chrome con emulación de celular y lo juega con toques reales. |
| `npm run perf` | Mide los cuadros por segundo con emulación de celular y CPU frenada. |

`smoke` y `perf` usan un Chrome o Edge ya instalado (o el que indique `CHROME_PATH`) y necesitan que antes se haya corrido `npm run build`.

Atajos de desarrollo en la URL: `?demo` arranca un partido de IA contra IA, `?loop` lo repite al terminar, `?fps` muestra el contador de cuadros y el error de timing de cada golpe en milisegundos, y `?record` guarda las entradas del partido para poder repetirlo.

## Cómo se juega

**La primera vez no hay menú.** El juego abre directo en la cancha, con tu saque listo, un pulgar fantasma que muestra el gesto y Beto, el profe, que saluda desde el otro lado. El primer peloteo es el tutorial: devuelve una pelota lenta hacia donde estás y deja pasar la siguiente, hasta que ganás un punto. Una vez que te salió el primer golpe, las visitas siguientes abren en la pantalla de inicio, con "Partida rápida" como botón principal, abajo, donde ya está el pulgar.

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

Son los tres primeros del elenco diseñado en `docs/personajes.md` (rama de personajes). La idea es que se reconozcan por cómo juegan, no por el nombre:

| Rival | Cómo juega | Cómo se le gana | Gesto delator |
| --- | --- | --- | --- |
| **Beto**, «el Profe» ★ | Pelotas cómodas, al medio y hacia vos. Poca potencia. | Con ángulos: se mueve poco de costado y se equivoca seguido. | Señala con la mano libre a dónde va a tirar. |
| **Romina**, «la Topadora» ★★ | Pega plano y fuerte desde donde esté y sube a la red. | Con paciencia: después del cuarto golpe se va desordenando, y la pared le cuesta. | Se planta con las piernas abiertas y la pala detrás de la cabeza: viene un cañonazo. |
| **Chela**, «la Astronauta» ★★★ | Globos altísimos, pared y casi ningún error. Si llega exigida, siempre tira globo. | Atacando y haciéndola correr: es lenta. | Se agacha con la pala abierta: viene globo. Un pasito adelante: viene chiquita. |

Ninguno hace trampa: predicen la pelota con la misma física que la marca de pique.

**El gesto delator no miente.** El rival decide el golpe entre 0,45 y 0,55 s antes del contacto y desde ese momento su armado lo muestra. No lo cambia salvo que cambie la pelota. La primera vez no se nota; a la quinta te anticipás.

**Manías y frases, sin frenar nada.** Entre punto y punto el rival tiene un tic corto (Beto se acomoda la gorra, Romina golpea la pala contra la zapatilla, Chela saluda al banco) y a veces dice algo en un globito sobre su cabeza: en más o menos un tercio de los puntos, nunca tres seguidos y sin repetirse enseguida. Todo ocurre dentro de la pausa que ya existe: el saque cierra el globito y corta el tic, y el rival nunca demora su saque por esto. Las frases se pueden poner en "Pocas" o "Ninguna" y nunca dicen nada necesario para jugar.

**Te reconocen.** El juego guarda la historia con cada rival en el dispositivo. La primera vez se presentan ("¡Hola! Soy Beto, el profe."), después te saludan distinto, y al terminar piden la revancha al lado del botón ("¿Otra? ¡De una!"). Si un rival te ganó tres veces seguidas, al empezar el siguiente partido te cuenta su gesto delator, una sola vez. No hay rachas que castiguen ni nada que se pierda por perder.

### Entre punto y punto

La pausa dura un segundo como mucho y se saltea con un toque. Al terminar el partido, "Revancha" es el botón principal y ya tiene el foco.

### Opciones

Esquema de control y lado del joystick, velocidad del juego (60 %, 80 %, 100 %), frases del rival (muchas, pocas, ninguna), movimiento asistido, guía de dónde pararse, marca de dónde pica, anillo de timing, reducir movimiento, vibración, cámara (tres encuadres para comparar), resolución, pantalla completa y contador de cuadros. Abajo se ven los datos guardados en el dispositivo.

**Movimiento asistido** es una opción de accesibilidad y viene apagada: el jugador corre solo hacia la pelota y la persona solo pega.

## Arquitectura

```
src/
  config.ts          Todos los números ajustables del juego, en un solo lugar
  core/              Utilidades sin estado de juego: matemática, azar con semilla, estadísticas de cuadros
  characters/        El elenco: estilo de juego, rasgos, gesto delator, manías y frases de cada personaje
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
    ai.ts              El rival: decide el golpe antes de pegar y lo muestra
    autopilot.ts       Movimiento automático, compartido por la IA y por el movimiento asistido
  input/             Táctil, mouse y teclado, traducidos a "quiero la pelota acá" y "me muevo hacia allá"
  platform/          Lo único que conoce el navegador: guardado, vibración, sonido, pantalla, ciclo de vida
  render/            Todo lo que se ve
    scene.ts           El contrato entre el juego y cualquier renderer
    scenery.ts         El escenario en tres capas, pintado u horneado una vez
    camera.ts          Proyección pseudo-3D y encuadre automático
    prototype/         El renderer actual, de formas grises
  ui/                Marcador, menús, opciones y textos (DOM)
  app/               El pegamento: bucle principal, armado de la escena, flujo de pantallas, guardado,
                     y lo que dice y hace el rival entre puntos
tests/               Tests y simulaciones de balance
scripts/             Medición de rendimiento y prueba de punta a punta en un navegador real
```

Las dependencias van en un solo sentido: `sim` no importa nada de `render`, `input`, `ui` ni `platform`. Se puede correr un partido entero en Node, y eso es lo que hacen los tests. Un test de arquitectura ([tests/platform.test.ts](tests/platform.test.ts)) falla si alguien rompe esa regla.

### Simulación a paso fijo, render interpolado

La simulación avanza siempre de a 1/120 de segundo (`Match.step`). El bucle principal acumula el tiempo real y corre los pasos que hagan falta; después dibuja un cuadro mezclando las posiciones de los dos últimos pasos según cuánto falta para el siguiente. Así el juego se comporta igual a 30, 60 o 120 cuadros por segundo, y la velocidad ajustable es solo un multiplicador del tiempo que entra al acumulador.

### Determinista y repetible

La simulación no usa `Math.random`, el reloj ni el navegador: todo el azar sale de un generador con semilla. Con la misma semilla y las mismas entradas el partido es idéntico, golpe por golpe. `InputRecorder` guarda las entradas de cada jugador paso por paso (solo cuando cambian) junto con la semilla y la versión de la física (`PHYSICS_VERSION`), y `ReplayController` las vuelve a jugar. Eso sirve hoy para depurar y más adelante para repeticiones, partidos fantasma o validar resultados. Cualquier cambio que altere la física tiene que subir `PHYSICS_VERSION`: las grabaciones y los partidos guardados con otra versión se descartan en vez de reproducirse mal.

### Render separado de la lógica

Un renderer no lee la simulación. Recibe un `Scene` por cuadro (pelota, jugadores con su animación abstracta y hacia dónde se estiran, qué personaje es cada uno, el gesto con el que delata su golpe y su manía, marca de pique, anillo de timing, marca de objetivo con el golpe que va a salir, pisadas, lo que hacen los pulgares, tutorial) y los eventos de lo que pasó (golpe con su nombre y calidad, pique, pared, punto). El juego solo conoce la interfaz `Renderer` ([src/render/scene.ts](src/render/scene.ts)): para integrar el arte final alcanza con escribir otra clase que la implemente y cambiar una línea en [src/app/game.ts](src/app/game.ts). El renderer gris vive entero en [src/render/prototype/](src/render/prototype/).

### El escenario en tres capas

Lo que no se mueve (cancha, paredes, red) solo depende del tamaño de la pantalla y de la cámara, así que se hace una vez y en cada cuadro se copia ([src/render/scenery.ts](src/render/scenery.ts)). Son tres piezas porque los jugadores van en el medio:

| Capa | Qué tiene | Dónde va |
| --- | --- | --- |
| `back` | Piso, líneas, pared del fondo y laterales. Opaca, pantalla completa. | Primero. |
| `net` | La red, recortada a su rectángulo. | Sobre los jugadores del fondo y debajo de los de adelante. |
| `front` | La pared cercana, recortada a su rectángulo. | Sobre todo lo que hay en la cancha. |

Hoy las pinta Canvas 2D (`paintScenery`). Es la misma separación que recomienda la investigación de gráficos livianos para hornear el escenario con WebGL2, y está preparada para eso sin implementarlo:

- El renderer acepta un **horneador** opcional (`SceneryBaker`): una función que devuelve las tres piezas cuando las tenga, o `null` si no puede (no hay WebGL2, el shader no compila).
- **Nunca se espera al horneado.** Al cambiar el tamaño se pinta el escenario 2D, que es inmediato, y el horneado lo reemplaza cuando llega. Uno que llega tarde, para una pantalla que ya cambió, se descarta. Ninguna llamada de `Renderer` es asíncrona.
- Las piezas son `CanvasImageSource`: una vez horneadas se pueden copiar a un canvas 2D y soltar el contexto WebGL.
- Para que el shader pinte exactamente la misma cancha, la cámara da su inversa: `Camera.eye` y `Camera.ray(px, py)`.

Un renderer WebGL2 propio para todo el juego (la segunda etapa de esa investigación) es otra clase detrás de la misma interfaz. El renderer recibe el canvas y él pide el contexto, así que cada uno pide el suyo; el de Canvas 2D queda como respaldo. El marcador, los menús y los globitos no se enteran: son DOM, y lo que necesitan de la cancha (dónde está la cabeza de un jugador) lo piden con `Renderer.project`.

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

### Rivales con personalidad

Un personaje es un dato ([src/characters/](src/characters/)). Lo que cambia cómo juega entra a la simulación como números; todo lo demás es presentación y no toca un peloteo.

**Lo que juega.** `toAILevel` traduce el estilo (once valores de 0 a 1: agresividad, red, pared, globo, chiquita, potencia, precisión, errores, velocidad, lectura, ángulo) y los rasgos a los parámetros de la IA. Los ganchos nuevos en el motor son pocos:

| Gancho | Qué hace |
| --- | --- |
| `PlayerIntent.cue` | El golpe que el jugador ya decidió. No cambia nada del peloteo: es lo que muestra su armado. |
| `power` | Multiplica la velocidad de sus golpes (el remate tiene tope). |
| `wallBias` | Gusto por la pelota que vuelve de la pared, al elegir el contacto. |
| `angle`, `aggression` | Qué tan abierto apunta, y cuánto prefiere el golpe fuerte y profundo al seguro. |
| `feed` | Juega hacia el rival en vez de lejos, como un profe (rasgo de Beto; más la primera vez). |
| `impatientAfter`, `impatience` | Dispersión que crece con cada golpe del peloteo (rasgo de Romina). |
| `wallScatter` | Dispersión al jugar de pared (rasgo de Romina). |
| `lobUnderPressure` | Exigida, siempre globo (rasgo de Chela). |
| `mishit` | Cada tanto le pega mal. Sin esto, un rival que juega seguro no erraría nunca, porque el timing solo debilita el golpe. |

**Lo que se ve y se lee.** `Personality` ([src/app/personality.ts](src/app/personality.ts)) escucha los eventos del partido y decide frases y manías. Tiene su propio generador de azar, distinto del de la simulación: con las frases prendidas o apagadas el partido es idéntico, golpe por golpe, y hay un test que lo verifica. El globito es DOM y sigue a la cabeza del rival; los gestos y las manías son poses de cuerpo entero, para que se lean al tamaño del rival.

**Lo que se dejó afuera** del diseño del elenco, por ahora: los otros siete personajes, las reacciones propias al ganar o perder un punto, el busto en el marcador, la tarjeta de presentación, la escalera del club, el rival sugerido en la partida rápida, los compañeros y sus avisos en dobles, y las voces.

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
- **Perfil**: solo cuentas. Partidos empezados, terminados y ganados; puntos; golpes por calidad de timing; revanchas; y cuántos segundos pasaron desde abrir el juego hasta el primer golpe.
- **Historia con cada rival** (unos 150 bytes por rival): cuándo se conocieron y cuándo jugaron por última vez, partidos ganados y perdidos, racha, puntos de oro, el peloteo más largo y si ya contó su gesto delator.

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
| Rivales: estilo, rasgos, gesto delator, manías | [src/characters/cast.ts](src/characters/cast.ts) |
| Cómo el estilo se vuelve juego | [src/characters/style.ts](src/characters/style.ts) |
| Frases | [src/characters/lines.es.ts](src/characters/lines.es.ts) |
| Formatos de partido | `FORMATS` |
| Pausas, aceleración de los peloteos largos | `rules` |
| Gestos: joystick, distancias para apuntar, qué es un deslizamiento rápido | `CONTROLS` |
| Física: gravedad, restitución del piso, del vidrio y de la reja | `physics` |
| Medidas de la cancha y de las paredes | `court` |

El alcance extra de la persona (`HUMAN_REACH`) está en [src/app/game.ts](src/app/game.ts). El encuadre y el tamaño visual de la pelota y de los jugadores, en [src/render/view.ts](src/render/view.ts).

`npm run sim` sirve para ver el efecto de un cambio sin jugar. Usa un jugador simulado que pasa por la misma entrada que una persona: empuja el joystick hacia las pisadas, con demora y con error, y suelta el golpe mirando el anillo. Con los valores actuales, sobre 40 partidas rápidas por casilla:

| Jugador simulado | contra Beto ★ | contra Romina ★★ | contra Chela ★★★ |
| --- | --- | --- | --- |
| Principiante (timing ±160 ms, se para a 70 cm del lugar ideal) | gana 65 % | gana 15 % | gana 3 % |
| Promedio (±100 ms, 45 cm) | gana 98 % | gana 65 % | gana 23 % |
| Experto (±50 ms, 25 cm) | gana 100 % | gana 100 % | gana 100 % |

Un punto dura de promedio entre 5 y 7 golpes contra Beto, entre 7 y 11 contra Romina y entre 9 y 13 contra Chela. Una partida rápida dura entre 2 y 5 minutos y medio de juego. Con movimiento asistido el jugador promedio le gana a Romina 39 de 40.

La forma de cada estilo es la del diseño del elenco. El filo (precisión, errores, velocidad, lectura) se calibró con esta simulación para que las estrellas digan lo que dicen, y no coincide con la tabla del diseño: en este motor un rival que juega seguro casi no erra, así que Beto es fácil porque le pega mal seguido y es lento, y los errores de Romina están en sus rasgos y en el riesgo de pegarle fuerte a todo, no en sus números base.

Estos números sirven para comparar cambios. No dicen cómo le va a una persona de verdad: nadie midió todavía qué tan bien se mueve alguien con el joystick.

## Rendimiento

Objetivo: 60 cuadros por segundo en un Android de gama media de hace unos cinco años.

**Medición.** `npm run perf` abre el build de producción en Chrome, emula un celular en vertical (360×800 CSS, densidad 3, táctil), frena la CPU con el protocolo DevTools y deja correr un partido de IA contra IA durante 12 segundos por cada nivel de freno. El canvas queda en 720×1600 por el tope de densidad.

Resultados en Chrome 157 headless, sobre un Ryzen 7 8700G:

| CPU | Cuadros por segundo | Tiempo entre cuadros (mediana / p99 / peor) | Cuadros de más de 17,5 ms | Trabajo de JavaScript por cuadro |
| --- | --- | --- | --- | --- |
| 1× | 240 | 4,2 / 4,4 / 4,4 ms | 0 % | 0,09 ms |
| 4× | 240 | 4,2 / 4,4 / 8,2 ms | 0 % | 0,43 ms |
| 6× | 239 | 4,2 / 4,4 / 50,1 ms | 0 % | 0,73 ms |
| 12× | 230 | 4,2 / 8,4 / 16,9 ms | 0 % | 1,26 ms |
| 20× | 76 | 12,5 / 29,2 / 54,3 ms | 17,3 % | 2,80 ms |

Chrome headless pinta a 240 cuadros por segundo, así que "240" significa que no perdió ninguno. Con la CPU frenada 4× el JavaScript del juego usa 0,43 ms de los 16,7 ms que hay por cuadro a 60 cuadros por segundo. Los niveles altos varían mucho de una corrida a otra: con 20× otras corridas dieron 107 cuadros por segundo.

Con una persona jugando hay un poco más de trabajo, porque el contacto se recalcula en cada paso y se dibujan la marca de objetivo y los controles. Medido con dos dedos emulados moviéndose todo el tiempo: 0,15 ms por cuadro sin freno, 0,60 ms con 4× y 0,86 ms con 6×, sin ningún cuadro de más de 17,5 ms. La prueba de punta a punta también pasa completa con la CPU frenada 4× (`npm run smoke -- --throttle 4`).

**Qué no dice esta medición.** Frenar la CPU no frena la GPU ni el rasterizado, y una computadora de escritorio frenada 4× sigue siendo más rápida que el celular objetivo. Es una cota optimista. Falta medir en un teléfono real: con `?fps` (o la opción "Mostrar fps") el juego muestra cuadros por segundo, el peor cuadro del último segundo y el trabajo por cuadro.

**Peso.** La descarga inicial es de 41 KB comprimidos: 37,8 KB de JavaScript, 2,2 KB de CSS y 0,8 KB de HTML. Los tres personajes con sus frases pesan unos 7 KB de eso. No hay imágenes, fuentes ni dependencias en tiempo de ejecución.

## Verificación

- `npm test`: 221 tests. Cubren la física de la pelota (pique, vidrio, reja, red, salida de la cancha), que la predicción coincide exactamente con la simulación, las reglas (pique antes de pared, doble pique, saque cruzado, faltas, let), la puntuación (punto de oro, tie-break, rotación del saque en singles y dobles), qué golpe sale en cada situación, el timing y el golpe armado, el movimiento a mano y el asistido, los gestos de los dos esquemas, el tutorial, guardar y seguir un partido, la repetición exacta de un partido grabado, la cámara y su inversa, partidos completos entre IA (también de dobles), las reglas de arquitectura, el elenco (que el gesto delator aparece antes del contacto y no miente, cada rasgo en la cancha, frases y manías que no tocan el partido, la memoria de rivalidad) y el escenario en capas (que nunca se espera a un horneado).
- `npm run smoke`: 56 verificaciones en un Chrome con emulación de celular, con toques reales. Hace la primera visita (con el saludo del rival), juega un partido entero con dos dedos a la vez (uno en el joystick, el otro manteniendo, apuntando y soltando) mientras mira que el rival delate sus golpes, tenga sus manías y diga sus frases, pausa y saltea la espera entre puntos, revisa la frase de revancha y la historia guardada, pasa por el inicio y las opciones, juega con una mano, cierra el juego a mitad de un partido y lo retoma, emula un notch, prueba mouse y teclado en tamaño de escritorio, abre el build desde `file://` y revisa que no se pida nada de afuera. Guarda capturas de cada etapa en `.smoke/`.

Los dedos de la prueba los maneja un programa que lee el estado del partido. Sirve para saber que los controles funcionan de punta a punta; no para saber cómo se sienten.

## Accesibilidad

- Los gestos delatores y las manías son de cuerpo entero: no dependen del color ni de la cara. Las frases son texto, se pueden apagar y no llevan información necesaria; por eso el globito queda fuera de los lectores de pantalla, que ya anuncian el marcador y el resultado de cada punto.
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
- Del elenco hay tres de diez personajes, y faltan sus reacciones al punto, el busto en el marcador, la tarjeta de presentación, la escalera del club y el rival sugerido. La dificultad de los tres se calibró contra un jugador simulado, no contra gente.
- El globito del rival y el cartel del punto pueden pisarse cuando el rival está cerca de la red.
- El escenario se puede hornear con WebGL2 (la interfaz está), pero nadie escribió todavía ese horneador.
- Dobles funciona en la simulación, pero falta el encuadre y la interfaz para jugarlo.
- La red no tiene postes con hueco ni puertas, y la pelota no choca con los jugadores.
- `npm audit` marca una vulnerabilidad de severidad alta en `picomatch`, que llega por Vite y Vitest. Son herramientas de desarrollo: no entra en lo que se publica.
