import type { CharacterId, CharacterText } from './types';

/**
 * What the characters say, in rioplatense Spanish. The lines come from the
 * cast design (docs/personajes.md): short enough to read at a glance, in the
 * voice of each one, warm, never addressed to a gender, and never carrying
 * anything needed to play.
 */
export const CHARACTER_TEXT: Record<CharacterId, CharacterText> = {
  beto: {
    style: 'El profe: pelotas cómodas, al medio y hacia vos. Le cuestan los ángulos.',
    lines: {
      winPoint: [
        'Tranqui, se aprende.',
        'Mirá la pelota, no a mí.',
        'Pies, pies, pies.',
        'Llegaste tarde, no mal.',
        '¡Codo adelante!',
        { text: 'Esa se deja pasar.', when: ['wall'] },
        'Bien armado. Faltó timing.',
        'Esa era para aprender.',
      ],
      losePoint: [
        '¡Eso! ¡Así se pega!',
        '¡Bien ahí!',
        'Esa no la enseñé yo.',
        '¡Diez puntos!',
        'Me superaste. Qué orgullo.',
        '¡Así, así, así!',
        '¿Quién te enseñó eso? Yo.',
        'Eso fue un golazo.',
      ],
      goldenPoint: [
        'Punto de oro. ¡A disfrutar!',
        'Este se juega con la cabeza.',
        'Despacio y adentro.',
        'Como en la práctica.',
        'El que se apura, pierde.',
        'Pelota adentro y listo.',
      ],
      rematchTheyWon: ['Otra vuelta, que estás cerca.', 'Vamos de nuevo, sin miedo.', 'La práctica hace al maestro.'],
      rematchTheyLost: ['Ahora juego en serio.', 'Bueno, el profe se calienta.', 'Clase avanzada, entonces.'],
      meetFirst: ['¡Hola! Soy Beto, el profe.'],
      meetAgain: ['¡Volviste! Me alegra.'],
      meetLongTime: ['¡Tanto tiempo! ¿Entrenaste?'],
      hint: ['Fijate mi mano: te aviso.'],
    },
  },

  romina: {
    style: 'Pega plano y fuerte desde donde esté. Si el punto se alarga, se apura.',
    lines: {
      winPoint: [
        '¡TOMÁ!',
        '¿La viste pasar?',
        { text: 'Directo al vidrio.', when: ['wall'] },
        'Esa salió caliente.',
        'Te avisé que pegaba.',
        '¡Vamos, todavía!',
        'Una más así y la rompo.',
        '¡Fuego, fuego!',
      ],
      losePoint: [
        { text: '¡Se me fue por un pelo!', when: ['error'] },
        { text: 'Me apuré. Me apuré.', when: ['longRally', 'error'] },
        'La próxima, más fuerte.',
        'Bueno, bueno, bueno…',
        'Calma, Romina. Calma.',
        { text: '¿Quién puso esa pared?', when: ['wall'] },
        { text: '¡Uh! Le di con todo.', when: ['error'] },
        'Bien ahí. Me la comí.',
      ],
      goldenPoint: [
        '¡Punto de oro! ¡Vamos!',
        'Acá no hay que pensar.',
        'Que nadie pestañee.',
        'Respirá, Romi.',
        'Pelota al vidrio y listo.',
        'Este sale a cañonazos.',
      ],
      rematchTheyWon: ['¿Otra? ¡De una!', 'Siempre lista.', '¡Dale que va!'],
      rematchTheyLost: ['Esta vez no me apuro.', 'Te debo una. La cobro.', 'Revancha. Y con todo.'],
      meetFirst: ['Romina. Pego fuerte, eh.'],
      meetAgain: ['¡Volviste! Traé casco.'],
      meetLongTime: ['¿Dónde te metiste?'],
      hint: ['Si me planto, retrocedé.'],
    },
  },

  chela: {
    style: 'Globos altísimos, pared y paciencia. Casi no erra: hay que atacarla.',
    lines: {
      winPoint: [
        'Arriba, corazón.',
        { text: '¿Alcanzaste? No.', when: ['lob'] },
        'Cuarenta años de globo.',
        'Paciencia, tesoro.',
        'Esa la estaba esperando.',
        { text: 'Hasta la luna y de vuelta.', when: ['lob'] },
        'Despacito se llega lejos.',
        { text: 'Mirá el cielo, mi vida.', when: ['lob'] },
      ],
      losePoint: [
        '¡Ay, qué linda!',
        { text: 'Eso, rematala. Muy bien.', when: ['smash'] },
        { text: 'Uy, me agarraste lejos.', when: ['drop'] },
        'Estas rodillas…',
        'Bien jugado, corazón.',
        'No me hagas correr, che.',
        'Ay, si tuviera sesenta…',
        { text: 'Te la regalé, ¿eh?', when: ['error'] },
      ],
      goldenPoint: [
        'Punto de oro. Qué emoción.',
        'Ya viví muchos de estos.',
        'Globo y a rezar.',
        'Tranquila, Chela.',
        'El que espera, gana.',
        'Próxima parada: el punto.',
      ],
      rematchTheyWon: ['¿Otra? Tengo toda la mañana.', 'Subí, que arranco.', 'Dale, que el mate se enfría.'],
      rematchTheyLost: ['Esta vez no te regalo nada.', 'Vení, que te cobro el boleto.', 'Ah, ¿te la creíste? Otra.'],
      meetFirst: ['Hola, tesoro. Soy Chela.'],
      meetAgain: ['¡Otra vez vos! Qué lindo.'],
      meetLongTime: ['¡Al fin! ¿Comés bien?'],
      hint: ['Si me agacho, mirá arriba.'],
    },
  },
};
