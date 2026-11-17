import type { AILevelName } from '../config';
import type { FaultReason, PointReason } from '../sim/rules';
import type { Quality, ShotKind } from '../sim/types';

/** Every string the player reads. The game speaks rioplatense Spanish. */
export const TEXT = {
  title: 'Pádel',
  subtitle: 'Prototipo de mecánicas',
  you: 'Vos',
  rival: 'Rival',

  quality: {
    perfect: '¡Perfecto!',
    good: 'Bien',
    early: 'Temprano',
    late: 'Tarde',
  } satisfies Record<Quality, string>,
  whiffFar: 'No llegás',

  /** Name of the shot that came out, shown under the timing: gestures are learnt by playing. */
  shot: {
    safe: 'Seguro',
    drive: 'Drive',
    volley: 'Volea',
    lob: 'Globo',
    drop: 'Dejada',
    smash: 'Remate',
    serve: 'Saque',
  } satisfies Record<ShotKind, string>,

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
  pointRival: 'Punto del rival',
  gameYou: '¡Juego para vos!',
  gameRival: 'Juego del rival',
  goldenPoint: 'Punto de oro',
  serveHint: 'Deslizá para sacar',
  serveHintKeys: 'Espacio para sacar',
  rivalServes: 'Saca el rival',
  serves: 'saca',

  play: 'Jugar',
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
  demo: 'Ver demo (IA contra IA)',

  howTo: [
    ['Deslizá', 'pegale hacia donde deslizás'],
    ['Deslizá largo hacia arriba', 'globo'],
    ['Deslizá hacia abajo', 'dejada'],
    ['Tocá', 'golpe seguro al centro'],
  ] as ReadonlyArray<readonly [string, string]>,
  howToTiming: 'Pegale justo cuando el anillo se cierra: ni antes ni después.',

  settings: {
    controls: 'Controles',
    assisted: 'Asistido',
    assistedHint: 'El jugador se mueve solo; vos elegís cuándo y hacia dónde pegar.',
    manual: 'Joystick',
    manualHint: 'Movés al jugador con el pulgar izquierdo y pegás con el derecho.',
    stickSide: 'Joystick del lado',
    left: 'Izquierdo',
    right: 'Derecho',
    difficulty: 'Dificultad',
    speed: 'Velocidad del juego',
    matchLength: 'Partido a',
    game: 'juego',
    gamesPlural: 'juegos',
    bounceMarker: 'Marca de dónde pica',
    timingAid: 'Anillo de timing',
    reduceMotion: 'Reducir movimiento',
    vibration: 'Vibración al pegar',
    camera: 'Cámara',
    cameraLow: 'Baja',
    cameraMid: 'Media',
    cameraHigh: 'Alta',
    quality: 'Resolución',
    qualityAuto: 'Auto',
    qualityHigh: 'Alta',
    qualityMedium: 'Media',
    qualityLow: 'Baja',
    fps: 'Mostrar fps',
    on: 'Sí',
    off: 'No',
    accessibility: 'Ayudas',
    video: 'Imagen',
  },

  level: {
    easy: 'Fácil',
    normal: 'Normal',
    hard: 'Difícil',
  } satisfies Record<AILevelName, string>,

  speedLabel: (value: number): string => `${Math.round(value * 100)}%`,
} as const;
