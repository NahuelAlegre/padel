# Pendientes

Lista que mantiene la sesión orquestadora: ideas y pedidos acordados con el usuario que todavía no se asignaron a ninguna sesión. Cuando algo se asigna o se hace, se tacha o se borra.

## Decisiones del usuario

- **Estilo visual final**: se decide con los favoritos del [tablero de referencias](https://claude.ai/artifact/P6WLCVwJxfoabQ2uwoLKgh) (privado) y con la comparación entre personajes 2D y 3D estilizado.
- **Juntar en `main` las ramas de investigación**: `visual-research`, `retention-research`, `competitor-research`, `tiny-graphics-research`, `personajes` y `visual-references`. El usuario dijo "todavía no".

## Arte (próxima ronda)

- Probar 3 o 4 variantes de escala de los personajes, con exageración que varíe con la profundidad (≈1,2× para el jugador cercano y ≈1,5× para el rival), y retocar la cámara para que la cancha no se sienta chica.
- Adoptar el elenco de `docs/personajes.md`, empezando por Beto, Romina y Chela.
- Escenario horneado con shader al cargar (WebGL2), con respaldo en Canvas 2D.
- Comparar lado a lado los personajes 2D y 3D toon, a escala de juego y en movimiento.
- **Más adelante**, pulido visual profundo: piernas y pies con forma (no cilindros), caras con más expresión y detalle, sin sensación de "AI slop". Ver "Exigencia visual" en `CLAUDE.md`.
- Usar Google Flow (Nano Banana) para generar arte conceptual de referencia antes de programar. El usuario dio su OK para usarlo desde su Chrome.

## Motor

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
