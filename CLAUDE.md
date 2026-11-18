# Pádel: juego de navegador

## Visión

Juego de pádel para navegador, **mobile first y en vertical**. Está pensado para partidas cortas, por ejemplo en el transporte público, y deja lugar para un modo más competitivo más adelante.

**Público principal: la gente que juega al pádel.** Un jugador de pádel, incluso uno profesional, tiene que poder decir "esto es como en el pádel" aunque las mecánicas sean sencillas. **Fácil de aprender, difícil de dominar**: la profundidad sale de la táctica real del pádel, no de que el rival llegue a todo.

Tiene que ser muy simple de jugar y accesible para todos. Además tiene que verse lindo: **la parte visual importa tanto como las mecánicas**. Si se ve soso, la gente lo abandona antes de probarlo en serio.

## Principios de producto

Lo que distingue a este juego es que es accesible y respetuoso con el jugador:

- **Cargar y jugar**: sin registro, sin cuentas obligatorias, sin pase de temporada y sin pagar para jugar.
- **Partida rápida siempre a mano**: desde el inicio, un toque y estás jugando. Esta opción no desaparece aunque se agreguen modos.
- **Más adelante**: torneos y opciones de partido (sets, dificultad, dobles). Suman profundidad sin tapar la partida rápida.
- **Nada de patrones oscuros**: sin presión para pagar, sin notificaciones abusivas, sin trucos para retener a la fuerza.
- **Rivales y compañeros con personalidad**: se juega contra alguien, no contra "la CPU". La personalidad se nota jugando (estilo de juego, gestos, frases cortas) y nunca corta la fluidez.
- **Pantalla limpia, sin tener que leer**: el juego es para quien busca algo simple y entretenido, como en el colectivo. Esa persona no quiere leer y juega el tutorial rápido.
  - Pocas ayudas en pantalla, sutiles, integradas en el mundo y con estilo, que aparecen solo cuando hacen falta.
  - Nada de saturar con información, círculos u opciones.
  - Lo que sobra cuando hay arte se saca: por ejemplo, el anillo que marca cuál es tu jugador.
  - La complejidad (elegir cada tipo de golpe, ayudas detalladas) puede existir como opción para quien la busque, nunca por defecto.
- **Control arcade, resultado realista**: pocas decisiones para el jugador (moverse, a dónde, qué tan fuerte o alto, cuándo) y pádel de verdad como resultado (golpes reales, paredes y reglas).

## Decisiones tomadas

- **Punto de vista**: desde atrás del jugador, en 3D. La sombra de la pelota en el piso es lo que muestra a qué altura va.
- **Estilo visual (decidido el 2026-11-18)**: **3D toon en tiempo real** (WebGL2, sombreado toon con contorno de tinta) sobre una **cancha con luz horneada en capas**, con ambiente de club cálido al atardecer. Es el camino B de `design/prueba-3d/`.
  - Se eligió frente a sprites prerrenderizados (camino A) por fluidez, peso, carga y escalabilidad del elenco.
  - El camino A queda como respaldo para equipos sin WebGL2.
  - En el celular del usuario, los dos andan a 60 fps.
  - Lo buscado es "interesante y estético", no realista. El pixel art y el 2D vectorial se descartaron.
  - Los favoritos del usuario en el tablero de referencias son 3D toon y cel shading (Bomb Rush Cyberfunk, Rollerdrome, OlliOlli World, Racket Club, Messenger) y ambientes cálidos.
- **Escala de personajes**: la variante media, con exageración que varía con la profundidad (≈1,2× el cercano, ≈1,5× el rival). La cancha tiene que sentirse grande, "todo chico en un espacio grande".
- **Cámara**: el jugador elige en Opciones entre **"Acompaña"** y **"Fija"** (cancha entera), porque a cada uno le puede gustar una u otra. La que acompaña lo hace de forma sutil, con estas reglas:
  - El vidrio de fondo propio, con 2 o 3 m de margen, siempre a la vista.
  - Paneo lateral y zoom leve con límites.
  - Se abre un poco con globos y pelotas al fondo.
  - Zona muerta y suavizado.
  - Con "reducir movimiento", cámara fija de cancha entera.
- **Calidad del arte**: la primera maqueta se rechazó porque los personajes "parecen palitos y círculos que intentan ser un humano". Los personajes necesitan proporciones estilizadas pero creíbles, volumen y animación con carácter.
- **Prioridad en personajes: la animación.** Las siluetas propias de cada personaje se hacen solo si no suman peso, por ejemplo con escala de huesos o piezas chicas.
- **Orientación**: vertical primero. En escritorio se muestra como una columna vertical centrada.
- **Jugadores**: 1 contra 1 al principio, pero la arquitectura tiene que soportar dobles (2 contra 2) sin reescribir. Equipos con N jugadores e IA o control por jugador; nada de 1 contra 1 fijo en el código.
- **Controles**: simples y fluidos.
  - El jugador controla el movimiento de su personaje. Nada de que se mueva solo: el movimiento asistido queda únicamente como opción de accesibilidad.
  - El jugador elige a dónde golpear y con qué fuerza o altura. El tipo de golpe concreto (bandeja, víbora, contrapared, chiquita, globo, remate) lo decide el contexto y se nombra en pantalla.
  - Se prueban dos esquemas: dos pulgares (mover, y apuntar antes de que llegue la pelota y soltar para golpear) y uno de una sola mano.
- **Reglas**: saque por abajo, punto de oro y partidos cortos.

## Exigencia visual

- **Criterio de crítico exigente: el único tope es el rendimiento.** Nada de conformarse con "está bien para ser código".
- **Evitar la sensación de "AI slop"**: arte genérico, formas de manual, todo igual de prolijo y sin intención.
- **Feedback concreto sobre la maqueta v2**:
  - Las piernas y los pies parecen cilindros que imitan piernas.
  - Las caras son demasiado simples.
  - Con los personajes a 1,7× la cancha se siente chica. Probar una escala que varíe con la profundidad (menos en el jugador cercano, más en el rival).
- **El pulido visual profundo es una fase posterior**, después de validar las mecánicas en el celular. Pero cada entrega visual se revisa con este criterio desde ya.

## Lo que no queremos (aprendido de jugar a la competencia)

- Ralentizar o detener el juego para apuntar.
- Animaciones largas después de cada punto que cortan la fluidez.
- Ruedas o menús con muchos tipos de golpe para elegir.
- Que el personaje se mueva solo, o que la dirección del golpe dependa de hacia dónde se mueve.
- Publicidad, popups, pase de temporada, monedas y puntos por todos lados.
- Estética anime exagerada: el pádel tiene que parecer pádel.
- Cargas largas (los juegos de pádel hechos con Unity tardan en arrancar).

Lo que sí gustó: elegir a dónde golpear antes de que llegue la pelota y que el personaje ejecute el golpe ahí.

## Restricciones técnicas

- **Liviano pero lindo**: se acepta perder algo de liviandad para que se vea bien, pero no puede ser un juego pesado. Objetivo orientativo: 60 fps en un Android de gama media de hace unos 5 años y una descarga inicial chica.
- TypeScript + Vite, sin motores de juego pesados. Render en WebGL2 escrito a mano (sin three.js ni PixiJS), con respaldo en Canvas 2D. Dependencias chicas solo si se justifican.
- La física avanza con paso fijo y el render va desacoplado.
- Lo estático se dibuja una vez y se cachea: la luz de la cancha va horneada. Los personajes son mallas 3D chicas con esqueleto, compartidas entre todo el elenco. Las variantes salen de colores y piezas, y las animaciones se comparten.
- Los modelos y las animaciones se generan con scripts de Blender en modo consola, guardados en el repo y reproducibles. Usan la GPU dedicada con `--gpu-backend vulkan --gpu-device 1002/747e/0`.
- DPR con tope y resolución interna ajustable según el rendimiento.
- **Accesibilidad**:
  - No depender solo del color.
  - Opción para reducir el movimiento.
  - Ayudas visuales, como la marca de dónde va a picar la pelota.
  - Velocidad ajustable.
  - Pausa en cualquier momento.
  - Jugable sin sonido.
- **Publicación**: GitHub Pages desde https://github.com/NahuelAlegre/padel.

## Convenciones

- Los textos del juego van en español. El código y los identificadores, en inglés.
- `design/` es para la dirección de arte y las exploraciones visuales. `src/` es para el juego.
- El trabajo se reparte en sesiones paralelas que coordina una sesión orquestadora. Cada sesión trabaja en su propia rama o worktree y toca solo su área.
- Hacer commit en la rama propia. Pedir confirmación antes de hacer push o abrir PRs.
- **Capturas y navegador**: preferir el navegador integrado de la app. Si un script necesita un navegador headless (Chrome o Edge), tiene que usar `--user-data-dir` con una carpeta temporal ABSOLUTA y escribible, más `--noerrdialogs`. Nunca una ruta relativa ni el perfil real del usuario: si falla, aparecen carteles de error en su pantalla.
