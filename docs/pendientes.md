# Pendientes

Lista que mantiene la sesión orquestadora: ideas y pedidos acordados con el usuario que todavía no se asignaron a ninguna sesión. Cuando algo se asigna o se hace, se tacha o se borra.

## Decisiones del usuario

- **Estilo visual final**: los favoritos del [tablero de referencias](https://claude.ai/artifact/P6WLCVwJxfoabQ2uwoLKgh) (privado) apuntan a 3D estilizado (ver abajo). Falta una escena de prueba que compare 3D prerrenderizado a sprites contra 3D toon en tiempo real, sobre la misma cancha iluminada, medida en un teléfono real.
- **Juntar en `main` las ramas de investigación**: `visual-research`, `retention-research`, `competitor-research`, `tiny-graphics-research`, `personajes` y `visual-references`. El usuario dijo "todavía no".

## Señales del tablero de referencias (2026-11-18)

El usuario marcó 28 favoritos de 47. Las fichas y la lectura crítica están en `docs/referencias-visuales.md` (rama `claude/visual-references-552078`).

- **Favoritos completos** (todos los de la familia): 3D toon o cel shading (5/5), acogedor con luz cálida (5/5) y navegador (4/4). Sobre shaders e iluminación dijo: "me gustan todos, porque mejora mucho la experiencia".
- **Favoritos parciales**:
  - 3D de película animada (3/4, solo como inspiración).
  - Deportes (3/6: OlliOlli World; Racket Club, "humanoide pero sin gráficos demandantes"; Super Mega Baseball 4, solo por las poses).
  - 3D low-poly (2/4: "el low poly siempre tiene su encanto").
  - 2D con profundidad (2/4).
  - Vectorial plano (2/5: Alto's "demasiado minimalista", Tangle Tower por el contraste).
- **Ninguno** de 2D ilustrado o pintado (0/5). Rematch le gusta pero es "demasiado realista y demandante".
- **Por viabilidad**: 16 favoritos son "3D liviano", 7 son "2D Canvas" y 5 son "inspiración".
- **Escala**: de Overcooked! 2, "me gusta cómo todo parece chico en un espacio grande".
- **Lectura**: el estilo apunta a **3D estilizado (toon o low-poly) con buena iluminación**, por las direcciones 1 (3D prerrenderizado a sprites) o 2 (3D toon en tiempo real) del documento, con la cancha iluminada como base. La dirección 3 (2D ilustrado) pierde fuerza.

## Cámara

- **Idea del usuario**: que la cámara no sea fija y acompañe un poco al jugador, como en Tennis Clash.
  - Con 3D en tiempo real sale casi gratis.
  - Con sprites prerrenderizados o Canvas 2D se puede imitar con paneo y zoom suaves sobre capas horneadas, con parallax.
  - Cuidar que la pelota se siga leyendo bien.
  - Agregar una opción de accesibilidad para reducir o apagar el movimiento de cámara.

## Arte (próxima ronda)

- Probar 3 o 4 variantes de escala de los personajes, con exageración que varíe con la profundidad (≈1,2× para el jugador cercano y ≈1,5× para el rival), y retocar la cámara para que la cancha no se sienta chica.
- Adoptar el elenco de `docs/personajes.md`, empezando por Beto, Romina y Chela.
- Escenario horneado con shader al cargar (WebGL2), con respaldo en Canvas 2D.
- Comparar lado a lado los personajes 2D y 3D toon, a escala de juego y en movimiento.
- **Más adelante**, pulido visual profundo: piernas y pies con forma (no cilindros), caras con más expresión y detalle, sin sensación de "AI slop". Ver "Exigencia visual" en `CLAUDE.md`.
- Usar Google Flow (Nano Banana) para generar arte conceptual de referencia antes de programar. El usuario dio su OK para usarlo desde su Chrome.

## Motor

- **Ronda "pantalla limpia"** (feedback del primer juego en el celular, 2026-11-18). El usuario dice "simple pero entretenido", pero que "demasiados círculos" lo confundieron. Es diseño de información, no de arte:
  - Sacar el anillo que marca cuál es el jugador propio. Para accesibilidad queda como opción (contorno o color).
  - Pisadas de "dónde pararse" apagadas por defecto.
  - **Una sola señal de timing** en vez de anillo, punto fijo, banda y rayita. Por ejemplo, que aparezca solo en los últimos ~300 ms y sea mínima.
  - Marca de pique chica y sutil, solo para el primer pique en tu lado. El seguimiento después del vidrio, como opción.
  - Marca de objetivo solo mientras el pulgar está apretado, sin halo de dispersión por defecto.
  - Nombre del golpe solo para los golpes especiales (bandeja, víbora, salida de pared, remate) y breve.
  - **Ayudas que se van solas**: a medida que el jugador acierta, las ayudas se desvanecen. Niveles "completas / mínimas / ninguna", con "mínimas" por defecto.
  - Tutorial sin texto, que se aprende jugando y con pistas de una sola vez.
  - El estilo visual de cada ayuda llega con el arte final. Ahora se define qué se muestra, cuándo y cuánto.
- **Más adelante**: modo "avanzado" opcional para quien quiera elegir cada tipo de golpe. Nunca por defecto.
- **Modo incrustable**, para poder meter el juego dentro de otras apps, por ejemplo una de reservas de canchas:
  - Que el juego se monte en un elemento contenedor sin asumir que es dueño de toda la página.
  - Configuración de entrada: tema o club, idioma, sonido.
  - Eventos de salida por `postMessage`: partido terminado, resultado.
  - Que tolere que la app anfitriona lo pause y lo reanude.

## Más adelante

- **Desafío por link, sin servidor**: semilla y resultado en la URL.
- **Partido en vivo por link**: necesita un servidor chico y código de red con compensación de latencia.
- Modo dobles jugable (la simulación ya lo soporta), torneos y opciones de partido.
- PWA, y después Capacitor para las tiendas.
