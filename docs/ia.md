# IA humana: compañeros y rivales que aciertan y fallan como personas

**En una línea:** el compañero ya no se queda mirando una pelota que es suya, y la computadora falla cuando vos se la hacés difícil: la sacás de su lugar, le cambiás el ritmo, la sorprendés o le dejás una pelota baja, rápida o en un rincón. Una pelota cómoda casi nunca la falla. Y el compañero tiene actitud: agresiva, equilibrada o pasiva.

**Cómo probarlo:** `?dobles&alcance=real` como siempre, más `?actitud=agresiva` (o `equilibrada`, `pasiva`) para tu compañero y `?rivales=pasiva` (o las otras) para la pareja de enfrente. En Opciones → Experimental → Dobles hay una fila nueva, **Actitud**, con tres canchitas dibujadas. Una vez publicado: `https://nahuelalegre.github.io/padel/?dobles&alcance=real&actitud=agresiva`.

**Dos vueltas.** La primera arregló al compañero, les dio motivo a los errores y sumó las actitudes. La segunda hizo que el error lo provoque tu táctica (sección 2), que la computadora no sostenga un plan vencido (sección 3) y arregló un smoke que fallaba a veces (sección 4).

---

## 1. El compañero que se quedaba quieto

Lo que viste («la pelota iba en línea recta a mi compañero y no hacía nada, como si esperara que yo hiciera algo») tenía cinco causas. Las reproduje con partidos enteros, al revés y al drive, con los dos alcances, con una persona simulada que juega posicional y con una que se queda quieta.

| Causa | Qué pasaba | Arreglo |
| --- | --- | --- |
| **Se congelaba mientras leía la pelota** | Beto tarda 0,34 s en leer una pelota. Una víbora a 24 m/s le llega al cuerpo en 0,35 s. Mientras leía no se movía. Cuando terminaba ya no tenía tiempo de ponerse al costado, así que planeaba otra pelota (la salida del vidrio) y la de su cuerpo pasaba de largo. | **Reflejo**: una pelota que le pasa al alcance antes de leerla la bloquea desde donde está, a partir de la mitad de su reacción (0,12 a 0,2 s). El bloqueo sale al medio y flojo, y a veces se va: es una pelota al cuerpo. |
| **Su golpe podía caer después de que la pelota muriera** | El momento del golpe tenía un error al azar de ±0,1 a 0,2 s. Si caía después del segundo pique no había golpe: corría hasta la pelota y se quedaba mirando. Los rivales también: era un «error» invisible que regalaba puntos. | **Siempre le pega**: si su cuerpo iba a llegar después de que la pelota muera, igual le pega, en el último momento, y no le llega («no llegó»). Se ve el golpe al aire. |
| **La del medio era tuya aunque fuera a su cuerpo** | La regla del medio (la toma la derecha que da al medio: vos, al revés) miraba cuánto se apartaba la pelota del centro de la pareja, no a quién iba. Con la pareja cerca, una pelota que pasaba a 0,7 m de él y a 2 m de vos era «tuya», y te decía «¡tuya!». | **La que va al cuerpo es de ese**: una pelota que pasa a un paso de uno (1,3 m) y claramente lejos del otro (0,9 m más) es suya, digan lo que digan el lado y el medio. La regla del medio queda para las que pasan entre los dos. |
| **Miraba una sola vez** | Decidía de quién era al golpe del rival y la revisaba una vez. Si después no ibas, o ibas para otro lado, nadie volvía a mirar: «nunca te roba» se cumplía al pie de la letra, y la miraba pasar. | **Vigila la pelota todo el tiempo** (unas 20 veces por segundo). Si la pelota terminó yendo a él y no a vos, la toma desde donde está. Si no vas (según cómo te movés, no lo que pensás), la cubre cuando faltan 0,8 s. Y en el último momento (0,3 s) pone la pala en una que le pasa al alcance y a la que no llegás. Siempre dice «¡mía!» antes, con 0,12 s como mínimo. |
| **«Te la pasa» con cuentas de máquina** | Si su carrera perfecta no llegaba, te la pasaba («¡tuya!») cuando vos «podías» en una carrera perfecta sin tiempo de reacción, aunque la pelota le pasara a 35 cm. | Te la pasa solo si no le llega ni estirándose y vos llegás con 0,3 s de margen. |

**Te da tiempo de arrancar** (segunda vuelta): el compañero no decide que no vas antes de 0,4 s desde el golpe rival. Con una pelota rápida podía decidirlo cuando todavía nadie había tenido tiempo de reaccionar, y te la sacaba.

**La regla, con su test** (`tests/ai.test.ts`): una pelota que pasa al alcance del compañero, a la que tenía que pegarle (si no, se pierde el punto), y que pasa más cerca de él que de vos, nunca queda sin que nadie de la pareja la intente. Se prueba en 8 partidos (revés y drive, los dos alcances, una persona quieta y una posicional), con las tres actitudes y entre cuatro computadoras.

**Antes y después** (30 partidos por casilla, vos posicional y Beto contra Romina y Chela; `npm run sim`, informe `doubles`, línea «le pasa al lado y nadie la intenta»):

| Pelotas del compañero que nadie intentó | Antes | Primera vuelta | Ahora |
| --- | --- | --- | --- |
| Revés, alcance real | 15 en 30 partidos (0,50 por partido) | 2 (0,07) | **2 (0,07)** |
| Revés, alcance actual | 13 (0,43) | 2 (0,07) | **3 (0,10)** |
| Drive, alcance real | 16 (0,53) | 2 (0,07) | **1 (0,03)** |
| Drive, alcance actual | 13 (0,43) | 1 (0,03) | **2 (0,07)** |
| Vos corriendo a todas, revés, real | 12 (0,40) | 2 (0,07) | **5 (0,17)** |
| Cuatro computadoras medias, real | 52 y 47 (1,7 por partido) | 9 y 10 (0,3) | **2 y 2 (0,07)** |

Las que quedan son de otra clase. Con vos en la cancha: pelotas del medio a las que vos ibas y en las que fallaste el golpe, y él te las dejó porque llegabas. Entre computadoras: la pareja rival desordenada que se mira y no va ninguno, que es a propósito y se castiga (`docs/dobles.md`, sección 3).

## 2. El error lo provocás vos

**La regla:** una pelota cómoda casi nunca se falla; una que le exigiste con tu colocación, mucho más seguido. En la primera vuelta el error dependía de con cuánto margen llegaba la computadora a la pelota, y ese apuro le llegaba igual contra quien jugaba con táctica que contra quien no. Por eso la táctica pagaba menos: contra Romina +10 → +4 y contra Chela +20 → +8. Ahora el error sale de lo que hizo el otro.

**Qué hace exigente una pelota** (`demandOf`, en `src/control/ai.ts`). La computadora lo calcula en cuanto planea el contacto:

| | Qué mide | Cuánto suma |
| --- | --- | --- |
| **La pelota** | Su presión donde la va a pegar: baja en la red, al ras del piso, rápida, estirada, encajonada en un rincón, por arriba de la cabeza yendo para atrás, apuntada cerca de las líneas. Es la presión que ya existía, calculada con el contacto que planea. | 0 a 1 |
| **El tiempo** | Lo que le sobra después de leerla con una reacción normal (0,25 s: si ella es lenta para leer, no es mérito tuyo) y de correr hasta ahí con sus piernas. Con 0,15 s de sobra no suma nada; con 0,15 s de menos, todo. Es lo que logran la colocación y el ritmo: sacarla de su lugar. | hasta 0,6 |
| **El cambio de ritmo** | La diferencia de velocidad con la última pelota que pegó. Con 8 m/s suma todo. | hasta 0,3 |
| **La sorpresa** | Cuánto más que su reacción tardó en leerla: una chiquita estando atrás, o un golpe perfecto que esconde adónde va. | hasta 0,4 |

Se suman, con un tope de 1,5. **Lo que le hace al golpe crece con el cuadrado**, así que una pelota de peloteo casi no lo mueve y la que trabajaste sí:

| | Cómoda (0) | De peloteo (0,3) | Exigida (1) |
| --- | --- | --- | --- |
| Error de timing, en veces el de sus manos | 0,5 | 0,8 | 3,5 |
| Cuánto llega tarde, en veces el error de sus manos | 0 | 0,14 | 1,5 |
| Cuánto se desvía la pelota | 0,75 | 1 | 3,75 |

Las manos de Chela tienen 0,09 s de error. Con una pelota cómoda queda en 0,05 s, y no la falla. Con una exigida queda en 0,32 s y llega 0,14 s tarde: cuatro de cada diez no le salen, y las que salen, salen flojas o desviadas. Beto (0,2 s) se quiebra antes: con una exigida falla más de la mitad.

Desde 0,45 el golpe cuenta como **forzado** (`hit.why === 'forced'`; antes era `'hurried'`), y solo entonces el que pega fuerte y lee poco **va por todo**: Romina en el 23 % de esas pelotas, Beto en el 7 %, Chela nunca, porque globea. Con una pelota cómoda nunca va por todo (hay un test). Un **bloqueo al cuerpo** no cuenta la exigencia: tiene su propio error, un poco más ancho que el de sus manos, y sale más desviado que una pelota común.

### Lo que paga la táctica

Persona simulada con las mismas manos, sin táctica y con táctica (posicional, en dobles); 30 partidos por casilla. `npm run sim`, informes `depth` y `doubles`. «Antes» es el motor de antes de la IA humana.

| | Antes | Primera vuelta | Ahora | Meta |
| --- | --- | --- | --- | --- |
| **1 contra 1** (partida rápida, alcance actual), persona promedio: contra Beto | 72 → 79 % (+7,8) | 59 → 76 % (+16,3) | 65 → 76 % (**+10,8**) | lo de antes |
| contra Romina | 61 → 71 % (+9,6) | 61 → 65 % (+4,2) | 50 → 66 % (**+16,4**) | +10 |
| contra Chela | 31 → 50 % (+19,6) | 37 → 45 % (+8,0) | 46 → 66 % (**+20,1**) | +19 |
| segundos por punto, con táctica | 9,6 / 11,4 / 19,1 | 12,1 / 11,1 / 21,9 | **10,0 / 11,7 / 14,6** | 8 a 14 |
| **Dobles** (revés, alcance real, Beto de compañero contra Romina y Chela): principiante | 30 → 47 % (+17,2) | 42 → 54 % (+12,1) | 29 → 45 % (**+15,9**) | +17 |
| promedio | 46 → 58 % (+12,3) | 53 → 64 % (+10,1) | 35 → 54 % (**+18,8**) | +12 |
| experta | 65 → 73 % (+7,8) | 70 → 74 % (+3,2) | 59 → 72 % (**+12,8**) | +8 |
| segundos por punto, posicional | 13,2 / 15,7 / 17,7 | 11,6 / 11,5 / 11,3 | **11,9 / 14,1 / 14,0** | 8 a 14 |
| 1 contra 1 con el alcance real: contra Beto / Romina / Chela | +14,3 / +8,4 / +8,7 | +10,2 / +1,5 / +9,5 | **+14,9 / +14,2 / +13,8** | — |

**Qué quiere decir:**

- **La táctica paga lo de antes o más** en todas las casillas menos una. El principiante en dobles suma +15,9 contra +17,2 de antes: está dentro del ruido de 30 partidos, que es de unos ±5 pp.
- **Los puntos quedan en la meta**, o apenas arriba: contra Chela 14,6 s (antes 19,1) y en dobles 14,0 a 14,1 s (antes 15,7 a 17,7).
- **Sin táctica cuesta más que antes**: contra Romina, 61 → 50 %; en dobles el promedio, 46 → 35 %. Con táctica quedás cerca de antes. La diferencia entre jugar pensando y no es más grande.
- **Chela quedó más fácil:** sin táctica le sacás el 46 % de los puntos (antes 31 %) y con táctica el 66 % (antes 50 %). Hoy cuesta lo mismo que Romina. Es la primera decisión de la sección 9.

### Cómo se ven los errores

**Por qué falla la computadora** (1 contra 1, alcance actual, persona promedio con táctica; cuando el punto termina en un error suyo, a la red o afuera):

| | Beto | Romina | Chela |
| --- | --- | --- | --- |
| Forzado: una pelota que le exigiste | 62 % | 33 % | 84 % |
| Fue por todo con una exigida | 14 % | 14 % | — |
| Punto largo (la tensión, y la impaciencia de Romina) | 10 % | 27 % | 9 % |
| Sin un motivo que se vea | 14 % | 26 % | 7 % |
| Golpes al aire («no llegó»), por partido | 8,7 | 7,0 | 8,2 |
| De esos, a pelotas a las que había llegado | 2,7 | 1,7 | 2,1 |

- Los errores sin motivo de Romina son su estilo: pega plano y fuerte desde cualquier lado y deja poco margen.
- **Los golpes al aire** son los puntos que termina sin llegar: el 82 a 88 % de los puntos que pierden Beto y Chela, y el 63 % de los de Romina. Unos siete de cada diez son intentos desesperados a una pelota que no alcanzaba. El resto, unos 2 por partido, son pelotas a las que llegó con tiempo pero le pegó tan tarde que ya habían pasado. Tu compañero, que de tu lado juega más parejo, tiene 3,7 golpes al aire por partido, 1,7 a pelotas a las que había llegado. Es lo que más conviene mirar en el celular (sección 7).

**Lo que probé y no quedó:**

- **La entereza de Chela** (que una pelota tenga que ser más exigente para forzarla, según su `composure`, la más alta del elenco). La vuelve tan difícil como antes: sin táctica le sacás el 31 % de los puntos. La táctica paga más (+25). Pero sus puntos pasan de 14,6 a 17,6 s, y los de dobles, a 15 o 16 s.
- **Que el golpe tarde de alguien que ya llegó pueda pegarle**, flojo, en vez de pegarle al aire. Saca casi todos los golpes al aire a pelotas a las que llegó (de 81 a 14 en 30 partidos contra Beto). Pero Beto queda mucho más difícil sin táctica (49 % de los puntos en lugar de 64 %) y los puntos contra Chela suben a 16,8 s. Al compañero casi no le cambia (1,7 → 1,5 por partido).
- **Que suelte la pelota para jugarla después del vidrio** cuando no llega: la computadora gana demasiado (Beto contra una persona sin táctica: 41 % de los puntos en lugar de 61 %).

Las dos primeras quedan como decisiones, con sus números (sección 9).

**Las metas del documento de profundidad:**

| Meta | Antes | Primera vuelta | Ahora |
| --- | --- | --- | --- |
| **Puntos que terminan en error** (55 a 65 %), 1 contra 1, alcance actual, contra Beto / Romina / Chela | 10 / 37 / 18 % | 22 / 56 / 29 % | 14 / 31 / 20 % |
| Lo mismo, dobles, revés, alcance actual / real | 40 / 23 % | 56 / 24 % | 32 / 25 % |
| **Puntos de 8 a 14 s**: dobles, revés, real / actual | 15,7 / 20,0 s | 11,5 / 16,2 s | **14,1 / 14,7 s** |
| Cuatro computadoras (Beto y Chela contra Romina y Chela), real | 22,2 s | 16,4 s | 19,9 s |
| 1 contra 1 contra Chela, actual / real | 19,1 / 14,2 s | 21,9 / 12,0 s | **14,6 / 14,8 s** |

Los puntos que terminan en error bajaron respecto de la primera vuelta porque ahora lo que más falla la computadora es un golpe al aire, tarde, y el informe lo cuenta como «no llegó», no como error.

## 3. Planes vencidos

**Qué pasaba** (lo pidió la sesión de animación): a veces una computadora mostraba el golpe armado para su contacto planeado, seguía esperando 0,10 a 0,15 s después de esa hora sin pegar, y después pegaba otra pelota a más de un metro. Por ejemplo, preparaba una volea y pegaba la salida del vidrio. Ningún cuerpo puede prepararse para eso.

**Por qué:** la hora del golpe tenía su error de timing, pero el armado mostraba la hora planeada. Si el golpe iba a llegar tarde, el armado se quedaba esperando en un contacto vencido. Y si su cuerpo no llegaba antes de que la pelota muriera, se quedaba con ese plan hasta que vencía, y entonces planeaba la pelota siguiente.

**Arreglo:**

- La computadora decide cuándo va a pegar en el momento en que planea el contacto, y el armado muestra ese golpe desde el principio (`PlayerIntent.meetAt`). Si va a pegar tarde, la pala se prepara para donde va a estar la pelota en ese momento, y ahí pega.
- Si su cuerpo va a llegar después de que la pelota muera, o más de 0,24 s después de su contacto, igual le pega: en el último momento, donde esperaba la pelota, y no le llega (`ShotIntent.late`, que ya viene en el golpe que muestra el armado). Nunca sostiene un plan vencido ni salta a otra pelota.

**Medido:**

| | Primera vuelta (`main`) | Ahora |
| --- | --- | --- |
| Armados vencidos: el golpe sigue armado más de 0,05 s después de su contacto, por partido y lado (dobles, revés, alcance real) | 4 a 21 | **0** |
| Lo mismo, cuatro computadoras medias | 16 y 17 | **0** |
| El cuerpo se desliza pegando parado, p90: 1 contra 1 actual / real, dobles actual / real (informe `reach`, 12 partidos por casilla) | 21 / 21 / 17 / 16 cm | **5 / 1 / 1 / 0 cm** |
| La pala queda de la pelota, p90 | 39 / 29 / 25 / 17 cm | **26 / 20 / 14 / 14 cm** |
| El cuerpo se desliza pegando a la carrera, p90 | 52 / 39 / 66 / 48 cm | 53 / 48 / 56 / 50 cm |

Pegando parado, el deslizamiento que quedaba salía casi todo de estos planes, como había medido la sesión de animación. A la carrera no cambia: falta la estocada al final de la carrera, que es de la animación.

## 4. El smoke que fallaba a veces

**Qué fallaba:** en una de tres corridas, «vos pegás y tu compañero también (0 tuyos, 1 de Beto)». No era el compañero sacándote pelotas. El bot del smoke solo juega las pelotas que le tocan, y en esa corrida hubo un solo golpe cerca de la pareja en 3 puntos: los puntos pueden ser muy cortos.

**Arreglo:** el smoke sigue jugando hasta que pegaron los dos (o hasta 10 puntos). Y, aparte, el compañero te da 0,4 s para arrancar (sección 1).

**Otra verificación que fallaba a veces:** «arrastrar despacio mueve al jugador» falló una vez en tres corridas (se movió 0,16 m en lugar de 1,5). El arrastre empezaba justo después del último golpe de la prueba anterior, sin esperar a que tu jugador se parara, y duraba un tiempo fijo de reloj, que con la máquina cargada es menos tiempo de juego. Cualquiera de las dos cosas lo explica. Ahora empieza con el jugador parado y dura siempre el mismo tiempo de juego.

**Medido:** con los dos arreglos, las tres corridas pasan las 125 verificaciones. En las tres pegaron los dos de la pareja (de 6 a 12 golpes tuyos y de 5 a 11 de Beto).

## 5. Actitudes

**Las tres, en la cancha:**

| Actitud | Cómo juega con vos | Cómo se ve |
| --- | --- | --- |
| **Agresiva** | Te sigue a la red antes (cuando estás a 6,2 m de la red) y tarda en bajar (0,9 s). Detrás de un golpe de ataque suyo sube aunque estés atrás. Va a la red y la aguanta: 60 % del camino hacia siempre, y define más. Y a veces **te pide la pelota**: una alta que remata en la red, una a la que llegás apurado o una que podés dejar picar y él volea. Siempre dice «¡mía!» antes, como mínimo 0,25 s antes de tu golpe. A veces se equivoca robando, porque calcula su margen como la gente que roba: 0,1 s de más, con ±0,15 s de error. | «¡Arriba!» cuando sube solo. La mano arriba («¡mía!»). Más pelotas desde la red. |
| **Equilibrada** | Su lado y el medio según la regla, y te cubre lo que no llegás. Es el compañero de antes, con el arreglo de la sección 1. | «¡mía!» y «¡tuya!» solo en las dudosas. |
| **Pasiva** | Te sigue a la red tarde (cuando ya estás a 4,2 m) y baja enseguida (0,15 s). Va menos a la red, globea más y no define: te la deja. En el medio te deja la pelota aunque sea de su derecha. Cubre solo lo que le viene al cuerpo (1,3 m), y en el último momento pone la pala si no llegás. | Te señala («¡tuya!») en las del medio. |

**Medido** (30 partidos por casilla, Beto con cada actitud, vos promedio):

| | Agresiva | Equilibrada | Pasiva |
| --- | --- | --- | --- |
| Revés, real: tus puntos posicional (lo que paga) | 57 % (+15) | 54 % (+19) | 56 % (+19) |
| Revés, actual | 70 % (+21) | 61 % (+18) | 62 % (+21) |
| Drive, real | 55 % (−4) | 50 % (−3) | 47 % (+2) |
| Drive, actual | 62 % (−6) | 64 % (+2) | 61 % (+9) |
| «¡Mía!» por partido (revés, real) | 2,4; salen bien el 96 % | 0 | 0 |
| Tu pareja desde la red (revés, real) | 43 % | 33 % | 36 % |
| Juntos (revés, real) | 78 % | 75 % | 73 % |
| Segundos por punto (revés, real) | 12,2 | 14,1 | 13,5 |

«Salen bien» quiere decir que la pelota que robó obligó al rival a devolverla o ganó el punto. Las que robó y fueron error, o a las que no llegó, son el 4 %.

**Qué dicen.** Al revés, jugar posicional paga +19 con la equilibrada y la pasiva: si no hacés tu parte, no la hace nadie. Con la agresiva paga un poco menos (+15), porque te cubre y te roba. Al drive, jugar posicional casi no paga con ninguna. Las tres ganan parecido: la actitud cambia cómo se juega, no cuánto se gana.

**Personaje y actitud.** El personaje es cómo juega: sus manos, sus piernas, sus golpes, sus manías, su gesto delator y sus frases. La actitud es cómo comparte la cancha. Cada uno tiene la suya de siempre, que encaja con su personaje:

- **Beto: equilibrada.** El profe juega su lado y el medio como se enseña, te cubre y avisa todo.
- **Romina: agresiva.** Sube, todo lo alto es suyo y te dice «¡mía!» más de lo que querrías.
- **Chela: pasiva.** Te devuelve todo desde atrás y te deja la red y lo dudoso.

Le podés pedir otra a cualquiera, y la recuerda: una Chela agresiva sigue siendo lenta y globeadora, pero sube y te pide las altas. La actitud nunca cambia sus manos ni sus piernas (hay un test). En 1 contra 1 no hay actitud.

**La pareja rival** usa las mismas actitudes, cada uno con la suya: Romina, agresiva, le pide a Chela las del medio y las altas, y se cruza a volear («cruzarse»). Contra Romina y Chela son 1,1 a 1,7 «¡mía!» por partido, y salen bien el 88 al 97 %. Con `?rivales=` se le puede dar a los dos la misma actitud para probar.

**Cómo se elige sin leer:** en Opciones → Dobles, después de «Compañero», tres botones con una canchita dibujada vista desde tu lado: la red, las líneas de saque, vos (un aro) y tu compañero (un punto lleno). En la agresiva tu compañero está arriba, en la red. En la equilibrada está a tu altura. En la pasiva está atrás, contra el vidrio. Debajo, una sola línea que la explica para quien quiera leer, y «Así juega Romina si no le pedís nada» bajo la actitud propia de cada uno.

**Lo que no está:** gestos propios de cada actitud. Usan los avisos que ya existen («¡mía!», «¡tuya!», «¡arriba!»). Un festejo de la agresiva cuando le sale el robo, o una disculpa cuando no, quedan como pedido a la sesión de animación.

## 6. Cómo se mide

`npm run sim` (informe `doubles`, archivo `tests/sim/doubles.sim.ts`) tiene líneas nuevas para cada casilla. Salen de `tests/probe.ts`, que mira el partido como alguien al lado de la cancha:

- **reacción**: cuánto tarda cada uno en tener adónde ir, con la media, el p10 y el p90, y cuántos bloqueos al cuerpo hubo;
- **le pasa al lado y nadie la intenta**: la regla de la sección 1, para tu compañero, para vos y para la pareja rival, con de quién era la pelota que nadie intentó;
- **«¡mía!»**: cuántas por partido de cada lado, según la actitud, y cuántas salen bien, al error o sin llegar;
- **por qué erran**: los puntos que terminan en error de cada lado, según el motivo (forzado, fue por todo, bloqueo al cuerpo, punto largo, no forzado);
- **no llegó**: los golpes al aire de la computadora;
- **planes vencidos**: cuántas veces por partido un golpe sigue armado después de su contacto, y cuánto;
- una tabla nueva: qué paga jugar posicional con cada actitud del compañero.

`SIM_ATTITUDE=agresiva` cambia la actitud del compañero y `SIM_ATTITUDES=no` saltea la tabla. El informe `depth` (1 contra 1) también dice por qué erran y cuántas veces no llegó la computadora. El informe `reach` es de la sesión de animación: mide qué hace el cuerpo para llegar, y es el que muestra los planes vencidos desde el dibujo (sección 3).

La simulación cambió en las dos vueltas: `PHYSICS_VERSION` pasó de 3 a 4 y ahora a 5. Una partida guardada con otra versión se descarta.

**Rendimiento.** La exigencia de una pelota se calcula una vez por contacto planeado, no en cada paso.

- **Un paso de la simulación de dobles** cuesta lo mismo que en `main`: 6,0 µs en promedio en las dos, con seis mediciones alternadas de cada una. En la primera vuelta había pasado de 4,2 a 5,9 µs, por la vigilancia de la pelota y la lectura.
- **Con `npm run perf -- --dobles`**, el trabajo del juego por cuadro sale igual dentro del ruido. Con dos jugadores en 3D y la CPU 6× más lenta, el build de `main` midió 1,3 y 2,4 ms en dos corridas, y esta rama 2,7 y 2,0 ms.
- **El código** pesa 0,5 KB más comprimido: 85,5 KB.

## 7. Qué probar en el celular

Con `?dobles&alcance=real` (y después con `&actitud=agresiva` y `&actitud=pasiva`), y la partida rápida de siempre:

1. **Hacele difícil la pelota al rival**: sacalo de la red al rincón contrario, cambiale el ritmo, tirale una chiquita cuando está atrás. Tiene que fallar bastante más que con una pelota cómoda, y tiene que notarse por qué. Con una pelota cómoda no te tiene que regalar nada.
2. **Los golpes al aire**: unos 2 por partido son a pelotas a las que la computadora llegó con tiempo y le pegó tan tarde que ya habían pasado. Si se lee como un error de persona («le pegó tarde»), queda. Si se ve roto, la alternativa está medida (sección 2).
3. **Chela**: si todavía se siente la más difícil. Hoy cuesta lo mismo que Romina.
4. **Tirale fuerte al cuerpo a tu compañero cuando está en la red**, o dejá que te tiren a vos al revés y mirá a Beto. No tiene que quedarse duro: bloquea, a veces mal.
5. **Quedate quieto** en una pelota del medio que va hacia él: tiene que tomarla, diciendo «¡mía!» con la mano arriba.
6. **Corré hacia una tuya**: no te la tiene que sacar (equilibrada y pasiva). Con la agresiva, mirá si los «¡mía!» se sienten divertidos o molestos (hoy son unos 2,4 por partido).
7. **Las tres canchitas de Opciones**: si se entienden sin leer la palabra.

## 8. Pedidos a la sesión de animación

Son datos que la simulación ya entrega. Falta dibujarlos:

- **Golpe forzado** (`hit.why === 'forced'`; en la primera vuelta era `'hurried'`): una pelota que le exigieron. Armado corto, el cuerpo todavía yendo, desequilibrado.
- **Bloqueo al cuerpo** (`plan.reflex`): la pala delante del pecho, sin armado.
- **Fue por todo** (`hit.why === 'gamble'`): el golpe plano y largo de alguien apurado.
- **No llegó**: la computadora le pega al aire (`anim.kind = 'whiff'`). Hay dos clases. La mayoría son una estirada a una pelota que no alcanza. Las otras, un golpe tarde donde esperaba la pelota, que ya pasó: el armado ya lo sabe (`cue.late`). Un gesto de «no llegué» vendría bien.
- **Golpe tarde**: el armado ya muestra la hora y el lugar reales del golpe (`anim.contactAt` y `anim.reach*`). Si va a pegar tarde, prepara la pala para donde va a estar la pelota.
- **Sorprendido** (`player.read` mayor que su reacción, por ejemplo con una chiquita): medio paso tarde en arrancar.
- **La presión acumulada** (`player.strain`, `player.pressure`): postura más agachada, como pedía el documento de profundidad.
- **Robo de la agresiva**: un festejo corto si sale y una disculpa si no.

## 9. Decisiones que te quedan

| Decisión | Recomendación |
| --- | --- |
| ¿Chela vuelve a ser la más difícil? Hoy le sacás el 46 % de los puntos sin táctica y el 66 % con táctica (antes 31 y 50 %). | **Probarlo jugando primero.** Si se siente fácil, su entereza la devuelve a 31 % sin táctica y hace pagar más la táctica (+25), pero sus puntos pasan de 14,6 a 17,6 s. Es un cambio chico y ya medido. |
| ¿Los golpes al aire a pelotas a las que llegó? Unos 2 por partido por rival, 1,7 de tu compañero. | **Mirarlo en el celular.** La alternativa, que pegue tarde y flojo, está medida: los saca casi todos de los rivales, pero hay que recalibrar porque Beto queda bastante más difícil (49 % sin táctica en lugar de 64 %). |
| ¿Cuánto roba la agresiva? Hoy, unos 2,4 «¡mía!» por partido. | **Así, y afinarlo jugando.** Si molesta, que robe solo las altas. |
| ¿Actitud por defecto de cada uno? | **Beto equilibrado** (el compañero por defecto y el que se enseña), **Romina agresiva**, **Chela pasiva**. |
| ¿La actitud en la pantalla de inicio, junto con el compañero? | **Sí, cuando el dobles sea la partida rápida**: tres canchitas al lado de la cara del compañero. Hoy está en Opciones → Experimental. |
| ¿Una persona puede pedir «¡mía!»? | **Más adelante.** Un toque largo en la pelota que viene, para jugar con un compañero pasivo sin que se quede mirando. |
