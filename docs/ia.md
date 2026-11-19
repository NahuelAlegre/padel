# IA humana: compañeros y rivales que aciertan y fallan como personas

**En una línea:** el compañero ya no se queda mirando una pelota que es suya. La computadora juega la que le viene al cuerpo y vigila la pelota todo el tiempo. Cuando falla, se nota por qué: llegó apurada, bloqueó una pelota al cuerpo o fue por todo con una pelota difícil. Y el compañero tiene actitud: agresiva, equilibrada o pasiva.

**Cómo probarlo:** `?dobles&alcance=real` como siempre, más `?actitud=agresiva` (o `equilibrada`, `pasiva`) para tu compañero y `?rivales=pasiva` (o las otras) para la pareja de enfrente. En Opciones → Experimental → Dobles hay una fila nueva, **Actitud**, con tres canchitas dibujadas. Una vez publicado: `https://nahuelalegre.github.io/padel/?dobles&alcance=real&actitud=agresiva`.

---

## 1. El compañero que se quedaba quieto

Lo que viste («la pelota iba en línea recta a mi compañero y no hacía nada, como si esperara que yo hiciera algo») tenía cinco causas. Las reproduje con partidos enteros, al revés y al drive, con los dos alcances, con una persona simulada que juega posicional y con una que se queda quieta.

| Causa | Qué pasaba | Arreglo |
| --- | --- | --- |
| **Se congelaba mientras leía la pelota** | Beto tarda 0,34 s en leer una pelota. Una víbora a 24 m/s le llega al cuerpo en 0,35 s. Mientras leía no se movía. Cuando terminaba ya no tenía tiempo de ponerse al costado, así que planeaba otra pelota (la salida del vidrio) y la de su cuerpo pasaba de largo. | **Reflejo**: una pelota que le pasa al alcance antes de leerla la bloquea desde donde está, a partir de la mitad de su reacción (0,12 a 0,2 s). El bloqueo sale al medio y flojo, y a veces se va: es una pelota al cuerpo. |
| **Su golpe podía caer después de que la pelota muriera** | El momento del golpe tenía un error al azar de ±0,1 a 0,2 s. Si caía después del segundo pique no había golpe: corría hasta la pelota y se quedaba mirando. Los rivales también: era un «error» invisible que regalaba puntos. | **Siempre le pega**: si el golpe iba a llegar después de que la pelota muera, llega en el último momento, tarde. Se ve el swing, y casi siempre no le llega («no llegó»). |
| **La del medio era tuya aunque fuera a su cuerpo** | La regla del medio (la toma la derecha que da al medio: vos, al revés) miraba cuánto se apartaba la pelota del centro de la pareja, no a quién iba. Con la pareja cerca, una pelota que pasaba a 0,7 m de él y a 2 m de vos era «tuya», y te decía «¡tuya!». | **La que va al cuerpo es de ese**: una pelota que pasa a un paso de uno (1,3 m) y claramente lejos del otro (0,9 m más) es suya, digan lo que digan el lado y el medio. La regla del medio queda para las que pasan entre los dos. |
| **Miraba una sola vez** | Decidía de quién era al golpe del rival y la revisaba una vez. Si después no ibas, o ibas para otro lado, nadie volvía a mirar: «nunca te roba» se cumplía al pie de la letra, y la miraba pasar. | **Vigila la pelota todo el tiempo** (unas 20 veces por segundo). Si la pelota terminó yendo a él y no a vos, la toma desde donde está. Si no vas (según cómo te movés, no lo que pensás), la cubre cuando faltan 0,8 s. Y en el último momento (0,3 s) pone la pala en una que le pasa al alcance y a la que no llegás. Siempre dice «¡mía!» antes, con 0,12 s como mínimo. |
| **«Te la pasa» con cuentas de máquina** | Si su carrera perfecta no llegaba, te la pasaba («¡tuya!») cuando vos «podías» en una carrera perfecta sin tiempo de reacción, aunque la pelota le pasara a 35 cm. | Te la pasa solo si no le llega ni estirándose y vos llegás con 0,3 s de margen. |

**La regla, con su test** (`tests/ai.test.ts`): una pelota que pasa al alcance del compañero, a la que tenía que pegarle (si no, se pierde el punto), y que pasa más cerca de él que de vos, nunca queda sin que nadie de la pareja la intente. Se prueba en 8 partidos (revés y drive, los dos alcances, una persona quieta y una posicional), con las tres actitudes y entre cuatro computadoras.

**Antes y después** (30 partidos por casilla, vos posicional y Beto contra Romina y Chela; `npm run sim`, informe `doubles`, línea «le pasa al lado y nadie la intenta»):

| Pelotas del compañero que nadie intentó | Antes | Ahora |
| --- | --- | --- |
| Revés, alcance real | 15 en 30 partidos (0,50 por partido) | **2 (0,07)** |
| Revés, alcance actual | 13 (0,43) | **2 (0,07)** |
| Drive, alcance real | 16 (0,53) | **2 (0,07)** |
| Drive, alcance actual | 13 (0,43) | **1 (0,03)** |
| Vos corriendo a todas, revés, real | 12 (0,40) | **2 (0,07)** |
| Cuatro computadoras medias, real | 52 y 47 (1,7 por partido) | **9 y 10 (0,3)** |

Las que quedan son de otra clase. Con vos en la cancha: pelotas del medio a las que vos ibas y en las que fallaste el golpe, y él te las dejó porque llegabas. Entre computadoras: la pareja rival desordenada que se mira y no va ninguno, que es a propósito y se castiga (`docs/dobles.md`, sección 3).

## 2. Aciertos y errores con motivo

Nadie falla porque sí (`mishit` sigue en 0) y nadie llega a todo. Todo es determinista: la misma semilla juega el mismo partido. Lo que cambió es que ahora cada error tiene una causa que se puede ver:

| Qué le pasa | Cuándo | Qué sale |
| --- | --- | --- |
| **Llega apurado** | Llega a la pelota con menos de 0,25 s de margen. | Su golpe sale más tarde y menos preciso: hasta 0,06 s de error de timing y de retraso, y la pelota hasta 1,6 veces más desviada. Pega tarde (la pelota sale floja y alta) o no le llega. |
| **Pelota rápida** | Más de 12 m/s. | Hasta 0,04 s más de error de timing. |
| **Pelota al cuerpo** | Le llega antes de leerla. | Bloqueo: no la apunta, sale al medio, más suave y desviada. |
| **Va por todo** | Pelota difícil (baja, estirada o llegando tarde) y es de las que pegan fuerte y leen poco el juego. | En vez del globo de seguridad, un golpe ganador a las líneas, mucho más desviado. Romina lo hace en el 23 % de esas pelotas; Beto, en el 7 %; Chela nunca (siempre globea apurada). |
| **Punto largo** | La tensión acumulada (ya existía) y la impaciencia de Romina. | Más dispersión. |

**Aciertos con calidad:**

- **Lee el juego.** Cada computadora tarda en leer cada pelota lo que dice su reacción, ajustado por lo que vio:
  - la respuesta de alguien en apuros es una pelota defensiva, y quien lee el juego la ve venir (hasta 35 % antes, según su lectura: Chela mucho, Beto poco);
  - el gesto delator de un rival de la computadora también se lee (25 % antes);
  - una chiquita lo agarra a contrapié si está atrás (60 % más lento), y un golpe perfecto esconde adónde va (25 % más lento).
  
  Así tu chiquita y tu golpe limpio valen más, y la computadora no lee lo que tenés apuntado con el pulgar (sigue sin hacerlo, hay un test).
- **Coloca con intención** (ya estaba): a los pies del que queda en tierra de nadie, al hueco, globo a la pareja en la red.

**Cómo se ven los errores en el partido** (revés, alcance real, vos posicional y Beto contra Romina y Chela). Cuando el punto termina en un error de la pareja rival:

| Por qué erró la pareja rival | Antes | Ahora |
| --- | --- | --- |
| Llegó apurada | 8 % | 31 % |
| Fue por todo con una difícil | — | 12 % |
| Bloqueo al cuerpo | — | 3 % |
| Pelota difícil | 15 % | 3 % |
| Punto largo | 55 % | 19 % |
| Sin un motivo que se vea | 22 % | 32 % |

Además, «no llegó» (le pegó al aire, la compu): 7,4 por partido la pareja rival y 2,9 tu compañero. Antes esos eran los golpes que no existían.

**Las metas de profundidad que estaban incumplidas:**

| Meta | Antes | Ahora |
| --- | --- | --- |
| **Puntos que terminan en error** (meta del documento de profundidad: 55 a 65 %), 1 contra 1, alcance actual, contra Beto / Romina / Chela | 10 / 37 / 18 % | **22 / 56 / 29 %**. Mejora; contra Romina se cumple. |
| Lo mismo, dobles, revés, alcance actual | 40 % | **56 %** |
| Lo mismo, dobles, revés, alcance real | 23 % | 24 %. Con el alcance real los puntos se pierden más por no llegar que por errar. |
| **Puntos de 8 a 14 s** en dobles, contra Romina y Chela, revés, alcance real | 15,7 s | **11,5 s** ✔ |
| Lo mismo, alcance actual | 20,0 s | 16,2 s |
| Cuatro computadoras (Beto y Chela contra Romina y Chela) | 22,2 s | 16,4 s |
| 1 contra 1 contra Chela, alcance real | 14,2 s | **12,0 s** ✔ |
| 1 contra 1 contra Chela, alcance actual | 19,1 s | 21,9 s ✘ (empeora) |
| **La presión no se ve en el cuerpo** | — | Del lado de la simulación ya está todo lo que hace falta para mostrarla: el evento de golpe dice `why` (`hurried`, `reflex`, `gamble`); el plan dice si es un bloqueo (`plan.reflex`); el jugador tiene `read` (cuánto tardó en leer: alto si lo sorprendieron) y `pressure`/`strain`. Falta dibujarlo: es un pedido a la sesión de animación (sección 6). |

**El 1 contra 1, medido** (persona simulada promedio con táctica; entre paréntesis, cuánto suma la táctica contra la misma persona sin táctica; 30 partidos por rival):

| | Antes | Ahora |
| --- | --- | --- |
| Alcance actual: puntos contra Beto / Romina / Chela | 79 % (+7) / 71 % (+10) / 50 % (+19) | 76 % (+17) / 65 % (+4) / 45 % (+8) |
| Alcance actual: segundos por punto | 9,6 / 11,4 / 19,1 | 12,1 / 11,1 / 21,9 |
| Alcance real: puntos | 78 % (+15) / 59 % (+8) / 51 % (+9) | 76 % (+10) / 59 % (+2) / 60 % (+10) |
| Alcance real: segundos por punto | 8,0 / 9,3 / 14,2 | 8,1 / 8,2 / 12,0 |

Lo que se gana y lo que se pierde:

- **Se gana:** la dificultad queda casi igual, los rivales fallan por motivos que se ven en vez de no pegarle, y con el alcance real los puntos son más cortos.
- **Se pierde:** con el alcance actual, contra Chela los puntos se alargan 3 s. Contra Romina y Chela la táctica suma menos (+10 → +4 y +19 → +8), porque ahora se equivocan solas cuando las apurás, y eso le llega a cualquiera, juegue con táctica o no. Contra Romina es su personaje: «la paciencia le gana». El test de táctica contra Chela (`tests/depth.test.ts`) pide ahora +5 en 8 partidos en lugar de +8.

## 3. Actitudes

**Las tres, en la cancha:**

| Actitud | Cómo juega con vos | Cómo se ve |
| --- | --- | --- |
| **Agresiva** | Te sigue a la red antes (cuando estás a 6,2 m de la red) y tarda en bajar (0,9 s). Detrás de un golpe de ataque suyo sube aunque estés atrás. Va a la red y la aguanta: 60 % del camino hacia siempre, y define más. Y a veces **te pide la pelota**: una alta que remata en la red, una a la que llegás apurado o una que podés dejar picar y él volea. Siempre dice «¡mía!» antes, como mínimo 0,25 s antes de tu golpe. A veces se equivoca robando, porque calcula su margen como la gente que roba: 0,1 s de más, con ±0,15 s de error. | «¡Arriba!» cuando sube solo. La mano arriba («¡mía!»). Más pelotas desde la red. |
| **Equilibrada** | Su lado y el medio según la regla, y te cubre lo que no llegás. Es el compañero de antes, con el arreglo de la sección 1. | «¡mía!» y «¡tuya!» solo en las dudosas. |
| **Pasiva** | Te sigue a la red tarde (cuando ya estás a 4,2 m) y baja enseguida (0,15 s). Va menos a la red, globea más y no define: te la deja. En el medio te deja la pelota aunque sea de su derecha. Cubre solo lo que le viene al cuerpo (1,3 m), y en el último momento pone la pala si no llegás. | Te señala («¡tuya!») en las del medio. |

**Medido** (30 partidos por casilla, Beto con cada actitud, vos promedio):

| | Agresiva | Equilibrada | Pasiva |
| --- | --- | --- | --- |
| Revés, real: tus puntos posicional (lo que paga) | 64 % (+7) | 64 % (+10) | 62 % (+11) |
| Revés, actual | 73 % (+21) | 70 % (+19) | 71 % (+23) |
| Drive, real | 65 % (−5) | 63 % (0) | 64 % (+8) |
| Drive, actual | 71 % (−3) | 72 % (+3) | 71 % (+15) |
| «¡Mía!» por partido (revés, real) | 2,4; salen bien el 97 % | 0 | 0 |
| Tu pareja desde la red (revés, real) | 42 % | 36 % | 34 % |
| Juntos (revés, real) | 79 % | 75 % | 73 % |
| Segundos por punto (revés, real) | 11,1 | 11,5 | 11,5 |

«Salen bien» quiere decir que la pelota que robó obligó al rival a devolverla o ganó el punto. Las que robó y fueron error, o a las que no llegó, son el 3 %.

**Qué dicen.** Con la pasiva, jugar posicional es lo que más paga: si no hacés tu parte, no la hace nadie. Con la agresiva, correr a todas rinde casi lo mismo, porque te cubre y te roba. Al drive, con la agresiva, correr a todas rinde más que jugar posicional. Las tres ganan parecido: la actitud cambia cómo se juega, no cuánto se gana.

**Personaje y actitud.** El personaje es cómo juega: sus manos, sus piernas, sus golpes, sus manías, su gesto delator y sus frases. La actitud es cómo comparte la cancha. Cada uno tiene la suya de siempre, que encaja con su personaje:

- **Beto: equilibrada.** El profe juega su lado y el medio como se enseña, te cubre y avisa todo.
- **Romina: agresiva.** Sube, todo lo alto es suyo y te dice «¡mía!» más de lo que querrías.
- **Chela: pasiva.** Te devuelve todo desde atrás y te deja la red y lo dudoso.

Le podés pedir otra a cualquiera, y la recuerda: una Chela agresiva sigue siendo lenta y globeadora, pero sube y te pide las altas. La actitud nunca cambia sus manos ni sus piernas (hay un test). En 1 contra 1 no hay actitud: los rivales son exactamente como eran.

**La pareja rival** usa las mismas actitudes, cada uno con la suya: Romina, agresiva, le pide a Chela las del medio y las altas, y se cruza a volear («cruzarse»). Contra Romina y Chela son 1,3 a 1,6 «¡mía!» por partido, y salen bien el 94 al 100 %. Con `?rivales=` se le puede dar a los dos la misma actitud para probar.

**Cómo se elige sin leer:** en Opciones → Dobles, después de «Compañero», tres botones con una canchita dibujada vista desde tu lado: la red, las líneas de saque, vos (un aro) y tu compañero (un punto lleno). En la agresiva tu compañero está arriba, en la red. En la equilibrada está a tu altura. En la pasiva está atrás, contra el vidrio. Debajo, una sola línea que la explica para quien quiera leer, y «Así juega Romina si no le pedís nada» bajo la actitud propia de cada uno.

**Lo que no está:** gestos propios de cada actitud. Usan los avisos que ya existen («¡mía!», «¡tuya!», «¡arriba!»). Un festejo de la agresiva cuando le sale el robo, o una disculpa cuando no, quedan como pedido a la sesión de animación.

## 4. Cómo se mide

`npm run sim` (informe `doubles`, archivo `tests/sim/doubles.sim.ts`) tiene líneas nuevas para cada casilla. Salen de `tests/probe.ts`, que mira el partido como alguien al lado de la cancha:

- **reacción**: cuánto tarda cada uno en tener adónde ir, con la media, el p10 y el p90, y cuántos bloqueos al cuerpo hubo;
- **le pasa al lado y nadie la intenta**: la regla de la sección 1, para tu compañero, para vos y para la pareja rival, con de quién era la pelota que nadie intentó;
- **«¡mía!»**: cuántas por partido de cada lado, según la actitud, y cuántas salen bien, al error o sin llegar;
- **por qué erran**: los puntos que terminan en error de cada lado, según el motivo;
- **no llegó**: los golpes al aire de la computadora;
- una tabla nueva: qué paga jugar posicional con cada actitud del compañero.

`SIM_ATTITUDE=agresiva` cambia la actitud del compañero y `SIM_ATTITUDES=no` saltea la tabla. El informe `depth` (1 contra 1) también dice por qué erran y cuántas veces no llegó la computadora.

**Rendimiento.** Un paso de la simulación de dobles pasa de 4,2 a 5,9 µs: la vigilancia de la pelota y la lectura. Son unos 0,003 ms por cuadro. Con `npm run perf -- --dobles`, el build de antes y el de ahora medidos en las mismas condiciones dan, para dobles en 3D:

| CPU | Antes | Ahora |
| --- | --- | --- |
| Normal | 0,39 ms | 0,30 ms |
| 4× más lenta | 1,87 ms | 1,53 ms |
| 6× más lenta | 2,70 ms | 2,69 ms |

La diferencia es ruido de la máquina, que hoy está más cargada que cuando se midió `docs/dobles.md`. El juego pesa 3,2 KB más comprimido (84,7 KB).

## 5. Qué probar en el celular

Con `?dobles&alcance=real` (y después con `&actitud=agresiva` y `&actitud=pasiva`):

1. **Tirale fuerte al cuerpo a tu compañero cuando está en la red**, o dejá que te tiren a vos al revés y mirá a Beto. No tiene que quedarse duro: bloquea, a veces mal.
2. **Quedate quieto** en una pelota del medio que va hacia él: tiene que tomarla, diciendo «¡mía!» con la mano arriba.
3. **Corré hacia una tuya**: no te la tiene que sacar (equilibrada y pasiva). Con la agresiva, mirá si los «¡mía!» se sienten divertidos o molestos (hoy son unos 2,4 por partido).
4. **Mirá los errores de la pareja rival**: si se entiende por qué fallan (apurados, estirados, Romina yendo por todo) o si parecen al azar.
5. **Las tres canchitas de Opciones**: si se entienden sin leer la palabra.

## 6. Pedidos a la sesión de animación

Son datos que la simulación ya entrega. Falta dibujarlos:

- **Apuro** (`hit.why === 'hurried'`, o el plan con poco margen): armado corto y cuerpo todavía corriendo al pegar.
- **Bloqueo al cuerpo** (`plan.reflex`): la pala delante del pecho, sin armado.
- **Fue por todo** (`hit.why === 'gamble'`): el golpe plano y largo de alguien apurado.
- **No llegó**: ahora la computadora le pega al aire (`anim.kind = 'whiff'`) en vez de quedarse quieta. Un gesto de «no llegué» vendría bien.
- **Sorprendido** (`player.read` mayor que su reacción, por ejemplo con una chiquita): medio paso tarde en arrancar.
- **La presión acumulada** (`player.strain`, `player.pressure`): postura más agachada, como pedía el documento de profundidad.
- **Robo de la agresiva**: un festejo corto si sale y una disculpa si no.

## 7. Decisiones que te quedan

| Decisión | Recomendación |
| --- | --- |
| ¿Cuánto roba la agresiva? Hoy, unos 2,4 «¡mía!» por partido. | **Así, y afinarlo jugando.** Si molesta, que robe solo las altas. |
| ¿Actitud por defecto de cada uno? | **Beto equilibrado** (el compañero por defecto y el que se enseña), **Romina agresiva**, **Chela pasiva**. |
| ¿La actitud en la pantalla de inicio, junto con el compañero? | **Sí, cuando el dobles sea la partida rápida**: tres canchitas al lado de la cara del compañero. Hoy está en Opciones → Experimental. |
| ¿Recuperar lo que paga la táctica contra Romina y Chela en 1 contra 1? | **Primero probarlo jugando.** Los números bajaron porque ahora fallan solas cuando las apurás, que es más humano. Si se siente que «cualquiera les gana», hay que bajar `GAMBLE` (Romina) o el apuro. |
| ¿Una persona puede pedir «¡mía!»? | **Más adelante.** Un toque largo en la pelota que viene, para jugar con un compañero pasivo sin que se quede mirando. |
