# Dobles posicional y alcance real

Propuesta de diseño y prototipo jugable. La versión visual, con los diagramas de cancha, es el Artifact privado «Dobles posicional»; su fuente está en [dobles.html](dobles.html).

**En una línea:** en dobles cada pelota tiene dueño, la pareja va atada con una cuerda y nadie llega a lo imposible. Así la posición importa y no hace falta ser un velocista.

**Cómo probarlo:** `?dobles` abre la partida rápida en 2 contra 2 (vos al revés con Beto, contra Romina y Chela). `?alcance=real` le da a todos el alcance de una persona. `?lado=drive` y `?companero=chela` (o `romina`) cambian tu lado y tu compañero. `?actitud=agresiva` (o `equilibrada`, `pasiva`) cambia cómo juega tu compañero con vos, y `?rivales=pasiva` la de la pareja de enfrente. Lo mismo está en **Opciones → Experimental**. La partida rápida de siempre no cambia.

**La IA, más humana:** el compañero ya no se queda mirando una pelota suya, y la computadora acierta y falla con motivos que se ven. Además, cada compañero tiene una actitud: agresiva, equilibrada o pasiva. Está todo en [ia.md](ia.md), con las mediciones de antes y después. Esta página está actualizada donde eso cambió una regla.

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
| **La que va al cuerpo es de ese.** | Una pelota que pasa a un paso de uno (1,3 m) y por lo menos 0,9 m más lejos del otro es de ese, digan lo que digan el lado y el medio. Y se sigue mirando: si la pelota termina yendo a uno, es de ese. | Test: `la del medio que va al cuerpo de tu compañero es suya` (`tests/ai.test.ts`). |
| **El medio es de la derecha.** | Una pelota que pasa entre los dos, a menos de 0,9 m del centro de la pareja, es del que tiene la derecha hacia el medio: con dos diestros, el de revés. Si los dos o ninguno, el que está más adelante. Si el otro llega 0,3 s más cómodo, es del otro, y se avisa. Un compañero pasivo te la deja. | Test: `la del medio es de quien tiene la derecha hacia el medio`. |
| **Drive y revés.** | Elegís tu lado. El drive (derecha) construye; el revés (izquierda) toma el medio y casi todos los globos al medio. | — |
| **Subir después de un buen globo.** | Un globo que pasó por arriba de la pareja rival es la señal para subir los dos. | — |
| **Bajar ante un globo profundo.** | Si el globo pasa por arriba de la pareja en la red, los dos bajan. | — |
| **El cambio.** El globo pasa por arriba de uno; el otro, en diagonal, corre a buscarlo y el primero cruza. | El compañero cruza por un globo que te pasó por arriba si no estás yendo vos y llega 0,25 s más cómodo. Avisa antes. | Test: en partidos enteros, cada pelota tuya que pegó el compañero fue avisada. |

Todo esto vive en `src/sim/pair.ts` y no usa azar: el partido sigue siendo determinista (`PHYSICS_VERSION` pasó a 3).

## 2. El compañero

**Juega en pareja con vos.**

- **Te sigue.** Sube a la red cuando estás a menos de 5 m de la red. Baja cuando te quedás atrás casi medio segundo (0,4 s) o en el instante en que corrés para atrás detrás de un globo. A mitad de camino, espera a ver adónde vas. Equilibrado, nunca abre el hueco él: si no subís, no sube. Cuánto antes sube y cuánto tarda en bajar depende de su actitud (abajo). Si tuvo que defender desde el fondo y vos seguís en la red, se queda atrás y te llama («¡atrás!») hasta que bajes o pegues vos: ver [red.md](red.md).
- **Cubre su mitad** y se desliza con la pelota. Si cruzás al otro lado, toma el lado que dejaste.
- **No se queda mirando.** Una pelota que le viene al cuerpo es suya. Una que es tuya la sigue con la vista: si terminó yendo a él y no a vos, o si no estás yendo, la toma, y siempre avisa antes («¡mía!»). Una que se le cruza a una pelota de distancia y a la que no llegás, la juega en el último momento. Si le llega antes de leerla, la bloquea.
- **No te roba.** Equilibrado o pasivo, una pelota tuya a la que estás yendo no la toca. Agresivo, a veces sí, siempre con «¡mía!» antes (abajo). Hay un test que juega partidos enteros y verifica, golpe por golpe, que toda pelota tuya que pegó la avisó antes.
- **Es honesto con lo que no llega:** si una pelota suya no la alcanza ni estirándose y vos llegás con margen, te la pasa con un «¡tuya!».
- **Su actitud** ([ia.md](ia.md), sección 3):
  - **agresiva**: sube antes y baja después, sube sola detrás de su ataque y te llama («¡arriba!»), remata todo y a veces te pide la tuya;
  - **equilibrada**: lo de arriba, tal cual;
  - **pasiva**: sube cuando ya estás arriba, baja enseguida, te deja las del medio y cubre solo lo que le viene al cuerpo.
  
  Cada personaje tiene la suya (Beto equilibrado, Romina agresiva, Chela pasiva) y le podés pedir otra en Opciones, con tres canchitas dibujadas.

**Cómo avisa, sin texto.** Con el cuerpo, el mismo gesto para todos los personajes, para que se aprenda una vez. Siempre es verdad. Cada aviso es un movimiento corto, que entra, marca y sale en menos de un segundo, nunca una pose sostenida, y el codo va doblado, como el de una persona. Los dos que más se ven no se parecen ni de espaldas ni de frente, ni en chiquito: «¡mía!» es una mano arriba; «¡tuya!», un brazo al costado y el cuerpo entero girado.

| Aviso | Gesto | Cuándo |
| --- | --- | --- |
| ¡Mía! | La mano libre sube abierta por encima de la cabeza, con el codo afuera, y vuelve a bajar. Si ya está armando su golpe, no la levanta: el brazo es del golpe. | Va a una pelota que no se ve sola que es suya (abajo), o te toma una tuya: no la alcanzás, terminó yendo a él, o (agresivo) la juega mejor. |
| ¡Tuya! | Gira la cabeza y el torso hacia vos, saca el brazo de tu lado bajo y al costado y da medio paso atrás para dejarte lugar. Si estás del lado de su pala, te apunta con la pala a la altura del hombro, nunca baja al costado ni atrás, que es armar un golpe, y la mano libre suelta la pala y le cuelga al costado. | Una pelota que no se ve sola que es tuya, o te pasa una que él no alcanza. |
| ¡Voy! | Como «¡mía!», mirándote: cruzá. | Cruza por un globo que te pasó por arriba: enseguida si llega mucho más cómodo, o tarde si no fuiste a buscarlo (ver [red.md](red.md)). Bajá vos también. |
| ¡Arriba! | Te mira y te llama dos veces con el antebrazo, por debajo del hombro: «vení, vení». | Su globo pasó a la pareja rival y vos estás atrás, o sube solo detrás de su ataque. |
| ¡Atrás! | Te mira y barre el brazo hacia atrás dos veces, por debajo del hombro. | Un globo te pasa por arriba (o les pasó a los dos) y seguís en la red; o él quedó atrás defendiendo y vos seguís arriba ([red.md](red.md)). |

**Cuándo hace seña: solo cuando de quién es la pelota no se ve sola.** Dice siempre de quién es cada pelota del medio, pero el cuerpo lo muestra solo cuando hace falta:

- **Una pelota que va claramente a uno** (le pasa más cerca que al otro por más de un cuarto de la distancia entre los dos: 1,15 m con los dos atrás) es de ese, y no lleva seña. Si la juega el otro, sí.
- **Entre los dos**, quien juega al pádel sabe la regla: cada uno su lado, y la del medio para el que tiene la derecha hacia el medio. Tu compañero hace seña cuando se aparta de la regla (te deja una suya, te toma una tuya) y cuando es una moneda al aire: los dos llegan con tiempo y ninguno con más de 0,3 s de ventaja.
- **Lo que cambia de manos en el camino** siempre lleva seña: te la cubre, te la deja porque no llega, cruza por un globo, te la roba.
- **Entre dos de la computadora**, que se entienden solos, solo hay seña en la moneda al aire y cuando la juega el que no era: lo que una pareja de verdad se diría en voz alta. Siguen las de su desorden, que son las que se pueden castigar: se señalan los dos cuando dudan, y el que subió o bajó solo llama al otro.

Lo que se dice sin mostrarse no cambia nada del juego: la simulación es idéntica cuadro a cuadro. En un solo lugar se atiene a lo dicho: un compañero que ya habló de una pelota no te la pasa después (`Match.updatePairs`).

Medido en 30 partidos (`npx vitest run --config vitest.sim.config.ts calls`), vos al revés con Beto contra Romina y Chela:

| | Antes | Ahora |
| --- | --- | --- |
| Pelotas que te llegan a la pareja con seña de tu compañero | 76 % | 21 % |
| Pelotas que le llegan a la pareja rival con alguna seña | 85 % | 30 % (la mitad, las de su desorden) |

Con Romina de compañera hace seña en el 36 % (sus robos y lo que no hace por la regla) y con Chela en el 21 %.

**¿Le falta algo a quien juega sin sonido?** Medido en 100 partidos por casilla con una persona simulada, promedio y posicional, que tarda 0,25 s en leer una seña. Si lee la cancha como un jugador de pádel (la pelota que le viene al cuerpo o le pasa claramente más cerca es suya; si no, la regla), gana lo mismo con las señas de ahora que viendo todas como antes: con Beto, 62,5 % de los puntos antes y 61,3 % ahora; con Romina, 78,0 y 77,9; con Chela, 72,8 y 71,3 (el ruido de la medida es de ±1 punto). Si solo aplica la regla del lado y el medio, sin mirar a quién va la pelota, pierde de 3 a 6 puntos (con Beto, de 63,7 a 57,8 %) y no va ninguno de los dos a 2 pelotas más de cada 100: las señas de las pelotas claras le avisaban que tomara las que le venían al cuerpo.

Los avisos salen cuando el compañero terminó de leer la pelota (su reacción, 0,2 a 0,35 s después del golpe rival), así hay medio segundo o más para actuar. Uno dicho sobre su propio golpe espera a que el golpe termine.

**Su personalidad.** El mismo personaje que como rival, con su estilo y sus piernas, pero jugando a ganar y con manos más firmes (40 % menos de dispersión de timing, con tope de 0,07 s; 25 % menos de dispersión de golpes; lee la pelota un 25 % antes). Lo que propone `docs/personajes.md` llega por la actitud de cada uno: Beto equilibrado, que avisa todo; Romina agresiva, que sube y remata lo alto; Chela pasiva, que te devuelve todo desde atrás. Los tres avisan con los mismos gestos.

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

**La regla de oro:** si el cuerpo no puede llegar en la animación, la simulación no deja pegar. Con el alcance real la pelota más lejana que se pega baja de 2,20 m a 1,56–1,60 m y las pelotas al ras del piso, de 8–11 % a 3–4 % de los golpes.

### El cuerpo llega como una persona (fase 2)

**El problema.** El cuerpo dibujado se deslizaba entero, hasta 90 cm, para poner la pala en la pelota: la mediana era de 60 a 78 cm, los pies patinaban y en los golpes difíciles la pala igual quedaba lejos. La causa era la geometría: los clips tocaban la pelota 60 a 78 cm adelante del cuerpo y la simulación la pega a 20 cm. El «imán» no llevaba el cuerpo hacia la pelota: lo corría hacia atrás y hacia afuera.

**Qué cambió.** El cuerpo ya no se mueve entero: llega con las piernas, la cadera y el brazo.

1. **Los golpes tocan donde pega la simulación.** La simulación pega a unos 62 cm al costado y 20 cm adelante de los pies, y los personajes se dibujan 1,2 a 1,5 veces más grandes: a su escala, la pelota queda a medio metro al costado y más baja de lo que espera alguien parado. La derecha, el revés, las voleas, el globo, la bandeja, el remate y las estiradas se rehicieron en Blender para ese punto: la pala toca la pelota más cerca del cuerpo, más atrás y más baja, con las rodillas más flexionadas y la base corrida hacia atrás, así la pelota sigue quedando delante del pie de adelante. Son los mismos 24 clips.
2. **Zancada de verdad.** Si la pelota está más lejos de lo que toma el brazo, primero la cadera se corre hacia ella con los pies donde están (hasta 12 cm). Si hace falta más, el pie de adelante da un paso hacia la pelota (hasta 45 cm; 50 en la estirada) y la cadera lo sigue. El paso sale un tercio de segundo antes del contacto, cae antes de pegar y vuelve después. El pie de atrás queda plantado.
3. **Los pies no patinan.** Cada pie apoyado queda clavado en la cancha, sobre la bola del pie, como en los clips: el talón puede subir o girar, la punta no se mueve. Si el cuerpo lo quiere en otro lado (la zancada, un gesto que abre la base, un golpe que entra tarde, la simulación que corre al jugador unos centímetros), el pie da un paso: sube, cruza y baja. Los pies se turnan, nunca saltan los dos.
4. **Flexión profunda.** Para una pelota baja la cadera baja hasta 55 cm desde parado, con la rodilla de atrás a unos 10 cm del piso y nunca a través de él. Un pie en el aire no baja con la cadera.
5. **El remate y la bandeja se acomodan.** El remate a una pelota más baja salta menos: el cuerpo entero baja mientras los pies están en el aire. La bandeja flexiona para una pelota más baja y se estira para una más alta.
6. **La estirada se elige por la distancia real:** una pelota a más de 1,15 m de los pies (lo que llega una persona parada) y al costado. Una pelota lejos pero adelante se juega con un paso hacia adelante. La estirada ya no espera con un pie en el aire: si sobra tiempo, espera parada y la zancada sale entera al final.
7. **La pala en la pelota.** El brazo hace el resto con cinemática inversa, como antes, pero ahora el resto es chico. Corriendo, las piernas siguen la carrera y los brazos golpean: el contacto se calcula con ese cuerpo y la cadera se inclina hacia la pelota.
8. **Lo que no alcanza**, el cuerpo entero lo cubre, y los pies lo siguen a pasos. Con el alcance real casi no pasa. Con el de hoy pasa en las pelotas que ninguna persona alcanza.
9. **Funciona igual para los cuatro jugadores**, cada uno con su cuerpo y su escala: 1,2× el cercano, 1,5× el lejano y 0,9 en Chela.
10. **En 2D** la figura tiene rodillas: se agacha para la pelota baja y da el paso con el pie del lado de la pelota, con los mismos tiempos que en 3D.

**Cómo se mide.** `npm run sim`, informe `reach` (`tests/sim/reach.sim.ts`): 4 partidos por casilla, cada jugador dibujado como en el juego. «Parado» es quien pega a menos de 0,45 m/s. Los «antes» son el motor de `main` medido con el mismo informe.

| Dobles, alcance real | Antes | Ahora |
| --- | --- | --- |
| El cuerpo se desliza, pegando parado (mediana / p90 / máximo) | 62 / 85 / 90 cm | **0** / 12 / 72 cm |
| El cuerpo se desliza, pegando a la carrera | 58 / 82 / 89 cm | **0** / 32 / 98 cm |
| La pala queda de la pelota en el contacto (mediana / p90) | 13 / 41 cm | **9** / 18 cm |
| Un pie apoyado se mueve por cuadro, alrededor de un golpe parado (mediana / p99) | 24 / 191 mm | **0,0** / 2,0 mm |
| Pelotas por debajo de 45 cm: cuánto baja la cadera desde parado (mediana) | 51 cm | **55 cm** |
| La rodilla más baja (p10 / mínimo) | 9 / 6 cm | 11 / **8** cm |
| Pelotas a más de 1,15 m jugadas a fondo | 4 de 47 | **11** de 47 |

| 1 contra 1, alcance de hoy (la partida rápida) | Antes | Ahora |
| --- | --- | --- |
| El cuerpo se desliza, pegando parado | 86 / 89 / 90 cm | **0** / 18 / 142 cm |
| La pala queda de la pelota | 17 / 79 cm | **10** / 32 cm |
| Un pie apoyado se mueve por cuadro | 26 / 200 mm | **0,0** / 8,1 mm |

**Qué quiere decir.**

- Pegando parado, el cuerpo ya no se desliza: la mediana es cero. El p90 de 12 cm sale casi entero de pelotas que la simulación cambia en los últimos 10 cuadros (ver más abajo). Con el plan estable el deslizamiento es cero, salvo bandejas muy abiertas al costado.
- Un pie apoyado no se mueve: antes patinaba una mediana de 24 mm por cuadro (1,4 m/s) alrededor de cada golpe.
- La flexión ya llegaba a unos 50 cm, porque los clips viejos tocaban alto, pero la rodilla atravesaba el piso. Ahora llega a 55 cm y la rodilla queda a 8 cm o más.
- Con el alcance de hoy, el máximo de deslizamiento sube a 1,42 m. Antes tenía un tope de 90 cm y la pala quedaba lejos; ahora el cuerpo va hasta la pelota imposible y los pies lo siguen. Con el alcance real no pasa.

**Peso y rendimiento.**

- El personaje pesa lo mismo: 107.384 bytes comprimido, 154 menos que antes. Son los mismos 24 clips; los golpes, 30,1 KB.
- El código del juego, 2,7 KB más comprimido: de 80,2 a 82,9 KB.
- Animar a los cuatro cuesta 27 µs por cuadro en la PC de prueba, antes 15. Lo nuevo es sobre todo mantener los pies plantados, que pide resolver las piernas casi en cada cuadro. En un Android de gama media eso es un 0,4 % del cuadro.
- `npm run perf -- --dobles`, trabajo por cuadro en dobles 3D con la CPU 4× y 6× más lenta: antes 1,85 y 1,94 ms, ahora 1,34 y 1,91 ms. La medición es ruidosa: no empeoró de forma visible.

**Qué mirar en el celular** (`?dobles&alcance=real`, y la partida rápida de siempre):

- La pelota baja: que la flexión se lea como pádel, con la base larga y la rodilla de atrás cerca del piso, y no como una sentadilla.
- La zancada de revés a una pelota abierta: el pie derecho cruza, el izquierdo queda plantado.
- Los pasitos de acomodo: el jugador parado que se corre unos centímetros ahora da pasos en vez de deslizar. Que no se vea nervioso.
- La derecha de todos los días, a la altura de la cintura: el contacto quedó más cerca del cuerpo. Desde atrás se ve compacta; que no se vea apretada.
- El remate a una pelota no tan alta, con el salto más chico.
- En 2D, con `?2d`.

**Lo que no se resolvió.**

- ~~**Planes de último momento.**~~ A veces la IA mantenía un contacto vencido hasta 0,15 s y después pegaba otra pelota, a más de un metro (por ejemplo, preparaba una volea y pegaba la salida del vidrio). **Resuelto en la IA** (`docs/ia.md`, sección 3): el armado muestra desde el principio el golpe que de verdad va a dar, y nunca queda un plan vencido. Pegando parado, el deslizamiento p90 bajó de 16–21 cm a 0–5 cm.
- **A la carrera**, el cuerpo se inclina pero no cambia la última zancada de la carrera por una estocada. Con el alcance real queda un deslizamiento de 0 / 32 cm (mediana / p90).
- **La flexión desde atrás** puede leerse como una sentadilla y no como una estocada: la base del clip es diagonal y la cámara la ve de espaldas.
- **Pegarle a una pelota que viene muy al cuerpo** se resuelve con la cadera y el brazo, no con un paso atrás.
- **El Artifact «Dobles posicional»** no se volvió a publicar: su fuente, `docs/dobles.html`, ya dice que la fase 2 está hecha.

**Para revisar cuadro por cuadro:** `npm run frames` (o `node scripts/frames.mjs --url http://localhost:5183/` con el servidor de desarrollo) juega la demo con una semilla fija y guarda los momentos en que el cuerpo más trabaja: la pelota más baja, la más lejana, un revés bajo, una por arriba de la cabeza, una derecha común y una al final de una carrera, de cada lado de la red. También lo que le pasa a la IA: un golpe apurado, un bloqueo, un golpe al aire, un robo y uno que salió mal, una sorpresa y el momento de más tensión. Saca 7 cuadros alrededor de cada uno, recortados a la densidad del celular, en `.frames/`. Con `--label` se distinguen dos versiones, con `--2d` se mira el respaldo, con `--buscar` solo lista los momentos de una semilla y con `--forzar perdon` agrega un «perdón» forzado después de una derecha común. Con `--estudio carrera` no juega: arma cuadro a cuadro una carrera que termina en una pelota lejos y la dibuja sin la simulación, igual para cualquier versión de la animación (la IA frena para pegar y la demo nunca la muestra).

### Segunda vuelta: lo que le pasa a la IA se ve, y la estocada a la carrera

**Para qué.** La IA ya se equivoca por algo (`docs/ia.md`): llega apurada, bloquea una pelota al cuerpo, no llega, lee tarde, se carga en un punto largo, le roba la pelota al compañero. El cuerpo tiene que mostrar por qué, sin leer, en lo que dura, sin frenar nada y con lo que ya existe: los mismos 24 clips y la misma cinemática inversa, sin arte nuevo.

**De dónde lo saca.** La simulación ya lo decía todo. `fillScene` (`src/app/scene.ts`) lo pasa a la escena en cuatro campos de `ScenePlayer`: `why` (golpe apurado o bloqueo, desde que la IA decide su golpe y empieza a armarlo hasta que termina), `surprise`, `tension` y `stealing`. La escena tiene sus propias palabras: si la IA renombra sus motivos (por ejemplo `'hurried'` a `'forced'`), solo cambia la traducción en `fillScene`. La animación sigue sin leer la simulación.

| Qué le pasa (dato de la simulación) | Qué hace el cuerpo | Cuánto dura |
| --- | --- | --- |
| **Apurado** (`why: 'hurried'`) | No arma: los brazos siguen la carrera hasta 0,2 s antes del contacto y el golpe entra por la mitad del clip. Las piernas siguen corriendo. | lo que dura el golpe |
| **Bloqueo** de una pelota al cuerpo (`why: 'reflex'`) | Sin armar y sin swing: la pala se pone donde va a estar la pelota 0,15 s antes y la espera; recién después empuja. Es todo brazo, el cuerpo no se acomoda. La cabeza se aparta de la pelota y, de derecha, la mano libre sube al costado de la cara, donde se ve también de espaldas. | ±0,35 s del contacto |
| **No llegó** (golpe al aire) | El brazo va a buscarla pero no del todo, y el cuerpo no se desliza tras ella: no llega. Un instante después caen la cabeza y los brazos: un pedazo del lamento, solo en el torso, mientras las piernas siguen. | medio segundo |
| **Sorprendido** (lee más tarde que de costumbre) | Cuando ya tendría que estar yendo: en los talones, el torso hacia atrás, la pala que sube tarde y la mano libre abierta. Después arranca. | lo que tarda de más (0,1 a 0,3 s) |
| **Presión acumulada** (`strain`) | Mientras espera, más bajo (hasta 7 cm) y con la base más abierta (hasta 9 cm, cuando apoya los pies), el torso hacia adelante. Corriendo o pegando, nada. | mientras dure |
| **Robo** («¡mía!» de la agresiva) | Si la pelota pasó: un «¡vamos!» corto con la pala, el festejo sin el salto. Si se fue, quedó en la red o no llegó: «perdón», la mano libre arriba hacia el compañero y la cabeza hacia ese lado, en vez del lamento del punto. | 0,4 s; 0,9 s |

**La estocada a la carrera** (lo que la fase 2 dejó pendiente «a la carrera»). Si sigue corriendo cuando llega la pelota y esta queda más lejos de lo que toma la cadera, la última zancada se alarga hacia ella (hasta 50 cm): el pie que está en el aire baja más afuera, la cadera lo sigue y baja como en una estocada, y el pie apoyado no se mueve. Además, un pie apoyado de la carrera ya no se desliza cuando el cuerpo entero se corre hacia la pelota o vuelve: queda clavado hasta que se levanta. La IA y el movimiento asistido frenan para pegar (llegan a 0 m/s), así que esto se ve sobre todo en la persona que pega corriendo; a la IA que llega corriendo y frena la sigue cubriendo el paso de la fase 2.

**En 2D** se ven el bloqueo (la pala adelante del pecho), la sorpresa (los brazos se abren), el «no» con la cabeza después de un golpe al aire y la tensión. El apurado y el robo quedan solo en 3D.

**Cómo se mide.** El mismo informe `reach`, con una medida nueva: el pie apoyado alrededor de los golpes a la carrera (con un umbral de piso más estricto, porque el pie que despega sigue bajo un cuadro o dos). «Antes» es `main` medido con el mismo informe.

| | 1 contra 1, real | Dobles, real | 1 contra 1, hoy | Dobles, hoy |
| --- | --- | --- | --- | --- |
| El cuerpo se desliza pegando a la carrera (p90) | 35 → **30** cm | 38 → **34** cm | 53 → **46** cm | 96 → **75** cm |
| El cuerpo se desliza pegando parado (p90) | 20 → **18** cm | 16 → **12** cm | 17 → 18 cm | 21 → **20** cm |
| La pala queda de la pelota (p90) | 26 → **24** cm | 17 → **16** cm | 35 → **32** cm | 26 → **24** cm |
| Pie apoyado alrededor de un golpe parado (p99 / máximo) | 7,9 → **3,2** / 153 → **21** mm | 3,5 → **1,7** / 1022 → **71** mm | 12,1 → **4,1** / 214 → 214 mm | 3,7 → **1,6** / 436 → **55** mm |
| Pie apoyado alrededor de un golpe a la carrera (mediana / p90) | 24 → **15** / 130 → **107** mm | 22 → **14** / 129 → **105** mm | 24 → **15** / 127 → **109** mm | 23 → **13** / 129 → **103** mm |

**Qué quiere decir.**

- La estocada achica el deslizamiento a la carrera: el p90 baja entre 4 y 21 cm.
- El pie apoyado de un golpe parado mejoró de paso. Los gestos nuevos hacían patinar los pies y se arreglaron tres cosas: un paso que ya no cambia de destino mientras baja, un pie que no se estira de más esperando al otro y un remate más chico que no baja los pies al piso.
- **A la carrera los pies todavía patinan**, alrededor del golpe: 13 a 15 mm por cuadro de mediana y unos 10 cm de p90. Mejoró un tercio, pero no se resolvió. Sale de la mezcla de las piernas del golpe con las de la carrera cuando el jugador frena para pegar o arranca después, entre 0,5 y 1,8 m/s. Es lo próximo para los pies.

**Peso y rendimiento.**

- Sin arte nuevo: el personaje pesa lo mismo. El festejo corto y el «no llegué» son pedazos de clips que ya estaban.
- El código del juego, 2,0 KB más comprimido (gzip -9): de 86,1 a 88,1 KB.
- Animar a los cuatro cuesta 30 a 34 µs por cuadro en la PC de prueba, antes 27 a 31: unos 3 µs más.
- `npm run perf -- --dobles`: trabajo del juego por cuadro en dobles 3D, con la CPU 4× y 6× más lenta y en dos muestras. Antes, 1,51 y 2,21 ms, y después 1,29 y 1,80 ms. Ahora, 1,85 y 2,11 ms, y después 1,27 y 1,83 ms. La medición es ruidosa y ninguna diferencia se sostiene de una muestra a la otra.

**Qué mirar en el celular** (`?dobles&alcance=real`):

- Un bloqueo en la red: que se lea como un reflejo (la pala ya puesta, la cabeza que se aparta) y no como una volea más.
- Un golpe al aire de la IA: que el «no llegué» llegue un instante después y no tape el juego.
- La sorpresa: es corta. Que se note sin parecer un tic.
- La tensión en un punto largo: más baja y más abierta. Que no parezca cansancio.
- Un robo de Romina: el «¡vamos!» y, si sale mal, el «perdón».
- Correr hacia una pelota abierta y pegarle sin frenar: la última zancada se alarga.

**Lo que no se resolvió.**

- Los pies a la carrera alrededor del golpe (arriba).
- De espaldas, el bloqueo de revés se distingue poco de una volea: la diferencia está en los tiempos (la pala espera) más que en la forma. Y si la IA cambia el contacto en los últimos cuadros, la pala que esperaba salta al nuevo; la segunda vuelta de la IA (planes vencidos) lo resuelve.
- La sorpresa de alguien lejos es chica en pantalla y dura 0,1 a 0,3 s.
- El «perdón» casi no aparece en la demo: en 10 semillas de 100 s ningún robo salió mal, y hay uno o dos robos cada 1000 s de demo. Por eso se capturó forzado.
- El apurado y el robo no tienen versión 2D.

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

**Después de la ronda de IA humana** ([ia.md](ia.md)), con vos al revés y el alcance real, como en la última columna:

- Jugar posicional paga +12 / +10 / +3 pp (antes +17 / +12 / +8).
- Los puntos duran 11,5 s (antes 15,7): entran en la meta.
- Las pelotas del compañero que nadie intentó bajan de 0,5 a 0,07 por partido.

Paga un poco menos porque los dos ganan más (el que corre a todas, de 46 a 53 %; el posicional, de 58 a 64 %): el compañero cubre más y los rivales fallan cuando los apurás, y eso le sirve a cualquiera.

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
2. **Animación** (hecha, ver la sección 4): zancada con el pie de atrás plantado, flexión profunda, pies que no patinan y golpes que tocan la pelota donde la pega la simulación. El cuerpo ya no se desliza para llegar.
3. **Aprender dobles:** las cuatro lecciones, la pista de tierra de nadie, la elección de compañero en el inicio, las frases y festejos de pareja.
4. **Dobles por defecto:** si el usuario lo decide, la partida rápida pasa a dobles, se recalibran los rivales y el 1 contra 1 pasa a «Cruzado».

**Riesgos.**

- Con el alcance real hay que pararse bien, y el joystick en el celular puede quedarse corto. Solo se sabe jugando.
- Un compañero que se percibe tonto o que «roba» arruina el modo. Los avisos y la regla del medio son lo que hay que mirar en el celular. El compañero que se quedaba mirando su pelota ya está arreglado, y el que roba es solo el agresivo, que siempre avisa ([ia.md](ia.md)).
- Al drive con Beto de compañero, que es lento, correr a todas paga lo mismo que jugar posicional. Al revés paga +8 a +25 pp.
- Cuánto se desordena la rival es un número a afinar jugando: hoy, una de cada cinco pelotas tuyas la encuentra desordenada. Si es poco no hay nada que castigar; si es mucho, parece torpe.
- Los puntos contra Romina y Chela siguen algo largos (16 a 20 s de media; la meta es 8 a 14): Chela devuelve todo.
- La brecha de +15 pp se cumple solo en algunas casillas, y es la de un jugador simulado: nadie midió todavía a una persona.

**Decisiones que te quedan.**

| Decisión | Recomendación |
| --- | --- |
| ¿La partida rápida pasa a ser de dobles? | **Sí, después de probarlo en el celular.** Es el pádel que jugás, y la posición se nota. El 1 contra 1 queda como opción. |
| ¿El alcance real para todos, también en 1 contra 1? | **Sí.** La zancada y la flexión ya están (fase 2). Probalo primero con `?alcance=real` para sentir la diferencia. |
| ¿Qué es el 1 contra 1? | **Cruzado**, en media cancha y en diagonal. |
| ¿Tu lado por defecto? | **Revés**: tomás el medio, como el más fuerte de una pareja, y es donde la posición paga más. Drive en Opciones. |
| ¿Quién es el compañero por defecto? | **Beto**, el profe, que avisa todo. Los demás se eligen después de haberlos enfrentado. |
| ¿Cuánto se desordena la pareja rival? | **Como ahora** (una de cada cinco pelotas tuyas, según la entereza de cada rival), y afinarlo jugando en el celular: que se note y que no parezca torpe. |
