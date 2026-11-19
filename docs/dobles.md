# Dobles posicional y alcance real

Propuesta de diseño y prototipo jugable. La versión visual, con los diagramas de cancha, es el Artifact privado «Dobles posicional»; su fuente está en [dobles.html](dobles.html).

**En una línea:** en dobles cada pelota tiene dueño, la pareja va atada con una cuerda y nadie llega a lo imposible. Así la posición importa y no hace falta ser un velocista.

**Cómo probarlo:** `?dobles` abre la partida rápida en 2 contra 2 (vos al revés con Beto, contra Romina y Chela). `?alcance=real` le da a todos el alcance de una persona. `?lado=drive` y `?companero=chela` (o `romina`) cambian tu lado y tu compañero. Lo mismo está en **Opciones → Experimental**. La partida rápida de siempre no cambia.

---

## El principio: el alcance real es lo que hace que la posición importe

El usuario lo dijo así: reducir el alcance «es para forzar al jugador a jugar más posicional y que no se confíe en que va a llegar a todos lados. Y que juegue con el compañero. Y eso también aplicaría al enemigo, así como el enemigo puede castigar al jugador, el jugador puede castigar al enemigo».

Esto ordena todo lo demás:

1. **Si se llega a todo corriendo, la posición no vale nada.** Con el alcance real (1,15 m parado, 1,60 m con zancada, igual para todos), estar bien parado y con el compañero gana más que correr a todas. Medido con un jugador simulado de manos promedio, al revés y con el alcance real: jugar posicional le suma +12 pp contra correr a todas (+17 con manos de principiante, +8 de experto); con el motor de hoy le restaba 38.
2. **Jugar en pareja rinde.** Dejársela al compañero, cubrir cada uno su zona y subir juntos se ven en el resultado: con el motor de hoy, jugar así costaba −26 a −49 pp; ahora suma.
3. **Simetría total.** La pareja rival tiene el mismo alcance y las mismas reglas de posición que la tuya. Si vos te quedás mal parado, te castiga; si se queda mal parada ella, la castigás vos.
   - **A veces se desordena**, según su entereza (`composure`) y la presión que acumuló en el punto: uno sube y el otro se queda atrás, uno se queda en tierra de nadie, o dudan en una pelota al medio. Romina y Beto se desordenan seguido; Chela, casi nunca. Tu compañero nunca: la pareja la llevás vos.
   - **Se ve sin leer.** La pareja partida se ve en la cancha, y el que subió solo le hace señas al compañero. El que quedó en tierra de nadie está a mitad de cancha. Si la pelota va al hueco, se miran y se señalan los dos («¡tuya!», «¡tuya!»), y a veces no va ninguno.
   - **Se castiga.** La pareja rival está desordenada en uno de cada cinco golpes tuyos. Tirándole al hueco ganás el 74 % de esos puntos (contra una pareja ordenada, el 64 %), el 37 % en el acto, y el 21 % de esas pelotas ni las devuelve (ordenada: 8 %). Del otro lado, una pareja partida o con alguien en tierra de nadie pierde el punto en el acto 12 pp más seguido que una pareja junta: vale para la tuya y para la rival.
4. **En el prototipo se sienten las dos cosas:** con `?dobles&alcance=real`, quedarte en tierra de nadie o subir solo te cuesta pelotas a los pies y globos, y la pareja rival desordenada te deja huecos para ganar el punto.

## 1. Las reglas de posición del pádel, como reglas del juego

| Regla del pádel | En el juego | Por qué vale (medido, 30 partidos) |
| --- | --- | --- |
| **La red ataca, el fondo defiende.** | Subir es la forma de ganar puntos: voleas y remates. | Cuando una pareja está en la red y la otra atrás, gana la red el 73–76 % de los puntos (antes, 21 %). |
| **Atados con una cuerda.** Los dos arriba o los dos atrás. | Las parejas de la computadora suben y bajan juntas. Tu compañero sube cuando subís y baja cuando te quedás atrás. | Tu pareja está junta el 74 % del tiempo de pelota viva (antes, 49 %); la rival, el 87–89 % (antes, 77 %). |
| **El hueco.** Uno arriba y otro abajo deja una diagonal vacía. | La pareja rival lo busca: por arriba del que está en la red o al medio de la diagonal. | A una pareja partida le tira ahí el 64–85 % de las veces; a una junta, el 38–58 %. |
| **La tierra de nadie.** Entre la línea de saque y la red (5 a 6,5 m de la red). | Nadie de la computadora espera ahí. La pareja rival le tira a los pies a quien se queda. | A los pies el 35–69 % de las veces, según el rival. |
| **Deslizarse con la pelota** (basculación). | La pareja se corre en bloque hacia el lado de la pelota (30 % de su posición, hasta 1,2 m). El de ese lado cubre el paralelo; el otro se cierra al medio. En la red los dos están más juntos (3,6 m) que atrás (4,6 m). | Test: `se desliza con la pelota y se cierra en la red`. |
| **El medio es de la derecha.** | Una pelota que pasa a menos de 0,9 m del centro de la pareja es del que tiene la derecha hacia el medio: con dos diestros, el de revés. Si los dos o ninguno, el que está más adelante. Si el otro llega 0,3 s más cómodo, es del otro, y se avisa. | Test: `la del medio es de quien tiene la derecha hacia el medio`. |
| **Drive y revés.** | Elegís tu lado. El drive (derecha) construye; el revés (izquierda) toma el medio y casi todos los globos al medio. | — |
| **Subir después de un buen globo.** | Un globo que pasó por arriba de la pareja rival es la señal para subir los dos. | — |
| **Bajar ante un globo profundo.** | Si el globo pasa por arriba de la pareja en la red, los dos bajan. | — |
| **El cambio.** El globo pasa por arriba de uno; el otro, en diagonal, corre a buscarlo y el primero cruza. | El compañero cruza por un globo que te pasó por arriba si no estás yendo vos y llega 0,25 s más cómodo. Avisa antes. | Test: en partidos enteros, cada pelota tuya que pegó el compañero fue avisada. |

Todo esto vive en `src/sim/pair.ts` y no usa azar: el partido sigue siendo determinista (`PHYSICS_VERSION` pasó a 3).

## 2. El compañero

**Juega en pareja con vos.**

- **Te sigue.** Sube a la red cuando estás a menos de 5 m de la red. Baja cuando te quedás atrás casi medio segundo (0,4 s) o en el instante en que corrés para atrás detrás de un globo. A mitad de camino, espera a ver adónde vas. Nunca abre el hueco él: si no subís, no sube.
- **Cubre su mitad** y se desliza con la pelota. Si cruzás al otro lado, toma el lado que dejaste.
- **Nunca te roba.** Una pelota tuya la juega solo en dos casos, y siempre avisa antes: si no vas a llegar (la cubre) o si es un globo que te pasó por arriba y no estás yendo (el cambio). Una pelota que te dejó («¡tuya!») no la toca. Hay un test que juega partidos enteros y lo verifica golpe por golpe.
- **Es honesto con lo que no llega:** si una pelota suya no la alcanza y vos sí, te la pasa con un «¡tuya!».

**Cómo avisa, sin texto.** Con el brazo libre, el mismo gesto para todos los personajes, para que se aprenda una vez. Siempre es verdad.

| Aviso | Gesto | Cuándo |
| --- | --- | --- |
| ¡Mía! | La mano libre arriba de la cabeza. | Va a una pelota del medio, o a una tuya que no alcanzás. |
| ¡Tuya! | Te señala, con la cabeza hacia vos. | Una pelota del medio es tuya, o te pasa una que él no alcanza. |
| ¡Voy! | El brazo barre hacia tu lado: cruzá. | Cruza por un globo que te pasó por arriba. |
| ¡Arriba! | Te hace señas hacia la red. | Su globo pasó a la pareja rival y vos estás atrás. |
| ¡Atrás! | Señala por arriba del hombro. | Un globo les pasó a los dos y vos seguís en la red. |

Los avisos salen cuando el compañero terminó de leer la pelota (su reacción, 0,2 a 0,35 s después del golpe rival), así hay medio segundo o más para actuar. Duran 0,9 s. No dicen nada sobre las pelotas obvias de cada lado: la pantalla queda limpia.

**Su personalidad.** El mismo personaje que como rival, con su estilo y sus piernas, pero jugando a ganar y con manos más firmes (40 % menos de dispersión de timing, con tope de 0,07 s; 25 % menos de dispersión de golpes; lee la pelota un 25 % antes). Lo que propone `docs/personajes.md`, y todavía no está en el prototipo, donde los tres avisan igual: Beto «avisa temprano y siempre» y te deja definir; Romina sube y remata lo alto de su zona; Chela es la maestra de la pared y la que dice «¡arriba!» después de su globo.

**Tu lado.** Por defecto, **revés**: tomás el medio con la derecha, como el más fuerte de una pareja de pádel, y es el lado donde jugar posicional paga más (+8 a +25 pp al revés contra −3 a +3 al drive, con Beto de compañero y la rival que se desordena). Al drive, el medio es de tu compañero; se elige en Opciones o con `?lado=drive`.

## 3. La pareja rival

La dificultad sale de cómo decide, no de que llegue a todo: nadie corre más que una persona.

| Cómo está parada tu pareja | Qué hace la pareja rival |
| --- | --- |
| Alguien en tierra de nadie | Le tira a los pies (70 % de las veces). |
| Partida: uno arriba y otro abajo | Por arriba del de la red, o al medio de la diagonal. Más cuanto más sabe castigar (`punish`). |
| Los dos en la red | Globo (más a quien le gusta globear), chiquita a los pies, o bajo por el medio. |
| Los dos atrás | Al hueco y profundo (con la pareja bien parada, es el medio). Globo o chiquita para subir detrás. |
| Te dejó una pelota para atacar | Donde no hay nadie. |

Detrás del saque la pareja rival sube casi siempre (60 % como mínimo, más según su gusto por la red). Una pelota que se pega desde adentro de la cancha (a menos de 6 m de la red) lleva a la red a quien la pegó, como en el pádel. Dos de la misma pareja encima de la misma pelota se estorban: la pelota les sale más difícil.

**La pareja rival también se desordena**, y eso es lo que se le castiga. Pasa en los momentos de cambio y en las pelotas difíciles de repartir, más cuanto menos entereza tiene y más presión acumuló en el punto. Dura hasta que la pareja vuelve a pegarle a la pelota.

| Qué le pasa | Cuándo | Cómo se ve | Cómo se castiga |
| --- | --- | --- | --- |
| **Sube uno solo** (o baja uno solo) | La pareja cambia de lugar y uno no acompaña. | Uno en la red, otro atrás; el que fue le hace señas al otro. | Por arriba del que está en la red, o entre los dos. |
| **Se queda en tierra de nadie** | Acompaña y se frena a mitad de camino (5,8 m). | Uno a mitad de cancha. | A sus pies: queda clavado y la levanta. |
| **Dudan en el medio** | Una pelota por el medio, entre dos con poca entereza. | Se señalan los dos. | Por el medio: llegan tarde. |
| **Nadie sabe de quién es** | Una pelota que pasa lejos de los dos (a más de 2,2 m de cada uno) cuando están desordenados. | Se señalan los dos; a veces no va ninguno. | Al hueco. |

Con entereza 0,2 (Beto, Romina) una pareja se desordena unas 45 veces cada 100 golpes suyos, con la de Chela (0,78) 12 y con 0,9, 5. Los números están en `DISORDER` de `src/sim/pair.ts`. Nada de esto le pasa a una pareja con una persona: tu compañero no se desordena ni duda.

**Más adelante:** que la química de la pareja (además de la entereza de cada uno) decida cuánto dudan en el medio (`docs/personajes.md`, 3.5).

## 4. Un alcance de persona real

| | Hoy, la persona | Hoy, la máquina | Real, para todos |
| --- | --- | --- | --- |
| Parado, con el brazo y la pala | 1,79 m | 1,25 m | **1,15 m** |
| Estirándose o con una zancada | 2,23 m si suelta tarde | 1,60 m; 1,85 m tarde | **1,60 m**, y la pelota sale más floja |
| Por arriba de la cabeza | igual que abajo | igual que abajo | **se achica**: desde 1,7 m de altura hasta 0,75 m en el remate más alto (2,7 m) |
| La pelota más baja que se pega | 7,5 cm | 7,5 cm | **20 cm**; con zancada, 32 cm |
| Entre 20 y 50 cm | — | — | se pega flexionando y sale floja (la presión «contra el piso» que ya existe) |

**La regla de oro:** si el cuerpo no puede llegar en la animación, la simulación no deja pegar. Con el alcance real la pelota más lejana que se pega baja de 2,20 m a 1,56–1,60 m y las pelotas al ras del piso, de 8–11 % a 3–4 % de los golpes. El cuerpo dibujado alcanza eso con los clips que ya hay: la derecha toca la pelota a 0,96 m del cuerpo y la estirada a 1,39 m, a tamaño real, y los personajes se dibujan 1,2 a 1,5 veces más grandes.

**Qué falta en la animación** (medido con `npm run sim`, informe `reach`):

1. **El imán no es el alcance.** El cuerpo se desliza hacia la pelota una mediana de 67 a 76 cm, con el alcance de hoy y con el real por igual. La causa es la geometría: el clip de derecha toca la pelota 60 cm adelante del cuerpo y la simulación, 20 cm. Hace falta una **zancada de verdad**: el pie de atrás queda plantado, el de adelante da el paso y la pelvis baja, en lugar de mover el cuerpo entero. Y alinear dónde toca la pelota la simulación con dónde la tocan los clips.
2. **Flexión profunda** para las pelotas de 20 a 45 cm: hoy el cuerpo baja 36 cm como mucho y el remate y la bandeja no se agachan. Hace falta llegar a unos 55 cm, con la rodilla al piso en la pelota más baja.
3. **La estirada para 1,15 a 1,6 m:** el clip ya existe; hay que elegirlo por la distancia real y no deslizar encima.

El prototipo no fuerza nada de esto: el alcance real ya rige en la simulación y la animación sigue como está.

**¿Y el 1 contra 1?** Con el alcance real, cubrir 10 m de ancho solo es ser un velocista. Opciones:

| Opción | Qué es | Costo |
| --- | --- | --- |
| **Cruzado** (recomendada) | 1 contra 1 en media cancha, en diagonal, como el «cruzadito» que juega todo jugador de pádel para calentar. Cada uno cubre 5 m, lo mismo que en dobles, con el mismo alcance. | Reglas (el primer pique tiene que caer en la mitad cruzada), el apuntado en media cancha y una línea sutil. Sin arte nuevo. |
| Cancha angosta de 6 m | Las pistas individuales existen, de 6 × 20 m. | Hornear otra cancha (unos 130 KB más), paredes y cámara nuevas. |
| Alcance propio | El 1 contra 1 sigue con el alcance generoso. | Rompe la regla de oro: el cuerpo vuelve a llegar a lo imposible. |

## 5. La cámara con cuatro jugadores, en vertical

Las reglas de encuadre ya incluían a tu compañero y a los dos rivales; el prototipo las usa tal cual.

- **Acompaña:** el paneo sigue a tu jugador (62 % de su posición) y el zoom se abre lo que haga falta para que entren los cuatro, la pelota, dónde pica y tu vidrio de fondo. En la red se cierra si entran todos.
- **Fija:** la cancha entera.
- Medido en la prueba de punta a punta: en todo el partido de dobles, los cuatro, la pelota en juego y tu vidrio siempre quedaron en pantalla.
- Tu jugador se distingue del compañero sin anillo: es el que mueve tu pulgar, está siempre en tu lado (derecha o izquierda) y el compañero es un personaje con su ropa y sus piezas.

## 6. Cómo se aprende sin leer

Propuesta, todavía no está en el prototipo. Mismo formato que el tutorial actual: una situación, el profe tira la pelota, tres aciertos. Beto es tu compañero.

| # | Lección | La situación | Qué cuenta como acierto |
| --- | --- | --- | --- |
| D1 | Tu lado | Pelotas a cada mitad. Beto levanta la mano en las suyas. | Pegás las tuyas y dejás las suyas. |
| D2 | El medio | Pelotas por el medio. Beto avisa con la mano o te señala. | Le hacés caso al gesto. |
| D3 | Subir juntos | Tu globo pasa a la pareja rival; Beto te hace señas. | Llegás a la red con él antes del golpe rival. |
| D4 | El cambio | Un globo te pasa por arriba; Beto barre el brazo. | Cruzás al otro lado sin ir a buscarla. |
| D5 | Castigar el hueco | La pareja del profe se desordena a propósito: uno sube solo o se queda en tierra de nadie. | Le tirás al hueco o a los pies, y el punto se gana. |

**En el partido, las pistas son el compañero:** sus gestos ya dicen dónde ir. Como pista de una sola vez: si te quedás en tierra de nadie cuando el rival va a pegar, Beto te hace la seña de «arriba» o «atrás».

## 7. Cómo se mide que la posición importa

`npm run sim` tiene un informe nuevo, `doubles` (`tests/sim/doubles.sim.ts`), con un jugador simulado que pasa por los mismos controles que una persona. «Posicional» juega su lado, sube y baja con su compañero, hace caso a los avisos y tira donde no está la otra pareja. «Sin táctica» corre a todas las pelotas que puede y se queda atrás: el velocista.

Vos y Beto contra Romina y Chela, 30 partidos por casilla. «Antes» es el motor de hoy (el de `main`) con el mismo jugador simulado y el mismo arnés; «ahora» es esta rama, con vos al revés (el lado por defecto). Las manos son las del jugador promedio salvo donde dice otra cosa.

| Métrica | Meta | Antes | Ahora, alcance de hoy | Ahora, alcance real |
| --- | --- | --- | --- | --- |
| Cuánto paga jugar posicional (principiante / promedio / experto) | +15 pp | −26 / −38 / −49 (al drive) | +12 / +25 / +21 | +17 / +12 / +8 |
| Lo mismo, al drive | +15 pp | −26 / −38 / −49 | — | +3 / −3 / −1 |
| Castigando el hueco rival: ganás el punto | +10 pp sobre la pareja ordenada | — (no se desordenaba) | 83 % (ordenada, 76 %) | 74 % (ordenada, 64 %) |
| Castigando el hueco rival: no la devuelven | — | — | 18 % (ordenada, 6 %) | 21 % (ordenada, 8 %) |
| Un hueco (pareja partida o en tierra de nadie) pierde en el acto, de más | 10 pp o más | 7 pp | 11–12 pp | 12 pp |
| Red contra fondo: los gana la red | 60 % o más | 21 % (en el 5 % de los puntos) | 82 % (en el 41 %) | 68 % (en el 44 %) |
| Tu pareja, junta (tiempo de pelota viva) | — | 49 % | 74 % | 74 % |
| La pareja rival, junta | — | 77 % | 72 % | 71 % |
| Pelotas que nadie de tu pareja tocó (por el medio) | — | 232 (181) | 71 (42) | 141 (75) |
| Segundos por punto, media | 8 a 14 | 9,9 (los perdía rápido) | 20,0 | 15,7 |

La pareja rival junta baja de 77 % a 71 % a propósito: ahora se desordena, y eso es lo que se le castiga.

**El hueco y la tierra de nadie**, con pelotas tiradas a mano a una pareja quieta (porque en un partido, ahora, una pareja partida casi no aparece: 1 a 6 % de las pelotas):

| Rival | A una pareja partida: por arriba del de la red o al hueco | A una pareja junta, lo mismo | A los pies de quien está en tierra de nadie | A una pareja en la red, globo |
| --- | --- | --- | --- | --- |
| IA media | 64 % | 53 % | 51 % | 26 % |
| IA fuerte | 85 % | 38 % | 69 % | 36 % |
| Romina | 70 % | 45 % | 35 % | 15 % |
| Chela | 65 % | 58 % | 55 % | 52 % |

**Cuatro IA medias**, sin persona, con el alcance real: el punto termina con una pareja en la red y la otra atrás en el 40 % de los puntos (antes, 18 %), y ahí gana la red el 62 %; los puntos duran **12,6 s** (antes, 21,6 s).

**Con un compañero parejo** (IA media de compañero y de rivales, medido antes de que las parejas rivales se desordenaran), jugar posicional pagaba +5 / +16 / +12 pp con el alcance de hoy y +8 / +8 / +12 con el real.

**1 contra 1**, jugador simulado promedio con táctica, contra Beto / Romina / Chela:

| | Alcance de hoy (igual que antes) | Alcance real |
| --- | --- | --- |
| Cuánto paga la táctica | +8 / +10 / +20 pp | +14 / +8 / +9 pp |
| Puntos ganados | 79 / 71 / 50 % | 78 / 59 / 51 % |
| Segundos por punto | 9,6 / 11,4 / 19,1 | 8,0 / 9,3 / 14,2 |

Con el alcance de hoy el 1 contra 1 da exactamente los mismos números que antes, golpe por golpe: lo nuevo de dobles no lo toca.

**Qué dicen.** Antes, jugar posicional en dobles se pagaba caro: el compañero no compartía ninguna regla, la pelota del medio no era de nadie y la pareja no subía junta. Ahora paga, y paga de los dos lados: estar bien parado gana puntos y castigar a la pareja rival desordenada también. Paga sobre todo si tomás el medio (revés): +12 a +25 pp con manos de principiante y de promedio. Al drive con Beto, correr a todas rinde lo mismo que jugar posicional, porque vos sos mejor que Beto y cubrir más cancha compensa. Con manos de experto, castigar el hueco no suma: ese jugador gana casi todo igual. La meta de +15 pp se cumple en algunas casillas, no en todas. Los puntos con Romina y Chela siguen algo largos (16 a 20 s; Chela devuelve todo); con rivales parejos y el alcance real entran en la meta (12,6 s). En 1 contra 1, el alcance real acorta los puntos y achica lo que paga la táctica contra Chela (+20 → +9): solo en la cancha entera, gana más el que corre. Es otro argumento para el Cruzado.

## 8. Rendimiento

Trabajo del juego por cuadro (simular, animar los esqueletos con su cinemática inversa, la cámara y mandar a dibujar), con `npm run perf -- --dobles` en un Chrome headless que emula un celular (360 × 800, densidad 3), sobre un Ryzen 7 8700G:

| | CPU normal | 4× más lenta | 6× más lenta |
| --- | --- | --- | --- |
| 1 contra 1, en 3D | 0,15 ms | 0,53 ms | 1,14 ms |
| **Dobles, en 3D** (cuatro personajes) | **0,21 ms** | **0,80 ms** | **1,23 ms** |
| Dobles, en 2D | 0,13 ms | 0,57 ms | 0,93 ms |

Un cuadro a 60 fps tiene 16,7 ms. Ningún cuadro tardó más de 17,5 ms en ninguna de las doce mediciones. Lo que no mide es la placa de video de un celular: con cuatro personajes son el doble de mallas, contornos y sombras. Hay que mirarlo con `?dobles&fps` en un Android de gama media; si no llega, el ajuste de resolución automático ya baja la resolución interna.

## 9. Fases, riesgos y decisiones

**Fases.**

1. **Prototipo** (esta rama): reglas de pareja, compañero y pareja rival (que también se desordena), alcance real como interruptor, avisos con el cuerpo, opciones experimentales y mediciones.
2. **Animación:** zancada con el pie plantado, flexión profunda, geometría del contacto. Sin esto, el alcance real se juega bien pero se ve igual que hoy.
3. **Aprender dobles:** las cuatro lecciones, la pista de tierra de nadie, la elección de compañero en el inicio, las frases y festejos de pareja.
4. **Dobles por defecto:** si el usuario lo decide, la partida rápida pasa a dobles, se recalibran los rivales y el 1 contra 1 pasa a «Cruzado».

**Riesgos.**

- Con el alcance real hay que pararse bien, y el joystick en el celular puede quedarse corto. Solo se sabe jugando.
- Un compañero que se percibe tonto o que «roba» arruina el modo. Los avisos y la regla del medio son lo que hay que mirar en el celular.
- Al drive con Beto de compañero, que es lento, correr a todas paga lo mismo que jugar posicional. Al revés paga +8 a +25 pp.
- Cuánto se desordena la rival es un número a afinar jugando: hoy, una de cada cinco pelotas tuyas la encuentra desordenada. Si es poco no hay nada que castigar; si es mucho, parece torpe.
- Los puntos contra Romina y Chela siguen algo largos (16 a 20 s de media; la meta es 8 a 14): Chela devuelve todo.
- La brecha de +15 pp se cumple solo en algunas casillas, y es la de un jugador simulado: nadie midió todavía a una persona.

**Decisiones que te quedan.**

| Decisión | Recomendación |
| --- | --- |
| ¿La partida rápida pasa a ser de dobles? | **Sí, después de probarlo en el celular.** Es el pádel que jugás, y la posición se nota. El 1 contra 1 queda como opción. |
| ¿El alcance real para todos, también en 1 contra 1? | **Sí, junto con la zancada y la flexión** (fase 2). Probalo primero con `?alcance=real` para sentir la diferencia. |
| ¿Qué es el 1 contra 1? | **Cruzado**, en media cancha y en diagonal. |
| ¿Tu lado por defecto? | **Revés**: tomás el medio, como el más fuerte de una pareja, y es donde la posición paga más. Drive en Opciones. |
| ¿Quién es el compañero por defecto? | **Beto**, el profe, que avisa todo. Los demás se eligen después de haberlos enfrentado. |
| ¿Cuánto se desordena la pareja rival? | **Como ahora** (una de cada cinco pelotas tuyas, según la entereza de cada rival), y afinarlo jugando en el celular: que se note y que no parezca torpe. |
