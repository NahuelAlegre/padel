# Pádel

Juego de pádel para navegador, pensado primero para el celular en vertical. Simple de jugar, accesible y lindo de ver.

Las decisiones de diseño del proyecto están en [CLAUDE.md](CLAUDE.md). Este README cubre el motor y el juego tal como está hoy: la simulación, los controles, los rivales y el aspecto **3D toon en tiempo real sobre una cancha con la luz horneada**, con un respaldo en Canvas 2D para que nadie se quede sin jugar.

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
| `npm test` | Tests de física, reglas, puntuación, golpes, gestos, personajes, cámara, animación, pantalla limpia, guardado y arquitectura (Vitest). |
| `npm run sim` | Juega cientos de partidos sin pantalla e imprime estadísticas de balance. |
| `npm run smoke` | Abre el build en un Chrome con emulación de celular y lo juega con toques reales. |
| `npm run perf` | Mide el peso de la primera visita, el tiempo hasta el primer cuadro y el trabajo por cuadro, con emulación de celular, CPU frenada y conexiones lentas. |
| `npm run art` | Empaqueta la cancha y el personaje para la web (ver "Los archivos del arte"). Necesita Python y Pillow 11.3 o más nuevo. |

`smoke` y `perf` usan un Chrome o Edge ya instalado (o el que indique `CHROME_PATH`) y necesitan que antes se haya corrido `npm run build`. Abren el navegador sin ventana, con un perfil descartable en una carpeta temporal.

Atajos de desarrollo en la URL: `?demo` arranca un partido de IA contra IA, `?loop` lo repite al terminar, `?fps` muestra el contador de cuadros (con qué aspecto se está dibujando, `3d` o `2d`) y el error de timing de cada golpe en milisegundos, `?2d` no usa nunca el 3D (lo que ve un dispositivo sin WebGL2) y `?record` guarda las entradas del partido para poder repetirlo.

## Cómo se juega

**La primera vez no hay menú ni nada que leer.** El juego abre directo en la cancha, con tu saque listo, unos pulgares fantasma que muestran los gestos y Beto, el profe, que saluda desde el otro lado. El primer peloteo es el tutorial: devuelve una pelota lenta hacia donde estás y deja pasar la siguiente, hasta que ganás un punto. Una vez que te salió el primer golpe, las visitas siguientes abren en la pantalla de inicio, con "Partida rápida" como botón principal, abajo, donde ya está el pulgar.

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

Con el pulgar derecho, arrastrar a los costados elige el lado, hacia arriba pide más profundidad, bien arriba es un globo y hacia abajo es una chiquita. La marca lo muestra sin palabras: anillo doble para el globo y anillo chico para la chiquita. Está solo mientras el pulgar apunta. El lado del joystick se puede invertir para zurdos.

**Una mano.** Un solo pulgar hace las dos cosas, y lo que las distingue es la velocidad del gesto:

| Gesto | Qué hace |
| --- | --- |
| Apoyar y arrastrar | Joystick flotante. Soltar despacio es quedarse quieto. |
| Deslizamiento rápido | Pega. La dirección apunta y el largo da la profundidad: largo hacia arriba es un globo, hacia abajo una chiquita. |
| Toque | Golpe cómodo al medio. |

Salir del joystick con un latigazo también es un golpe, para no tener que levantar el dedo antes.

**Teclado y mouse.** Flechas o WASD para moverse. J, K y L pegan a la izquierda, al medio y a la derecha; U, I y O son los globos; M es la chiquita y la barra espaciadora una pelota cómoda al medio. P o Escape pausan. El mouse apunta igual que el pulgar derecho: mantener, arrastrar y soltar. Con el esquema de una mano, el mouse hace de pulgar.

### El golpe lo decide la situación

Vos solo decís a dónde querés la pelota. El nombre del golpe lo pone el contexto, nunca un menú. Los golpes que vale la pena aprender (bandeja, víbora, salida de pared, contrapared y remate) aparecen escritos un instante sobre tu jugador cuando te salen; el resto no ensucia la pantalla.

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

**La pelota se enciende un instante antes de que haya que pegarle.** Es la única señal de timing que hay en pantalla. Lo que cuenta es el momento en que soltás (o deslizás) respecto de la llegada de la pelota:

- **Perfecto** (±60 ms): más rápido y preciso.
- **Bien** (±150 ms): normal.
- **Temprano**: si soltás antes de que la pelota esté a tu alcance, el golpe queda **armado** y sale solo cuando llega, tan bien como uno bueno. Lo único que perdés es el perfecto. Así se puede elegir a dónde pegar bastante antes de que llegue la pelota.
- **Tarde** (hasta 240 ms): la pelota vuelve, pero floja, alta y corta.

Un timing mediocre no manda la pelota afuera. Los errores salen del riesgo que elegís (apuntar cerca de las paredes agranda la dispersión) y de no llegar. Las ventanas están medidas en tiempo de juego: con la velocidad al 60 % son ±100 ms y ±250 ms reales. No hay cámara lenta ni pausas para apuntar.

**La ayuda está en el alcance, no en el movimiento.** Alcanza con acercarse: la persona llega a pelotas que pasan a 1,6 m (la máquina, a 1,25 m) y el jugador se estira para llegar. Cuanto más estirado, menos preciso el golpe.

**Qué pelota se juega.** Si desde donde estás parado la pelota pasa dos veces a tu alcance (antes y después del vidrio de fondo, por ejemplo), la señal es para la más cómoda, con el mismo criterio que usa la máquina. Desde el fondo eso suele ser dejarla picar y esperar la salida de pared. La contrapared queda como último recurso: sale cuando la pelota ya te pasó y no va a volver.

### Rivales

Son los tres primeros del elenco diseñado en `docs/personajes.md` (rama de personajes). La idea es que se reconozcan por cómo juegan, no por el nombre:

| Rival | Cómo juega | Cómo se le gana | Gesto delator |
| --- | --- | --- | --- |
| **Beto**, «el Profe» ★ | Pelotas cómodas, al medio y hacia vos. Poca potencia. | Con ángulos: se mueve poco de costado y se equivoca seguido. | Señala con la mano libre a dónde va a tirar. |
| **Romina**, «la Topadora» ★★ | Pega plano y fuerte desde donde esté y sube a la red. | Con paciencia: después del cuarto golpe se va desordenando, y la pared le cuesta. | Se planta con las piernas abiertas y la pala detrás de la cabeza: viene un cañonazo. |
| **Chela**, «la Astronauta» ★★★ | Globos altísimos, pared y casi ningún error. Si llega exigida, siempre tira globo. | Atacando y haciéndola correr: es lenta. | Se agacha con la pala abierta: viene globo. Un pasito adelante: viene chiquita. |

Ninguno hace trampa: predicen la pelota con la misma física que la marca de pique. Por ahora los tres comparten el mismo cuerpo y se distinguen por los colores: Beto de blanco, azul marino y mostaza; Romina de rojo, amarillo y negro; Chela de lavanda, blanco y rosa.

**El gesto delator no miente.** El rival decide el golpe entre 0,45 y 0,55 s antes del contacto y desde ese momento su armado lo muestra. No lo cambia salvo que cambie la pelota. La primera vez no se nota; a la quinta te anticipás.

**Manías y frases, sin frenar nada.** Entre punto y punto el rival tiene un tic corto (Beto se acomoda la gorra, Romina golpea la pala contra la zapatilla, Chela saluda al banco) y a veces dice algo en un globito sobre su cabeza: en más o menos un tercio de los puntos, nunca tres seguidos y sin repetirse enseguida. Todo ocurre dentro de la pausa que ya existe: el saque cierra el globito y corta el tic, y el rival nunca demora su saque por esto. Las frases se pueden poner en "Pocas" o "Ninguna" y nunca dicen nada necesario para jugar.

**Te reconocen.** El juego guarda la historia con cada rival en el dispositivo. La primera vez se presentan ("¡Hola! Soy Beto, el profe."), después te saludan distinto, y al terminar piden la revancha al lado del botón ("¿Otra? ¡De una!"). Si un rival te ganó tres veces seguidas, al empezar el siguiente partido te cuenta su gesto delator, una sola vez. No hay rachas que castiguen ni nada que se pierda por perder.

### Entre punto y punto

La pausa dura un segundo como mucho y se saltea con un toque. Quien ganó el punto lo festeja con un gesto corto mientras camina a su lugar; el saque siguiente lo corta y nada espera a que termine. Al terminar el partido, "Revancha" es el botón principal y ya tiene el foco.

### Opciones

Esquema de control y lado del joystick, velocidad del juego (60 %, 80 %, 100 %), frases del rival (muchas, pocas, ninguna), ayudas en pantalla (completas, mínimas, ninguna), movimiento asistido, reducir movimiento, vibración, cámara (acompaña o fija), resolución, pantalla completa y contador de cuadros. Abajo se ven los datos guardados en el dispositivo.

**Ayudas en pantalla.** El juego es para alguien que quiere algo simple y no quiere leer, así que por defecto hay muy poco:

| Nivel | Qué hay en pantalla |
| --- | --- |
| **Mínimas** (por defecto) | Una sola señal de timing (la pelota se enciende en el último instante), una marca chica donde va a picar la pelota que viene a tu lado, la marca de objetivo mientras el pulgar apunta, y el nombre de los golpes especiales. |
| **Completas** | Todo: anillo bajo tu jugador, anillo de timing con sus ventanas, pisadas donde conviene pararse, marca de cada pique, marca de objetivo también con el golpe armado y con el halo del riesgo, el nombre y la calidad de cada golpe, y los textos de ayuda del saque. |
| **Ninguna** | Nada: la cancha, la pelota y su sombra. |

Las ayudas mínimas **se van apagando a medida que acertás**: cada golpe que sale (perfecto, bien o armado de antemano) las atenúa un poco, y cada golpe tarde o pelota a la que no llegaste las trae de vuelta. Se apagan para quien acierta más de cuatro de cada cinco. Nunca bajan de un cuarto de su intensidad; para no ver nada está "Ninguna". Las completas no se apagan: son las de quien las quiere o las necesita.

**Cámara.** Hay gente a la que le gusta una y gente a la que le gusta la otra, así que se elige: **Acompaña** (por defecto) va con la jugada, de a poco; **Fija** muestra la cancha entera, quieta. Con "Reducir movimiento" la cámara queda fija.

**Movimiento asistido** es una opción de accesibilidad y viene apagada: el jugador corre solo hacia la pelota y la persona solo pega.

## Cómo se ve

**3D toon en tiempo real sobre una cancha horneada.** La cancha es un club al atardecer cuya luz se calculó una sola vez, en Blender, y viaja como siete imágenes. Los jugadores son una malla 3D chica con esqueleto, sombreada en tres tonos planos, con contorno de tinta y una sombra en el piso que tiene la forma de la pose. Todo se dibuja con WebGL2 escrito a mano, sin motor ni bibliotecas.

**Escala.** Los personajes se dibujan más grandes de lo real, y más cuanto más lejos están: 1,2× el cercano y 1,5× el del fondo. Así la cancha se siente grande y el rival se lee.

**Si no hay 3D, hay 2D.** Sin WebGL2, o si el sistema le quita el contexto gráfico a la página, el juego sigue en Canvas 2D: la misma cancha horneada, con personajes simples. Cuando el contexto vuelve, vuelve el 3D. Abierto desde un archivo (`file://`) también se ve en 2D, porque el navegador no deja leer el archivo del personaje.

**Pantalla limpia.** No hay anillo bajo tu jugador, ni pisadas, ni círculos que se cierran. Lo que se muestra es poco, fino y está pintado en el mundo (ver "Ayudas en pantalla").

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
  platform/          Lo único que conoce el navegador: los archivos del juego, guardado, vibración, sonido,
                     pantalla, ciclo de vida
  render/            Todo lo que se ve
    scene.ts           El contrato entre el juego y cualquier renderer
    view.ts            Qué cámaras hay y los pocos números del dibujo que no son de la cámara
    viewport.ts        Tamaño y densidad del canvas
    stage/             Lo que comparten los dos aspectos
      camera.ts          La cámara de referencia, el encuadre, la cámara que acompaña y la escala de los personajes
      view.ts            Cámara más pantalla: dónde cae un punto de la cancha y la matriz para la placa de video
      court-art.ts       Las capas de la cancha horneada (la tabla la escribe scripts/art.py)
      director.ts        Decide qué muestra cada cuadro: cámara, marcas, efectos y nombres
      frame.ts           El cuadro ya resuelto, igual para los dos aspectos
      looks.ts           Los colores de cada personaje
      renderer.ts        El renderer: carga los archivos, elige 3D o 2D y maneja la pérdida de contexto
    toon/              El aspecto 3D, en WebGL2 escrito a mano
      character.ts       Lee el personaje: malla, esqueleto y clips
      animator.ts        De lo que dice la simulación a la pose del cuerpo
      reach.ts           Cinemática inversa de brazos y piernas
      shaders.ts         Los cuatro programas
      gl.ts              Dibuja el cuadro
    flat/              El aspecto 2D de respaldo, y lo que va encima del mundo en los dos (pulgares, nombres)
  ui/                Marcador, menús, opciones y textos (DOM)
  app/               El pegamento: bucle principal, armado de la escena, flujo de pantallas, guardado,
                     y lo que dice y hace el rival entre puntos
public/art/          La cancha y el personaje tal como los baja el juego
tests/               Tests y simulaciones de balance
scripts/             Empaquetado del arte, medición de rendimiento y prueba de punta a punta en un navegador real
```

Las dependencias van en un solo sentido: `sim` no importa nada de `render`, `input`, `ui` ni `platform`. Se puede correr un partido entero en Node, y eso es lo que hacen los tests. Un test de arquitectura ([tests/platform.test.ts](tests/platform.test.ts)) falla si alguien rompe esa regla.

### Simulación a paso fijo, render interpolado

La simulación avanza siempre de a 1/120 de segundo (`Match.step`). El bucle principal acumula el tiempo real y corre los pasos que hagan falta; después dibuja un cuadro mezclando las posiciones de los dos últimos pasos según cuánto falta para el siguiente. Así el juego se comporta igual a 30, 60 o 120 cuadros por segundo, y la velocidad ajustable es solo un multiplicador del tiempo que entra al acumulador.

### Determinista y repetible

La simulación no usa `Math.random`, el reloj ni el navegador: todo el azar sale de un generador con semilla. Con la misma semilla y las mismas entradas el partido es idéntico, golpe por golpe. `InputRecorder` guarda las entradas de cada jugador paso por paso (solo cuando cambian) junto con la semilla y la versión de la física (`PHYSICS_VERSION`), y `ReplayController` las vuelve a jugar. Eso sirve hoy para depurar y más adelante para repeticiones, partidos fantasma o validar resultados. Cualquier cambio que altere la física tiene que subir `PHYSICS_VERSION`: las grabaciones y los partidos guardados con otra versión se descartan en vez de reproducirse mal.

### Render separado de la lógica

Un renderer no lee la simulación. Recibe un `Scene` por cuadro (pelota con su velocidad, jugadores con su animación abstracta, cuánto falta para que su pala toque la pelota y hacia dónde se estiran, qué personaje es cada uno, el gesto con el que delata su golpe y su manía, qué nivel de ayudas hay y cuánto le queda, pique, contacto, objetivo, lo que hacen los pulgares, tutorial) y los eventos de lo que pasó (golpe con su nombre y calidad, pique, pared, punto). El juego solo conoce la interfaz `Renderer` ([src/render/scene.ts](src/render/scene.ts)): si un cuadro sale en 3D con WebGL2 o en Canvas 2D es asunto del renderer, y ninguna de sus llamadas es asíncrona.

**La simulación no se tocó para el 3D.** Lo único que se le agregó es información para mostrar: cuándo va a ser el contacto de un golpe (`contactAt`) y qué golpe va a salir antes de que salga (`predictKind`). Un partido grabado se repite igual que antes.

### El 3D y su respaldo

`StageRenderer` ([src/render/stage/renderer.ts](src/render/stage/renderer.ts)) es el renderer del juego. Tiene dos maneras de dibujar el mismo cuadro y el juego nunca se entera de cuál usa:

- Arranca en **2D**, que no necesita nada: una cancha pintada a mano y personajes simples.
- Pide por su cuenta las imágenes de la cancha y el archivo del personaje (`platform.assets`). Cuando llegan y el dispositivo tiene WebGL2, pasa al **3D**. Si alguno no llega, o no hay WebGL2, o un shader no compila, se queda en 2D con lo que tenga.
- Si se **pierde el contexto gráfico** (el sistema recuperó memoria, la pestaña estuvo mucho en segundo plano), vuelve al 2D en ese mismo cuadro, y al 3D cuando el contexto vuelve, reconstruyendo todo lo que la placa tenía. El partido no se frena.
- Los primeros instantes espera hasta 1,2 s a que llegue la cancha, con la pantalla del color del atardecer: es mejor un instante oscuro que una cancha que cambia dos veces de aspecto delante de la persona. Con los archivos precargados desde el HTML, en la práctica el primer cuadro ya es en 3D.

Son **dos canvas apilados**. El de abajo es el mundo en 3D. El de arriba es el canvas 2D de siempre, donde también caen los dedos: cuando no hay 3D dibuja todo, y cuando lo hay solo lo que va encima del mundo (los pulgares, el nombre de un golpe especial, los pulgares fantasma del tutorial) y se limpia solo si algo se dibujó.

Antes de dibujar, el **director** ([src/render/stage/director.ts](src/render/stage/director.ts)) convierte el `Scene` en un cuadro resuelto ([frame.ts](src/render/stage/frame.ts)): la cámara, cuánto se agranda cada personaje, las pocas marcas del piso, los efectos cortos de los impactos y el nombre de un golpe. Los dos aspectos dibujan ese mismo cuadro; solo cambia qué tan lindo sale.

### La cancha horneada, en capas

La luz de la cancha no se calcula en el juego: está horneada en imágenes renderizadas desde una cámara de referencia. Son capas porque los jugadores van en el medio y porque cada una se mueve distinto cuando se mueve la cámara:

| Capa | Qué tiene | Cuándo se dibuja |
| --- | --- | --- |
| `cielo` | El cielo. Es un telón: solo se desliza de costado cuando la cámara gira. | Primero |
| `piso`, `entorno`, `paredes` | El piso con sus líneas y sombras, el club y los árboles, los vidrios y las rejas del fondo y de los costados | Detrás de todos |
| `red` | La red | Entre los jugadores del fondo y los de adelante |
| `cerca` | El vidrio de fondo propio | Sobre todo lo que hay en la cancha |
| `frente` | Lo que está entre la cancha y la cámara | Al final |

En 3D cada capa se apoya sobre el plano del mundo donde están sus cosas, y cada punto de ese plano le pregunta a la cámara de referencia dónde cayó en el render: ese es su color. Con la cámara quieta la imagen es el render, píxel por píxel; cuando la cámara se mueve un poco, cada plano se corre como corresponde y aparece el paralaje. El fondo completo se guarda como una textura mientras la cámara no se mueve, así que con la cámara fija es una sola copia por cuadro.

Tres detalles que hacen que no parezca un personaje pegado encima de una foto:

- **Las sombras de los personajes** son la misma malla aplastada contra el piso en la dirección del sol con que se horneó la cancha, multiplicando el piso hacia el violeta. El stencil hace que cada píxel se oscurezca una sola vez.
- **La sombra de la pelota** queda debajo de la pelota, porque es lo que dice a qué altura va, pero estirada hacia donde caen las demás sombras y con su mismo tinte.
- **Los reflejos del vidrio cercano no pasan por encima de tu jugador.** Los cuerpos del lado cercano dejan una marca en el stencil y, donde hay marca, el vidrio se dibuja a un cuarto de su opacidad.

En 2D las mismas imágenes se componen una vez en un canvas y se copian; la cámara no se mueve.

### Los archivos del arte

Los modelos, las animaciones y la cancha salen de los scripts de Blender de [design/prueba-3d/](design/prueba-3d/), que dejan su salida en `design/prueba-3d/assets`. `npm run art` ([scripts/art.py](scripts/art.py)) la empaqueta en `public/art`, que es lo que baja el juego:

| Archivo | Qué es |
| --- | --- |
| `court/<capa>.avif` | Cada capa en AVIF: 131 KB en total contra 306 KB del WebP, con una diferencia promedio de un nivel en 255 |
| `court/<capa>.webp` | La misma capa como vino, para los navegadores sin AVIF. El juego pregunta una sola vez si el navegador decodifica AVIF, para no bajar nada de más. |
| `character.bin` | La malla (7.309 vértices), el esqueleto (25 huesos) y los 10 clips, como vinieron |
| `character.bin.gz` | Lo mismo comprimido: 116 KB en vez de 236 KB. Los servidores de archivos estáticos no siempre comprimen un tipo que no conocen, así que el juego pide este primero y lo descomprime él. |

El script también reescribe la tabla de capas de [court-art.ts](src/render/stage/court-art.ts). Volver a correrlo con la misma entrada da los mismos archivos.

### Personajes animados

Hay un solo cuerpo, compartido por todos, con diez clips. La simulación sabe dónde está cada jugador, a qué velocidad va, si tiene la pala atrás, qué golpe es y cuándo toca la pelota. Lo que va en el medio es `FigureAnimator` ([src/render/toon/animator.ts](src/render/toon/animator.ts)):

- **Las piernas siguen al piso.** El ciclo de correr avanza con los metros realmente recorridos (dividido por la zancada del clip y por la escala del personaje), no con el tiempo: los pies no patinan a ninguna velocidad. De costado usa los pasos laterales y hacia atrás corre el mismo ciclo al revés.
- **Los golpes se estiran en el tiempo.** El cuadro del clip en que la pala toca la pelota cae en el instante en que la simulación le pega. Si el golpe se armó con tiempo, el cuerpo hace su preparación y espera con la pala atrás; los últimos 0,24 s van siempre en fase con la pelota. Si se pidió a último momento (un deslizamiento, una tecla), entra tan rápido como haga falta para estar ahí.
- **Se pega corriendo.** El tronco y los brazos hacen el golpe mientras las piernas siguen el piso; parado, golpea el cuerpo entero.
- **La pala va a la pelota de verdad.** El clip pasa por donde estaba su pelota cuando se animó; la real viene más alta, más baja o más lejos, y además el personaje está agrandado y la pelota no. Alrededor del contacto el cuerpo da un paso hacia la pelota (hasta 0,9 m), se agacha con los pies en el piso si viene baja, y el brazo lleva la pala el resto del camino. Brazos y piernas se resuelven con la misma cinemática inversa de dos huesos ([reach.ts](src/render/toon/reach.ts)). No es un salto en el último cuadro: todo el recorrido del golpe se dobla hacia la pelota. En un partido simulado la pala queda a menos de 20 cm de la pelota en la mitad de los golpes; el resto son pelotas tomadas a dos metros de los pies y golpes a destiempo, donde la simulación es generosa y el cuerpo llega hasta donde llega.
- **El clip se elige por la altura relativa al cuerpo dibujado.** Una pelota a dos metros está sobre la cabeza de alguien de tamaño real y a la altura del pecho del rival agrandado, así que para él es una volea alta y no un remate.
- **Los cambios se funden**, nunca se cortan. La cabeza sigue a la pelota y la trenza se balancea detrás del movimiento.
- **El saque**: la pelota se muestra donde está la mano del personaje agrandado y se desliza a su lugar real apenas se le pega.
- **Cada personaje agrega lo suyo** encima: su gesto delator mientras tiene la pala atrás (Beto señala con la mano libre, Romina se planta con las piernas abiertas, Chela se agacha o da un paso) y su manía entre puntos, como unos pocos lugares donde tienen que estar las manos, la cadera y los pies. El gesto suelta la pala 0,3 s antes del contacto para que el golpe sea el del clip. Quien gana el punto hace un festejo corto.

**Preparado para los clips nuevos.** Los clips pueden traer metadatos y el código ya los lee si están: `stride` (metros por ciclo), `contact` (el instante del contacto) y `hit` (dónde está la pala en ese instante). Si faltan, usa valores razonables: 1,45 m de zancada para correr y 1,05 m para los pasos laterales, y el contacto al 52 % del clip. Los nombres de los huesos y el formato del archivo son los de [design/prueba-3d](design/prueba-3d/).

### Pantalla limpia

Qué ayuda existe en cada nivel se decide una sola vez, al armar la escena ([src/app/scene.ts](src/app/scene.ts)), para cualquier renderer; cómo se ve, en el director. El resultado con las ayudas mínimas:

- El anillo bajo tu jugador, las pisadas y el anillo de timing no existen.
- La señal de timing es un resplandor sobre la pelota que aparece 0,18 s antes del contacto.
- La marca de pique es un anillo fino y chico, solo para el primer pique de una pelota que viene a tu lado.
- La marca de objetivo está mientras el pulgar apunta; al soltar ya no hay nada que decidir y se va.
- Los efectos de los impactos duran entre 0,16 y 0,22 s y no dejan anillos: un destello en el golpe, un poco de polvo en el pique, un brillo en el vidrio.

Cuánto le queda de esas ayudas a cada persona (`assist`, de 0 a 1) se guarda en su perfil.

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

**Lo que se ve y se lee.** `Personality` ([src/app/personality.ts](src/app/personality.ts)) escucha los eventos del partido y decide frases y manías. Tiene su propio generador de azar, distinto del de la simulación: con las frases prendidas o apagadas el partido es idéntico, golpe por golpe, y hay un test que lo verifica. El globito es DOM y sigue a la cabeza del rival; los gestos y las manías son poses de cuerpo entero, para que se lean al tamaño del rival, y existen en los dos aspectos: en 3D con cinemática inversa sobre el esqueleto, en 2D sobre la figura simple.

**Lo que se dejó afuera** del diseño del elenco, por ahora: los otros siete personajes, las reacciones propias al ganar o perder un punto, el busto en el marcador, la tarjeta de presentación, la escalera del club, el rival sugerido en la partida rápida, los compañeros y sus avisos en dobles, y las voces.

### Los errores salen de la física

La calidad del golpe no mueve el punto de pique: desvía el lanzamiento (dirección, ángulo y velocidad). Un drive plano y rápido tiene poco margen sobre la red y antes del vidrio; un golpe alto y al centro perdona mucho. La dispersión crece con lo estirado que llega el jugador, con la velocidad de la pelota que viene, con las pelotas bajas, con el riesgo del lugar al que se apunta y con el largo del peloteo: después de 5 golpes el punto se va acelerando, así que ninguno dura para siempre.

### Cámara

La cámara de referencia, con la que se horneó la cancha, mira desde atrás y arriba (30° hacia abajo) y muestra la cancha entera. La pantalla se llena siempre a lo ancho: un teléfono largo ve más cielo y más piso, uno corto menos, y nunca hay franjas ([src/render/stage/camera.ts](src/render/stage/camera.ts)).

**"Fija"** es esa cámara, quieta. **"Acompaña"** es esa cámara un poco corrida, un poco girada y un poco más cerca. En pádel la pelota que te pasa sigue viva, porque vuelve del vidrio, así que la cámara nunca se pega al jugador. Sus reglas:

1. Siempre a la vista, con margen: tu jugador, la pelota, dónde va a picar y tu vidrio de fondo.
2. El rival y la red, siempre a la vista.
3. Solo panea de costado y hace un zoom leve, entre 1,00 y 1,30. Nada más.
4. Se abre con un globo o una pelota que se va al fondo, y se cierra cuando el juego está en la red. Abre enseguida y espera 0,35 s antes de cerrar.
5. Tiene zona muerta (medio metro) y va de a poco (1,7 m/s). Si la jugada se le adelanta y algo está por irse del cuadro, se apura (6 m/s), pero va: nunca salta.
6. No sigue a una pelota que ya no está en juego.
7. Con "Reducir movimiento", o en el respaldo 2D, no se mueve.

Los tests la prueban jugando de verdad: partidos simulados enteros contra los tres rivales y uno de dobles, cuadro por cuadro, con pelotas que vuelven de las paredes y globos. En ninguno de los miles de cuadros de cada partido tu jugador, el rival o una pelota en juego dentro de la cancha quedan fuera de la pantalla, el zoom no sale de sus límites y la cámara no se mueve más de 13 cm de un cuadro al siguiente. También se prueban una pantalla corta (360×600) y una larga (412×915). La prueba de punta a punta mira lo mismo en un navegador con un partido jugado con toques.

### Canvas

Los dos canvas siguen el tamaño que les da el CSS. Su resolución interna es la densidad de la pantalla con tope en 2, por una escala que baja sola si el dispositivo no llega a los cuadros por segundo. Cada bajada es una prueba: si no mejora, se deshace, para no borronear el juego cuando el límite lo pone el ahorro de batería y no los píxeles. Los textos del canvas (el nombre de un golpe) se pintan una vez y después se copian.

## Preparado para ser una app (PWA y Capacitor)

Todavía no hay manifest, service worker ni proyecto de Capacitor. Lo que sí está es la base para que agregarlos no obligue a tocar el juego:

**Zonas seguras.** La página pide `viewport-fit=cover`. El marcador, la pausa, las ayudas y los menús se corren con `env(safe-area-inset-*)`. El canvas no puede leer esas variables, así que la plataforma las mide con un elemento invisible y la cámara que acompaña deja ese lugar libre arriba y abajo. La cancha queda entera debajo del marcador y tu vidrio arriba de la zona de los pulgares. La prueba de punta a punta lo verifica emulando un notch de 47 px y una barra de inicio de 34 px.

**Nada depende de la dirección de la página.** No hay rutas ni estado en la URL, y `location` solo se lee para los atajos de desarrollo. El build usa rutas relativas (`base: './'`) y un único script clásico en vez de un módulo, porque los navegadores no cargan módulos desde `file://`. Así el mismo `dist/` funciona en una subcarpeta de GitHub Pages, en `capacitor://localhost`, en `https://localhost` y abierto desde el disco. La prueba de punta a punta abre `dist/index.html` desde `file://` y juega.

**Lo que depende del dispositivo está detrás de interfaces chicas** ([src/platform/types.ts](src/platform/types.ts)). El juego recibe un `Platform` y no toca nada más:

| Interfaz | Hoy en el navegador | En una app nativa |
| --- | --- | --- |
| `assets` | Imágenes y archivos del propio juego, por rutas relativas. Elige AVIF o WebP y descomprime los archivos que viajan con gzip. | Los archivos del paquete |
| `storage` | `localStorage`, con memoria como respaldo si está bloqueado. Pide `navigator.storage.persist()`. | Preferences |
| `haptics` | `navigator.vibrate` | Haptics, con impactos de verdad |
| `sound` | Silencio: el juego ya avisa qué sonido toca y con qué fuerza | Audio nativo o Web Audio |
| `display` | Zonas seguras, reducir movimiento, pantalla completa y bloqueo vertical | StatusBar y ScreenOrientation |
| `lifecycle` | `visibilitychange` y `pagehide` | App: pausa, vuelta y botón "atrás" de Android |
| `analytics` | Guarda los últimos eventos en memoria; no sale nada del dispositivo | Lo que se decida, con consentimiento |
| `launch` | Tiempo desde que cargó y atajos de la URL | Parámetros de arranque |

El guardado es asíncrono a propósito: los nativos lo son, y así cambiarlo no toca a quien lo usa. Un test falla si aparece `localStorage`, `navigator`, `location`, pantalla completa, orientación o visibilidad fuera de `src/platform`.

**Todo viaja en el build.** Un HTML, un CSS, un JavaScript, las siete capas de la cancha y el archivo del personaje. El ícono es un SVG embebido y las fuentes son las del sistema. No hay nada de CDNs. Un test revisa que el código no tenga direcciones de internet y que las llamadas de red estén solo en la plataforma, y la prueba de punta a punta mira el tráfico: no se pide nada fuera del propio paquete, y cada archivo una sola vez.

**Se pausa sola** cuando la app pasa a segundo plano, y el partido queda guardado.

Lo que falta para la PWA: el manifest (nombre, íconos, `display: standalone`, orientación vertical), los íconos y un service worker que guarde los archivos del juego para jugar sin conexión. Para Capacitor: crear el proyecto con `webDir: 'dist'`, escribir un `createNativePlatform()` con los plugins de la tabla y usarlo en [src/main.ts](src/main.ts) en lugar de `createWebPlatform()`. Hay que probar en dispositivos reales que `env(safe-area-inset-*)` llegue bien dentro del WebView de Android.

## Lo que se guarda en el dispositivo

No hay cuentas ni registro. Son tres documentos JSON chicos, detrás de `platform.storage` ([src/app/persistence.ts](src/app/persistence.ts)):

- **Opciones.**
- **Partido en curso**: formato, rival, marcador, quién saca y qué intento de saque es. Se guarda al empezar cada punto y se borra al terminar el partido.
- **Perfil**: solo cuentas. Partidos empezados, terminados y ganados; puntos; golpes por calidad de timing; revanchas; cuántos segundos pasaron desde abrir el juego hasta el primer golpe; y cuánto le queda de las ayudas mínimas.
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
| Cámara que acompaña: zoom, márgenes, zona muerta, velocidades | `FOLLOW` en [src/render/stage/camera.ts](src/render/stage/camera.ts) |
| Cuánto se agranda cada personaje | `FIGURE_SCALE`, en el mismo archivo |
| Colores de cada personaje | [src/render/stage/looks.ts](src/render/stage/looks.ts) |
| Animación: fundidos, paso hacia la pelota, cuánto se agacha, alcance del brazo, gestos | las constantes de [src/render/toon/animator.ts](src/render/toon/animator.ts) |
| Cuándo se enciende la pelota, cuánto duran los efectos y los nombres | [director.ts](src/render/stage/director.ts) y [frame.ts](src/render/stage/frame.ts) |
| Qué tan rápido se apagan las ayudas mínimas | `ASSIST_*` en [src/app/game.ts](src/app/game.ts) |

El alcance extra de la persona (`HUMAN_REACH`) está en [src/app/game.ts](src/app/game.ts).

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

Objetivo: 60 cuadros por segundo en un Android de gama media de hace unos cinco años, y una descarga inicial chica.

`npm run perf` abre el build de producción en Chrome, emula un celular en vertical (360×800 CSS, densidad 3, táctil) y mide tres cosas. Los resultados que siguen son de Chrome 157 headless sobre un Ryzen 7 8700G con su gráfica integrada (Radeon 780M).

**Peso de la primera visita**, tal como viaja por la red, con sus cabeceras:

| Parte | Viaja |
| --- | --- |
| Cancha (7 capas en AVIF) | 133,0 KB |
| Personaje (malla, esqueleto y 10 clips, con gzip) | 116,0 KB |
| Código (JavaScript, con gzip) | 55,8 KB |
| Página y estilos | 3,8 KB |
| **Total** | **308,5 KB en 11 archivos** |

Antes de empaquetar el arte, la cancha y el personaje sumaban 542 KB (306 KB de WebP y 236 KB sin comprimir); ahora son 249 KB. Un navegador sin AVIF baja la cancha en WebP (306 KB). No hay fuentes ni dependencias en tiempo de ejecución.

**Tiempo desde que se pide la página hasta el primer cuadro**, sin nada en caché. El primer cuadro ya es en 3D en todos los casos: la cancha y el personaje se piden desde el HTML, en paralelo con el código.

| Conexión | CPU sin frenar | CPU 4× más lenta |
| --- | --- | --- |
| Sin límite (servidor local) | 97 ms | 262 ms |
| 4G rápida (9 Mbit/s, 60 ms de demora) | 533 ms | 671 ms |
| 4G lenta (1,6 Mbit/s, 150 ms de demora) | 1972 ms | 2067 ms |

**Cuadros**, con un partido de IA contra IA andando:

| Aspecto | CPU | Trabajo del juego por cuadro | Tiempo entre cuadros (mediana / p99 / peor) | Cuadros de más de 17,5 ms |
| --- | --- | --- | --- | --- |
| 3D | 1× | 0,16 ms | 4,2 / 4,4 / 4,5 ms | 0 % |
| 3D | 4× | 0,90 ms | 4,2 / 4,3 / 4,4 ms | 0 % |
| 3D | 6× | 1,11 ms | 4,2 / 4,4 / 12,4 ms | 0 % |
| 2D | 1× | 0,14 ms | 4,2 / 4,4 / 4,5 ms | 0 % |
| 2D | 4× | 0,52 ms | 4,2 / 4,4 / 4,5 ms | 0 % |
| 2D | 6× | 0,84 ms | 4,2 / 4,4 / 8,4 ms | 0 % |

Chrome headless pinta a 240 cuadros por segundo en esta máquina, así que 4,2 ms entre cuadros significa que no perdió ninguno. El "trabajo del juego" es todo lo que hace el JavaScript en un cuadro: simular, animar los esqueletos con su cinemática inversa, decidir la cámara y mandar a dibujar. Con la CPU frenada 6× usa 1,11 ms de los 16,7 ms que hay por cuadro a 60 cuadros por segundo. El canvas queda en 720×1600 por el tope de densidad.

**Qué no dice esta medición.** Frenar la CPU no frena la placa de video, y el tiempo entre cuadros es el de la gráfica de esta máquina, no el de un teléfono. La prueba de estilo 3D ([design/prueba-3d](design/prueba-3d/)), que dibuja lo mismo, dio 60 cuadros por segundo en el celular del usuario, pero este renderer todavía no se midió ahí. Con `?fps` (o la opción "Mostrar fps") el juego muestra cuadros por segundo, el peor cuadro del último segundo, el trabajo por cuadro y si está dibujando en `3d` o en `2d`.

## Verificación

- `npm test`: 256 tests. Cubren la física de la pelota (pique, vidrio, reja, red, salida de la cancha), que la predicción coincide exactamente con la simulación, las reglas, la puntuación, qué golpe sale en cada situación, el timing y el golpe armado, el movimiento a mano y el asistido, los gestos de los dos esquemas, el tutorial, guardar y seguir un partido (y leer lo que guardó la versión anterior), la repetición exacta de un partido grabado, partidos completos entre IA (también de dobles), las reglas de arquitectura y el elenco. De esta ronda:
  - **El personaje** ([tests/toon.test.ts](tests/toon.test.ts)): que el archivo se lee bien, que la pala está donde dice cada clip en su instante de contacto y que los ciclos cierran.
  - **La animación** ([tests/animator.test.ts](tests/animator.test.ts)): un ciclo de piernas son los metros de una zancada a cualquier velocidad; arrancar y frenar sin saltos; la pala en el punto de contacto en el instante del contacto, se haya armado el golpe con mucho tiempo o con 90 ms; que armado con tiempo espera con la pala atrás; el paso hacia la pelota y la vuelta; pegar corriendo; la cabeza que sigue a la pelota; los gestos delatores y las manías de cada personaje; el festejo; y, en un partido simulado entero, que la pala queda cerca de la pelota en el contacto.
  - **La cámara y la pantalla limpia** ([tests/stage.test.ts](tests/stage.test.ts)): las reglas de la cámara que acompaña pieza por pieza y jugando partidos enteros contra los tres rivales; que "Fija", "Reducir movimiento" y el respaldo 2D no mueven nada; y qué hay en pantalla con cada nivel de ayudas, cuadro por cuadro.
- `npm run smoke`: 85 verificaciones en un Chrome con emulación de celular, con toques reales. Hace la primera visita (en 3D, sin textos de ayuda, con el saludo del rival), juega un partido entero con dos dedos a la vez mientras mira que la pantalla siga limpia, que la cámara tenga siempre a la vista lo que importa y que el rival delate sus golpes, tenga sus manías y diga sus frases; pausa y saltea la espera entre puntos; pasa por el inicio y las opciones (ayudas y cámara incluidas); **le quita el contexto gráfico a la página en medio del juego** y mira que siga en 2D y que vuelva al 3D; juega con una mano, la cámara fija y las ayudas completas; cierra el juego a mitad de un partido y lo retoma; prueba un dispositivo sin WebGL2; emula un notch; prueba mouse y teclado en tamaño de escritorio; abre el build desde `file://`; y revisa que no se pida nada de afuera y que la cancha baje en AVIF y el personaje comprimido. Guarda capturas de cada etapa en `.smoke/`.

Los dedos de la prueba los maneja un programa que lee el estado del partido. Sirve para saber que los controles funcionan de punta a punta; no para saber cómo se sienten. Para mirar la animación cuadro por cuadro, `Game.advance(dt)` avanza el partido un cuadro con el bucle detenido.

## Accesibilidad

- Los gestos delatores y las manías son de cuerpo entero: no dependen del color ni de la cara. Las frases son texto, se pueden apagar y no llevan información necesaria; por eso el globito queda fuera de los lectores de pantalla, que ya anuncian el marcador y el resultado de cada punto.
- Nada depende solo del color: tu jugador es siempre el de adelante y de espaldas, la marca de objetivo cambia de forma según el golpe, la señal de timing es un cambio de brillo y de tamaño, y la opción elegida lleva una marca además del relleno.
- Reducir movimiento (toma la preferencia del sistema): cámara fija, sin estela, sin destellos, sin pausa de impacto y sin mensajes que se desplazan.
- Ayudas completas para quien las quiera o las necesite, en Opciones: anillo bajo tu jugador, anillo de timing con sus ventanas, pisadas donde conviene pararse, marca de cada pique, el nombre y la calidad de cada golpe y los textos del saque. No se apagan solas.
- Quien juega con teclado ve qué teclas sacan, aunque las ayudas estén en mínimas: un pulgar fantasma no puede mostrar una tecla.
- Movimiento asistido, para quien no pueda o no quiera manejar el joystick.
- Dos esquemas de control, uno de ellos para una sola mano, y joystick de cualquiera de los dos lados.
- Velocidad del juego ajustable al 60 % y al 80 %; las ventanas de timing se agrandan en la misma proporción.
- Pausa en cualquier momento, con el botón, con P o Escape, y automática al cambiar de pestaña o de aplicación.
- Se juega sin sonido: todavía no hay ninguno, y toda la información es visual.
- Menús con botones reales, foco visible y regiones que anuncian el marcador y el resultado de cada punto.

## Publicación

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) corre los tests, hace el build y publica `dist/` en GitHub Pages cada vez que se hace push a `main`. El repositorio ya tiene Pages configurado con origen "GitHub Actions", así que el primer push a `main` publica. Como el build usa rutas relativas, no hay que configurar la base del sitio.

## Pendientes conocidos

- **Probarlo en un celular real.** Sigue siendo lo más importante. De esta ronda hay que mirar ahí: los cuadros por segundo del renderer 3D (acá solo se midió el trabajo de la CPU), cómo se siente la cámara que acompaña, si la señal de timing alcanza sola, y qué tan rápido conviene que se apaguen las ayudas.
- **Clips nuevos.** El código ya lee la zancada, el instante de contacto y la posición de la pala de cada clip si vienen en el archivo. Lo que traigan de más (la mano en el contacto, dónde sostiene la pelota la mano libre y cuándo la suelta) todavía no se usa: en el saque la pelota se muestra al costado del cuerpo, no en la mano.
- **Límites de la cinemática inversa.** El paso hacia la pelota llega a 0,9 m y el brazo a 0,5 m; las pelotas tomadas más lejos y los golpes tardíos no llegan. El brazo lleva la pala pero no la gira, y el tronco no rota hacia la pelota.
- **Zurdos.** El modelo es diestro. Todo el elenco de hoy lo es; un personaje zurdo necesita el cuerpo espejado.
- **Siluetas propias.** Los tres rivales comparten el cuerpo y cambian los colores.
- **Si el 3D anda lento, no se pasa solo a 2D.** El respaldo entra cuando no hay WebGL2 o se pierde el contexto. En un equipo con WebGL2 por software, hoy solo baja la resolución.
- **La cancha en AVIF se recodifica desde el WebP** de la prueba de estilo. Exportarla directo desde los originales daría un poco más de calidad por el mismo peso.
- **Precarga.** Un navegador que no puede descomprimir por su cuenta (Safari anterior a 16.4) baja el personaje dos veces: el comprimido que precarga la página y el otro.
- **Abierto desde un archivo se ve en 2D**, porque el navegador no deja leer el archivo del personaje. Dentro de una app (Capacitor) se sirve por `https://localhost` y no pasa.
- **Modo incrustable.** No está hecho ni especificado, y no se probó el juego dentro de un `iframe`.
- **El resto de la personalidad.** Hay tres de los diez personajes. Faltan sus reacciones propias al punto (hoy todos festejan igual), el busto en el marcador, la tarjeta de presentación, la escalera del club y el rival sugerido. La dificultad se calibró contra un jugador simulado, no contra gente.

El resto:

- No hay sonido. El juego ya pide cada sonido por lo que pasó (`platform.sound.play('hit', fuerza)`); falta quien los haga sonar.
- La interfaz (marcador, menús) tomó los colores del atardecer, pero es la del prototipo: falta diseñarla.
- El resumen de fin de partido muestra solo el resultado: faltan los números del partido y un "Siguiente rival".
- No hay botón para exportar o importar los datos guardados, ni pantalla de privacidad. No se envía nada a ningún lado.
- El saque no tiene timing: entra casi siempre. Las faltas existen (hay segundo saque y doble falta), pero son raras.
- La pelota no tiene efecto. Con eso, un remate bien colocado gana por tiempo y no porque "salga por tres".
- El globito del rival y el cartel del punto pueden pisarse cuando el rival está cerca de la red.
- Dobles funciona en la simulación y la cámara ya encuadra a los compañeros, pero falta la interfaz para jugarlo.
- La red no tiene postes con hueco ni puertas, y la pelota no choca con los jugadores.
- `npm audit` marca una vulnerabilidad de severidad alta en `picomatch`, que llega por Vite y Vitest. Son herramientas de desarrollo: no entra en lo que se publica.
