# Pádel: juego de navegador

## Visión

Juego de pádel para navegador, **mobile first y en vertical**. Está pensado para partidas cortas, por ejemplo en el transporte público, y deja lugar para un modo más competitivo más adelante.

Tiene que ser muy simple de jugar y accesible para todos. Además tiene que verse lindo: **la parte visual importa tanto como las mecánicas**. Si se ve soso, la gente lo abandona antes de probarlo en serio.

## Principios de producto

Lo que distingue a este juego es que es accesible y respetuoso con el jugador:

- **Cargar y jugar**: sin registro, sin cuentas obligatorias, sin pase de temporada y sin pagar para jugar.
- **Partida rápida siempre a mano**: desde el inicio, un toque y estás jugando. Esta opción no desaparece aunque se agreguen modos.
- **Más adelante**: torneos y opciones de partido (sets, dificultad, dobles). Suman profundidad sin tapar la partida rápida.
- **Nada de patrones oscuros**: sin presión para pagar, sin notificaciones abusivas, sin trucos para retener a la fuerza.

## Decisiones tomadas

- **Cámara**: desde atrás del jugador, con profundidad simulada (2D con proyección en perspectiva). La sombra de la pelota en el piso es lo que muestra a qué altura va.
- **Estilo visual**: plano redondeado (vectorial, formas redondeadas, paleta cálida). Lo buscado es "interesante y estético", no realista. El pixel art se descartó porque "parece un juego de NES".
- **Calidad del arte**: la primera maqueta se rechazó porque los personajes "parecen palitos y círculos que intentan ser un humano". Los personajes necesitan proporciones estilizadas pero creíbles, volumen y animación con carácter.
- **Orientación**: vertical primero. En escritorio se muestra como una columna vertical centrada.
- **Jugadores**: 1 contra 1 al principio, pero la arquitectura tiene que soportar dobles (2 contra 2) sin reescribir. Equipos con N jugadores e IA o control por jugador; nada de 1 contra 1 fijo en el código.
- **Controles**: simples y fluidos.
  - El jugador controla el movimiento de su personaje. Nada de que se mueva solo: el movimiento asistido queda únicamente como opción de accesibilidad.
  - El jugador elige a dónde golpear y con qué fuerza o altura. El tipo de golpe concreto (bandeja, víbora, contrapared, chiquita, globo, remate) lo decide el contexto y se nombra en pantalla.
  - Se prueban dos esquemas: dos pulgares (mover, y apuntar antes de que llegue la pelota y soltar para golpear) y uno de una sola mano.
- **Reglas**: saque por abajo, punto de oro y partidos cortos.

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
- TypeScript + Vite + Canvas 2D, sin motores de juego pesados. Dependencias chicas solo si se justifican.
- La física avanza con paso fijo y el render va desacoplado.
- Lo estático se dibuja una vez y se cachea. Los personajes con detalle pueden pre-renderizarse a sprites al cargar el juego, según el DPR del dispositivo.
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
