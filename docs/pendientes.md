# Pendientes

Lista que mantiene la sesión orquestadora: ideas y pedidos acordados con el usuario que todavía no se asignaron a ninguna sesión. Cuando algo se asigna o se hace, se tacha o se borra.

## Decisiones del usuario

- ~~Estilo visual final~~: **decidido el 2026-11-18**, 3D toon en tiempo real con la cancha horneada y la escala media. Ver `CLAUDE.md`.
  - Base: `design/prueba-3d/` (rama `claude/3d-style-test-9fba4e`).
  - En el celular del usuario, los dos caminos andan a 60 fps, con 0,4 a 0,8 ms de JavaScript por cuadro.
- **Juntar en `main` las ramas de investigación**: `visual-research`, `retention-research`, `competitor-research`, `tiny-graphics-research`, `personajes` y `visual-references`. El usuario dijo "todavía no".

## Siguiente ronda propuesta (2026-11-18)

Hay dos trabajos en paralelo que tocan carpetas distintas. Los dos necesitan que la rama de la prueba 3D esté en `main`.

### A. Personajes con carácter (en `design/`, Blender por scripts)

La prueba 3D sacó de encima las primitivas, pero el personaje sigue siendo "prolijo y genérico", según la propia autocrítica y la revisión de la orquestadora. Falta una decisión gráfica fuerte.

- Primero, **arte conceptual en Google Flow** (Nano Banana 2.1, OK del usuario para usarlo desde su Chrome): 2 o 3 propuestas de estilización exagerada a la manera de OlliOlli World o Bomb Rush Cyberfunk, con piernas largas, tobillos finos, zapatillas grandes, manos con presencia y pelo con forma. El usuario elige.
- **Siluetas propias** para Beto (panza y gorra), Romina (hombros y trenza) y Chela (bajita y visera), según `docs/personajes.md`, más el jugador.
- **Caras**: parpadeo, 3 o 4 expresiones y bustos grandes para el marcador.
- Pelo con volumen y ropa con pliegues.
- **Animación**:
  - Pies que no patinan (paso ajustado a la velocidad).
  - Carrera hacia atrás propia y split step.
  - Reacciones al punto.
  - Pala a la pelota con cinemática inversa en vivo.
- Malla más liviana, donde sobran vértices: zapatillas, dedos y agujeros de la pala.

### B. Integración del render 3D en el motor (en `src/`)

- Renderer WebGL2 detrás de la interfaz `Renderer`, a partir de `design/prueba-3d/lib`, con el camino A (Canvas 2D) como respaldo.
- Escala media, con exageración que varía con la profundidad.
- Cámara que acompaña con las reglas de encuadre, probada con juego real, contra las paredes y en dobles.
- **Ronda "pantalla limpia"** con el estilo nuevo de las ayudas: ver "Motor" abajo.
- Bajar el peso de la cancha: AVIF, capas blandas a media resolución, fundir capas.
- Arreglos de la cancha:
  - Los reflejos del vidrio cercano no tienen que pasar sobre el jugador.
  - Sombra de la pelota coherente con el resto.
  - Cielo con más vida.
  - Buffet con más diseño.
- Sombra propia en los personajes, con un mapa de sombras chico.
- Medir en el celular del usuario y, si se puede, en un Android de gama media y un iPhone viejo.

## Motor

- ~~Descubrir los golpes sin leer, tutorial, profundidad y animaciones nuevas~~: **publicado el 2026-11-18** (merge `52eac28`). Ocho lecciones jugables, pistas de una sola vez, marca de objetivo con forma según el golpe, mecánicas M1 a M4 y M6, IA con `punish`, `holdNet` y `composure`, efecto en la pelota, y los 24 clips. Esperando que el usuario lo pruebe en el celular.
- **Pendiente de esa ronda** (revisión de la orquestadora):
  - **La marca de objetivo se ve tenue**: en algunas capturas es un anillo gris fino sobre el azul. Tiene que verse bien mientras se apunta.
  - **El menú del tutorial es una grilla de texto**: falta un dibujito de la trayectoria en cada lección para que sea "visual".
  - **Las pisadas de "dónde pararse" no se entienden** (el usuario preguntó qué eran): en las lecciones 1, 5, 6 y 7 se ven como dos puntitos blancos. Dibujarlas como suelas de zapatilla o sacarlas.
  - Probar el tutorial con alguien que no juegue videojuegos (el usuario sí juega, y por eso lo entendió).
  - **Metas de profundidad sin cumplir**:
    - La táctica suma +15 pp solo contra Chela; contra Beto y Romina suma entre 7 y 13.
    - Los puntos contra Chela duran 19 s (meta: 8 a 14).
    - Casi ningún punto termina en error: una pelota exigida vuelve floja, no afuera.
    - La presión todavía no se ve en el cuerpo del jugador.
  - No se hicieron los puntos 7 a 10 de `docs/profundidad.md`: lectura de patrones, cambios de ritmo, salida por tres y el medio en dobles.
  - ~~Medir los cuadros por segundo del 3D en un teléfono~~: medido el 2026-11-19 en un celular del usuario más viejo que el suyo, «no es antiguo pero tampoco es moderno para juegos». En dobles, con cuatro personajes y la versión publicada con la IA humana y la zancada, va a 90 fps (11,1 ms por cuadro, el tope de su pantalla) con 1,74 ms de CPU por cuadro. Falta un Android de gama media de hace unos 5 años y un iPhone viejo.
- **Ronda "pantalla limpia"** (feedback del primer juego en el celular, 2026-11-18). El usuario dice "simple pero entretenido", pero que "demasiados círculos" lo confundieron. Es diseño de información; el estilo llega con el 3D:
  - Sacar el anillo que marca cuál es el jugador propio. Para accesibilidad queda como opción (contorno o color).
  - Pisadas de "dónde pararse" apagadas por defecto.
  - **Una sola señal de timing** en vez de anillo, punto fijo, banda y rayita. Por ejemplo, el brillo en la pelota o la pala que ya probó la escena 3D, solo en el último instante.
  - Marca de pique chica y sutil, solo para el primer pique en tu lado. El seguimiento después del vidrio, como opción.
  - Marca de objetivo solo mientras el pulgar está apretado, sin halo de dispersión por defecto.
  - Nombre del golpe solo para los golpes especiales (bandeja, víbora, salida de pared, remate) y breve.
  - **Ayudas que se van solas**: a medida que el jugador acierta, las ayudas se desvanecen. Niveles "completas / mínimas / ninguna", con "mínimas" por defecto.
  - Tutorial sin texto, que se aprende jugando y con pistas de una sola vez.
- **Más adelante**: modo "avanzado" opcional para quien quiera elegir cada tipo de golpe. Nunca por defecto.
- **Modo incrustable**, para poder meter el juego dentro de otras apps, por ejemplo una de reservas de canchas:
  - Que el juego se monte en un elemento contenedor sin asumir que es dueño de toda la página.
  - Configuración de entrada: tema o club, idioma, sonido.
  - Eventos de salida por `postMessage`: partido terminado, resultado.
  - Que tolere que la app anfitriona lo pause y lo reanude.

## Dobles posicional y alcance creíble (idea del usuario, 2026-11-18)

**Prototipo publicado el 2026-11-18** (merge `0fb3c31`): propuesta en `docs/dobles.md` y en el [Artifact](https://claude.ai/artifact/9c464BuRNAzAys6RQnxpGX) (privado). Se prueba con `?dobles&alcance=real` o en Opciones → Experimental; la partida rápida no cambió. Esperando que el usuario lo pruebe en el celular.

- **Primera prueba en el celular** (2026-11-18): "Es más caótico pero me gusta, eso le da diversión." La IA necesita pulirse, "es base para un juego divertido". A veces una pelota iba derecho al compañero, "claramente era suya en su área", y no hacía nada. Pidió IA que se sienta humana, "tanto aciertos como errores", y actitudes de compañero elegibles: agresivo (a veces roba), pasivo y equilibrado.
  - **Publicado el 2026-11-19** (merges `5694d86` y `4b7bd3a`):
    - **IA**: el compañero juega sus pelotas, los errores tienen motivo y hay tres actitudes (agresiva, equilibrada, pasiva) en Opciones → Dobles. Detalle en `docs/ia.md`.
    - **Fase 2 de animación**: zancada con el pie plantado y flexión profunda; el cuerpo ya no se desliza pegando parado. Detalle en `docs/dobles.md`, sección 4.
  - **Segundas vueltas, publicadas el 2026-11-19** (merges `2dbd31e` y `5be1d46`):
    - **IA**: el error lo provoca la presión del jugador, y la táctica vuelve a rendir: en 1 contra 1, +11/+16/+20 pp contra Beto, Romina y Chela; en dobles posicional, +16/+19/+13. La IA ya no arma un golpe y pega otro.
    - **Animación**: seis gestos de la IA (apurado, bloqueo, «no llegué», sorprendido, tensión, festejo o «perdón» del robo) y la estocada a la carrera.
  - **Decisiones del usuario, después de probarlo en el celular**:
    - Chela quedó más fácil: hoy cuesta lo mismo que Romina. Se la puede endurecer, pero sus puntos pasan a 17,6 s.
    - Golpes al aire: cada rival falla unas 2 veces por partido pelotas a las que llegó. Si parecen regalados, que conecten flojo (hay que recalibrar a Beto).
  - **Pendiente de animación** (revisión de la orquestadora): el festejo del robo casi no se distingue, el bloqueo de revés se confunde con una volea, los pies todavía patinan al pegar a la carrera (p90 de unos 11 cm por cuadro), y el apurado y el robo no tienen versión 2D.
- **Decisiones del usuario, después de probarlo**: partida rápida en dobles, alcance real para todos, el 1 contra 1 como «Cruzado» (media cancha en diagonal), revés y Beto por defecto, cuánto se desordena la pareja rival.
- **Pendiente** (revisión de la orquestadora):
  - ~~Fase 2, animación~~: publicada el 2026-11-19 (ver arriba).
  - Al drive, jugar posicional casi no rinde (−3 a +3 pp). La meta de +15 pp se cumple solo en algunas casillas, con un jugador simulado.
  - ~~Puntos contra Romina y Chela de 16 a 20 s~~: con la IA nueva, 11,5 s en dobles al revés con alcance real.
  - Las lecciones D1 a D5 y la pista de tierra de nadie. Cada personaje ya tiene su actitud, pero todavía avisan igual.
  - ~~Medir los cuadros por segundo con cuatro personajes en el celular~~: 90 fps con 1,74 ms de CPU en un celular más viejo que el del usuario (ver "Motor").

Lo que sigue es el planteo original, de antes del prototipo.

El usuario notó que "el jugador puede golpear desde posiciones muy imposibles", tanto él como la IA. La causa es doble:
- **Alcance**: la simulación deja pegar hasta 1,8 m del cuerpo a tiempo y 2,2 m tarde, y a la IA hasta 1,85 m. Una persona llega a 1,1–1,2 m parada y a unos 1,7 m con una zancada. Las pelotas se pueden pegar a 7,5 cm del piso.
- **Animación**: el cuerpo se desliza hasta 90 cm hacia la pelota sin dar un paso, y se agacha como mucho 36 cm.

Pidió **no mandarlo todavía**, porque lo piensa junto con los dobles:
- "2 vs 2 me parece es el juego por defecto del padel, o al menos le da más diversión": un jugador en un extremo se la deja al compañero en vez de "ser un velocista".
- Quiere **juego posicional**, que "la posición del jugador importe".
- Siempre jugó a dobles.

Cuando se retome, va como un solo diseño:
- dobles como modo principal, con 1 contra 1 como opción;
- compañero con IA que juega en pareja: subir y bajar juntos, el medio y los lados;
- alcances de persona real con la animación a la par (zancada y flexión de verdad);
- una cámara para cuatro jugadores;
- recalibrar la profundidad.

## Más adelante

- **Desafío por link, sin servidor**: semilla y resultado en la URL.
  - **Al abrir el link, un solo botón antes de jugar** (pedido del usuario, 2026-11-19): arrancar directo "es muy agresivo", porque no se espera estar jugando con solo abrir el link. Esa pantalla también tapa la descarga mientras la persona mira la invitación.
  - Mientras baja, que no se vea una pantalla vacía: hoy, en 3G malo, la pantalla queda lisa unos 8 s.
  - Vista previa del link en WhatsApp (imagen y título) y probar que ande dentro del navegador de WhatsApp e Instagram.
  - **Tiempo hasta jugar, medido el 2026-11-19** sobre la versión publicada: primera visita, sin caché, con la CPU 4× más lenta, 327 KB.

    | Conexión | En pantalla y jugable |
    |---|---|
    | 4G bueno (9 Mbps) | 0,9 s |
    | 4G flojo (1,6 Mbps) | 2,4 s |
    | 3G (0,75 Mbps) | 4,6 s |
    | 3G malo (0,4 Mbps) | 8,1 s |
- **Partido en vivo por link**: necesita un servidor chico y código de red con compensación de latencia.
  - Plan probable: conexión directa entre los dos jugadores (WebRTC) con un servidor mínimo que solo los presenta, y rollback, aprovechando que la simulación ya es determinista y registra entradas.
  - Para no cerrarse la puerta desde ya: que la simulación dé **exactamente el mismo resultado en cualquier navegador y procesador**. Evitar en `src/sim/` funciones como `Math.sin`, `Math.cos`, `Math.pow` y `Math.exp`, que pueden variar entre motores, o usar versiones propias. Agregar un test que compare un partido grabado contra un resultado de referencia.
  - Un "controlador remoto" es solo otro tipo de controlador, junto al humano y la IA.
  - **Cada uno ve desde atrás de su jugador** (pregunta del usuario, 2026-11-18). La cancha horneada es una sola foto desde un lado, así que el segundo jugador ve el mundo **espejado**: x → −x, y → −y, solo en la presentación, sin tocar la simulación.
    - No hay que hornear otra cancha ni sumar descarga.
    - Hoy el render asume que el equipo 0 está cerca de la cámara (`src/render/stage/director.ts`). Esa vista tiene que salir de "mi equipo".
    - Revisar las asimetrías que hoy dependen de "persona contra IA", como `HUMAN_REACH` y `latencyCompensation`, para que entre dos personas sean parejas.
  - Desconexiones: pausa, reconexión y que la IA tome el lugar si el otro se va.
- Dobles: ver "Dobles posicional" arriba. Torneos y opciones de partido.
- PWA, y después Capacitor para las tiendas.

## Referencia: señales del tablero (2026-11-18)

El usuario marcó 28 favoritos de 47 en el [tablero de referencias](https://claude.ai/artifact/P6WLCVwJxfoabQ2uwoLKgh) (privado). Las fichas están en `docs/referencias-visuales.md` (rama `claude/visual-references-552078`).

- **Favoritos completos**: 3D toon o cel shading (5/5), acogedor con luz cálida (5/5) y navegador (4/4). Sobre shaders e iluminación dijo: "me gustan todos".
- **Ninguno** de 2D ilustrado (0/5).
- Notas del usuario:
  - Racket Club: "humanoide pero sin gráficos demandantes".
  - Overcooked: "todo parece chico en un espacio grande".
  - Super Mega Baseball: "una buena animación mejora la experiencia".
  - Tennis Clash: la cámara que acompaña.
