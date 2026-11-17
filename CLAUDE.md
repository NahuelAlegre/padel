# Pádel: juego de navegador

## Visión

Juego de pádel para navegador, **mobile first y en vertical**. Está pensado para partidas cortas, por ejemplo en el transporte público, y deja lugar para un modo más competitivo más adelante.

Tiene que ser muy simple de jugar y accesible para todos. Además tiene que verse lindo: **la parte visual importa tanto como las mecánicas**. Si se ve soso, la gente lo abandona antes de probarlo en serio.

## Decisiones tomadas

- **Cámara**: desde atrás del jugador, con profundidad simulada (2D con proyección en perspectiva). La sombra de la pelota en el piso es lo que muestra a qué altura va.
- **Estilo visual**: plano redondeado (vectorial, formas redondeadas, paleta cálida). Lo buscado es "interesante y estético", no realista. El pixel art se descartó porque "parece un juego de NES".
- **Calidad del arte**: la primera maqueta se rechazó porque los personajes "parecen palitos y círculos que intentan ser un humano". Los personajes necesitan proporciones estilizadas pero creíbles, volumen y animación con carácter.
- **Orientación**: vertical primero. En escritorio se muestra como una columna vertical centrada.
- **Jugadores**: 1 contra 1 al principio, pero la arquitectura tiene que soportar dobles (2 contra 2) sin reescribir. Equipos con N jugadores e IA o control por jugador; nada de 1 contra 1 fijo en el código.
- **Controles**: simples, pensados para jugar con el pulgar y con una sola mano.
- **Reglas**: saque por abajo, punto de oro y partidos cortos.

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
