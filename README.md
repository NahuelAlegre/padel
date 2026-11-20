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
| `npm test` | Tests de física, reglas, puntuación, golpes, profundidad, gestos, personajes, cámara, animación, pantalla limpia, tutorial, sonido, guardado y arquitectura (Vitest). |
| `npm run sim` | Juega cientos de partidos sin pantalla e imprime estadísticas de balance y de profundidad (cómo se juegan los puntos y cuánto paga la táctica). |
| `npm run smoke` | Abre el build en un Chrome con emulación de celular y lo juega con toques reales. |
| `npm run perf` | Mide el peso de la primera visita, el tiempo hasta el primer cuadro y el trabajo por cuadro, con emulación de celular, CPU frenada y conexiones lentas. |
| `npm run art` | Empaqueta la cancha y el personaje para la web (ver "Los archivos del arte"). Necesita Python y Pillow 11.3 o más nuevo. |
| `npm run sounds` | Genera todos los sonidos como WAV en `out/sounds/`, para escucharlos fuera del navegador (ver "Cómo suena"). |
| `npm run sound-board` | Arma el tablero para escuchar y elegir los sonidos, `design/sonido/tablero.html`. |

`smoke` y `perf` usan un Chrome o Edge ya instalado (o el que indique `CHROME_PATH`) y necesitan que antes se haya corrido `npm run build`. Abren el navegador sin ventana, con un perfil descartable en una carpeta temporal.

Atajos de desarrollo en la URL: `?demo` arranca un partido de IA contra IA, `?loop` lo repite al terminar, `?fps` muestra el contador de cuadros (con qué aspecto se está dibujando, `3d` o `2d`) y el error de timing de cada golpe en milisegundos, `?2d` no usa nunca el 3D (lo que ve un dispositivo sin WebGL2) y `?record` guarda las entradas del partido para poder repetirlo.

Atajos experimentales, que valen mientras la página está abierta y no se guardan: `?dobles` juega la partida rápida en 2 contra 2, `?alcance=real` le da a todos el alcance de una persona (`?alcance=actual`, el de siempre), `?lado=drive` o `?lado=reves` elige tu lado en dobles y `?companero=beto`, `romina` o `chela` elige tu compañero. Se combinan: `?dobles&alcance=real`. Con `?demo&dobles` juegan cuatro IA.

## Cómo se juega

**La primera vez no hay menú ni nada que leer.** El juego abre directo en la cancha, con tu saque listo, unos pulgares fantasma que muestran los gestos y Beto, el profe, que saluda desde el otro lado. El primer peloteo hace de introducción: devuelve una pelota lenta hacia donde estás y deja pasar la siguiente, hasta que ganás un punto. Una vez que te salió el primer golpe, las visitas siguientes abren en la pantalla de inicio, con "Partida rápida" como botón principal, abajo, donde ya está el pulgar. Los demás golpes (el globo, la chiquita, la bandeja, el remate) se aprenden en el Tutorial, o jugando: el juego los muestra una vez, cuando convienen.

| Formato | Qué es |
| --- | --- |
| Partida rápida | A 2 juegos, con punto de oro. Entre 2 y 5 minutos. |
| Partido | Un set a 4 juegos, con punto de oro y tie-break corto (a 5 puntos) si llegan 3 a 3. |

El partido se guarda al empezar cada punto. Si cerrás el juego o te llaman por teléfono, al volver aparece "Seguir el partido" con el marcador tal como estaba.

### Tutorial

Está en el inicio y en la pausa, nunca en el camino: "Partida rápida" sigue siendo el botón principal. Son **ocho lecciones cortas que se juegan**, no se leen. En cada una Beto, el profe, arma la situación y te tira la pelota; un pulgar fantasma muestra el gesto; y la lección queda hecha cuando el golpe te salió tres veces.

| # | Lección | La situación | El gesto que muestra el pulgar |
| --- | --- | --- | --- |
| 1 | Moverse y pegar | La pelota va a un costado, una vez a cada lado. | El joystick, y mantener, apuntar y soltar. |
| 2 | Apuntar | El profe se para de un lado: la pelota va al otro. | Arrastrar hacia el lado vacío. |
| 3 | Globo | El profe está en la red. | Arrastrar bien arriba. |
| 4 | Chiquita | El profe está lejos, en el fondo. | Arrastrar hacia abajo. |
| 5 | La pared | Una pelota profunda: dejarla picar y salir del vidrio. | Las pisadas muestran dónde esperarla. |
| 6 | Bandeja | Estás en la red y te tiran un globo. | El joystick hacia atrás, y pegarle sin dejarla picar. |
| 7 | Remate | Estás en la red y el globo queda corto. | Pegarle arriba. |
| 8 | Leer el gesto | Peloteás con el profe: antes de pegar señala a dónde va a tirar. | Ninguno: hay que mirarlo a él. |

En pantalla hay un nombre, media línea ("Por arriba del que está en la red") y tres círculos que se van llenando. Se puede elegir cualquier lección en cualquier orden, repetirla o saltearla; las hechas llevan una tilde y la palabra "Hecha". No cuentan como partido ni tocan el marcador de nada.

**Pistas en medio de un partido.** Los golpes que hay que descubrir (el globo, la chiquita y esperar la pared) se muestran una vez, justo cuando convienen: con el rival en la red, el pulgar fantasma arrastra bien arriba; con el rival en el fondo y vos cerca de la red, hacia abajo; y si la pelota va a salir del vidrio, las pisadas marcan dónde esperarla. Cada pista aparece dos veces como mucho y nunca más desde que hiciste ese golpe. Con las ayudas en "Ninguna" no aparecen.

**La marca de objetivo dice qué golpe es por su forma**, también con las ayudas mínimas: anillo simple para el golpe normal, doble para el globo y chico para la chiquita. Cuando el pulgar pasa de un golpe a otro la marca da un salto, que es como se nota sin leer que arrastrando más arriba pasa algo distinto.

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
| Pelota bien alta (más de 2,2 m), a menos de 4,5 m de la red y sin ir para atrás | Remate |
| Pelota por arriba de la cabeza, hasta media cancha (6,6 m) | Bandeja, o víbora si apuntás a un costado |
| En el aire, cerca de la red | Volea |
| Después de un rebote en la pared | Salida de pared |
| La pelota ya te pasó, contra tu vidrio | Contrapared |
| Pediste por arriba | Globo |
| Pediste corto | Chiquita, o dejada si es en el aire |
| Todo lo demás | Derecha o revés |

### El timing

**La pelota se enciende un instante antes de que haya que pegarle.** Es la única señal de timing que hay en pantalla. Lo que cuenta es el momento en que soltás (o deslizás) respecto de la llegada de la pelota:

- **Perfecto** (±60 ms): más preciso, y además le da a cada golpe lo suyo (ver la tabla de abajo).
- **Bien** (±150 ms): normal.
- **Temprano**: si soltás antes de que la pelota esté a tu alcance, el golpe queda **armado** y sale solo cuando llega, tan bien como uno bueno. Lo único que perdés es el perfecto. Así se puede elegir a dónde pegar bastante antes de que llegue la pelota.
- **Tarde** (hasta 240 ms): la pelota vuelve, pero floja, alta y corta.

Un timing mediocre no manda la pelota afuera. Los errores salen del riesgo que elegís (apuntar cerca de las paredes agranda la dispersión) y de no llegar. Las ventanas están medidas en tiempo de juego: con la velocidad al 60 % son ±100 ms y ±250 ms reales. No hay cámara lenta ni pausas para apuntar.

**Cada golpe tiene su perfecto.** No es solo una palabra: se nota en lo que le pasa al rival.

| Golpe | Qué le da el perfecto |
| --- | --- |
| Derecha, revés, volea | 15 % más de ritmo y más baja sobre la red |
| Globo | Pica junto al vidrio (ver "Globo con calidad") |
| Chiquita | Más corta, más suave, y muerde más al picar |
| Bandeja | Más profunda y más baja: pica cerca del vidrio y no sale |
| Víbora | 15 % más de ritmo y más abierta |
| Salida de pared | No flota: sale baja sobre la red |
| Remate | Salta todavía más después del pique |

Armar el golpe temprano es lo seguro (sale como uno bueno); esperar y soltar justo da calidad; soltar tarde sale flojo.

**La ayuda está en el alcance, no en el movimiento.** Alcanza con acercarse: la persona llega a pelotas que pasan a 1,6 m (la máquina, a 1,25 m) y el jugador se estira para llegar. Cuanto más estirado, más débil y menos preciso el golpe. Con `?alcance=real` (experimental) no hay ayuda: todos llegan a 1,15 m parados y a 1,60 m con una zancada.

**Qué pelota se juega.** Si desde donde estás parado la pelota pasa dos veces a tu alcance (antes y después del vidrio de fondo, por ejemplo), la señal es para la más cómoda, con el mismo criterio que usa la máquina. Desde el fondo eso suele ser dejarla picar y esperar la salida de pared. La contrapared queda como último recurso: sale cuando la pelota ya te pasó y no va a volver.

### Construir el punto

Fácil de aprender, difícil de dominar: los controles son los mismos de siempre, y lo que cambia es que **el buen golpe depende de la situación**. No hay barras ni indicadores; se ve en la pelota y en los cuerpos.

**Calidad de pelota.** Cada pelota es más o menos difícil para quien la recibe, según lo que le hizo el golpe anterior:

- por debajo de la faja cerca de la red, o contra el piso en cualquier lado: hay que pegarle hacia arriba;
- lejos del cuerpo: hay que estirarse;
- rápida;
- pegada al vidrio del fondo o en un rincón: no hay lugar para el swing;
- por arriba de la cabeza mientras vas para atrás.

Una pelota difícil **le baja el techo a la respuesta**: sale más lenta, más alta sobre la red, con menos ángulo y más corta. Es decir, una pelota para atacar. Así se construye: un buen golpe complica la devolución, la devolución floja se ataca, y el punto se gana un escalón a la vez.

**La red se gana y se defiende.**

- **Globo con calidad.** Qué tan profundo cae un globo no lo elige el pulgar: sale de la ejecución. Perfecto pica junto al vidrio (9,3 m) y obliga a irse atrás; bueno, a unos 8,3 m; armado temprano, un poco menos; tarde o exigido queda corto, y se remata.
- **Aguantar o retroceder, con el joystick.** Si te tiran un globo y te quedás (o das dos pasos atrás), la pelota que pasa a tu alcance por arriba se juega de bandeja o de víbora, sin dejarla picar: así se conserva la red. Si corrés al fondo, la dejás pasar y te queda la salida de pared. La decisión es tuya en una fracción de segundo, como en la cancha.
- **El remate es para el globo corto.** Hace falta la pelota bien alta y cerca de la red, y tener los pies debajo: yendo para atrás sale bandeja.

**Los golpes que definen tienen efecto.** El remate salta al picar y sale del vidrio por arriba de todos, de vuelta hacia la red. La chiquita muerde: pica y se queda. La volea, la bandeja y la víbora van cortadas: quedan bajas y mueren en el vidrio del fondo en lugar de volver. Pegarle fuerte y profundo desde el fondo, en cambio, es regalarle la pared al otro.

**La presión se acumula.** Una seguidilla de pelotas difíciles desordena a cualquiera: la dispersión crece con la tensión acumulada, más para quien tiene menos entereza. Quien ataca no la acumula; quien defiende sí. Cada punto empieza de cero.

Nadie erra porque sí: los rivales ya no tienen golpes malos al azar. Los puntos se pierden por no llegar, por arriesgar cerca de las paredes y por la presión. Los peloteos largos igual tienen una red de seguridad: desde el golpe 10 se van acelerando.

### Rivales

Son los tres primeros del elenco diseñado en `docs/personajes.md` (rama de personajes). La idea es que se reconozcan por cómo juegan, no por el nombre, y que **a cada uno se le gane jugando al pádel**:

| Rival | Cómo juega | Cómo se le gana | Gesto delator |
| --- | --- | --- | --- |
| **Beto**, «el Profe» ★ | Pelotas cómodas, al medio y hacia vos. No define la pelota fácil y casi no sube a la red. | Apuntando al lado vacío y subiendo: te deja la red, y de ahí cualquier volea al costado lo pasa. | Señala con la mano libre a dónde va a tirar. |
| **Romina**, «la Topadora» ★★ | Pega plano y fuerte desde donde esté, sube a la red y castiga la pelota corta y flotada. | Con paciencia y sin darle pelotas flojas: se va desarmando cuando el punto se alarga (después del cuarto golpe cada uno le suma tensión) y la pared le cuesta. Globo cuando sube a la red. | Se planta con las piernas abiertas y la pala detrás de la cabeza: viene un cañonazo. |
| **Chela**, «la Astronauta» ★★★ | Vive en el fondo, devuelve todo, te saca de la red con globos altísimos y te mueve con chiquitas. Casi no se desordena. | Desde el fondo no se le gana: hay que **ganar la red y aguantarla**. Bandeja a sus globos buenos; volea cortada y chiquita para hacerla correr (es lenta) y levantar la pelota del piso; exigida globea corto, y ese globo se remata. | Se agacha con la pala abierta: viene globo. Un pasito adelante: viene chiquita. |

Las estrellas son **qué tan bien juegan al pádel**, no qué tan rápido corren: leer el punto, definir la pelota fácil, subir y aguantar la red, manos firmes y entereza. Ninguno corre más que una persona (entre el 75 % y el 100 % de tu velocidad) ni llega más lejos, y ninguno mira lo que estás por hacer: deciden con lo que cualquiera ve en la cancha.

Ninguno hace trampa: predicen la pelota con la misma física que la marca de pique. Por ahora los tres comparten el mismo modelo, cada uno con su cuerpo (proporciones, postura y ritmo propios), sus colores y sus piezas: Beto de blanco, azul marino y mostaza, con gorra y bigote; Romina de rojo, amarillo y negro; Chela de lavanda, blanco y rosa, más baja.

**El gesto delator no miente.** El rival decide el golpe entre 0,45 y 0,55 s antes del contacto y desde ese momento su armado lo muestra. No lo cambia salvo que cambie la pelota. La primera vez no se nota; a la quinta te anticipás.

**Manías y frases, sin frenar nada.** Entre punto y punto el rival tiene un tic corto (Beto se acomoda la gorra, Romina golpea la pala contra la zapatilla, Chela saluda al banco) y a veces dice algo en un globito sobre su cabeza: en más o menos un tercio de los puntos, nunca tres seguidos y sin repetirse enseguida. Todo ocurre dentro de la pausa que ya existe: el saque cierra el globito y corta el tic, y el rival nunca demora su saque por esto. Las frases se pueden poner en "Pocas" o "Ninguna" y nunca dicen nada necesario para jugar.

**Te reconocen.** El juego guarda la historia con cada rival en el dispositivo. La primera vez se presentan ("¡Hola! Soy Beto, el profe."), después te saludan distinto, y al terminar piden la revancha al lado del botón ("¿Otra? ¡De una!"). Si un rival te ganó tres veces seguidas, al empezar el siguiente partido te cuenta su gesto delator, una sola vez. No hay rachas que castiguen ni nada que se pierda por perder.

### Dobles (experimental)

Se prende con `?dobles` o en Opciones → Experimental, y la partida rápida pasa a ser de 2 contra 2: vos y un compañero del elenco contra los otros dos (por defecto, vos al revés con Beto, contra Romina y Chela). La partida rápida de siempre no cambia. La propuesta completa, con sus mediciones, está en [docs/dobles.md](docs/dobles.md).

- **Cada pelota tiene dueño.** La de tu lado es tuya; la del medio, de quien tiene la derecha hacia el medio (con dos diestros, el de revés). Tu compañero juega una pelota tuya solo si no llegás o si es un globo que te pasó por arriba, y siempre avisa antes.
- **La pareja va atada.** Tu compañero sube a la red cuando subís y baja cuando te quedás atrás; nunca abre el hueco él. Las parejas de la computadora suben y bajan juntas, se deslizan con la pelota y no esperan en tierra de nadie.
- **Los avisos son con el cuerpo**, nunca con texto, y solo cuando de quién es la pelota no se ve sola: una moneda al aire entre los dos, una pelota que no va a quien dice la regla, o una que cambia de manos. La mano arriba es «¡mía!»; el brazo al costado hacia vos, con la cabeza y el torso girados, es «¡tuya!»; «¡voy!» es como «¡mía!» mirándote; llamarte con el antebrazo es «¡arriba!» y barrer el brazo hacia atrás es «¡atrás!». Siempre son verdad.
- **La pareja rival busca dónde no estás:** a los pies de quien queda en tierra de nadie, por arriba del que está en la red o al hueco de una pareja partida, globo a una pareja en la red y el medio a una pareja atrás.
- **Y también se desordena, y se la castiga.** Las mismas reglas y el mismo alcance valen para las dos parejas. Según su entereza y la presión del punto, a veces uno de la pareja rival no acompaña al otro (sube o baja solo), se queda en tierra de nadie o dudan en una pelota al medio; una pelota que pasa lejos de los dos los hace dudar más, y a veces no va ninguno. Se ve sin leer: el que subió solo le hace señas al compañero y, cuando dudan, se señalan los dos. Tu compañero nunca se desordena.
- **El compañero es el mismo personaje** que como rival, pero juega a ganar (no le regala pelotas al rival) y con manos más firmes.
- Por ahora no se guarda para seguirlo después, no cuenta en la historia con cada rival y nadie habla.

**El alcance real** (`?alcance=real`, también en Experimental) es el de una persona, igual para todos: 1,15 m parado y 1,60 m con una zancada, más corto por arriba de la cabeza, y nada por debajo de 20 cm del piso (32 cm con zancada). Vale en 1 contra 1 y en dobles. Con el alcance de siempre, el 1 contra 1 juega exactamente igual que antes.

### Entre punto y punto

La pausa dura un segundo como mucho y se saltea con un toque. Quien ganó el punto lo festeja con un gesto corto mientras camina a su lugar; el saque siguiente lo corta y nada espera a que termine. Al terminar el partido, "Revancha" es el botón principal y ya tiene el foco.

### Opciones

Esquema de control y lado del joystick, velocidad del juego (60 %, 80 %, 100 %), frases del rival (muchas, pocas, ninguna), ayudas en pantalla (completas, mínimas, ninguna), movimiento asistido, reducir movimiento, vibración, sonido (sí o no, y el volumen de los golpes y el del ambiente por separado), cámara (acompaña o fija), resolución, pantalla completa y contador de cuadros. En **Experimental**: dobles, tu lado (drive o revés) y tu compañero, y el alcance (actual o real); se aplican desde el próximo partido. Abajo se ven los datos guardados en el dispositivo.

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

## Cómo suena

**Todo el sonido se genera en el momento: no hay ningún archivo de audio.** Cada sonido es una receta corta (TypeScript, en [src/audio/synth/](src/audio/synth/)) que se convierte en audio en el propio dispositivo, de a poco en los huecos entre cuadros, empezando medio segundo después del primer cuadro. Nada de esto demora el arranque y no se baja nada: todo el sonido le suma unos 27 KB al JavaScript (11 KB con gzip).

**Qué suena.** Se eligió de oído, en el celular, en un tablero con dos o tres versiones de cada cosa ([design/sonido/tablero.html](design/sonido/tablero.html)). Quedó la primera versión de todo:

| Qué | Cómo está hecho |
| --- | --- |
| **Golpe de pala** (pala de carbono) | Síntesis modal: el contacto de la pelota hace sonar los modos de la pala y la pelota, más un chasquido de aire en los golpes fuertes. Un contacto más corto excita más los agudos: el remate suena más brillante y seco, y la chiquita y el globo, un «puc» suave. Se generan cuatro fuerzas con tres tomas cada una. El remate y la víbora tienen además el silbido de la pala, que se escucha antes del contacto. |
| **Pique** (césped firme) | Un «poc» apagado de la pelota con un golpe sordo del piso y un poco de arena. El bote previo del saque es un pique como cualquier otro. |
| **Vidrio** (seco) | Un «bom» corto y grave: un racimo denso de modos bajos, como un panel de vidrio grande, sin nada que suene a campana. |
| **Reja** (tensa) | Un chasquido metálico y el traqueteo de la malla contra sus soportes: golpecitos cada vez más espaciados. |
| **Red** | Un golpe sordo con roce de la malla; la que toca la cinta, un toque más seco con el cable que vibra. |
| **Pasos** (arena) | Pisadas que crujen y frenadas que raspan, como en una cancha con arena. Salen de cómo se mueven los jugadores: un paso por zancada al correr, el split step cuando el rival le pega y el raspón cuando alguien frena de golpe. |
| **Ambiente** (club de barrio) | Viento en los árboles, el rumor lejano de la ciudad, zorzales, benteveos, gorriones y torcazas, algún vaso en el buffet y un peloteo en la cancha de al lado. Los pájaros están lejos, en los árboles, y cantan de vez en cuando (uno cada 25 segundos, en promedio). La base da la vuelta sin que se note el corte, y los pájaros y la otra cancha caen al azar, así que nunca se repite igual. |

**No hay voces**: ni los rivales ni el ambiente hablan. Se probaron y sonaban artificiales; la personalidad de los rivales sale de los gestos y del estilo de juego.

**Dónde suena.** Lo de tu lado suena cerca; lo del rival, más bajo, más apagado y con más aire de la cancha. Cada sonido se ubica a izquierda o derecha según dónde pasa, con un paneo angosto, y una reverb corta hace el aire de la cancha (el rebote del vidrio de atrás incluido). La mezcla es baja y pareja a propósito: entre el golpe más suave y el más fuerte hay unos 5 dB, y un limitador redondea los picos. Por defecto los golpes están al 50 % y el ambiente al 25 %.

**El club, bien de fondo.** En la primera prueba en el celular los pájaros se oían demasiado. Un silbido es un tono sostenido y un golpe dura unos milisegundos, así que, con el mismo pico, el silbido suena mucho más fuerte, y más en el parlante de un celular, que reproduce mejor los agudos de 2 a 4 kHz. Por eso el ambiente entero bajó más de la mitad, y los pájaros bastante más: ahora, en un parlante de celular, suenan unos 15 dB por debajo del golpe más fuerte, antes sonaban por encima. Con el ambiente al 100 %, igual quedan por debajo de los golpes. Los tests miden esto.

**Cómo se comporta.**

- El audio se despierta con el primer toque, como exigen los navegadores.
- En iPhone respeta el modo silencio y no corta la música que la persona esté escuchando.
- En pausa, con la pestaña en segundo plano o con el sonido apagado, se suspende todo.
- Nunca suenan más de 12 sonidos a la vez: si hace falta, se corta primero un paso antes que un golpe.
- El ambiente se prepara en pasos de un par de milisegundos y empieza a sonar cuando está listo. Nada se calcula en el momento de un toque: antes, la base del club se generaba entera con el primer toque y, con la CPU de un celular lento, el juego se trababa medio segundo.

**Para escuchar y cambiar.**

- `npm run sounds` guarda todo como WAV en `out/sounds/`: `game-*` son las tomas que usa el juego, `board-*` las versiones del tablero y `club-*` el ambiente.
- `npm run sound-board` rearma el tablero.
- Lo elegido está en `CHOSEN` y el balance de la mezcla, en `CUES` ([src/audio/bank.ts](src/audio/bank.ts)). Cada receta tiene sus variantes en tablas como `RACKET_STYLES` ([src/audio/synth/impacts.ts](src/audio/synth/impacts.ts)).

## Arquitectura

```
src/
  config.ts          Todos los números ajustables del juego, en un solo lugar
  core/              Utilidades sin estado de juego: matemática, azar con semilla, estadísticas de cuadros
  characters/        El elenco: estilo de juego, rasgos, gesto delator, manías y frases de cada personaje
  audio/             El sonido, sin nada del navegador
    synth/             Las recetas: filtros, modos, ruido, reverb; golpes, superficies, pasos y el club
    bank.ts            Lo elegido en el tablero, en qué fuerzas y cuántas tomas se genera, y la mezcla
    director.ts        Qué suena, dónde y con qué fuerza, a partir de los eventos y del movimiento
  sim/               La simulación. No sabe nada de pantalla, DOM, reloj ni dispositivos
    ball.ts            Física de la pelota: gravedad, pique, vidrio, reja, red
    court.ts           Geometría de la cancha y perfiles de las paredes
    rules.ts           Reglas del punto: qué pique vale, qué es falta, quién puede pegar
    score.ts           15/30/40, punto de oro, juegos, sets, tie-break y rotación del saque
    shots.ts           Qué golpe sale según la situación y qué velocidad darle para que caiga donde se apuntó
    trajectory.ts      Predicción: simula el futuro de la pelota con la misma física y reglas
    intercept.ts       Dónde y cuándo le conviene pegar a cada jugador
    formation.ts       Dónde se para cada jugador, para equipos de 1 o de 2
    pair.ts            Dobles: de quién es cada pelota, dónde espera cada uno, cuándo suben o bajan juntos y qué se avisan
    player.ts          Estado y movimiento de un jugador
    replay.ts          Grabación de las entradas y repetición exacta de un partido
    match.ts           El partido: une todo y avanza de a un paso fijo
  control/           Quién decide por cada jugador
    human.ts           Lee la entrada abstracta
    ai.ts              El rival: decide el golpe antes de pegar y lo muestra
    autopilot.ts       Movimiento automático, compartido por la IA y por el movimiento asistido
  input/             Táctil, mouse y teclado, traducidos a "quiero la pelota acá" y "me muevo hacia allá"
  platform/          Lo único que conoce el navegador: los archivos del juego, guardado, vibración, sonido
                     (Web Audio: el motor, el ambiente del club), pantalla, ciclo de vida
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
scripts/             Empaquetado del arte, sonidos a WAV, el tablero de sonido, medición de rendimiento y
                     prueba de punta a punta en un navegador real
design/sonido/       El tablero donde se eligieron los sonidos
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
| `character.bin` | La malla (4.676 vértices), el esqueleto (25 huesos), los 24 clips y los cuatro cuerpos del elenco, como vinieron |
| `character.bin.gz` | Lo mismo comprimido: 105 KB en vez de 248 KB. Los servidores de archivos estáticos no siempre comprimen un tipo que no conocen, así que el juego pide este primero y lo descomprime él. |

El script también reescribe la tabla de capas de [court-art.ts](src/render/stage/court-art.ts). Volver a correrlo con la misma entrada da los mismos archivos.

### Personajes animados

Hay un solo modelo, compartido por todos, con 24 clips; cada personaje lo usa con su propio cuerpo (escala de huesos, postura, ritmo y amplitud), sus colores y sus piezas (gorra, trenza, bigote). La simulación sabe dónde está cada jugador, a qué velocidad va, si tiene la pala atrás, qué golpe es y cuándo toca la pelota. Lo que va en el medio es `FigureAnimator` ([src/render/toon/animator.ts](src/render/toon/animator.ts)):

- **Las piernas siguen al piso.** Cada marcha (correr, correr de espaldas, galope lateral a cada lado) avanza con los metros realmente recorridos, divididos por la zancada que trae su clip y por la escala del personaje: el pie apoyado se mueve menos de 3 cm en una corrida de 12 m, y hay un test que lo mide para las cuatro. En diagonal la pelvis gira lo que le falta al clip para apuntar hacia donde va.
- **Antes de que pegue el rival, un saltito** (*split step*) para quien está esperando parado; entre puntos, una postura de descanso.
- **Los golpes se estiran en el tiempo.** El cuadro del clip en que la pala toca la pelota cae en el instante en que la simulación le pega. Si el golpe se armó con tiempo, el cuerpo hace su preparación y espera con la pala atrás; los últimos 0,24 s van siempre en fase con la pelota. Si se pidió a último momento (un deslizamiento, una tecla), entra tan rápido como haga falta para estar ahí.
- **Se pega corriendo.** El tronco y los brazos hacen el golpe mientras las piernas siguen el piso; parado, golpea el cuerpo entero.
- **La pala va a la pelota de verdad.** El clip pasa por donde estaba su pelota cuando se animó; la real viene más alta, más baja o más lejos, y además el personaje está agrandado y la pelota no. Alrededor del contacto el cuerpo da un paso hacia la pelota (hasta 0,9 m), se agacha con los pies en el piso si viene baja, y el brazo lleva la pala el resto del camino. Brazos y piernas se resuelven con la misma cinemática inversa de dos huesos ([reach.ts](src/render/toon/reach.ts)). No es un salto en el último cuadro: todo el recorrido del golpe se dobla hacia la pelota. En un partido simulado la pala queda a menos de 20 cm de la pelota en la mitad de los golpes; el resto son pelotas tomadas a dos metros de los pies y golpes a destiempo, donde la simulación es generosa y el cuerpo llega hasta donde llega.
- **Cada golpe tiene su clip**: derecha, revés, volea de los dos lados, bandeja, remate, globo y las dos estiradas, además del saque. Se elige por el golpe, el lado y la altura relativa al cuerpo dibujado: una pelota a dos metros está sobre la cabeza de alguien de tamaño real y a la altura del pecho del rival agrandado, así que para él es una volea alta y no un remate.
- **Los cambios se funden**, nunca se cortan. La cabeza sigue a la pelota y la trenza se balancea detrás del movimiento.
- **El saque**: antes de sacar la pelota está en la mano libre, donde el clip dice que la sostiene, y la suelta en el cuadro en que el clip la suelta.
- **Cada personaje agrega lo suyo** encima: su gesto delator mientras tiene la pala atrás (Beto señala con la mano libre, Romina se planta con las piernas abiertas, Chela se agacha o da un paso) y su manía entre puntos. Las manías que tienen clip propio (acomodarse la gorra, golpear la zapatilla, saludar) usan ese clip; las demás siguen siendo unos pocos lugares donde tienen que estar las manos. El gesto suelta la pala 0,3 s antes del contacto para que el golpe sea el del clip. Quien gana el punto hace un festejo corto y quien lo pierde se desinfla un momento.

**Lo que el archivo dice, el código lo usa.** Los metadatos de cada clip vienen del contrato de [design/prueba-3d](design/prueba-3d/): zancada y dirección de cada marcha, por dónde entra el ciclo, cuándo apoya cada pie, el instante del contacto y dónde está la pala en ese instante, el tramo de armado en que se espera con la pala atrás, y la pelota en la mano del saque. Un archivo viejo, sin esos datos, se sigue leyendo con valores razonables. Todavía no se usan las caras (parpadeo y expresiones: a este tamaño no se ven) ni los clips de arranque y de frenada.

### Pantalla limpia

Qué ayuda existe en cada nivel se decide una sola vez, al armar la escena ([src/app/scene.ts](src/app/scene.ts)), para cualquier renderer; cómo se ve, en el director. El resultado con las ayudas mínimas:

- El anillo bajo tu jugador, las pisadas y el anillo de timing no existen.
- La señal de timing es un resplandor sobre la pelota que aparece 0,18 s antes del contacto.
- La marca de pique es un anillo fino y chico, solo para el primer pique de una pelota que viene a tu lado.
- La marca de objetivo está mientras el pulgar apunta; al soltar ya no hay nada que decidir y se va. Su forma dice qué golpe es (simple, doble para el globo, chica para la chiquita) y da un salto cuando el pulgar pasa de uno a otro.
- Las pistas de los golpes por descubrir (el pulgar fantasma del globo y de la chiquita, las pisadas de la pelota que sale del vidrio) aparecen dos veces como mucho cada una, y nunca más desde que la persona hizo ese golpe.
- Los efectos de los impactos duran entre 0,16 y 0,22 s y no dejan anillos: un destello en el golpe, un poco de polvo en el pique, un brillo en el vidrio.

Cuánto le queda de esas ayudas a cada persona (`assist`, de 0 a 1) se guarda en su perfil.

### Equipos de N jugadores, un controlador por jugador

Un `Match` recibe dos equipos con la cantidad de jugadores que sea, y cada jugador trae su `Controller`. Nada asume 1 contra 1: el saque rota entre todos los jugadores y las formaciones salen de una tabla en coordenadas del equipo. Una pareja juega como en el pádel ([src/sim/pair.ts](src/sim/pair.ts)): el partido decide de quién es cada pelota por el lado y por el medio, y no por quién llega antes; la pareja tiene una profundidad común (la decide quien pegó la última, o la persona si hay una); y cada uno espera en su lado, deslizado hacia la pelota. Los avisos entre compañeros (`Player.call`) salen de esas decisiones, así que siempre son verdad. Nada de esto usa azar: un partido de dobles se repite igual con la misma semilla.

### Una sola física para todo

`stepBall` es una función pura. El partido la usa para mover la pelota y `predictTrajectory` la usa para simular su futuro, con las mismas reglas. De esa predicción salen:

- la marca de dónde va a picar, que sigue a la pelota después de un vidrio,
- el punto y el momento del contacto, incluso después de un rebote en la pared,
- las pisadas que aconsejan dónde pararse,
- el movimiento de los rivales y el movimiento asistido,
- la decisión de dejar pasar una pelota que se va afuera sola.

El efecto de un golpe (el salto del remate, la mordida de la chiquita, lo cortado de la volea) viaja con la pelota como dos números que se gastan en su primer pique, así que la predicción lo conoce y la marca de pique sigue siendo exacta.

### El golpe en dos tiempos

Pedir un golpe no es pegar: **arma** al jugador con una intención (lado, profundidad, por arriba o no). El contacto ocurre cuando la pelota llega, y ahí `resolveShot` decide qué golpe sale, a dónde va y qué tan bien: el timing, lo difícil que era la pelota (`ballPressure`, en [src/sim/pressure.ts](src/sim/pressure.ts)) y el perfecto propio de cada golpe ya están adentro. Es una función pura, así que la marca de objetivo muestra lo que el golpe puede hacer con la pelota que viene: exigido, no deja apuntar tan abierto ni tan profundo. El error de timing es la diferencia entre el momento en que se pidió el golpe y el del contacto.

Para un jugador que se mueve a mano, el contacto se recalcula en cada paso para el lugar donde está parado (`contactNear`): la pelota a su alcance que quede mejor ubicada y sea más cómoda. Ahí también se decide el globo: quien aguanta se lleva el contacto por arriba, quien corre al fondo deja pasar la pelota. Un jugador automático, en cambio, elige el contacto y corre hacia él (`planIntercept`), y cuánto prefiere la bandeja al vidrio es su `holdNet`.

### La cancha de práctica

El tutorial no es un modo aparte de la simulación: es un `Match` creado con `practice`, donde nadie saca y nada suma. Quien lo maneja ([src/app/drill.ts](src/app/drill.ts)) manda a cada uno a su lugar con `rest` y pone pelotas en juego con `feed`; desde ahí es un peloteo como cualquier otro, con la misma física y los mismos golpes. Una lección es un dato: dónde se para cada uno, qué pelota se alimenta, qué gesto se muestra y qué cuenta como acierto.

### Rivales con personalidad

Un personaje es un dato ([src/characters/](src/characters/)). Lo que cambia cómo juega entra a la simulación como números; todo lo demás es presentación y no toca un peloteo.

**Lo que juega.** `toAILevel` separa el filo de la forma. **Las estrellas dan el filo**: una tabla ([src/characters/style.ts](src/characters/style.ts)) dice cuánto vale cada eje con una, tres y cinco estrellas. **El estilo da la forma**: lo que le gusta hacer, y en qué es un poco mejor o peor que lo que dicen sus estrellas (cada gusto mueve su número hasta dos estrellas para arriba o para abajo).

| Eje | Parámetro | ★ | ★★★ | ★★★★★ |
| --- | --- | --- | --- | --- |
| Decisiones: elige el golpe que pide la situación | `smart` | 0,2 | 0,65 | 0,92 |
| Castigo: define la pelota que está para atacar | `punish` | 0,1 | 0,55 | 0,9 |
| Red: sube detrás del globo o la chiquita, y la aguanta | `netRush`, `holdNet` | 0,1 | 0,5 | 0,85 |
| Consistencia: timing y dispersión | `timingSigma`, `errorScale` | 0,2 s; 1,5 | 0,1 s; 1,1 | 0,06 s; 0,9 |
| Entereza: cuánto le pesa la presión acumulada | `composure` | 0,2 | 0,6 | 0,9 |
| Lectura: cuánto tarda en reaccionar | `reaction` | 0,45 s | 0,28 s | 0,18 s |
| Piernas, siempre dentro de las de una persona | `speedFactor` | 0,75 | 0,9 | 1,0 |

Lo demás es estilo y rasgos:

| Gancho | Qué hace |
| --- | --- |
| `PlayerIntent.cue` | El golpe que el jugador ya decidió. No cambia nada del peloteo: es lo que muestra su armado. |
| `power` | Multiplica la velocidad de sus golpes (el remate tiene tope). |
| `wallBias` | Gusto por la pelota que vuelve de la pared, al elegir el contacto. |
| `angle`, `aggression` | Qué tan abierto apunta, y cuánto prefiere el golpe fuerte y profundo al seguro. |
| `lobChance`, `dropChance` | Cuánto globea a quien está en la red y cuánto juega corto a quien está en el fondo. |
| `feed` | Juega hacia el rival en vez de lejos, como un profe (rasgo de Beto; más la primera vez). |
| `impatientAfter`, `impatience` | Desde ese golpe del peloteo, cada golpe más le suma tensión (rasgo de Romina): se desarma cuando la hacés esperar. |
| `wallScatter` | Dispersión al jugar de pared (rasgo de Romina). |
| `lobUnderPressure` | Exigida, siempre globo (rasgo de Chela). Como el globo exigido queda corto, es también su debilidad. |
| `mishit` | Golpes malos al azar. Está en 0 para todos: quedó como rasgo posible, no como forma de hacer fácil a un rival. |

**Cómo decide.** Después de cada golpe propio elige dónde esperar: detrás de un globo sube recién cuando lo ve pasar (cuando pica), detrás de una chiquita sube enseguida, y después de una volea o una bandeja se queda en la red según cuánto la aguanta. Para el golpe mira dónde está el otro: globo o pelota a los pies si está en la red, pelota corta si está en el fondo. Una pelota para atacar (cerca de la red, por arriba de la faja y con tiempo) la define quien sabe castigar: lejos del otro y sin darle el vidrio, o corta si el otro está muy atrás; quien no sabe, la devuelve al medio. Nada de eso mira lo que la persona tiene armado: hay un test que juega dos partidos idénticos salvo por el apuntado de la persona y compara al rival paso por paso.

**Lo que se ve y se lee.** `Personality` ([src/app/personality.ts](src/app/personality.ts)) escucha los eventos del partido y decide frases y manías. Tiene su propio generador de azar, distinto del de la simulación: con las frases prendidas o apagadas el partido es idéntico, golpe por golpe, y hay un test que lo verifica. El globito es DOM y sigue a la cabeza del rival; los gestos y las manías son poses de cuerpo entero, para que se lean al tamaño del rival, y existen en los dos aspectos: en 3D con cinemática inversa sobre el esqueleto, en 2D sobre la figura simple.

**Lo que se dejó afuera** del diseño del elenco, por ahora: los otros siete personajes, las reacciones propias al ganar o perder un punto, el busto en el marcador, la tarjeta de presentación, la escalera del club, el rival sugerido en la partida rápida, los compañeros y sus avisos en dobles, y las voces.

### Los errores salen de la física

La calidad del golpe no mueve el punto de pique: desvía el lanzamiento (dirección, ángulo y velocidad). Un drive plano y rápido tiene poco margen sobre la red y antes del vidrio; un golpe alto y al centro perdona mucho. La dispersión crece con lo estirado que llega el jugador, con la velocidad de la pelota que viene, con las pelotas bajas, con el riesgo del lugar al que se apunta, con lo difícil que era la pelota y con la tensión acumulada de quien pega. No hay errores al azar. El "calor" de los peloteos largos quedó solo como red de seguridad: desde el golpe 10 cada golpe sale un 5 % más rápido y más difícil de controlar, así que ningún punto dura para siempre.

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
| `sound` | Web Audio: genera los sonidos en el dispositivo, los ubica en la cancha y los suspende en pausa o en segundo plano | El mismo Web Audio dentro del WebView, o audio nativo |
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
- **Perfil**: solo cuentas. Partidos empezados, terminados y ganados; puntos; golpes por calidad de timing; revanchas; cuántos segundos pasaron desde abrir el juego hasta el primer golpe; cuánto le queda de las ayudas mínimas; qué lecciones del tutorial hizo; y, para las pistas, cuántos globos, chiquitas y salidas de pared jugó y cuántas veces se le mostró cada pista.
- **Historia con cada rival** (unos 150 bytes por rival): cuándo se conocieron y cuándo jugaron por última vez, partidos ganados y perdidos, racha, puntos de oro, el peloteo más largo y si ya contó su gesto delator.

`exportData` e `importData` pasan todo a un único texto y de vuelta, para llevarse el progreso a otro dispositivo. Todavía no hay un botón que los use.

El juego avisa por `platform.analytics` de los momentos que importan para medir retención (`open`, `match_start`, `first_hit`, `first_point_won`, `intro_done`, `rematch`, `match_end`, `lesson_start`, `lesson_done`). Hoy quedan en memoria y no se envía nada.

## Parámetros para iterar

Casi todo lo que define cómo se siente el juego está en [src/config.ts](src/config.ts):

| Qué | Dónde |
| --- | --- |
| Ventanas de timing, compensación de latencia | `timing` |
| Velocidad, altura y profundidad de cada golpe | `shots.specs` |
| Cuánto cuesta cada calidad de timing, estirarse, el riesgo | `shots.quality` y los `*Penalty` |
| Qué hace difícil a una pelota y cuánto le baja el techo a la respuesta | `shots.pressure` |
| Lo que el perfecto le da a cada golpe, la profundidad del globo según la ejecución, el efecto de cada golpe | `shots.perfect`, `shots.lobQuality`, `shots.spin` |
| Presión acumulada y red de seguridad de los peloteos largos | `rules.strain`, `rules.heat*` |
| Velocidad y alcance de los jugadores, desde dónde se remata, se volea o se aguanta la red | `player` |
| Qué vale cada eje de dificultad con una, tres y cinco estrellas | `EDGE` en [src/characters/style.ts](src/characters/style.ts) |
| Lecciones del tutorial: situación, pelota, gesto y criterio de acierto | `LESSONS` en [src/app/drill.ts](src/app/drill.ts) |
| Cuándo y cuántas veces aparece una pista | `HINT_*` en [src/app/game.ts](src/app/game.ts) |
| Rivales: estilo, rasgos, gesto delator, manías | [src/characters/cast.ts](src/characters/cast.ts) |
| Cómo el estilo se vuelve juego | [src/characters/style.ts](src/characters/style.ts) |
| Frases | [src/characters/lines.es.ts](src/characters/lines.es.ts) |
| Formatos de partido | `FORMATS` |
| Pausas entre puntos | `rules` |
| Gestos: joystick, distancias para apuntar, qué es un deslizamiento rápido | `CONTROLS` |
| Física: gravedad, restitución del piso, del vidrio y de la reja | `physics` |
| Medidas de la cancha y de las paredes | `court` |
| Cámara que acompaña: zoom, márgenes, zona muerta, velocidades | `FOLLOW` en [src/render/stage/camera.ts](src/render/stage/camera.ts) |
| Cuánto se agranda cada personaje | `FIGURE_SCALE`, en el mismo archivo |
| Colores de cada personaje | [src/render/stage/looks.ts](src/render/stage/looks.ts) |
| Animación: fundidos, paso hacia la pelota, cuánto se agacha, alcance del brazo, gestos | las constantes de [src/render/toon/animator.ts](src/render/toon/animator.ts) |
| Cuándo se enciende la pelota, cuánto duran los efectos y los nombres | [director.ts](src/render/stage/director.ts) y [frame.ts](src/render/stage/frame.ts) |
| Qué tan rápido se apagan las ayudas mínimas | `ASSIST_*` en [src/app/game.ts](src/app/game.ts) |

El alcance extra de la persona (`HUMAN_REACH`) está en [src/app/game.ts](src/app/game.ts). El alcance real, igual para todos, está en `player.realReach` y `player.real`.

| Qué, en dobles | Dónde |
| --- | --- |
| Cuándo una pelota es "del medio", cuánto se desliza la pareja, qué tan separados están en la red y atrás, cuándo el compañero cubre o cruza | Las constantes de [src/sim/pair.ts](src/sim/pair.ts) |
| Qué cambia un personaje cuando es tu compañero | `asPartner` en [src/characters/style.ts](src/characters/style.ts) |
| Qué hace la pareja rival según cómo está parada la tuya | `pairShot` y las constantes `FEET_*`, `HOLE_DEPTH`, `DOUBLES_SERVE_UP`, `BUILD_*` en [src/control/ai.ts](src/control/ai.ts) |
| Cuándo se estorban dos de la misma pareja, y cuándo sube quien pegó desde adentro | `CROWD_*` y `ADVANCE_FROM` en [src/sim/match.ts](src/sim/match.ts) |
| Cuánto se desordena una pareja de la computadora (no acompañar, quedarse a mitad de camino, dudar, que no vaya ninguno) y qué es un hueco | `DISORDER` y `HALFWAY` en [src/sim/pair.ts](src/sim/pair.ts) |

`npm run sim` sirve para ver el efecto de un cambio sin jugar. Usa un jugador simulado que pasa por la misma entrada que una persona: empuja el joystick hacia las pisadas, con demora y con error, y suelta el golpe mirando el anillo. Tiene tres niveles de manos (principiante: timing ±160 ms y se para a 70 cm del lugar ideal; promedio: ±100 ms y 45 cm; experto: ±50 ms y 25 cm) y, aparte, **táctica**: sin ella pega cualquier golpe y espera en el fondo; con ella juega al pádel con las mismas manos (sube detrás de un golpe de ataque y aguanta la red, globo o pelota a los pies cuando el rival está en la red, define la pelota fácil lejos del otro y sin darle el vidrio, no arriesga la volea baja).

Hay cinco informes:

- **Balance** ([tests/sim/balance.sim.ts](tests/sim/balance.sim.ts)): quién gana y cómo terminan los puntos, por casilla.
- **Profundidad** ([tests/sim/depth.sim.ts](tests/sim/depth.sim.ts)): cómo se juegan los puntos y **cuánto paga pensar**, contra las metas de `docs/profundidad.md` (rama de investigación). Lo que queda fuera de una meta sale como advertencia, no como error. Con `SIM_TWEAK='{"rivals.chela.speedFactor":0.9}'` se prueba otro número sin tocar los archivos.
- **Peloteo** ([tests/sim/rally.sim.ts](tests/sim/rally.sim.ts)): un partido golpe por golpe.
- **Dobles** ([tests/sim/doubles.sim.ts](tests/sim/doubles.sim.ts)): si la posición importa. Quién gana cuando una pareja está en la red y la otra atrás, cuánto cuesta un hueco o quedarse en tierra de nadie, cuánto se desordena la pareja rival y cuánto se gana castigándola, cuánto tiempo está junta cada pareja, cuánto paga jugar posicional contra correr a todas, y cuánto duran los puntos. `SIM_REACH=real` lo juega con el alcance real, `SIM_SIDE=reves` pone a la persona al revés y `SIM_LINEUP=chela,beto,romina` cambia el compañero y la pareja rival. Las metas y los resultados están en [docs/dobles.md](docs/dobles.md).
- **Alcance** ([tests/sim/reach.sim.ts](tests/sim/reach.sim.ts)): con el alcance de hoy y con el real, a qué distancia y a qué altura se pega, cuánto se desliza el cuerpo dibujado para llegar y dónde queda la pala.

**Cuánto paga la táctica.** Puntos ganados por el jugador simulado sin táctica → con táctica (entre paréntesis, partidos ganados de 30). "Antes" es el motor de la ronda anterior medido con este mismo jugador simulado; cada casilla son 30 partidas rápidas y el ruido entre corridas es de unos 3 puntos.

| Manos | | contra Beto ★ | contra Romina ★★ | contra Chela ★★★ |
| --- | --- | --- | --- | --- |
| Principiante | antes | 55 → 68 % (19 → 29) | 38 → 50 % (3 → 14) | 27 → 37 % (1 → 5) |
| | **ahora** | 49 → 62 % (14 → 26) | 41 → 54 % (6 → 19) | 19 → 34 % (0 → 3) |
| Promedio | antes | 72 → 78 % (29 → 30) | 56 → 61 % (21 → 27) | 40 → 55 % (7 → 19) |
| | **ahora** | 72 → 79 % (29 → 30) | 61 → 71 % (26 → 29) | 31 → 50 % (2 → 16) |
| Experto | antes | 91 → 94 % (30 → 30) | 87 → 85 % (30 → 30) | 71 → 77 % (30 → 30) |
| | **ahora** | 91 → 98 % (30 → 30) | 82 → 89 % (30 → 30) | 67 → 80 % (27 → 30) |

| Lo que suma la táctica, en puntos porcentuales | contra Beto | contra Romina | contra Chela |
| --- | --- | --- | --- |
| Antes (principiante / promedio / experto) | +13 / +6 / +3 | +12 / +5 / −2 | +10 / +15 / +6 |
| **Ahora** | +13 / +7 / +7 | +13 / +10 / +7 | **+15 / +19 / +13** |

Cómo se juegan los puntos, con el jugador promedio con táctica:

| Indicador | Meta | Beto: antes → ahora | Romina | Chela |
| --- | --- | --- | --- | --- |
| Golpes por punto, mediana | 6 a 9 (Chela: 9 a 12) | 4 → 4 | 8 → 7 | 7 → 8 |
| Golpes por punto, percentil 90 | hasta 18 (Chela: 24) | 10 → 12 | 18 → 15 | 17 → 21 |
| Segundos de peloteo, media | 8 a 14 | 8,1 → 9,6 | 12,3 → 11,4 | 15,9 → **19,1** |
| Golpes desde la red | 35 % o más | 20 → 23 % | 24 → 27 % | 13 → 21 % |
| Puntos que terminan con alguien en la red | 50 % o más | 49 → 47 % | 58 → 66 % | 40 → 51 % |
| El globo le saca la red a quien estaba ahí | 50 a 70 % | 62 → 61 % | 48 → 42 % | 61 → 62 % |
| Gana el punto quien dejó una pelota difícil | 65 % o más | no existía → 58 % | → 48 % | → 53 % |
| Puntos que terminan en error de quien pega | 55 a 65 % | 14 → 10 % | 55 → 37 % | 18 → 18 % |

**Qué se cumplió y qué no.** La táctica suma igual o más que antes en todas las casillas. Contra Chela llega a la meta de 15 puntos para el principiante y el promedio (+15 y +19) y queda cerca para el experto (+13); contra Beto y Romina queda entre +7 y +13. Chela es más difícil sin táctica (el promedio le gana 2 de 30 en vez de 7) y parecida con táctica (16 de 30). Lo que **no** se cumplió: los puntos contra Chela son más largos que antes (19 s de media contra una meta de 14), la experta sin táctica todavía le gana casi siempre (27 de 30; la meta era 21), los golpes desde la red siguen lejos del 35 %, y los puntos terminan mucho más porque el otro no llega que por error: una pelota exigida vuelve floja, no afuera. Construir paga (58 %, 48 % y 53 %), pero menos que la meta del 65 %.

Para leer estos números: el jugador simulado "sin táctica" igual apunta al lado vacío buena parte de las veces, que contra Chela ya es media táctica; y el promedio deja sin devolver más o menos una pelota cómoda de cada veinte, así que contra quien devuelve todo pierde por desgaste antes de que la táctica llegue a pesar. Sirven para comparar cambios. No dicen cómo le va a una persona de verdad: nadie midió todavía qué tan bien se mueve alguien con el joystick.

## Rendimiento

Objetivo: 60 cuadros por segundo en un Android de gama media de hace unos cinco años, y una descarga inicial chica.

`npm run perf` abre el build de producción en Chrome, emula un celular en vertical (360×800 CSS, densidad 3, táctil) y mide tres cosas. Con `--dobles` mide también los cuadros de una demo de dobles. Los resultados que siguen son de Chrome 157 headless sobre un Ryzen 7 8700G con su gráfica integrada (Radeon 780M).

**Peso de la primera visita**, tal como viaja por la red, con sus cabeceras:

| Parte | Viaja |
| --- | --- |
| Cancha (7 capas en AVIF) | 133,0 KB |
| Personaje (malla, esqueleto, 24 clips y cuatro cuerpos, con gzip) | 105,4 KB |
| Código (JavaScript, con gzip) | 64,1 KB |
| Página y estilos | 3,9 KB |
| **Total** | **306,4 KB en 11 archivos** |

El personaje nuevo trae más del doble de clips y pesa menos que el anterior, porque su malla es más liviana; el código creció 8 KB con la profundidad, la IA y el tutorial. Sin empaquetar, la cancha y el personaje sumarían 554 KB (306 KB de WebP y 248 KB sin comprimir); así son 238 KB. Un navegador sin AVIF baja la cancha en WebP (306 KB). No hay fuentes ni dependencias en tiempo de ejecución.

**Tiempo desde que se pide la página hasta el primer cuadro**, sin nada en caché. El primer cuadro ya es en 3D en todos los casos: la cancha y el personaje se piden desde el HTML, en paralelo con el código.

| Conexión | CPU sin frenar | CPU 4× más lenta |
| --- | --- | --- |
| Sin límite (servidor local) | 98 ms | 262 ms |
| 4G rápida (9 Mbit/s, 60 ms de demora) | 537 ms | 695 ms |
| 4G lenta (1,6 Mbit/s, 150 ms de demora) | 1952 ms | 2060 ms |

**Cuadros**, con un partido de IA contra IA andando:

| Aspecto | CPU | Trabajo del juego por cuadro | Tiempo entre cuadros (mediana / p99 / peor) | Cuadros de más de 17,5 ms |
| --- | --- | --- | --- | --- |
| 3D | 1× | 0,24 ms | 4,2 / 4,4 / 8,4 ms | 0 % |
| 3D | 4× | 0,78 ms | 4,2 / 4,4 / 8,3 ms | 0 % |
| 3D | 6× | 1,07 ms | 4,2 / 4,4 / 4,5 ms | 0 % |
| 2D | 1× | 0,11 ms | 4,2 / 4,4 / 4,5 ms | 0 % |
| 2D | 4× | 0,51 ms | 4,2 / 4,4 / 8,3 ms | 0 % |
| 2D | 6× | 0,86 ms | 4,2 / 4,4 / 8,4 ms | 0 % |

**Con cuatro personajes** (dobles, `npm run perf -- --dobles`): el trabajo del juego por cuadro es 0,21 / 0,80 / 1,23 ms en 3D con la CPU 1×, 4× y 6× (en la misma corrida, el 1 contra 1 dio 0,15 / 0,53 / 1,14 ms) y 0,13 / 0,57 / 0,93 ms en 2D. Ningún cuadro tardó más de 17,5 ms.

Chrome headless pinta a 240 cuadros por segundo en esta máquina, así que 4,2 ms entre cuadros significa que no perdió ninguno. El "trabajo del juego" es todo lo que hace el JavaScript en un cuadro: simular, animar los esqueletos con su cinemática inversa, decidir la cámara y mandar a dibujar. Con la CPU frenada 6× usa 1,07 ms de los 16,7 ms que hay por cuadro a 60 cuadros por segundo. El canvas queda en 720×1600 por el tope de densidad.

**Qué no dice esta medición.** Frenar la CPU no frena la placa de video, y el tiempo entre cuadros es el de la gráfica de esta máquina, no el de un teléfono. La prueba de estilo 3D ([design/prueba-3d](design/prueba-3d/)), que dibuja lo mismo, dio 60 cuadros por segundo en el celular del usuario, pero este renderer todavía no se midió ahí. Con `?fps` (o la opción "Mostrar fps") el juego muestra cuadros por segundo, el peor cuadro del último segundo, el trabajo por cuadro y si está dibujando en `3d` o en `2d`.

## Verificación

- `npm test`: 374 tests. Cubren la física de la pelota (pique, vidrio, reja, red, salida de la cancha), que la predicción coincide exactamente con la simulación, las reglas, la puntuación, qué golpe sale en cada situación, el timing y el golpe armado, el movimiento a mano y el asistido, los gestos de los dos esquemas, el tutorial, guardar y seguir un partido (y leer lo que guardó la versión anterior), la repetición exacta de un partido grabado, partidos completos entre IA (también de dobles), las reglas de arquitectura y el elenco. De las últimas rondas:
  - **La profundidad** ([tests/depth.test.ts](tests/depth.test.ts)): que una pelota más baja, más estirada, más rápida o más pegada al vidrio es más difícil; que una pelota difícil sale más lenta, más alta, menos abierta y más corta; la profundidad del globo según la ejecución; el perfecto de cada golpe; que yendo para atrás no hay remate; el efecto de cada golpe y que la predicción lo conoce; aguantar la red o irse al fondo, a mano y con la IA; la presión acumulada y la entereza; cómo define y cuándo sube la IA; que **no lee el pulgar** (dos partidos que solo difieren en el apuntado de la persona); que nadie erra al azar ni corre más que una persona; y que, con las mismas manos, jugar con táctica le saca más puntos a Chela.
  - **El tutorial** ([tests/drill.test.ts](tests/drill.test.ts)): que cada una de las ocho lecciones se completa haciendo lo que enseña y no cuenta otro golpe; la cancha de práctica (sin saque ni marcador); y que las lecciones hechas, los golpes encontrados y las pistas mostradas se guardan y se leen bien.
  - **El personaje** ([tests/toon.test.ts](tests/toon.test.ts)): que el archivo se lee bien, que la pala está donde dice cada clip en su instante de contacto y que los ciclos cierran.
  - **La animación** ([tests/animator.test.ts](tests/animator.test.ts)): el pie apoyado no patina en ninguna de las cuatro marchas; la pelvis gira en diagonal; el saltito antes del golpe del rival; la pelota en la mano libre antes del saque; la pala en el punto de contacto con el cuerpo de cada personaje; arrancar y frenar sin saltos; la pala en el punto de contacto en el instante del contacto, se haya armado el golpe con mucho tiempo o con 90 ms; que armado con tiempo espera con la pala atrás; el paso hacia la pelota y la vuelta; pegar corriendo; la cabeza que sigue a la pelota; los gestos delatores y las manías de cada personaje; el festejo; y, en un partido simulado entero, que la pala queda cerca de la pelota en el contacto.
  - **El sonido** ([tests/audio.test.ts](tests/audio.test.ts)): que todos los sonidos se generan sin errores ni saturación y que no queda ninguna voz; que un golpe más fuerte suena más brillante; que la mezcla es pareja; que el ambiente da la vuelta sin corte; que el club queda muy por debajo de los golpes en el parlante de un celular, también con el ambiente al 100 %, que los pájaros cantan de vez en cuando y que el club se prepara de a pasos chicos, nunca en el momento de un toque; que cada golpe, pique, pared y red del partido suena, lo tuyo cerca y lo del rival lejos; que **escuchar no cambia el partido** (el mismo partido con y sin sonido); que nunca suenan más de 12 sonidos a la vez; y las opciones de sonido.
  - **Dobles y alcance real** ([tests/doubles.test.ts](tests/doubles.test.ts)): de quién es cada pelota (su lado, el medio para la derecha que da al medio, al drive y al revés); que el compañero no corre ni pega una pelota tuya, que la cubre avisando antes si no llegás y que, en partidos enteros, nunca pega una pelota tuya sin avisar ni una que te dejó; que sube cuando subís y baja cuando te quedás atrás o corrés detrás de un globo; que la pareja se desliza con la pelota y se cierra en la red; que entre computadoras cada pareja está junta la mayor parte del punto; que la pareja rival le tira por arriba o al hueco a una pareja partida y a los pies a quien queda en tierra de nadie; que una pareja de la computadora se desordena más cuanto menos entereza tiene, que tu compañero nunca, y que el hueco de una pareja partida se castiga; que el alcance real es el mismo para todos, llega a 1,6 m con zancada y no a una pelota al ras del piso; el compañero con manos más firmes; y que un partido de dobles termina con los dos alcances y se repite igual con la misma semilla.
  - **La cámara y la pantalla limpia** ([tests/stage.test.ts](tests/stage.test.ts)): las reglas de la cámara que acompaña pieza por pieza y jugando partidos enteros contra los tres rivales; que "Fija", "Reducir movimiento" y el respaldo 2D no mueven nada; y qué hay en pantalla con cada nivel de ayudas, cuadro por cuadro.
- `npm run smoke`: 124 verificaciones en un Chrome con emulación de celular, con toques reales. Hace la primera visita (en 3D, sin textos de ayuda, con el saludo del rival), juega un partido entero con dos dedos a la vez mientras mira que la pantalla siga limpia, que la cámara tenga siempre a la vista lo que importa y que el rival delate sus golpes, tenga sus manías y diga sus frases; pausa y saltea la espera entre puntos; pasa por el inicio; **abre el tutorial, juega la lección del globo con el pulgar de verdad** (mira el pulgar fantasma, el doble anillo de la marca, las tres pelotas, la tilde de "Hecha" y que no sume puntos) y comprueba la pista del globo en medio de un partido; mira que el sonido se prepare después del primer cuadro, que el partido suene, que el ambiente esté de fondo, que en pausa no suene nada y que nunca suenen más de 12 sonidos a la vez; pasa por las opciones (ayudas, cámara y sonido incluidos); **le quita el contexto gráfico a la página en medio del juego** y mira que siga en 2D y que vuelva al 3D; juega con una mano, la cámara fija y las ayudas completas; cierra el juego a mitad de un partido y lo retoma; prueba un dispositivo sin WebGL2; emula un notch; **juega dobles con `?dobles&alcance=real`** (el marcador de las dos parejas, cada personaje en su lugar, que vos y tu compañero peguen, que el compañero avise con el cuerpo, los cuatro y la pelota siempre en pantalla, nadie pegándole a más de 1,6 m ni al ras del piso, y la sección Experimental de Opciones); prueba mouse y teclado en tamaño de escritorio; abre el build desde `file://`; y revisa que no se pida nada de afuera y que la cancha baje en AVIF y el personaje comprimido. Guarda capturas de cada etapa en `.smoke/`.

Los dedos de la prueba los maneja un programa que lee el estado del partido. Sirve para saber que los controles funcionan de punta a punta; no para saber cómo se sienten. Para mirar la animación cuadro por cuadro, `Game.advance(dt)` avanza el partido un cuadro con el bucle detenido.

## Accesibilidad

- Los gestos delatores y las manías son de cuerpo entero: no dependen del color ni de la cara. Las frases son texto, se pueden apagar y no llevan información necesaria; por eso el globito queda fuera de los lectores de pantalla, que ya anuncian el marcador y el resultado de cada punto.
- Nada depende solo del color: tu jugador es siempre el de adelante y de espaldas, la marca de objetivo cambia de forma según el golpe, la señal de timing es un cambio de brillo y de tamaño, la opción elegida lleva una marca además del relleno, y una lección hecha lleva una tilde y la palabra "Hecha".
- El tutorial se puede hacer con cualquiera de los dos esquemas, con teclado y con movimiento asistido; cada lección dice en media línea de qué se trata, para quien no pueda seguir el pulgar fantasma. Nunca es obligatorio.
- Reducir movimiento (toma la preferencia del sistema): cámara fija, sin estela, sin destellos, sin pausa de impacto y sin mensajes que se desplazan.
- Ayudas completas para quien las quiera o las necesite, en Opciones: anillo bajo tu jugador, anillo de timing con sus ventanas, pisadas donde conviene pararse, marca de cada pique, el nombre y la calidad de cada golpe y los textos del saque. No se apagan solas.
- Quien juega con teclado ve qué teclas sacan, aunque las ayudas estén en mínimas: un pulgar fantasma no puede mostrar una tecla.
- Movimiento asistido, para quien no pueda o no quiera manejar el joystick.
- Dos esquemas de control, uno de ellos para una sola mano, y joystick de cualquiera de los dos lados.
- Velocidad del juego ajustable al 60 % y al 80 %; las ventanas de timing se agrandan en la misma proporción.
- Pausa en cualquier momento, con el botón, con P o Escape, y automática al cambiar de pestaña o de aplicación.
- Se juega sin sonido: todo lo que suena también se ve (el golpe, el pique, la pared, la red y el marcador). El sonido se apaga con un botón, y los golpes y el ambiente tienen volúmenes separados. En iPhone respeta el modo silencio.
- Menús con botones reales, foco visible y regiones que anuncian el marcador y el resultado de cada punto.

## Publicación

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) corre los tests, hace el build y publica `dist/` en GitHub Pages cada vez que se hace push a `main`. El repositorio ya tiene Pages configurado con origen "GitHub Actions", así que el primer push a `main` publica. Como el build usa rutas relativas, no hay que configurar la base del sitio.

## Pendientes conocidos

- **Probarlo en un celular real.** Sigue siendo lo más importante, y de esta ronda hay mucho que solo se puede juzgar ahí:
  - **Aguantar o retroceder**: si la decisión ante un globo se llega a tomar con el pulgar, y si se entiende por qué a veces sale bandeja y a veces hay que irse al fondo.
  - **Si la presión se siente justa** ("me apuraron") y no arbitraria ("la pelota me salió floja sin razón"). Hoy solo se ve en la pelota; el cuerpo todavía no lo muestra.
  - **Si Chela se le puede ganar** subiendo a la red, y cuánto duran sus puntos de verdad.
  - **El tutorial**: si los gestos del pulgar fantasma se entienden sin leer, si tres pelotas por lección son muchas o pocas, y si la lección de la bandeja se puede hacer con el pulgar.
  - **Las pistas**: si se notan, y si dos veces alcanza.
  - Lo que venía de antes: los cuadros por segundo del renderer 3D, la cámara que acompaña, la señal de timing y qué tan rápido se apagan las ayudas.
  - **El sonido**: el volumen por defecto (¿es sutil o no se oye?), que los golpes no sobresalten, el balance entre el golpe, el pique y las paredes, si los pájaros y el resto del club quedaron bien de fondo después de bajarlos, que el modo silencio del iPhone lo calle, y que generar los sonidos en un Android de gama media no se note en los primeros segundos.
- **Lo que no se cumplió de las metas de profundidad** (los números están en "Parámetros para iterar"):
  - Los puntos contra Chela duran más que antes (19 s de media; la meta era 14).
  - La táctica suma 15 puntos o más solo contra Chela (y con manos de experto, 13); contra Beto y Romina, entre 7 y 13.
  - La experta sin táctica le sigue ganando a Chela casi siempre.
  - Los puntos terminan sobre todo porque el otro no llega, no por error: una pelota exigida vuelve floja en lugar de irse afuera o a la red.
  - Se juega más en la red que antes, pero lejos del 35 % de los golpes.
- **Mecánicas de profundidad que quedaron afuera**: que los rivales lean tus patrones, los cambios de ritmo, el "por tres" y el "por cuatro" (el remate ya salta, pero no saca la pelota de la cancha) y el medio en dobles.
- **La presión no se ve en el cuerpo.** El evento del golpe ya dice qué tan exigido fue y por qué (`pressure`, `Match.pressureParts`), pero la animación todavía no lo usa: faltan la rodilla al piso en la pelota baja, la estirada larga y el paso atrás apurado, y el sonido sordo del golpe forzado.
- **Animación**: no se usan las caras (parpadeo y expresiones) ni los clips de arranque y de frenada. Antes del saque, vista desde atrás, la pelota en la mano libre queda tapada por el cuerpo del jugador cercano.
- **Tutorial**: la lección "Leer el gesto" enseña solo el gesto de Beto (señalar el lado). Con teclado no hay pulgar fantasma que mostrar: queda la media línea de texto. No hay lección de saque ni de contrapared.
- **Límites de la cinemática inversa.** El paso hacia la pelota llega a 0,9 m y el brazo a 0,5 m; las pelotas tomadas más lejos y los golpes tardíos no llegan. El brazo lleva la pala pero no la gira, y el tronco no rota hacia la pelota.
- **El cuerpo se desliza hacia la pelota** (el «imán») una mediana de 67 a 76 cm en el contacto, con el alcance de hoy y con el real por igual (informe `reach` de `npm run sim`). La causa no es el alcance: el clip de derecha toca la pelota 60 cm adelante del cuerpo y la simulación, 20 cm. Faltan una zancada con el pie plantado en lugar de mover el cuerpo entero, alinear el punto de contacto de la simulación con el de los clips y una flexión más profunda para las pelotas bajas (ver [docs/dobles.md](docs/dobles.md)).
- **Zurdos.** El modelo es diestro. Todo el elenco de hoy lo es; un personaje zurdo necesita el cuerpo espejado.
- **Si el 3D anda lento, no se pasa solo a 2D.** El respaldo entra cuando no hay WebGL2 o se pierde el contexto. En un equipo con WebGL2 por software, hoy solo baja la resolución.
- **La cancha en AVIF se recodifica desde el WebP** de la prueba de estilo. Exportarla directo desde los originales daría un poco más de calidad por el mismo peso.
- **Precarga.** Un navegador que no puede descomprimir por su cuenta (Safari anterior a 16.4) baja el personaje dos veces: el comprimido que precarga la página y el otro.
- **Abierto desde un archivo se ve en 2D**, porque el navegador no deja leer el archivo del personaje. Dentro de una app (Capacitor) se sirve por `https://localhost` y no pasa.
- **Modo incrustable.** No está hecho ni especificado, y no se probó el juego dentro de un `iframe`.
- **El resto de la personalidad.** Hay tres de los diez personajes. Faltan sus reacciones propias al punto (hoy todos festejan igual), el busto en el marcador, la tarjeta de presentación, la escalera del club y el rival sugerido. La dificultad se calibró contra un jugador simulado, no contra gente.

El resto:

- No hay sonido. El juego ya pide cada sonido por lo que pasó (`platform.sound.play('hit', fuerza)`); falta quien los haga sonar.
- La interfaz (marcador, menús, lista de lecciones) tomó los colores del atardecer, pero es la del prototipo: falta diseñarla.
- El resumen de fin de partido muestra solo el resultado: faltan los números del partido y un "Siguiente rival".
- No hay botón para exportar o importar los datos guardados, ni pantalla de privacidad. No se envía nada a ningún lado.
- El saque no tiene timing: entra casi siempre. Las faltas existen (hay segundo saque y doble falta), pero son raras.
- El globito del rival y el cartel del punto pueden pisarse cuando el rival está cerca de la red.
- Dobles se juega como experimento (`?dobles`). Falta lo que propone [docs/dobles.md](docs/dobles.md): las lecciones de dobles, elegir compañero en el inicio, guardar el partido, las frases de pareja y decidir si pasa a ser la partida rápida.
- La red no tiene postes con hueco ni puertas, y la pelota no choca con los jugadores.
- `npm audit` marca una vulnerabilidad de severidad alta en `picomatch`, que llega por Vite y Vitest. Son herramientas de desarrollo: no entra en lo que se publica.
