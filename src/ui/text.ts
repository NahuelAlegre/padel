import type { FaultReason, PointReason } from '../sim/rules';
import type { Quality, ShotKind } from '../sim/types';
import type { LessonId } from '../app/drill';

/**
 * Name of a shot as it is called on court. The player never picks it from a
 * list: it is shown when the shot is played, and that is how it is learnt.
 */
export function shotName(kind: ShotKind, forehand: boolean, volley = false): string {
  switch (kind) {
    case 'serve':
      return 'Saque';
    case 'drive':
      return forehand ? 'Derecha' : 'Revés';
    case 'volley':
      return 'Volea';
    case 'lob':
      return 'Globo';
    case 'drop':
      return volley ? 'Dejada' : 'Chiquita';
    case 'smash':
      return 'Remate';
    case 'bandeja':
      return 'Bandeja';
    case 'vibora':
      return 'Víbora';
    case 'wallExit':
      return 'Salida de pared';
    case 'backWall':
      return 'Contrapared';
  }
}

/** Every string the player reads. The game speaks rioplatense Spanish. */
export const TEXT = {
  title: 'Pádel',
  subtitle: 'Prototipo de mecánicas',
  you: 'Vos',
  /** The name of a pair on the scoreboard. */
  pair: (a: string, b: string): string => `${a} y ${b}`,

  quality: {
    perfect: '¡Perfecto!',
    good: 'Bien',
    early: 'Temprano',
    late: 'Tarde',
  } satisfies Record<Quality, string>,
  whiffFar: 'No llegás',

  reason: {
    doubleBounce: 'Doble pique',
    net: 'Quedó en la red',
    ownSide: 'No pasó la red',
    wall: 'Directo al vidrio',
    fence: 'Directo a la reja',
    out: 'Se fue afuera',
    outAfterBounce: 'La sacó de la cancha',
    overNet: 'Volvió a su campo sin que la toquen',
    doubleFault: 'Doble falta',
  } satisfies Record<PointReason, string>,

  fault: {
    box: 'Falta: fuera del cuadro',
    net: 'Falta: quedó en la red',
    wall: 'Falta: tocó el vidrio antes de picar',
    fence: 'Falta: tocó la reja',
    out: 'Falta: se fue afuera',
  } satisfies Record<FaultReason, string>,

  secondServe: 'Segundo saque',
  letServe: 'Red: se repite el saque',
  pointYou: 'Punto para vos',
  pointRival: (name: string): string => `Punto de ${name}`,
  gameYou: '¡Juego para vos!',
  gameRival: (name: string): string => `Juego de ${name}`,
  goldenPoint: 'Punto de oro',
  tieBreak: 'Tie-break',
  serveHint: {
    two: 'Apretá, apuntá y soltá para sacar',
    one: 'Deslizá rápido para sacar',
    keys: 'J, K o L para sacar',
  },
  rivalServes: (name: string): string => `Saca ${name}`,
  serves: 'saca',

  quickMatch: 'Partida rápida',
  quickMatchNote: 'A 2 juegos, con punto de oro',
  fullMatch: 'Partido',
  fullMatchNote: 'Set a 4 juegos, tie-break en 3-3',
  resumeMatch: 'Seguir el partido',
  resume: 'Seguir',
  restart: 'Reiniciar',
  options: 'Opciones',
  back: 'Volver',
  menu: 'Menú',
  rematch: 'Revancha',
  pause: 'Pausa',
  paused: 'Pausa',
  win: '¡Ganaste!',
  lose: 'Perdiste',
  games: 'juegos',
  demo: 'Demo',
  rival: 'Rival',

  /** The tutorial: a name and a few words for each lesson. Everything else is shown, not said. */
  tutorial: 'Tutorial',
  lessons: 'Lecciones',
  lessonsNote: 'Cortas y jugando. Se pueden repetir o saltear.',
  lessonDone: 'Hecha',
  lessonJustDone: (name: string): string => `¡${name}: hecha!`,
  coach: 'Beto',
  lesson: {
    move: { name: 'Moverse y pegar', cue: 'Andá a la pelota y pegale' },
    aim: { name: 'Apuntar', cue: 'Al lado vacío' },
    lob: { name: 'Globo', cue: 'Por arriba del que está en la red' },
    drop: { name: 'Chiquita', cue: 'Cortita, cuando está lejos' },
    wall: { name: 'La pared', cue: 'Dejala picar y salir del vidrio' },
    bandeja: { name: 'Bandeja', cue: 'Dos pasos atrás y por arriba' },
    smash: { name: 'Remate', cue: 'Corta y alta: ¡rematá!' },
    read: { name: 'Leer el gesto', cue: 'Mirá a dónde señala' },
  } satisfies Record<LessonId, { name: string; cue: string }>,

  /** How the history with a rival reads on the start screen. */
  record: {
    never: 'Todavía no jugaron.',
    even: (each: number): string => `Van ${each} a ${each}.`,
    ahead: (wins: number, losses: number): string => `Vas ${wins} a ${losses}.`,
    behind: (wins: number, losses: number): string => `Te lleva ${losses} a ${wins}.`,
    classic: 'Clásico del club.',
  },

  settings: {
    controls: 'Controles',
    scheme: 'Esquema',
    two: 'Dos pulgares',
    twoHint: 'Un pulgar mueve con el joystick. El otro aprieta, apunta y suelta para pegar.',
    one: 'Una mano',
    oneHint: 'Arrastrar mueve al jugador. Un deslizamiento rápido es el golpe.',
    stickSide: 'Joystick del lado',
    left: 'Izquierdo',
    right: 'Derecho',
    speed: 'Velocidad del juego',
    speedHint: 'Para jugar a tu ritmo. No cambia las reglas.',
    aids: 'Ayudas',
    aidLevel: 'En pantalla',
    aidsFull: 'Completas',
    aidsMinimal: 'Mínimas',
    aidsNone: 'Ninguna',
    aidsHint: {
      full: 'Todo: dónde pica, cuándo pegar, dónde pararte y el nombre de cada golpe.',
      minimal: 'Lo justo: la pelota se enciende cuando hay que pegar. Se apagan solas a medida que acertás.',
      none: 'Nada: la cancha, la pelota y su sombra.',
    },
    assisted: 'Movimiento asistido',
    assistedHint: 'El jugador corre solo hacia la pelota y vos solo pegás.',
    rivalGroup: 'Rival',
    lines: 'Frases del rival',
    linesMany: 'Muchas',
    linesFew: 'Pocas',
    linesNone: 'Ninguna',
    linesHint: 'Globitos cortos entre punto y punto. Nunca dicen nada necesario para jugar.',
    reduceMotion: 'Reducir movimiento',
    vibration: 'Vibración al pegar',
    sound: 'Sonido',
    soundOn: 'Sonido',
    soundHint: 'Se puede jugar sin sonido: todo lo que suena también se ve.',
    effects: 'Golpes y pelota',
    ambience: 'Ambiente del club',
    ambienceHint: 'Pájaros, viento en los árboles y la cancha de al lado, bien de fondo.',
    video: 'Imagen',
    camera: 'Cámara',
    cameraFollow: 'Acompaña',
    cameraFixed: 'Fija',
    cameraHint: {
      follow: 'Va con la jugada, de a poco, sin perder de vista tu vidrio.',
      fixed: 'La cancha entera, quieta.',
    },
    cameraStill: 'Con «Reducir movimiento» la cámara se queda quieta.',
    quality: 'Resolución',
    qualityAuto: 'Auto',
    qualityHigh: 'Alta',
    qualityMedium: 'Media',
    qualityLow: 'Baja',
    fullscreen: 'Pantalla completa',
    fps: 'Mostrar fps',
    on: 'Sí',
    off: 'No',
    data: 'Datos de este dispositivo',
    dataNote: 'Se guardan solo acá. No hay cuentas ni se envía nada.',
    experimental: 'Experimental',
    experimentalNote: 'Para probar. Se aplica desde el próximo partido.',
    doubles: 'Dobles',
    doublesHint: 'Vos y un compañero contra una pareja, cada uno en su lado.',
    reach: 'Alcance',
    reachGenerous: 'Actual',
    reachReal: 'Real',
    reachHint: {
      generous: 'Llegás un poco más lejos que una persona: alcanza con acercarse.',
      real: 'Como una persona: lo que el cuerpo no alcanza no se pega. Igual para todos.',
    },
    side: 'Tu lado',
    sideDrive: 'Drive',
    sideReves: 'Revés',
    sideHint: {
      drive: 'A la derecha. Las pelotas del medio son de tu compañero.',
      reves: 'A la izquierda. Las del medio son tuyas: te quedan de derecha.',
    },
    partner: 'Compañero',
  },

  stats: {
    matches: (played: number, won: number): string => `Partidos: ${played} jugados, ${won} ganados`,
    perfect: (share: number): string => `Golpes perfectos: ${share} %`,
    firstHit: (seconds: number): string => `Primer golpe a los ${seconds.toFixed(1)} s de abrir el juego`,
    none: 'Todavía no hay partidos.',
  },

  speedLabel: (value: number): string => `${Math.round(value * 100)}%`,
  volumeLabel: (value: number): string => (value === 0 ? 'No' : `${Math.round(value * 100)}%`),
} as const;
