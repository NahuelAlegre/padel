import type { RivalId } from '../config';
import type { FaultReason, PointReason } from '../sim/rules';
import type { Quality, ShotKind } from '../sim/types';

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
  demo: 'Ver una demo',
  rival: 'Rival',

  rivals: {
    lola: { name: 'Lola', style: 'Tranquila: se queda en el fondo y devuelve todo al medio.' },
    tincho: { name: 'Tincho', style: 'Globero: te tira globos y sube a la red.' },
    mora: { name: 'Mora', style: 'Atacante: saca y sube, volea y remata lo que quede corto.' },
  } satisfies Record<RivalId, { name: string; style: string }>,

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
    assisted: 'Movimiento asistido',
    assistedHint: 'El jugador corre solo hacia la pelota y vos solo pegás.',
    bounceMarker: 'Marca de dónde pica',
    timingAid: 'Anillo de timing',
    positionGuide: 'Guía de dónde pararse',
    reduceMotion: 'Reducir movimiento',
    vibration: 'Vibración al pegar',
    video: 'Imagen',
    camera: 'Cámara',
    cameraLow: 'Baja',
    cameraMid: 'Media',
    cameraHigh: 'Alta',
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
  },

  stats: {
    matches: (played: number, won: number): string => `Partidos: ${played} jugados, ${won} ganados`,
    perfect: (share: number): string => `Golpes perfectos: ${share} %`,
    firstHit: (seconds: number): string => `Primer golpe a los ${seconds.toFixed(1)} s de abrir el juego`,
    none: 'Todavía no hay partidos.',
  },

  speedLabel: (value: number): string => `${Math.round(value * 100)}%`,
} as const;
