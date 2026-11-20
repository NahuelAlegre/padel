# Zonas de golpe

**En una línea:** importa dónde te queda la pelota alrededor del cuerpo. Al costado sale como la pediste; al cuerpo solo la podés bloquear, y sale blanda al medio; si ya te pasó, sale un manotazo flojo, o no llegás. A la computadora le pasa lo mismo.

**Cómo probarlo:** `?zonas` prende las zonas para el partido (`?zonas=no` las apaga). Se combina con lo demás: `?zonas&dobles&alcance=real`. También está en **Opciones → Experimental → Zonas de golpe**. Apagadas, el juego es exactamente el de siempre: mismos golpes, mismos tests y mismos números de `npm run sim`.

**El pedido.** El usuario quiere juego posicional: «que el jugador sepa que tiene que estar bien parado antes de golpear». Hasta ahora la simulación medía solo a qué distancia del cuerpo estaba la pelota. Castigaba la pelota lejana, pero una pelota al pecho contaba como perfecta y una que ya había pasado detrás contaba igual que una al costado. Eso además obligaba a la animación a inventar poses imposibles: según la investigación de anatomía, el 21 % de los golpes se daba detrás de los pies.

La versión visual, con el diagrama de las zonas y los números, es el Artifact privado [«Zonas de golpe»](https://claude.ai/artifact/CbfB2DpdTL3KjUuzGdPtYs); su fuente está en [zonas.html](zonas.html).

---

## 1. Las zonas

La pelota se mide en los ejes del jugador, en el instante en que la pala la encuentra.

- **Hacia dónde mira:** a la red, girado hacia la pelota que viene, hasta 15°. Una pelota que viene del vidrio de fondo se espera mirando a la red.
- **El contrapared es la excepción:** el cuerpo se da vuelta hacia el vidrio, así que lo que estaba atrás le queda adelante.

| Zona | Dónde | Qué le pasa al golpe |
| --- | --- | --- |
| **Ideal** | Al costado, un poco adelante: cerca del punto dulce (62 cm al costado, 20 cm adelante), entre la rodilla y el hombro. | Control total: va adonde apuntaste, con la fuerza y el golpe que pediste. |
| **Al cuerpo** | A menos de unos 30 cm de la línea del cuerpo, desde el pecho hasta el largo del brazo adelante (1 a 1,6 m), por debajo de la cabeza. | **Bloqueo**: sale blanda, alta y corta, hacia el medio, y cuesta dirigirla. |
| **Lejos** | En el borde del alcance. | Como hoy: estirada, sale floja. |
| **Atrás** | La pelota ya pasó la línea del cuerpo: desde 20 cm detrás (30 cm por arriba de la cabeza, donde la espalda se arquea). | **Manotazo**: flojo e impreciso. A 90 cm detrás ya no se llega. En pádel, lo correcto es esperarla a la salida del vidrio. |
| **Arriba** | Por encima de la cabeza. | Como hoy: bandeja, víbora o remate. Por arriba de la cabeza no hay «al cuerpo». |
| **Abajo** | Al ras del piso (menos de 40 cm). | Como hoy: se levanta, flexionando. |

**Todo es gradual.** Cada zona es un número de 0 a 1:

- **Al cuerpo:** una pelota a 15 cm de la línea del cuerpo cuenta entera; a 45 cm, nada.
- **Atrás:** desde 20 cm detrás de la línea crece hasta contar entera a 90 cm.

Mal parado no fallás: tu golpe pasa a ser defensivo, más cuanto peor estás. La zona que se nombra (para la animación y las estadísticas) es la parte más grande, si llega a la mitad.

**La regla de oro, ampliada.** `docs/dobles.md`, sección 4, dice que si el cuerpo no llega en la animación, la simulación no deja pegar. Ahora eso también vale hacia atrás. Una pelota que pasó la línea del cuerpo por más de 90 cm no se pega: el golpe queda armado (la persona la puede esperar a la salida del vidrio) o la computadora le pega al aire. Es la envolvente por golpe que proponía la investigación de anatomía (paso 3), en su forma más simple: una sola envolvente, en los ejes del cuerpo, para todos los golpes.

Los números están en `zones` de `src/config.ts`, y la geometría en `src/sim/zones.ts`.

## 2. Qué le hace al golpe

Las zonas entran en la **presión** (`ballPressure`, `src/sim/pressure.ts`), la misma que ya bajaba el ritmo, la altura y el ángulo de una pelota difícil. Se suman dos partes nuevas:

| Parte | Peso en la presión | Además |
| --- | --- | --- |
| Al cuerpo | hasta 1 (la presión llega al tope) | La dirección pedida se achica un 80 % hacia el medio (`blockAim`) y la dispersión suma 2 (`blockScatter`): poco control. |
| Atrás | hasta 0,6 | La dispersión suma 1 (`behindScatter`): impreciso. |

Con la presión al tope, la pelota sale:

- un 40 % más lenta,
- un metro más alta sobre la red,
- con la mitad de ángulo,
- un 60 % más corta.

Es una pelota para que el otro ataque. Lejos, arriba y abajo no cambian: ya estaban en la presión («estirada», «contra el piso»).

**El otro la castiga.** Un bloqueo o un manotazo flota, y en la cancha se ve: el cuerpo lo mostró. Por eso la computadora remata esa pelota, si puede atacarla, por lo menos el 70 % de las veces, aunque sea alguien que casi nunca remata (Beto remata el 10 % de las pelotas para atacar). Una pelota regalada la ataca cualquiera.

## 3. La computadora sufre lo mismo

La misma función mide la zona de todos, persona o computadora, en el contacto. Además:

- **Se acomoda para dejar la pelota en su zona ideal.** Corre al costado de la pelota en los ejes del cuerpo que la va a recibir (girado hasta 15°). Cuando una pared la empujaría a quedar encima de la pelota, ese lugar le cuesta lo que cuesta un bloqueo.
- **Pero no queda clavada en su lugar.** Termina al costado de su lugar, más cerca o más lejos de la pelota, tanto como dan sus manos (`zones.place`). Con una pelota cómoda, bien parada. Con una que le exigiste (la presión, el apuro, el cambio de ritmo, la sorpresa: `demandOf` en `src/control/ai.ts`), encajonada o estirada, como una persona. El error lo provocás vos, como ya pasaba con el timing (`docs/ia.md`, sección 2). Beto, torpe, se desacomoda más que Chela; el compañero, de manos firmes, menos.
- **Si va a pegar tarde, llega tarde con todo el cuerpo.** No se queda parada con el brazo atrasado: se acomoda para la pelota que de verdad va a encontrar, más adelante en su camino. Lo tarde cuesta lo que cuesta el timing, y la pelota no le queda detrás de los pies.
- **Tira al cuerpo como táctica.** Al que está en la red, con una pelota que puede pegar de frente, la computadora le apunta al cuerpo: la pelota pasa por el pecho y cae 1,8 m detrás. Lo hacen más los agresivos: Romina en el 45 % de esas pelotas, Beto y Chela en el 10 %. Es táctica real de pádel: al cuerpo solo se bloquea.

## 4. Cómo se entiende sin leer

1. **Lo muestra el cuerpo.** Con lo que ya existe, sin clips nuevos:

   | Zona | Mirada (`ScenePlayer.why`) | Qué hace el cuerpo |
   | --- | --- | --- |
   | Al cuerpo | `block` | La pala adelante del pecho, sin armado, esperando la pelota; la cabeza se aparta y la mano libre sube al costado de la cara. |
   | Atrás | `hurried` | Sin armado: el golpe entra tarde, a mitad del clip. |
   | Ideal o lejos | la de siempre | El golpe limpio, o la estirada que ya existe. |

   Antes, solo la computadora tenía estas miradas. Ahora las tiene cualquiera, vos incluido, mientras mantenés el pulgar apretado apuntando. La zona se decide a 0,2 s del contacto, con adónde va a estar cada uno: el lugar al que corre o, si lo movés vos, adónde va. Después no cambia hasta que termina el golpe, así el cuerpo no cambia de clip a mitad de camino. Está en `fillScene`, `src/app/scene.ts`.
2. **Lo confirma la pelota.** Va adonde apuntaste, o sale blanda al medio.
3. **El nombre, solo para el bloqueo.** El cartel de los golpes especiales dice «Bloqueo» cuando una pelota tuya te llegó al cuerpo. Es el mismo cartel de «Bandeja» o «¡Remate!»: no hay círculos ni carteles nuevos.

## 5. Para la animación: lo que falta

Hoy se usan las dos miradas que ya existían. Para una ronda de animación posterior (no se tocó `src/render/toon/`):

| Clip | Para qué | Notas |
| --- | --- | --- |
| **Bloqueo al cuerpo, codo arriba** | La pelota al pecho o a la cadera del lado de la pala. | El bloqueo de revés del pádel: codo arriba, pala delante del pecho, empuje corto, medio paso atrás con el pie libre. Dos alturas, pecho y cadera. Hoy el bloqueo de revés se confunde con una volea (`docs/dobles.md`). |
| **Golpe tarde** (manotazo) | La pelota al costado de la cadera o detrás. | El peso atrás, la cadera que gira hacia atrás, la pala que llega arrastrada y una muñeca corta. De derecha y de revés. |
| **Paso de acomodo** | Hacerse lugar antes de pegar: un paso al costado, alejándose de la pelota. | Que se vea que acomodarse es un gesto. Opcional. |
| **Estirada hacia adelante** | La pelota de frente, al largo del brazo. | Hoy cae en «al cuerpo» parcial: es un empuje. Opcional. |

El evento `hit` trae la zona (`zone`) y a qué distancia estaba la pelota, al costado (`side`) y adelante (`ahead`). Cada jugador guarda la zona de su último contacto (`player.zone`). La animación puede elegir el clip con eso, sin leer la simulación.

## 6. Cómo se mide

`npm run sim` tiene un informe nuevo, `zones` (`tests/sim/zones.sim.ts`). Juega cada casilla con las zonas apagadas y prendidas, con las mismas semillas:

- **1 contra 1:** con el alcance de hoy, la partida rápida.
- **Dobles:** al revés con el alcance real, una vez con cada personaje de compañero.

Por defecto son 30 partidos por casilla. Los números de abajo son de `SIM_MATCHES=100`, con un ruido de unos ±3 puntos.

**Las personas simuladas** (`tests/helpers.ts`) tienen las mismas manos (las del jugador promedio), las mismas piernas y la misma cabeza (con táctica). Solo cambia cómo se paran:

| Persona | Cómo se para |
| --- | --- |
| **Bien parado** | Termina a ±15 cm del lugar cómodo (al costado de la pelota, un poco detrás) y afloja la palanca al llegar, como una persona. |
| **Sin acomodarse** | Con llegar le alcanza: termina en cualquier lugar a un paso (90 cm) de donde va a pegarle. Afloja la palanca igual que la otra. |
| **La de los otros informes** | La de siempre: ±45 cm del lugar cómodo, con la palanca a fondo hasta 30 cm del lugar. |

«Sin acomodarse» llega a la pelota tanto como «bien parado»: solo cambia dónde le queda. Así se mide lo que agregan las zonas, y no el alcance. Correr a la pelota o moverse lo justo mezclaba otras cosas: se mueve menos, y queda mejor para la pelota siguiente.

### Lo que paga estar bien parado

| Casilla | Sin zonas | Con zonas |
| --- | --- | --- |
| 1 contra 1, Beto | +4 pp | **+12 pp** |
| 1 contra 1, Romina | +10 pp | **+19 pp** |
| 1 contra 1, Chela | +14 pp | **+23 pp** |
| Dobles con Beto (contra Romina y Chela) | +5 pp | **+10 pp** |
| Dobles con Romina (contra Beto y Chela) | +3 pp | **+8 pp** |
| Dobles con Chela (contra Beto y Romina) | +1 pp | **+6 pp** |

- **En 1 contra 1 se cumple la meta** de unos +15 pp: +12 a +23. Contra Beto paga menos porque Beto casi no castiga.
- **En dobles paga, pero menos:** +6 a +10. Pegás la mitad de las pelotas, el compañero tapa parte de tus errores y un bloqueo al medio hace dudar a la pareja rival. Es la decisión 4 de la sección 10.

### ¿Más difícil o más fácil? Puntos ganados, sin zonas → con zonas

| Casilla | Bien parado | Sin acomodarse | Persona de los otros informes | Segundos por punto (persona de siempre) | Errores propios por partido (persona de siempre) |
| --- | --- | --- | --- | --- | --- |
| 1 contra 1, Beto | 87 → 87 % (+0) | 83 → 74 % (−9) | 77 → 71 % (−6) | 10,5 → 10,7 | 0,5 → 0,8 |
| 1 contra 1, Romina | 77 → 76 % (−1) | 66 → 57 % (−9) | 65 → 57 % (−8) | 11,3 → 10,5 | 0,8 → 1,1 |
| 1 contra 1, Chela | 77 → 78 % (+1) | 63 → 55 % (−8) | 66 → 56 % (−10) | 14,9 → 14,8 | 1,1 → 1,6 |
| Dobles con Beto (contra Romina y Chela) | 66 → 70 % (+4) | 61 → 60 % (−1) | 56 → 58 % (+2) | 13,7 → 13,8 | 0,9 → 1,0 |
| Dobles con Romina (contra Beto y Chela) | 81 → 85 % (+4) | 78 → 77 % (−1) | 74 → 75 % (+1) | 10,6 → 10,4 | 0,8 → 0,6 |
| Dobles con Chela (contra Beto y Romina) | 75 → 77 % (+2) | 74 → 71 % (−3) | 64 → 65 % (+1) | 11,1 → 10,3 | 0,6 → 0,8 |

- **Para el que se para bien no cambia nada**: −1 a +1 en 1 contra 1. En dobles gana un poco (+2 a +4), porque la computadora también se desacomoda.
- **Los puntos duran lo mismo.** Los errores propios suben un poco, por los bloqueos que se van.
- **Las diferencias entre rivales se mantienen:** Beto sigue siendo el más fácil, y Romina y Chela parecidas.
- **El que se para como la persona de los otros informes** (±45 cm, palanca a todo o nada) pierde 6 a 10 puntos en 1 contra 1. En dobles no pierde nada.
  - **Contra Romina,** bajar sus tiros al cuerpo no lo cambió: lo que cuesta son los bloqueos propios, que ella remata.
  - **Una persona que lo prueba aprende a acomodarse,** que es justamente lo que se busca. Pero la primera impresión puede ser «está más difícil». Es la decisión 2 de la sección 10.

**Cómo se llegó a estos números.** La primera versión castigaba sobre todo lo tarde, y le pegaba igual al que se paraba bien y al que no. Hubo que:

- Ensanchar el «al cuerpo» hasta el largo del brazo, porque la simulación se salvaba pegándole a la pelota de frente a 1,3 m.
- Hacer que la computadora también se desacomode y llegue tarde con todo el cuerpo.
- Hacer que una pelota regalada la remate cualquiera.

Con eso, las zonas castigan al que se para mal y no al que se para bien.

### Dónde cae la pelota

La persona de los otros informes, en 1 contra 1 contra Romina y en dobles con Beto contra Romina y Chela (la situación de la investigación de anatomía):

| | Quién | Ideal | Al cuerpo | Atrás | Lejos | Arriba | Abajo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 contra 1, sin zonas | persona | 58 % | 14 % | 11 % | 3 % | 4 % | 10 % |
| | computadora | 75 % | 0 % | 4 % | 1 % | 15 % | 5 % |
| 1 contra 1, con zonas | persona | 64 % | 13 % | 4 % | 3 % | 4 % | 12 % |
| | computadora | 63 % | 16 % | 0 % | 3 % | 15 % | 4 % |
| Dobles, sin zonas | persona | 45 % | 13 % | 9 % | 17 % | 9 % | 7 % |
| | computadora | 76 % | 1 % | 4 % | 3 % | 12 % | 5 % |
| Dobles, con zonas | persona | 50 % | 15 % | 3 % | 16 % | 8 % | 8 % |
| | computadora | 65 % | 13 % | 0 % | 6 % | 12 % | 4 % |

- **La computadora antes nunca quedaba encima de la pelota;** ahora la exigís y queda al cuerpo un 12 a 22 % de las veces, como una persona.
- **Atrás casi desaparece:** la persona elige mejor dónde pegarle y la computadora llega tarde con todo el cuerpo.
- Las zonas de las otras casillas están en la salida del informe.

### Golpes detrás de los pies

| | Sin zonas | Con zonas |
| --- | --- | --- |
| **Todos los golpes, dobles con Beto contra Romina y Chela** (la situación de la investigación, que midió 21 %) | **19 %** | **8 %** |
| Todos los golpes, los otros dobles | 18 a 20 % | 7 a 8 % |
| Todos los golpes, 1 contra 1 | 17 a 26 % | 11 a 13 % |
| La computadora | 7 a 23 % | **1 a 3 %** |
| La persona de los otros informes | 23 a 34 % | 21 a 28 % |

- **La computadora ya casi no le pega detrás de los pies.**
- **La persona sí, todavía:** cuando suelta tarde o se para adelante de la pelota. Lo muestra el cuerpo (el apurado) y lo cobra la pelota.
- «Detrás de los pies» es la pelota detrás de la línea del cuerpo en el contacto, medida en la simulación. La investigación lo midió sobre el cuerpo dibujado; las dos dan parecido sin zonas (19 y 21 %).

### Lo muestra el cuerpo antes de pegar

Todos los jugadores de la cancha, con la persona «sin acomodarse», 100 partidos:

| | 1 contra 1 contra Beto | Dobles con Beto |
| --- | --- | --- |
| Pelotas al cuerpo que el cuerpo mostró bloqueadas antes del contacto | 63 % | 71 % |
| Pelotas atrás que mostró apurado | 23 % | 39 % |
| Pelotas en otra zona que mostró bloqueadas de más | 3 % | 4 % |

- **El bloqueo casi siempre se anticipa bien** y casi nunca se muestra de más.
- **El apurado se anticipa poco:** casi siempre es un swing tarde, y ese se decide recién al soltar.

### En el navegador

`node scripts/zones.mjs` (o `--url` con el servidor de desarrollo) juega en un celular emulado, en Chrome headless, con `?zonas&dobles&alcance=real` y con `?zonas`. Un jugador dentro de la página mueve a la persona y le pega de dos maneras: al costado de la pelota, o parado en su línea. Con 90 s por partido:

| | Golpes | Ideal | Al cuerpo | Bloqueo mostrado antes | Cartel «Bloqueo» | Golpes pedidos sin pelota |
| --- | --- | --- | --- | --- | --- | --- |
| Dobles, al costado | 15 | 80 % | 0 % | — | 0 | 0 |
| Dobles, en la línea | 10 | 20 % | 70 % | 6 de 7 | 7 | 0 |
| 1 contra 1, al costado | 20 | 90 % | 5 % | 0 de 1 | 1 | 0 |
| 1 contra 1, en la línea | 23 | 22 % | 74 % | 15 de 17 | 17 | 0 |

- **La página no tiró errores.**
- **La pelota al cuerpo sale a 10 m/s,** contra 15 m/s al costado.
- **Ningún golpe pedido quedó sin pelota:** no aparecieron pelotas imposibles de devolver. La pelota al cuerpo siempre se puede bloquear, y la que pasó de largo se puede esperar a la salida del vidrio.

Falta lo que solo dice una persona: si se siente justo. Es lo primero de la sección 10.

### Los tests

`tests/zones.test.ts`, 18 tests:

- **La geometría:** la ideal, al cuerpo, atrás, lejos, arriba, abajo y el contrapared.
- **La presión.**
- **Apagadas, nada cambia,** aunque se cambien todos los números.
- **En una cancha de práctica:** al costado sale como se pidió; al cuerpo, más lento y al medio. Con la opción apagada, igual que al costado. El cuerpo muestra el bloqueo antes del contacto, y solo con las zonas.
- **La envolvente:** a una pelota que pasó por más de lo que alcanza, no se le pega.
- **El tiro al cuerpo:** pasa por donde está parado el de la red, a media altura.
- **La opción:** apagada por defecto, y se recuerda.

## 7. Enseñarlo en el tutorial

Propuesta, no está hecha. Mismo formato que las lecciones de hoy: una situación, el profe tira la pelota y hacen falta tres aciertos.

**Lección «Al costado».**

- **La situación:** estás en el fondo y el profe te tira pelotas derecho al cuerpo, a media altura, después del pique.
- **Si te quedás donde estás:** la pelota te llega al pecho, el cuerpo bloquea (la pala adelante, la mano a la cara), la pelota sale blanda al medio y el profe la remata. No hace falta texto: se ve.
- **Acierto:** pegarle con la pelota al costado (zona ideal) y que vaya adonde apuntaste.
- **La pista, de una sola vez:** si fallás dos seguidas, aparecen las pisadas de dónde pararse (abajo) al costado de la línea de la pelota, y se van cuando llegás.

**Lección «Esperala»** (opcional): pelotas profundas que pican cerca del fondo. Si te quedás adelante, te pasan y sale un manotazo. El acierto es retroceder y pegarle al costado, o dejar que pegue en el vidrio y pegarle a la salida.

**Las pisadas, como suelas de zapatilla.** Hoy son dos puntitos blancos que el usuario no entendió. La propuesta:

- Dos suelas de zapatilla de tamaño real, con la punta y el taco y un par de líneas de dibujo de suela, en blanco tiza al 60 %, como pintadas en la cancha.
- Miran a la red, giradas hacia la pelota que viene, con el pie de afuera un poco más atrás: la postura abierta del golpe que se viene.
- Aparecen cuando el jugador leyó la pelota y se desvanecen cuando estás a 15 cm de ellas.
- Solo en las lecciones, o con todas las ayudas.
- Se dibujan con una forma calculada (una calcomanía en 3D, un `Path2D` en 2D): casi nada de peso y nada de arte nuevo. Va en `src/render/stage/`, no en los personajes.

## 8. Rendimiento y peso

- **Un paso de la simulación de dobles,** con la opción prendida, cuesta unos 3 µs más: de 5 a 8 µs en la PC de prueba, en tres medidas alternadas.
  - El costo sale de elegir el contacto de la persona: la zona se evalúa en cada punto de la trayectoria al alcance, unos 160 por paso.
  - En un Android de gama media, unas 6 veces más lento, son unos 40 µs por cuadro: un 0,2 % de los 16,7 ms.
  - Apagada, cuesta una lectura de zona por golpe, para el evento.
- **Peso:** el código del juego pasa de 90,9 a 93,3 KB comprimido (+2,3 KB). La descarga sigue en unos 330 KB.
- **Sin arte nuevo:** las miradas del cuerpo ya existían.

## 9. PHYSICS_VERSION

**No cambia.** Con las zonas apagadas la simulación es la misma, bit a bit:

- `npm run sim`, informe `depth`, da idéntico a `main`, línea por línea.
- Un test (`tests/zones.test.ts`) juega un partido entero cambiando todos los números de las zonas, apagadas, y verifica que cada golpe sale igual.
- Los tests existentes pasan sin cambios.

Prendidas, son una regla del partido, como el alcance real: un partido guardado solo guarda el marcador, y al retomarlo sigue con lo que diga la opción. Cambiar `PHYSICS_VERSION` haría descartar todos los partidos guardados sin motivo. Cuando las zonas pasen a estar prendidas por defecto, ahí sí hay que subirlo.

## 10. Decisiones que te quedan

Para después de probarlo en el celular, con `?zonas&dobles&alcance=real` y con `?zonas` en la partida rápida.

| Decisión | Hoy | Recomendación |
| --- | --- | --- |
| **¿Se siente justo?** Lo más importante: que un bloqueo se entienda (lo muestra el cuerpo, lo confirma la pelota) y no parezca un castigo de la máquina. | Una pelota al cuerpo sale blanda al medio, y una regalada la remata cualquiera. | **Probarlo primero.** Si castiga de más, hay tres perillas: el peso del bloqueo (`zones.weights.body`, `blockScatter`), cuánto te ayuda la simulación a elegir un contacto que no te encajone (`dodge`) y cuánto se remata una pelota regalada (`GIFT_PUNISH`). |
| **¿Contra Romina?** Es la que más castiga a quien se para mal: remata toda pelota que flota. | El jugador simulado «de siempre», que se para con unos 45 cm de error, pierde unos 10 puntos de cada 100 contra ella con las zonas. | **Dejarlo así si se siente como Romina.** Es su personaje. Si se siente injusto, que tire menos al cuerpo (`zones.bodyShot`). Eso solo no alcanzó en la medición, porque lo que más cuesta son los bloqueos propios. |
| **¿Lo tarde cuenta como «atrás»?** | Sí: si soltás tarde, la pelota ya pasó; sale un manotazo, y a más de 90 cm no hay golpe (el golpe queda armado para la salida del vidrio). | **Así.** Es lo que pasa de verdad, el cuerpo lo puede mostrar y soltar antes no cuesta nada (el golpe queda armado). La alternativa es medir la zona solo por dónde te paraste y dejarle lo tarde al timing, como antes; los golpes detrás de los pies de la persona no bajarían. |
| **¿El bloqueo va al medio o vuelve a quien la pegó?** | Al medio, como se acordó. | **Probar «vuelve a quien la pegó» en dobles.** Al medio hace dudar a la pareja rival, y por eso en dobles estar bien parado paga menos. Un bloqueo de verdad devuelve la pelota hacia donde vino. |
| **¿El cartel «Bloqueo»?** | Solo en tus golpes, con las zonas. | **Dejarlo** mientras se aprende; se puede sacar cuando el bloqueo tenga su clip propio. |
| **¿Las zonas por defecto?** | Experimental, apagadas. | **Cuando se sientan bien en el celular.** Para eso hace falta subir `PHYSICS_VERSION`, recalibrar a los rivales, la lección «Al costado» y las pisadas como suelas. |
| **¿La ronda de animación?** | Se usan el bloqueo y el apurado que ya existían. | **El bloqueo con el codo arriba primero** (sección 5): es el que más se ve y el que hoy se confunde con una volea. |
