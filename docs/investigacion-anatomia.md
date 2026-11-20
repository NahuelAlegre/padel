# Personajes que no se rompen: investigación de anatomía

**En una línea:** los brazos y las muñecas se deforman por tres causas que se suman. Primero, la cinemática inversa trata el codo y la rodilla como rótulas y no les pone topes. Segundo, los clips fijan la orientación de la pala en el espacio sin mirar el antebrazo, y la muñeca absorbe lo que sobra. Tercero, la piel no tiene cómo repartir un giro. Debajo hay un cuarto problema: la simulación pone la pelota donde el clip no llega. Un prototipo hecho solo en la medición, sin tocar el juego, arregla la mayor parte con una IK que conserva la bisagra y pone topes, y además deja la pala más cerca de la pelota que hoy.

Lo pidió el usuario después de mirar el estudio con Zoom: *«los personajes se deforman mientras juegan, sobre todo muñecas y brazos, y se siente raro durante la partida»*. Este documento responde tres preguntas: qué causa cada deformación, cómo lo resuelven otros juegos de deportes y por dónde conviene empezar. **No se cambió código del juego.** Las mediciones se hicieron con scripts aparte (ver la sección 7).

Hay un Artifact privado con las capturas, los diagramas y las comparaciones de antes y después: [«Anatomía de los personajes»](https://claude.ai/artifact/LEj1ZAt7EvqgGJVuchgZyw).

## Resumen

| | Qué pasa | Cuánto | De dónde sale |
| --- | --- | --- | --- |
| 1 | **El codo se dobla fuera de su plano o al revés** | 63 % de los cuadros cerca del golpe, hasta 174° fuera del plano | La IK del brazo (`bendLimb`): gira cada hueso por el arco más corto y no tiene topes. Después del golpe sigue tirando de la mano hacia el contacto y el codo se dobla al revés (hasta −143°). |
| 2 | **La muñeca de la pala, quebrada** | 96 % de los cuadros cerca del golpe; 78 % aun descontando el agarre | Los clips de Blender fijan la pala en el espacio del personaje y la muñeca absorbe lo que sobra. El agarre del modelo es de martillo y suma unos 45° de desvío en cualquier pose. La IK mantiene la mano fija en el mundo cuando mueve el antebrazo. |
| 3 | **La mano libre retorcida** | 59 % cerca del golpe; 78 % durante los gestos | La mano libre también está fijada en el espacio en los clips (giros de 130° a 180° en el revés y la volea). Los gestos de la IA usan la misma IK sin topes. |
| 4 | **Rodillas que se doblan de costado y la pierna en «spagat»** | 73 % de todos los cuadros, hasta 130° fuera del plano | La IK de piernas, con el mismo problema que la del brazo y un polo fijo «hacia adelante» del personaje. Cuando la cadera va lejos tras la pelota, la pierna estirada no llega al pie apoyado y queda en el aire. |
| 5 | **La piel se afina o se pellizca en muñeca y codo** | La muñeca cerca del golpe gira en total 129° (mediana): el anillo de la muñeca pierde el 57 % del grosor | Mezcla lineal con un solo anillo de vértices al 50 % en la muñeca y otro en el codo, sin hueso de giro en el antebrazo y con la malla atada en pose T. |
| 6 | **La pelota está donde el clip no llega** | El 21 % de los golpes se da detrás de los pies. Al clip le falta una mediana de 36 cm para llegar (p90: 91 cm) | La simulación respeta el alcance real, una distancia, pero no hacia dónde mira el cuerpo ni lo que alcanza cada golpe. |

**Lo que hacen los demás**, en una frase: los juegos grandes evitan la IK grande. Tienen muchas variantes de cada golpe y eligen la que ya pasa por la pelota (TopSpin 2K25 usa nueve animaciones por estilo de derecha o revés), ajustan la posición y el tiempo del cuerpo entero (*motion warping*), y la IK que queda es chica, con bisagra y con topes. La piel lleva huesos de giro en el antebrazo y el brazo.

**Por dónde empezar** (sección 5):

1. Una prueba automática de límites. Ya está escrita como script de medición.
2. Cambiar `bendLimb` por una IK de dos huesos con bisagra y topes.
3. Recortar las muñecas a su rango en cada cuadro.

Son unas 150 líneas, sin peso nuevo y sin tocar los clips. En el prototipo, cerca del golpe:

- Las rodillas fuera de rango bajan del 86 % al 0 %.
- Los codos de la pala, del 63 % al 6 %.
- Las dos muñecas, al 0 %.
- La pala queda de la pelota a una mediana de 1 cm, contra 9 cm hoy.

Después siguen la simulación (elegir el contacto dentro de lo que alcanza el golpe), los clips (agarre diagonal, mano relativa al antebrazo) y la piel (hueso de giro del antebrazo).

## 1. Cómo se midió

- **Ángulos de cada articulación**, cuadro a cuadro, sobre el esqueleto que dibuja el juego. Cada uno es la rotación de un hueso respecto de su padre, descompuesta en giro alrededor del hueso y balanceo (*swing-twist*).
  - El modelo no tiene rotaciones de reposo, así que el «cero» es la pose T: brazos al costado, palmas abajo, pulgares adelante, codos hacia atrás.
  - El lado derecho se espeja para usar las mismas convenciones.
  - Los ejes se verificaron con los clips: en todos, codos y rodillas son bisagras perfectas (0° fuera del plano). Eso confirma que la medida está bien orientada.
- **Etapas del animador.** Se engancharon sus pasos (solo para medir) y cada cuadro se mide cinco veces:
  - **clip**: los clips mezclados, con la postura del personaje y el giro de cadera de la carrera;
  - **piernas**: después de llevar el cuerpo a la pelota (cadera, paso, rodillas);
  - **brazo**: después de la IK que pone la pala en la pelota;
  - **gesto**: después de los gestos de la IA y de las manías;
  - **final**: lo que se dibuja.

  La causa de una infracción es la primera etapa en la que ya pasaba al menos la mitad de lo que termina pasando.
- **Dónde:**
  - Partidos de dobles con el alcance real: una persona guionada y Beto contra Romina y Chela, y la demo con cuatro IA. Cuatro partidos de cada uno, unos 450.000 cuadros de jugador.
  - Las situaciones del estudio, jugadas igual que en `?estudio`: la misma demo fija, la misma búsqueda y el mismo animador, cuadro a cuadro.
  - Los 24 clips solos, como salen de Blender.
- **Límites:** los de la sección 6, tomados de rangos normales de movimiento.
- **La muñeca de la pala se mide de dos maneras.** El modelo agarra el mango perpendicular al antebrazo, como un martillo (sección 2.3). Para sostener la pala como un jugador, la mano tiene que estar unos 45° desviada hacia el meñique en cualquier pose. Por eso, además de la medida tal cual, se informa la medida «con agarre diagonal»: la misma pose, como si el mango cruzara la palma en diagonal, que es como se agarra una pala de verdad.

### Cuadros fuera de rango

Partidos de dobles, persona guionada. La demo con cuatro IA da lo mismo con ±3 puntos. Entre paréntesis, la etapa que lo causa.

| Grupo | Todos los cuadros | Golpes, ±0,3 s del contacto | Gestos | Corriendo | Parado |
| --- | --- | --- | --- | --- | --- |
| Muñeca de la pala, tal cual | 98 % | 96 % | 99 % | 99 % | 98 % |
| Muñeca de la pala, con agarre diagonal | 31 % (clip 87 %) | 79 % (clip 66 %, brazo 31 %) | 43 % | 50 % | 5 % |
| Muñeca libre | 18 % (gesto 66 %, clip 34 %) | 59 % (clip 78 %) | 78 % (gesto 100 %) | 0 % | 3 % |
| Codo de la pala | 10 % | **63 % (brazo 91 %)** | 12 % (gesto 82 %) | 6 % | 2 % |
| Codo libre | 9 % (gesto 92 %) | 13 % | 44 % (gesto 100 %) | 3 % | 1 % |
| Hombros | 12 % | 29 % | 49 % (gesto 99 %) | 8 % | 0 % |
| Rodillas | **73 % (piernas 100 %)** | 87 % | 63 % | 39 % | 92 % |
| Caderas | 2 % | 17 % (piernas 99 %) | 0 % | 0 % | 0 % |
| Tobillos | 7 % | 46 % (piernas 89 %) | 2 % | 2 % | 2 % |
| Tronco (giro hombros contra cadera) | 1 % | 3 % | 0 % | 1 % | 0 % |

Cómo leerlo:

- **Parado está casi todo bien.** Las excepciones son la muñeca de la pala (el agarre de martillo) y las rodillas: la IK de piernas las tuerce unos 13° (mediana) aunque el jugador esté quieto.
- **Alrededor del golpe se rompe todo a la vez:**
  - el codo de la pala, por la IK;
  - las muñecas, por los clips y la IK;
  - las rodillas, los tobillos y las caderas, por la IK de piernas.
- **Los gestos de la IA** (avisos, señas, sorpresa) rompen el brazo libre y los hombros.
- **Cuánto mueve la IK la mano cerca del golpe:** 12 cm de mediana, 28 cm de p90 y 42 cm como máximo, que es su tope.
- **Valores extremos medidos:**
  - codo de la pala: 174° fuera de su plano;
  - muñeca de la pala: giro total de 180° respecto del antebrazo, la mano dada vuelta;
  - rodilla: 147° de costado.

### Dónde pone la simulación la pelota

Son 708 golpes, sin saques. Las distancias están en metros del personaje: se dividen por su escala de dibujo, 1,2 a 1,5.

| | Todos | Derecha | Revés | Voleas | Estiradas | Bandeja |
| --- | --- | --- | --- | --- | --- | --- |
| Pelota detrás de los pies | 21 % | 20 % | 22 % | 28–37 % | **54–61 %** | 18 % |
| Lo que le falta al contacto del clip (mediana / p90) | 36 / 91 cm | 32 / 62 | 34 / 74 | 34–36 / 105–115 | 82–90 / 121–157 | 89 / 106 |
| Más allá de lo que toma el brazo solo (16 cm) | 86 % | | | | | |
| Más allá de lo que toma el brazo entero (42 cm) | 38 % | | | | | |

En las estiradas, la pelota queda una mediana de 66 a 71 cm **detrás** del punto donde el clip la toca. El clip tira el cuerpo adelante al costado; la pelota pasó.

## 2. Las causas, una por una

### 2.1 La IK del brazo trata el codo como una rótula

`bendLimb` (`src/render/toon/reach.ts`) hace la IK de dos huesos de brazos y piernas:

1. Elige dónde va el codo.
2. Gira el brazo por el arco más corto hasta el codo nuevo.
3. Gira el antebrazo por el arco más corto hasta la muñeca.

El arco más corto no respeta la bisagra. El eje de flexión del codo vive en el brazo, y el segundo giro lo usa solo si por casualidad coincide. En general no coincide, y el antebrazo sale del plano (varo o valgo) y gira sobre su eje: un codo que en una persona estaría dislocado.

- En los clips, el codo de la pala nunca sale de su plano: 0°, siempre.
- Después de la IK, el 63 % de los cuadros cerca del golpe lo saca más de 10°. El p95 es 90° y el máximo, 174°.
- **No hay topes:** la flexión no tiene máximo y nada impide la hiperextensión.

Las otras implementaciones conocidas lo hacen distinto:

- **Daniel Holden**, en *Simple Two Joint IK*, gira las dos articulaciones alrededor de la normal del plano actual del miembro, así el pliegue queda en su plano. Después apunta el miembro entero desde la raíz. Usa un margen para que no se estire del todo, y la dirección de la rodilla cuando está casi recta.
- **Unreal** (*Two Bone IK*) y **Unity** (*Two Bone IK* de Animation Rigging) usan un objetivo para la articulación del medio (*joint target*, *hint*) que fija el plano del pliegue.

### 2.2 Después del golpe, la IK sigue tirando

La IK no se apaga en el contacto. Hasta 0,32 s después (`lungeWeight`) le sigue sumando a la mano el mismo vector «de donde el clip pega a donde está la pelota». En ese tiempo el clip ya hace el seguimiento y la mano cruza el cuerpo: el vector, que tenía sentido en el contacto, ahora apunta a través del torso. Como no hay topes (2.1), el codo se dobla al revés.

| Situación del estudio | Codo de la pala en el clip | Después de la IK |
| --- | --- | --- |
| Volea (Romina), 1,33 s, 0,04 s después del golpe | 131° de flexión, en su plano | **−143°** (doblado al revés) |
| Estirada (Vos), 1,58 s, 0,13 s después | 121°, en su plano | **−113°** |
| Baja (Romina), 1,65 s, 0,07 s después | 126°, en su plano | **−39°** y 43° fuera del plano |

Dura unos 150 ms: 9 cuadros a 60 fps. Es el «se siente raro durante la partida»: un latigazo del brazo justo después de pegar, que se ve en tiempo real y queda clarísimo cuadro a cuadro.

### 2.3 Los clips fijan la pala en el espacio y la muñeca sale como salga

Los clips se escriben como controles (`design/prueba-3d/blender/rig.py`, `animbase.py`). La mano de la pala lleva su posición, el eje de la pala (`racket`) y su cara (`face`), todo en ejes del personaje. La mano libre lleva la dirección de los dedos y de la palma. Al resolver la pose:

- **El antebrazo no tiene giro propio.** Su marco sale del plano del codo, así que el antebrazo funciona como el cúbito: no prona ni supina. **Toda la pronación y la supinación cae en la articulación de la muñeca.**
- **La mano toma la orientación pedida, sin mirar el antebrazo.** El ángulo de la muñeca es lo que sobra, y nadie lo controla. Los scripts verifican que los pies no patinen y que la pala llegue al contacto, pero no los límites de la muñeca.
- **El agarre es de martillo.** En el modelo, el mango cruza el puño perpendicular al antebrazo, hacia el pulgar (`personaje.py`, la mano que agarra). Una pala real se agarra con el mango en diagonal en la palma. Por eso, para que la pala apunte como la de un jugador, la mano tiene que desviarse hacia el meñique:
  - en la espera (`listo`), 50°;
  - en el contacto del revés, 108°;
  - en el de la bandeja, 109°.

  Una muñeca real llega a 30 o 45°. Con un agarre diagonal de 45°, la espera baja a 5°.
- **La orientación de la mano se interpola como vectores, componente a componente** (Catmull-Rom sobre `racket` y `face`). Entre claves, la mano puede dar vueltas rápidas. La mano respecto del antebrazo salta más de 30° de un cuadro al siguiente (a 60 Hz):
  - 12 veces en la derecha (máximo 92°);
  - 9 en la volea (101°);
  - 12 en el remate (99°);
  - 6 en la carrera (80°).

  Son giros de más de 5.000°/s.
- **Algunos polos de codo son casi paralelos al antebrazo** (la mano libre en el revés). El giro del antebrazo queda casi arbitrario.

Los clips solos, sin ninguna capa del animador, medidos con el agarre diagonal para no contar el martillo:

| Clip | Cuadros fuera de rango | Lo peor |
| --- | --- | --- |
| derecha | 71 % | desvío radial de la muñeca de 119°; 12 saltos de muñeca |
| revés | 87 % | mano libre girada 180°; muñeca de la pala girada 177° |
| volea | 78 % | mano libre desviada 163°; codo girado 180° en un cuadro |
| volea de revés | 76 % | mano libre girada 176° |
| bandeja | 80 % | muñeca de la pala girada 174° |
| remate | 81 % | muñeca de la pala desviada 133°; 12 saltos |
| globo | 74 % | muñeca de la pala girada 173° |
| estirada / de revés | 79 % / 55 % | caderas abiertas 131–132° entre muslos; mano libre girada 178–180° |
| saque | 91 % | muñeca de la pala girada 175° |
| correr | 100 % | muñeca de la pala girada 178°; 6 saltos |
| listo, espera, lamento, manía de la gorra | 0 % | — |

Con el agarre de martillo, todos los clips están fuera de rango casi todo el tiempo.

### 2.4 La IK de piernas: rodillas de costado y la pierna que no llega

Las piernas usan la misma `bendLimb`, con un polo fijo: `(0, −0,6, 0)` en ejes del **personaje**, «rodillas adelante». Hay tres problemas:

- **El arco más corto saca la rodilla de su plano**, igual que el codo.
- **El polo no sigue la pelvis.** Si el clip gira la cadera 30° a 70°, como en el armado de la derecha o en una estirada, el polo empuja la rodilla hacia la red y no hacia donde apunta el muslo.
- **Cuando la cadera va lejos tras la pelota, la pierna de atrás no llega al pie apoyado.** La IK la deja recta (1° de flexión) y el pie queda en el aire. Es la pierna «casi en spagat» de la primera captura: abierta 65° y sin tocar el piso.

Resultado: rodillas a más de 10° de su plano en el 73 % de todos los cuadros, también parado (mediana 13°), y hasta 147° en las estiradas. El tobillo absorbe lo que sobra, porque el pie conserva su orientación: el 46 % de los cuadros cerca del golpe pasa sus límites, sobre todo los 35° de flexión dorsal (p95: 57°).

### 2.5 Los gestos de la IA

`gesticulate` lleva la mano libre (y a veces la pala) a puntos fijos del espacio del personaje. Por ejemplo, «¡mía!» con la mano arriba, la seña de apuntar, la sorpresa o el «perdón». Usa la misma IK sin topes, con un polo fijo «codos abajo y afuera», y la mano conserva su orientación en el mundo. Por eso, en los cuadros con gesto:

- la muñeca libre está fuera de rango el 78 % del tiempo, con giros de 150° a 180°;
- el codo libre, el 44 %, a veces doblado al revés (−63°);
- el hombro, el 49 %: la mano lleva el brazo detrás del plano del cuerpo.

### 2.6 La piel: mezcla lineal, un solo anillo y sin hueso de giro

El sombreador (`CHARACTER_VS` en `src/render/toon/shaders.ts`) mezcla linealmente las matrices de hasta 3 huesos por vértice. Es la mezcla lineal de siempre (*linear blend skinning*). El brazo tiene 8 vértices por anillo. Sus pesos (`personaje.py`, `arm_w`):

- **Muñeca:** un solo anillo, en la articulación, al 50 % entre antebrazo y mano. El anillo anterior es 100 % antebrazo y el siguiente, 100 % mano.
- **Codo:** también un solo anillo al 50 %.
- **Muñequera:** rígida al antebrazo, aunque la piel de abajo sea 50 % mano.

Con mezcla lineal, un anillo al 50 % entre dos huesos que difieren en un ángulo θ se achica a cos(θ/2). Si el giro es alrededor del hueso, se achica entero: el «caramelo» (*candy wrapper*). Si es un pliegue, se pellizca del lado de adentro.

| Muñeca de la pala, giro total respecto del antebrazo | Mediana | p95 | El anillo de la muñeca se afina |
| --- | --- | --- | --- |
| Parado | 56° | 84° | 12 % (p95: 26 %) |
| Golpes, ±0,3 s | **129°** | 177° | **57 %** (p95: 97 %, colapsa) |
| Golpes, con agarre diagonal | 109° | 177° | 42 % |

Además, el modelo está atado en **pose T**, con los brazos horizontales. Para bajar el brazo al costado, el hombro recorre 90° desde la pose de reposo. Por eso muchos juegos atan la malla en pose A, con los brazos a unos 45°.

### 2.7 La simulación pone la pelota donde el clip no llega

La regla de oro (`docs/dobles.md`, sección 4) dice que si el cuerpo no puede llegar en la animación, la simulación no deja pegar. Hoy se cumple con una **distancia**: 1,15 m parado y 1,60 m estirado, con topes de altura. No se cumple con la **dirección** ni con **lo que alcanza cada golpe**:

- el 21 % de los golpes se pega detrás de los pies;
- en las estiradas, entre el 54 % y el 61 %.

El animador hace lo que puede:

1. elige un clip por altura y lado;
2. acomoda la cadera y da un paso;
3. le pide a la IK del brazo hasta 42 cm.

Con un faltante de 36 cm de mediana y 91 cm de p90, la IK trabaja casi siempre en su límite. Ahí se rompen el codo y la muñeca (2.1). La «Estirada» del estudio es el caso extremo: la pelota pasa 0,93 m **detrás** del jugador y el clip la busca adelante.

### 2.8 Lo que no es la causa principal

- **La escala por personaje.** Los huesos escalados engrosan brazos y panzas en los ejes del hueso en reposo, antes de rotar (`skinMatrices`), así que no deforman al girar. Sí tiene un efecto indirecto. La rival se dibuja 1,47 veces más grande, y el clip se elige por la altura de la pelota dividida por esa escala. Así, una volea a 1,19 m de altura queda «a la cintura» y se juega con el clip del revés de fondo. Pasa en la tercera captura.
- **La mezcla de capas.** Las capas se mezclan hueso por hueso, en rotaciones locales. En los cruces cortos puede pasar por poses intermedias raras, pero lo que llega de la etapa «clip» ya está en los clips mismos (tabla de 2.3).
- **El giro del tronco.** Pasa los 60° solo en el 1 % al 3 % de los cuadros, cuando el golpe va encima de una carrera con la pelvis girada.

## 3. Las tres capturas, cuadro por cuadro

Reproducidas en `?estudio` con la misma demo fija. Las capturas, con cada capa encendida por separado (solo clip, más piernas, más brazo, final) y con el prototipo de la sección 5, están en el Artifact.

**1. «Estirada», Vos, a 1,42 m del cuerpo (instante clave: 1,44 s).**

- **La pelota está 0,93 m detrás del jugador**, del lado del revés. El clip `estirada_reves` la busca 0,95 m más adelante (2.7).
- **Las piernas (IK de piernas):**
  - la rodilla izquierda se dobla 88° fuera de su plano;
  - la derecha queda recta (1°), abierta 65° y con el pie en el aire.

  Es la pierna en spagat. El clip solo ya abre las piernas 119° entre muslos.
- **El brazo de la pala (IK):**
  - 31° fuera de su plano en el contacto;
  - después del golpe (1,50 a 1,62 s), el codo se dobla al revés hasta −113° y la muñeca se desvía 97° a 122° hacia el pulgar.

  Por eso la pala «no se ve»: queda detrás del cuerpo.
- **La mano libre:** girada 164° respecto del antebrazo, desde el clip.

**2. «Baja», Romina, lejos, pelota a 0,32 m.**

El cuadro de la captura es 1,68 s, unos 0,1 s **después** del golpe (instante clave: 1,57 s).

- **La muñeca de la pala:** extendida 113° y girada 86°. Es la «muñeca doblada al extremo» y el «antebrazo retorcido». Las dos capas tienen su parte: en ese tramo del seguimiento, el clip ya la tiene girada 153° y desviada 80° a 98° hacia el pulgar, y la IK la termina de quebrar.
- **El codo (IK después del golpe):** doblado al revés 39° y 42° fuera de su plano. En ese mismo cuadro, el clip tiene el codo en 101° a 126°, en su plano.
- **El clip mismo:**
  - en el contacto, la muñeca de la pala desviada 105° a 108° hacia el meñique (unos 45° son del agarre de martillo);
  - la mano libre girada 129° a 169°, y el brazo libre recto al costado, como lo escribe el revés.
- **Las piernas «casi rectas» para una pelota baja.** En el contacto la cadera sí baja (rodillas a 122° y 133°), con la rodilla izquierda 68° fuera de su plano. En el cuadro de la captura, el paso ya volvió y el seguimiento del clip levanta el cuerpo.

**3. «Volea», Romina, lejos, a 1,19 m (instante clave: 1,28 s).**

- **Se juega con el clip del revés, no con el de la volea:** Romina se dibuja 1,47 veces más grande, así que la pelota le queda a 0,81 m «de su altura», debajo del umbral de volea (2.8).
- **La muñeca de la pala:** desviada 99° a 115° hacia el meñique. El clip pone unos 100° y la IK suma.
- **El codo:**
  - 25° a 53° fuera de su plano en el contacto (IK);
  - 0,05 s después, doblado al revés hasta −143°.
- **El brazo libre con la mano detrás de la cabeza:** así lo escribe el revés. La mano libre va a (0,44; 0,40; 1,08), atrás y a la altura del hombro, con la muñeca girada 102° a 134°.
- **El torso muy torcido:** el armado del revés más la carrera. El tronco llega a 69° en el armado.

## 4. Cómo lo resuelven otros juegos

### 4.1 De dónde sale la pose

**Muchos datos y elegir el que ya pasa por la pelota.**

- **Golpes según dónde está la pelota.**
  - **TopSpin 2K25** (Hangar 13): cada estilo de derecha o de revés tiene **nueve animaciones**. Se eligen por la altura de la pelota o por la dirección y la velocidad del jugador antes del golpe. Al limpiar la captura, los animadores se aseguran de que la pala toque la pelota a la altura esperada y con la orientación correcta. La captura no registra los dedos: las manos y el agarre se animan a mano ([Xbox Wire](https://news.xbox.com/en-us/2024/04/03/signature-gameplay-animations-for-topspin-2k25/)).
  - El golpe sale soltando el botón dentro de una ventana de tiempo ([2K](https://2k.com/games/topspin-2k/topspin-2k25/centre-court-report/gameplay/)).
- **Volumen de animaciones en otros deportes.**
  - **MLB The Show 23** sumó más de 5.000 animaciones de juego ([Gematsu](https://www.gematsu.com/2023/02/mlb-the-show-23-gameplay-features-detailed-game-sizzle-trailer)).
  - **NBA 2K25** tiene unas 1.500 animaciones de dribbling ([2K](https://nba.2k.com/2k25/the-game/gameplay/)). Antes, las transiciones estaban guionadas sobre una biblioteca capturada ([Microsoft](https://developer.microsoft.com/en-us/games/articles/2024/09/closer-look-at-nba-2k25-proplay-system/)).
- **Búsqueda continua en la base de capturas.**
  - **Motion matching**: en cada cuadro, buscar en toda la base el fragmento que mejor sigue la trayectoria deseada desde la pose actual. Lo presentó Simon Clavet con *For Honor* ([GDC 2016](https://www.gdcvault.com/play/1022985/Motion-Matching-and-The-Road)). Unreal lo trae como *Pose Search* ([Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-matching-in-unreal-engine)).
  - **FIFA 22** (*HyperMotion*) entrena una red con 8,7 millones de cuadros capturados en partidos y genera animación en tiempo real ([80.lv](https://80.lv/articles/ea-uses-machine-learning-for-animations-in-fifa-22)).
- **El camino opuesto.** NBA Live 14 (*BounceTek*) **separó la pelota de la animación** y la simuló, justamente para que no pareciera pegada a la mano ([EA](https://www.ea.com/news/nba-live-14-bouncetek-technology)).
- **El golf.** La pelota está quieta, así que el problema se da vuelta: el golfista se ubica respecto de la pelota. El medidor del swing está atado a la animación ([EA PGA Tour](https://www.ea.com/games/ea-sports-pga-tour/news/ea-sports-pga-tour-gameplay-deep-dive)).

**Pocos clips y procedural.** David Rosen (Wolfire) mostró cómo sacar animación fluida e interactiva de muy pocas poses clave, con técnicas procedurales simples ([GDC 2014](https://gdcvault.com/play/1020049/Animation-Bootcamp-An-Indie-Approach)). Es la familia de nuestro animador: pocas poses, mucha capa procedural.

### 4.2 Pala y pelota sin romper el cuerpo

- **Hacer trampa con la pelota, no con el cuerpo.**
  - En un juego de tenis temprano, la pala era en la práctica mucho más ancha que la real y el golpe se calculaba hacia atrás desde la pelota ([relato de un desarrollador](http://www.ittybittycomputers.com/Essays/Tennis.html)).
  - En TopSpin 2K25 la tolerancia está en el tiempo (soltar el botón dentro de la ventana) y en el resultado del golpe. El cuerpo lo resuelven la selección del clip y la limpieza de los animadores.
- **Mover el cuerpo entero, no el brazo.**
  - **Motion warping** de Unreal: ajusta el desplazamiento de la raíz para que la animación termine alineada con un objetivo ([Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-warping-in-unreal-engine)).
  - **Target matching** de Unity (`Animator.MatchTarget`): mueve y gira al personaje para que una parte del cuerpo, por ejemplo la mano o el pie, llegue a un punto en un instante del clip ([Unity](https://docs.unity3d.com/ScriptReference/Animator.MatchTarget.html)).
  - **Orientation warping y stride warping** de Unreal: giran el cuerpo y estiran el paso para empatar la dirección y la velocidad del movimiento ([Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/pose-warping-in-unreal-engine)). Lyra combina el *distance matching* en los arranques con el *stride warping* ([Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-in-lyra-sample-game-in-unreal-engine)).

  Nuestro paso hacia la pelota y el corrimiento de la cadera son de esta familia.
- **Elegir el clip por dónde está la pelota y cerrar con IK.** La respuesta clásica a cómo adaptar golpes de tenis es dividir el espacio alrededor del jugador en zonas, con una pose por zona, y usar la IK solo para el último tramo ([GameDev.net](https://www.gamedev.net/forums/topic/675001-how-to-adjust-the-players-animation-for-a-3d-tennis-game/)).
- **Las transiciones.** *Gears of War 4* dejó de mezclar dos animaciones en las transiciones. Las reemplazó por un posproceso, la *inercialización*, más barato y sin poses intermedias de mezcla ([GDC 2018](https://gdcvault.com/play/1025165/Inertialization-High-Performance-Animation-Transitions)).

### 4.3 Cinemática inversa con límites

- **IK de dos huesos que conserva la bisagra:**
  - *Simple Two Joint IK* de Daniel Holden: gira alrededor de la normal del plano del miembro, después apunta desde la raíz y deja un margen para no estirar del todo ([theorangeduck.com](https://theorangeduck.com/page/simple-two-joint));
  - *Two Bone IK* de Unreal, con objetivo para la articulación del medio y estiramiento opcional ([Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-blueprint-two-bone-ik-in-unreal-engine));
  - *Two Bone IK* de Unity, con *hint* para la dirección del pliegue ([Unity](https://docs.unity3d.com/Packages/com.unity.animation.rigging@1.2/manual/constraints/TwoBoneIKConstraint.html)).
- **Límites como proyección.**
  - Holden describe un límite como una función que lleva cualquier rotación a la válida más cercana. Se aplica **después** de la IK, de las mezclas o de lo procedural. Los rangos se ajustan **a partir de datos de captura**.
  - Las representaciones: caja, elipse (unas iteraciones de Newton) o K-DOP (unos productos punto). Hay un «ablandado» con `tanh` para que el tope no se sienta como un golpe, y la descomposición *swing-twist* ([theorangeduck.com](https://theorangeduck.com/page/joint-limits), [código](https://github.com/orangeduck/Joint-Limits)).
  - Los ragdolls usan lo mismo: giro con mínimo y máximo, y un cono de balanceo ([Character Joint de Unity](https://docs.unity3d.com/Manual/class-CharacterJoint.html)).
  - El `CCDIKSolver` de three.js admite `rotationMin` y `rotationMax` por eslabón ([three.js](https://threejs.org/docs/pages/CCDIKSolver.html)).
- **IK de cuerpo entero.** Reparte el alcance entre tronco, hombro y brazo. Es más cara y más compleja, y para nuestro caso alcanza con dejar que el pecho gire unos grados hacia la pelota antes del brazo.

### 4.4 La piel

- **Huesos de giro** (*twist bones*). Es la solución estándar al caramelo: uno o dos huesos entre el codo y la muñeca toman una fracción del giro de la mano, y la piel del antebrazo se pesa en degradé hacia ellos ([Cascadeur](https://cascadeur.com/help/rig/advanced_rigging/advanced_rigging_techniques/twist_bones), [foro de Unreal](https://forums.unrealengine.com/t/manny-twist-bones-how/1906562)). El maniquí de Unreal trae `upperarm_twist` y `lowerarm_twist` en cada brazo.
- **Mezcla con cuaterniones duales** (*dual quaternion skinning*). Elimina el caramelo con un costo de sombreador apenas mayor. A cambio infla los pliegues y no maneja bien la escala ([Kavan et al., I3D 2007](https://users.cs.utah.edu/~ladislav/kavan07skinning/kavan07skinning.html)). Disney Research propuso centros de rotación optimizados para corregir el inflado ([Le y Hodgins, 2016](https://la.disneyresearch.com/wp-content/uploads/Real-time-Skeletal-Skinning-with-Optimized-Centers-of-Rotation-Paper.pdf)).
- **Formas correctivas** (*corrective blendshapes*). Una forma de la malla que se activa según el ángulo de la articulación. El *Pose Driver* de Unreal las maneja con interpolación RBF a partir de la orientación de un hueso ([Epic](https://docs.unrealengine.com/4.27/AnimatingObjects/SkeletalMeshAnimation/AnimPose/PoseDriverNode/)).
- **Delta Mush directo.** Calidad de suavizado sin iterar, pensado para tiempo real ([EA SEED, SIGGRAPH 2019](https://www.ea.com/seed/news/siggraph2019-direct-delta-mush)). Es caro en memoria para nuestra escala.
- **Pose de atado.** La pose A (brazos a unos 45°) deja el hombro en la mitad de su recorrido y deforma menos que la pose T ([polycount](https://polycount.com/discussion/comment/2582806/)).
- **Pesos por vértice.** Unity recomienda mezcla lineal con hasta cuatro influencias y pocos huesos en celulares ([Unity](https://docs.unity3d.com/Manual/ModelingOptimizedCharacters.html)). Usamos tres: alcanza.

### 4.5 Juegos chicos, estilizados o de celular

Hay poca información técnica pública:

- **Tennis Clash**, **Mario Tennis** y **OlliOlli World**: no encontré charlas ni artículos sobre cómo animan los golpes. De *OlliOlli 2*, un 2D anterior, se sabe que tenía unos 8.000 cuadros animados a mano.
- **Racket Club** (Resolution Games), de realidad virtual, resuelve el brazo con el brazo real de la persona.

Para nuestro caso valen dos conclusiones:

1. Estilizar no excusa una articulación rota. Con contorno de tinta, un quiebre se ve **más**, no menos: el contorno lo dibuja.
2. De los juegos grandes, lo que se puede copiar sin sus datos es la idea: pocas poses claras, elegidas por dónde está la pelota, y la tolerancia en el tiempo del golpe y no en el cuerpo.

### 4.6 Qué nos sirve

| Técnica | Quién | Costo para nosotros | ¿Nos sirve? |
| --- | --- | --- | --- |
| IK de dos huesos con bisagra y topes | Holden, Unreal, Unity | ~150 líneas, 0 KB de arte, el mismo tiempo de CPU | **Sí, primero** |
| Límites *swing-twist* como pasada final | Holden; los ragdolls | Unos productos por articulación y cuadro | **Sí, primero** |
| Soltar la IK al empezar el seguimiento | — | Una constante | **Sí** |
| Elegir el contacto dentro de lo que alcanza el golpe | TopSpin (selección), la tolerancia en el tiempo | Trabajo en la simulación; el arte ya existe | **Sí** |
| Agarre diagonal; mano relativa al antebrazo en Blender | Animación a mano de las manos (TopSpin) | Regenerar los clips; mismo peso | **Sí** |
| Hueso de giro en el antebrazo | Todos los rigs de juego | 2 huesos (+2 matrices), unos 64 vértices, menos de 1 KB | **Sí** |
| Más variantes por golpe (alturas, salida de pared) | TopSpin, MLB, NBA 2K | ~3 KB por clip sin comprimir | Después |
| Warping del cuerpo entero (raíz) | Unreal, Unity | Ya existe en parte (paso y cadera) | Ya está |
| Motion matching / aprendizaje automático | For Honor, FIFA | Megas de datos y memoria | No |
| Cuaterniones duales | Muchos motores | Sombreador más largo; la escala por hueso complica | No por ahora |
| Formas correctivas | Unreal (Pose Driver) | ~0,5 KB por forma | Quizás, para el codo |
| Pose A | Rigs modernos | Cambiar el formato (rotaciones de reposo) | No por ahora |

## 5. Recomendación, ordenada por impacto y costo

Lo medido con el prototipo sale de los mismos partidos de dobles: tres de cada tipo, 366.000 cuadros de jugador. El prototipo está **solo en la medición**: reemplaza `bendLimb` con un mock de Vitest. El juego no cambió.

### Paso 0: la vara (antes de tocar nada)

La prueba automática de la sección 6. Sin ella, cada arreglo se juzga a ojo y en un solo cuadro. El script de medición ya existe y tarda segundos (sección 7).

### Paso 1: IK de dos huesos con bisagra y topes (brazos y piernas)

Cambiar `bendLimb` por:

1. **Doblar solo alrededor de la bisagra.** El eje vive en el hueso de arriba (en este rig, `z` del brazo y `x` del muslo). La flexión va de 2° a 145° en el codo y de 2° a 150° en la rodilla: nunca hiperextiende.
2. **Apuntar el miembro entero desde el hombro o la cadera.** La bisagra viaja con él. El plano del pliegue es el del clip, así que **el polo es el del clip**, no un «adelante» fijo del personaje.
3. **Muñeca dentro de su rango.** La mano sigue buscando su orientación en el mundo, pero se recorta con *swing-twist*: elipse de flexión 75°, extensión 65°, desvío radial 20° y cubital 35°, y giro ±85°. En la mano de la pala, con un desvío de agarre de 45°.
4. **Una segunda pasada al centro de la pala.** Recortar la muñeca gira la pala, y la segunda pasada lleva el centro de la pala, no la muñeca, a la pelota.
5. **Soltar la mano en 0,1 s después del golpe**, no en 0,32 s. El seguimiento es el del clip.

| Medida | Hoy | Paso 1 | Paso 1 sin la segunda pasada |
| --- | --- | --- | --- |
| Rodillas fuera de rango, todos los cuadros | 73 % | **0 %** | 0 % |
| Codo de la pala fuera de rango, ±0,3 s del golpe | 63 % | **6 %** | 6 % |
| Codo libre fuera de rango en los gestos | 44 % | **0 %** | 0 % |
| Muñeca de la pala (agarre diagonal), ±0,3 s del golpe | 78 % | **0 %** | 0 % |
| Muñeca libre, en los gestos | 79 % | **0 %** | 0 % |
| La pala queda de la pelota (mediana / p90) | 9 / 14 cm | **1 / 12 cm** | 15 / 39 cm |
| Pie apoyado alrededor de un golpe parado (p99 por cuadro) | 2,2 mm | 2,7 mm | 2,7 mm |

- **Los topes, solos, cuestan alcance:** la pala se aleja (p90 de 39 cm).
- **La segunda pasada lo devuelve con creces**, porque apunta el punto que de verdad tiene que tocar la pelota.
- **Los pies no empeoran.**
- **Costo:** unas 120 líneas de código, del orden de 1,5 KB comprimido, y el mismo tiempo de CPU que hoy (unas cuentas de cuaterniones por miembro).
- **Riesgo:** donde la pelota de verdad no se alcanza, ahora se ve que no se alcanza. Lo resuelve el paso 3.

### Paso 2: una pasada final de límites en las muñecas (y los codos)

Recortar en cada cuadro la rotación de cada mano respecto de su antebrazo, con la misma elipse. Cubre lo que viene de los clips mientras no se arreglen (paso 4).

- Las dos muñecas quedan en rango en el **100 %** de los cuadros.
- El contacto no cambia (mediana de 1 cm).
- La cara de la pala puede girar unos grados respecto de lo escrito en el clip. Eso no cambia la jugada, porque la dirección de la pelota la decide la simulación.
- Hay que mirarlo en el estudio: el revés y la bandeja son los que más cambian.

### Paso 3: la simulación elige el contacto dentro de lo que alcanza el golpe

- **Hacer trampa con la pelota, no con el cuerpo, pero dentro de la simulación**, que es la que manda y la que va a jugar en red.
- **Cada golpe declara su envolvente.** El archivo del personaje ya trae `hit` (dónde toca el clip) y el armado estirable. Hay que sumar una envolvente: cuánto puede correrse el contacto adelante y atrás, al costado y en altura sin romper el cuerpo. Por ejemplo, ±25 cm, ±35 cm y ±25 cm en metros del personaje, por la escala. Se exporta desde Blender.
- **La intercepción elige el instante en que la pelota pasa por la envolvente del golpe elegido**, en ejes del cuerpo: el jugador mira a la red y puede girar un poco.
  - Si la pelota pasa detrás del cuerpo (el 21 % de los golpes hoy), se elige un contacto más adelante en la trayectoria. En pádel es lo natural: la pelota vuelve del vidrio de fondo y se pega adelante.
  - Si no hay ninguno, se marca como inalcanzable.
- **Ajustes chicos y deterministas**, que no rompen la física:
  - mover el contacto uno o dos pasos de simulación;
  - una corrección de pocos centímetros en los últimos instantes.
- **Cómo convive con la regla de oro.** La amplía: *si la pelota no entra en la envolvente de ningún golpe, no se pega*. El alcance pasa a ser una región por golpe, en los ejes del cuerpo, en vez de un radio, y la animación y la simulación dicen lo mismo por construcción.
- **Costo:** trabajo en `src/sim/intercept.ts` y en la elección del golpe, más medir con `npm run sim` que el juego no se vuelva más fácil ni más difícil. El arte no cambia.

### Paso 4: los clips en Blender

- **Agarre diagonal.** Rotar el mango unos 45° en la palma (la mano que agarra en `personaje.py`) y el eje de reposo de la pala en `rig.solve`. Todos los clips pierden de golpe unos 45° de desvío cubital. Medido así: parado, del 98 % al 5 % de los cuadros fuera de rango.
- **El antebrazo prona y supina.** Al resolver la pose, pasar parte del giro de la mano al antebrazo y no todo a la muñeca. Es lo que necesita el hueso de giro del paso 5.
- **Interpolar la orientación de la mano como rotación** (*slerp*), no como dos vectores componente a componente. Así desaparecen los saltos de más de 30° por cuadro.
- **Verificar límites en el script** (`verificar_pasos.py` o `revisar.py`): que la exportación falle si un clip pasa los límites duros.
- **Revisar a mano lo que hoy está más lejos:**
  - la mano libre del revés y de la volea (giros de 130° a 180°);
  - las estiradas (piernas abiertas 131° entre muslos);
  - el saque y la bandeja (muñeca de la pala girada más de 170°).
- **Costo:** regenerar los clips (1 min 30 s). El peso no cambia.

### Paso 5: la piel

- **Un hueso de giro por antebrazo** (radio), a 2/3 del camino a la muñeca. Toma la mitad del giro de la mano alrededor del antebrazo, calculado en tiempo real: no necesita datos en los clips.
  - Los anillos del antebrazo se pesan en degradé: 0, 25, 50 y 75 %.
  - El caramelo de un giro de 90° baja del 29 % al 8 %.
- **Dos anillos más en la muñeca y en el codo**, para que el pliegue no dependa de un solo anillo al 50 %. Son unos 64 vértices, menos de 1 KB.
- **La muñequera, pesada como la piel** que cubre.
- **Costo:** 2 matrices más por personaje (26 → 28 en el sombreador) y regenerar la malla. Peso: menos de 1 KB.

### Paso 6: más golpes según dónde está la pelota

Después de lo anterior, si el estudio todavía muestra estiramientos raros:

- **Dos o tres alturas de contacto** para la derecha, el revés y las voleas, elegidas o mezcladas según la altura de la pelota. TopSpin usa nueve por estilo.
- **Una salida de pared**: el golpe con el cuerpo girado hacia el vidrio, para la pelota que viene de atrás.

Cada clip pesa unos 3 KB sin comprimir: entra holgado en el presupuesto de 1 MB.

### Lo que no conviene ahora

- **Motion matching y aprendizaje automático:** megas de datos.
- **Cuaterniones duales:** con el hueso de giro se resuelve lo mismo más barato, y la escala por hueso de los personajes los complica.
- **Pose A:** obliga a cambiar el formato para tener rotaciones de reposo.
- **IK de cuerpo entero:** caro y difícil de controlar. Alcanza con dejar que el pecho gire unos grados hacia la pelota antes del brazo.

## 6. Límites propuestos y prueba automática

### Los límites

En grados. «Blando» es lo que se espera de una persona. «Duro» es lo que nunca tiene que pasar, ni en un cuadro.

| Articulación | Medida | Blando | Duro | De dónde |
| --- | --- | --- | --- | --- |
| Muñeca | Flexión / extensión | 75 / 65 | 80 / 70 | Normales: flexión 80–90 y extensión 70–90 ([Anderson et al., 2004](https://queenshealthsci.elentra.cloud/community/carpaltunnelsyndrome:clinical_presentation/physical/motor)). Para la vida diaria alcanzan 54 y 60 ([Ryu et al., 1991](https://mayoclinic.elsevierpure.com/en/publications/functional-ranges-of-motion-of-the-wrist-joint/)) |
| Muñeca (con agarre diagonal en la pala) | Desvío radial / cubital | 20 / 35 | 25 / 40 | Radial 15 y cubital 30–45 (Anderson). Para la vida diaria, 17 y 40 (Ryu). En el tenis, el desvío cubital es máximo justo en el impacto ([Loushin et al., 2022](https://mdpi.com/2076-3417/12/9/4638)) |
| Antebrazo y muñeca | Pronación / supinación | 80 / 85 | 85 / 90 | 77–82 y 85–91 en adultos ([CDC](https://archive.cdc.gov/www_cdc_gov/ncbddd/jointrom/index.html)) |
| Codo | Flexión | 145 | 150 | 144–150 (CDC) |
| Codo | Hiperextensión | 5 | 8 | 1–5 (CDC) |
| Codo | Fuera del plano / giro sobre el antebrazo | 5 / 5 | 10 / 10 | Es una bisagra |
| Hombro | Detrás del plano del cuerpo / cruzando, con el brazo cerca de la horizontal | 40 / 130 | 45 / 140 | Estimado |
| Cadera | Flexión / extensión | 125 / 20 | 130 / 30 | 127–134 y 13–18 (CDC) |
| Cadera | Abducción / ángulo entre muslos | 50 / 100 | 60 / 110 | Estimado; 60 solo en estiradas |
| Rodilla | Flexión | 145 | 150 | 133–142 (CDC), más el tejido blando en la sentadilla profunda |
| Rodilla | Hiperextensión / fuera del plano | 3 / 5 | 5 / 10 | Es una bisagra |
| Tobillo | Flexión dorsal / plantar | 35 / 50 | 40 / 60 | Plantar 49–62 (CDC). La dorsal pasiva es 12–14; 35 es un estimado para la zancada con la rodilla flexionada |
| Tronco | Giro de hombros contra cadera | 55 | 65 | Estimado |
| Muñeca | Salto entre dos cuadros a 60 Hz | 20 | 30 | Más es un giro, no un golpe |

Medir con *swing-twist* respecto de la pose T, con el lado derecho espejado (sección 1). Holden sugiere ajustar los rangos con datos de captura. Acá los clips no son captura, así que valen los rangos clínicos y, para lo que sea estilo, un margen explícito.

### La prueba

`tests/anatomy.test.ts`, en la suite normal. Tarda segundos.

1. **Los clips:** cada clip del archivo, cada cuadro a 60 Hz y con cada personaje del elenco.
   - Ningún cuadro pasa un límite duro.
   - Ningún salto de muñeca supera los 30° entre cuadros.
   - Mientras se arreglan los clips, con una lista explícita de excepciones que solo puede achicarse.
2. **El animador:** las situaciones del estudio (la misma demo fija y la misma búsqueda) y un minuto de partido de dobles, a través de `FigureAnimator`.
   - Ningún cuadro pasa un límite duro.
   - El p99 de cada medida queda dentro del blando.
   - La pala queda a menos de 15 cm de la pelota en el p90 de los contactos.
3. **La piel:** con la rotación total de la muñeca y los pesos del anillo, la muñeca no se afina más de un 20 %.

Y en `npm run sim`, un informe `anatomia` con la tabla de la sección 1 por familia y por etapa, para seguir la tendencia como hoy se sigue el alcance.

## 7. Para reproducir

- **Los scripts de medición** quedaron en la carpeta de notas compartidas de la sesión orquestadora, en `anatomia/`. No están en el repo: son herramientas de esta investigación, no del juego.
  - `anatomia-medidas.ts`: las medidas, los límites y el enganche de etapas.
  - `anatomia.sim.ts`: partidos completos, por familia y por etapa.
  - `anatomia-estudio.sim.ts`: el estudio sin navegador.
  - `anatomia-clips.sim.ts`: los clips solos.
  - `anatomia-contacto.sim.ts`: dónde se pega.
  - `anatomia-ik.ts` y `anatomia-proto.sim.ts`: el prototipo y su comparación (`PROTO=0`, `1`, `3`, `4`).
- **Cómo correrlos:** copiarlos a `tests/sim/` y correr `npx vitest run --config vitest.sim.config.ts anatomia`. El estudio sin navegador tarda 4 s, los clips menos de 1 s y los partidos unos 2 minutos.
- **Las capturas** se sacaron del estudio con el ayudante de navegador del repo (`scripts/lib/browser.mjs`), a la densidad de un celular, con un enganche solo de lectura para apagar capas e inyectar el prototipo. Están en el Artifact; no se suben al repo.
- **Sin acceso a la fuente:**
  - las charlas de GDC se citan por su ficha y por lo que publicaron sus autores o la prensa;
  - de TopSpin 2K25, lo que dice el artículo de Xbox Wire;
  - el foro de GameDev.net y el estudio de Loushin no se pudieron abrir y se citan por su resumen.
