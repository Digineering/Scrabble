// Core Scrabble constants: board size, premium squares, tile values & distribution.

export const SIZE = 15;
export const CENTER = 7;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;

// Premium-square map. One char per cell, 15 rows.
//  T = triple word, D = double word (center is also D),
//  t = triple letter, l = double letter, . = plain.
const PREMIUM_LAYOUT = [
  'T..l...T...l..T',
  '.D...t...t...D.',
  '..D...l.l...D..',
  'l..D...l...D..l',
  '....D.....D....',
  '.t...t...t...t.',
  '..l...l.l...l..',
  'T..l...D...l..T',
  '..l...l.l...l..',
  '.t...t...t...t.',
  '....D.....D....',
  'l..D...l...D..l',
  '..D...l.l...D..',
  '.D...t...t...D.',
  'T..l...T...l..T',
];

// letterMult / wordMult per cell, indexed [row][col].
export const PREMIUM = PREMIUM_LAYOUT.map((row) =>
  row.split('').map((ch) => {
    switch (ch) {
      case 'T': return { letter: 1, word: 3, label: 'TW' };
      case 'D': return { letter: 1, word: 2, label: 'DW' };
      case 't': return { letter: 3, word: 1, label: 'TL' };
      case 'l': return { letter: 2, word: 1, label: 'DL' };
      default:  return { letter: 1, word: 1, label: '' };
    }
  })
);

export const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, _: 0, // '_' is a blank
};

// Standard English distribution (100 tiles, including 2 blanks as '_').
const DIST = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1,
  K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6,
  U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, _: 2,
};

export function freshBag() {
  const bag = [];
  for (const [letter, count] of Object.entries(DIST)) {
    for (let i = 0; i < count; i++) bag.push(letter);
  }
  return bag;
}

export const TOTAL_TILES = Object.values(DIST).reduce((a, b) => a + b, 0);
