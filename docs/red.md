# Plantarse en la red

**Lo que reportó el usuario** (2026-11-20, jugando dobles): «Si me pongo enfrente de la red y empiezo a spamear el botón de golpear, prácticamente me vuelvo invencible. Y si hacen un globo para pasarme por encima simplemente espero a que mi compañero la devuelva.»

**En una línea:** en el pádel la red es la mejor posición, y acá también; lo que cambió es que ahora cuesta lo que cuesta en la realidad. Cada golpe compromete el cuerpo, el globo que te pasa por tu lado es tuyo, y la pareja partida se paga.

**Cómo probarlo:** `?dobles&alcance=real` (o `?dobles`), plantate en la red y apretá golpe sin parar; después jugá normal, bajando cuando te tiran un globo.

---

## Qué pasaba (medido)

`npx vitest run --config vitest.sim.config.ts netcamp` juega un jugador simulado que se planta en la red (no baja nunca, se corre de costado hacia la pelota que le viene y devuelve el saque como cualquiera) contra el mismo jugador apretando una sola vez, y contra un jugador que juega bien (sube y baja con el compañero, el de los informes de dobles). Las manos son siempre las del jugador promedio.

1. **Apretar seguido no costaba nada.** Cada toque volvía a tomar el momento del golpe, así que el último caía siempre justo antes del contacto: nunca salía tarde y uno de cada cinco salía perfecto sin medir nada (20 a 24 % de perfectos). Un golpe al aire bloqueaba 0,15 s.
   - **Pero lo que más pesaba no era el perfecto:** era no llegar nunca tarde. Quien aprieta una sola vez con manos promedio a veces suelta tarde, y en la red la pelota ya pasó. Prepararse temprano (apretar una vez, apenas pega el rival) rinde lo mismo que apretar sin parar: con el alcance de hoy, 67,4 % y 68,7 % de los puntos con Beto, contra 59,8 % de quien aprieta una vez a tiempo.
2. **El globo no le costaba a la persona.** Si te quedabas en la red, el compañero cruzaba solo cuando estaba claramente mejor ubicado; si no, nadie iba (entre un sexto y un tercio de esos globos no los tocaba nadie). Y después de devolverlo, el compañero volvía a subir enseguida, porque te seguía a vos: la pareja partida casi no existía (una pelota por partido). Los rivales, además, te tiraban los mismos globos que a cualquiera: unos 5 por partido por tu lado, y con Beto y Romina de rivales, uno.
3. **La pareja partida no se pagaba.** Contra uno en la red y otro atrás, el «hueco» que buscaba la computadora era el medio entre los dos, y esa pelota pasa al alcance del que está en la red. Medido con el compañero ya quedándose atrás: dos de cada tres voleas del rival a la pareja partida las devolvía la persona, y la pareja partida ganaba el 61 a 68 % de esos puntos.
4. **Lo que se comprobó y no hacía falta tocar:** la volea a los pies en la red ya sale floja y hacia arriba (presión media 0,55 en las voleas por debajo de la faja, `ballPressure`, componente `below`).

## 1. Cada golpe compromete el cuerpo

`Match.requestSwing` (`src/sim/match.ts`). Vale para todos, personas y computadora; la computadora nunca aprieta de más, así que sus partidos dan idénticos.

| Qué hacés | Qué pasa |
| --- | --- |
| Apretás con la pelota viniendo | Se arma el golpe, como siempre: elegís a dónde antes de que llegue. **Prepararse temprano sigue siendo un golpe bueno.** |
| Volvés a apretar ya armado | **Cambia a dónde va, no cuándo pega.** El momento del primer toque queda: el perfecto hay que ganárselo, no se consigue apretando de nuevo. Con movimiento asistido, si la pelota te está pasando al alcance, ese toque también elige tomarla ahí en vez de esperar el rebote del vidrio, como antes. |
| Apretás sin que venga la pelota | **Golpe al aire entero:** la pala espera atrás un instante (0,1 s), pasa y termina (0,42 s). Mientras dura no hay otro golpe, y las piernas van con el golpe: te movés a media velocidad. Antes se cortaba a los 0,15 s y el cuerpo quedaba congelado en el armado. |
| Apretás justo antes de que pegue el rival | Si el rival le pega mientras tu pala todavía está atrás (hasta 0,22 s después de apretar), ese armado sirve para su pelota: no es un golpe al aire. |
| Tu compañero le pega a la pelota para la que estabas armado | El armado se va con esa pelota. Antes quedaba armado sin límite y te servía para la siguiente. |

**En cada esquema de control** es lo mismo, porque todos terminan en el mismo pedido de golpe:

- **Dos pulgares:** soltar el pulgar de apuntar es golpear. Con el golpe armado, otro toque cambia a dónde va.
- **Una mano:** el deslizamiento es el golpe; otro deslizamiento con el golpe armado cambia la dirección.
- **Teclado:** cada tecla de golpe es soltar (J, K, L, U, I, O, M, espacio); otra tecla con el golpe armado cambia la dirección.

**En la animación:** el golpe al aire de la persona ya no lleva el «no llegué» de la computadora (la cabeza que cae, o el «no» en 2D): pegaste a la nada y el golpe entero ya lo dice.

## 2. El globo que pasa por tu lado es tuyo

`secondLook` (`src/sim/pair.ts`), `Match.updatePairs` y `Match.holdBack`.

- **«¡Atrás!»** Cuando el compañero ve venir un globo por arriba tuyo y no estás yendo, te lo dice con la seña de siempre (el brazo que barre hacia atrás) y te da hasta 0,4 s desde el golpe rival para que vayas.
- **El cambio.** Si llega claramente más cómodo que vos, cruza enseguida y te avisa («¡voy!»), como antes. Si no, y no fuiste, cruza igual («¡voy!»), tarde. **El compañero no deja pasar la pelota:** antes, entre un sexto y un tercio de esos globos no los tocaba nadie.
- **¿Llega apurado?** Se midió y **no**: los globos de la computadora tardan unos 3 s en llegar al vidrio, y el compañero que cruza tarde llega igual con 1,4 a 1,8 s de margen. Forzarlo sería inventado. Lo que sí se agregó: una pelota que le pasan tarde le exige desde el momento en que se la pasan y desde donde estaba (`demandOf`), y eso pesa en los globos más bajos.
- **Se queda atrás.** Si tuvo que defender lejos de la red (desde el fondo o la salida del vidrio) y vos seguís arriba, ya no vuelve a subir solo: se queda atrás y te llama («¡atrás!») hasta que bajes, pegues vos, o él pegue una pelota que lo lleve arriba (un buen globo, una volea). La pareja queda partida, que es lo que en el pádel cuesta quedarse arriba.
- **Los rivales leen tu costumbre.** Cada vez que te pasan un globo y te quedás en la red, la pareja rival se acuerda y te tira otro por arriba tuyo: un 20 % más de las veces por cada vez que te quedaste, hasta un 60 %, además de los globos que ya tiraba. Lo hace cualquiera, también quien no lee el juego, porque se ve: medido, contra Beto y Romina (que casi no tiran globos) quedarse en la red seguía saliendo gratis. Cada vez que bajás, se le olvida una. Solo lee a las personas: lo que hace la computadora bajo un globo es el momento, no una costumbre.

## 3. La pareja partida se paga

`AIController.pairShot` y `holeOf` (`src/control/ai.ts`).

Contra una pareja con uno en la red y otro atrás, la computadora:

- desde el fondo, le tira globo al de la red (y más, si lo vio quedarse: sección 2);
- desde la red, le tira a los pies, corta;
- y si no, **al hueco de verdad:** una pelota que pasa lejos de la pala del que está en la red (más allá de su alcance y una zancada) y cae lo más lejos posible del de atrás. Lo mismo cuando remata una pelota para atacar.

Por ahora solo contra una pareja con una persona. Entre parejas de la computadora todo queda igual, y por eso la demo y el estudio dan idénticos: con la demo que sale de este cambio, el estudio encuentra una «baja» con la cadera a 127°, una pose que la animación todavía no resuelve (`PERSON_PAIRS_ONLY`).

## Cómo se mide

`npx vitest run --config vitest.sim.config.ts netcamp` (`tests/sim/netcamp.sim.ts`). Con `NETCAMP_MATCHES` (20 por defecto; los números de abajo son con 60), `SIM_REACH=real`, `NETCAMP_ONLY=doubles` o `singles`, y `NETCAMP_JSON`. «Antes» es `main` (9f61df6) con el mismo informe. En dobles vas al revés con cada personaje de compañero, contra los otros dos.

Puntos ganados por la pareja de la persona (o por la persona, en 1 contra 1), 60 partidos por casilla. El ruido es de unos ±2 a 3 puntos por casilla: dos corridas del mismo jugador con otra semilla llegaron a diferir 6.

**Dobles, con Beto contra Romina y Chela** (la partida de dobles por defecto)

| Jugador | Alcance de hoy | Alcance real |
| --- | --- | --- |
| Plantado, apretando sin parar | 68,7 → **58,9** | 66,8 → **55,1** |
| Plantado, una vez y temprano | 67,4 → **61,2** | 64,3 → **51,8** |
| Plantado, una vez a tiempo | 59,8 → **53,9** | 58,6 → **47,1** |
| Normal: sube y baja con el compañero | 62,2 → **60,3** | 53,4 → **56,8** |
| Normal, y se prepara temprano | 69,8 → **71,7** | 64,4 → **64,2** |
| Normal que a veces aprieta antes del golpe rival | 62,2 → **61,5** | 53,4 → **56,0** |

**Dobles, con Romina contra Beto y Chela**

| Jugador | Alcance de hoy | Alcance real |
| --- | --- | --- |
| Plantado, apretando sin parar | 78,7 → **75,1** | 76,6 → **75,0** |
| Plantado, una vez y temprano | 79,8 → **75,0** | 75,6 → **73,3** |
| Normal: sube y baja con el compañero | 77,1 → **76,7** | 73,6 → **73,1** |
| Normal, y se prepara temprano | 82,7 → **82,5** | 84,0 → **81,6** |

**Dobles, con Chela contra Beto y Romina**

| Jugador | Alcance de hoy | Alcance real |
| --- | --- | --- |
| Plantado, apretando sin parar | 74,1 → **71,8** | 76,0 → **69,2** |
| Plantado, una vez y temprano | 72,1 → **69,6** | 72,5 → **67,3** |
| Normal: sube y baja con el compañero | 72,0 → **69,5** | 64,3 → **63,4** |
| Normal, y se prepara temprano | 79,6 → **76,6** | 72,6 → **76,1** |

**1 contra 1** (sin compañero: solo cuentan el golpe que compromete y los globos que te tiran por quedarte)

| Jugador | Contra Beto (hoy / real) | Contra Romina | Contra Chela |
| --- | --- | --- | --- |
| Plantado, apretando sin parar | 79,1 → **78,1** / 78,4 → **77,2** | 65,3 → **45,7** / 58,3 → **40,1** | 36,0 → **54,9** / 38,8 → **53,5** |
| Plantado, una vez y temprano | 81,2 → **74,3** / 75,2 → **68,1** | 59,6 → **46,1** / 53,9 → **38,5** | 39,8 → **33,4** / 34,5 → **31,2** |
| Normal | 78,4 → **78,7** / 70,4 → **70,5** | 60,4 → **60,4** / 50,8 → **51,4** | 63,7 → **63,6** / 54,4 → **53,1** |
| Normal, y se prepara temprano | 88,7 → **88,7** / 87,9 → **87,9** | 78,4 → **78,8** / 71,4 → **71,1** | 80,0 → **81,0** / 74,5 → **73,5** |

En 1 contra 1 plantarse queda muy por debajo de jugar bien contra Romina y Chela. Contra Beto, el profe que da pelotas cómodas, rinde lo mismo que el jugador normal (78 %) y 10 puntos menos que el que se prepara temprano. Contra Chela, el que aprieta sin parar sube (36 → 55 %): es un efecto del jugador simulado (con las piernas lentas mientras pega al aire se corre menos detrás de la pelota, y su forma de correrse es mala), no algo que paga de verdad; el mismo jugador apretando una vez baja (40 → 33 %).

**Qué pasa con el que se planta** (dobles con Beto, plantado apretando sin parar; alcance de hoy / real):

- **Golpes perfectos:** 20 % → 1 % / 21 % → 1 %. Golpes al aire: de unos 380 por partido a unos 145 (cada uno dura el golpe entero).
- **Globos por arriba suyo:** 4,9 → 13,3 por partido / 3,5 → 11,9. Esos puntos los gana el 24 % / 21 % (antes 36 %). El compañero juega el 47 a 48 % de esos globos (antes 36 a 45 %).
- **Pareja partida:** de 1 pelota por partido a 8 a 9. Esos puntos los gana el 57 % / 49 % (antes 66 % / 63 %).
- **El compañero que cruza:** forzado en el 15 % / 14 % de esos golpes (antes 7 % / 13 %), con presión de la pelota casi nula: los globos de la computadora le dejan tiempo.
- **Volea a los pies:** unas 3 por partido, presión media 0,6: sale floja y hacia arriba, como antes.

**Qué dicen:**

- **Plantarse y apretar sin parar gana claramente menos que jugar bien:** 9 a 13 puntos menos que el jugador normal que se prepara temprano con Beto de compañero, 7 menos con Romina y 5 a 7 menos con Chela. Contra el normal que mide el momento con manos promedio queda parejo con Beto y Romina (±2) y algo arriba con Chela (+2 a +6): ese jugador pierde puntos por soltar tarde, no por cómo se para (ver las decisiones).
- **Apretar sin parar no gana más que apretar una vez y temprano** (±3, dentro del ruido). Sí gana más que apretar una vez a tiempo con manos promedio, por lo mismo: quien mide el momento a veces suelta tarde.
- **El juego normal no empeora:** el jugador normal y el que se prepara temprano quedan igual, dentro del ruido (de −3 a +3). El que a veces se adelanta al golpe rival también: unas 11 veces por partido aprieta antes, dos de cada tres le quedan armadas para esa pelota, y gana lo mismo que el normal.
- **Las señas:** con el jugador normal, las pelotas con seña mostrada de Beto pasan de 21 % a 23 %; el «¡atrás!» aparece unas 2 veces por partido.

## Qué probar en el celular

Con `?dobles&alcance=real`:

1. **Apretá sin parar** con la pelota del otro lado: el jugador tiene que pegar al aire entero y moverse más lento mientras tanto. Que se sienta torpe apretar de más, no que el juego no responda.
2. **Apretá justo antes de que pegue el rival**, como quien se adelanta: tiene que quedar armado para esa pelota, no pegar al aire.
3. **Apretá temprano y volvé a apretar hacia otro lado** antes de que llegue: tiene que ir hacia el lado nuevo.
4. **Quedate en la red cuando te tiran un globo:** Beto te tiene que decir «¡atrás!», cruzar si no vas, quedarse atrás llamándote, y los rivales te tienen que tirar más globos.
5. **Bajá cuando te tiran un globo:** que el juego normal se sienta igual que antes.
6. **El «¡atrás!» de Beto mientras se mueve o arma un golpe:** en las capturas se lee menos que en el estudio (ver abajo).

## Decisiones que te quedan

| Decisión | Hoy | Recomendación |
| --- | --- | --- |
| **¿Prepararse temprano tiene que valer tanto?** Es lo que más gana, en todas las casillas: el jugador normal que se prepara temprano le saca el 72 % de los puntos a Romina y Chela con Beto, contra el 60 % de quien mide el momento con manos promedio (en 1 contra 1, 79 a 89 % contra 60 a 79 %). Apretar sin parar ya no da perfectos: hoy equivale a prepararse temprano. | Temprano = golpe bueno, como decidiste. Medir el momento solo agrega el perfecto (alrededor de 3 de cada 10 golpes) y el riesgo de soltar tarde, que en la red es perder la pelota. | **Probarlo así en el celular.** Si apretar sin parar sigue sintiéndose fuerte, la perilla es que un golpe armado mucho antes salga un poco menos preciso que uno a tiempo (`shots.quality.early`), sin llegar a lo tarde. Es tocar algo que te gustó, por eso no lo hice solo. |
| **¿El compañero deja pasar el globo si te quedás?** | No: te dice «¡atrás!» y, si no vas, cruza tarde. Antes un cuarto a un tercio de esos globos no los tocaba nadie. | **Así.** Dejarla pasar se siente injusto, y el costo de quedarte ya lo pagás con la pareja partida y los globos que te tiran. |
| **¿El hueco nuevo también entre parejas de la computadora?** | Solo contra una pareja con una persona (`PERSON_PAIRS_ONLY`), para no cambiar la demo ni el estudio. | **Sí, cuando la anatomía resuelva la «baja» con la cadera a 127°** que aparece con la demo nueva. Es la misma regla para todos; hoy la diferencia solo se ve en la demo. |
| **¿Cuánto te leen los rivales?** Te tiran más globos por cada vez que te quedás (`HABIT_LOB`: un 20 % más por vez, hasta un 60 %), todos por igual. | Así. | **Afinarlo jugando:** que se note que te buscan arriba, sin que parezca que solo saben tirar globos. Si se quiere más personalidad, que Chela, que lee el juego, te lea antes que Romina. |
| **¿Las piernas a media velocidad durante el golpe al aire?** (`AIR_LEGS`) | 0,5. | **Así**, y mirarlo en el celular: tiene que sentirse como un golpe que te comprometió, no como un joystick trabado. |
| **El «¡atrás!» mientras el compañero se mueve o arma un golpe** | En las capturas se lee menos que en el estudio: el brazo libre queda a la altura del hombro mientras la pala está arriba. | **Pedírselo a la sesión de señas**: que el «¡atrás!» se lea también en movimiento, o que el compañero lo diga antes de empezar a correr. |
| **1 contra 1** | Plantarse ya no paga contra Romina y Chela; contra Beto rinde como jugar normal, sin prepararse temprano. | **Ver «Cruzado»** (la decisión pendiente de `docs/dobles.md`): en cancha entera, quedarse en la red y apretar temprano sigue rindiendo contra Beto y Romina. |

## Rendimiento, peso y versión

- El código del juego pasa de 100,2 a 101,4 KB comprimido. La descarga sigue lejos de 1 MB.
- Lo nuevo por paso de simulación es una vuelta por los jugadores para el golpe al aire; la lectura de globos mira la pelota una vez por globo, y el segundo vistazo del compañero calcula dos contactos más una sola vez por globo.
- `PHYSICS_VERSION` pasa de 5 a 6: los mismos toques ahora dan otro partido. Una partida guardada de 1 contra 1 con la versión vieja se descarta.
- La simulación sigue siendo determinista: la misma semilla y los mismos toques dan el mismo partido. Los partidos solo de computadora dan idénticos a `main`, golpe a golpe, con los dos alcances.
