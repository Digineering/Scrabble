// AI opponent. Generates every legal move, then picks one according to the
// chosen difficulty by sampling from a score-ranked band of candidates.

import { generateMoves } from './engine.js';

const LEVELS = {
  // exchangeBelow 0 keeps Easy playing its (weak) words instead of constantly
  // swapping tiles, which makes for a friendlier opponent.
  easy:   { band: [0.60, 0.92], maxScore: 18, allowBingo: false, exchangeBelow: 0 },
  medium: { band: [0.35, 0.70], maxScore: 45, allowBingo: true,  exchangeBelow: 4 },
  hard:   { band: [0.03, 0.18], maxScore: Infinity, allowBingo: true, exchangeBelow: 6 },
  insane: { band: [0.00, 0.00], maxScore: Infinity, allowBingo: true, exchangeBelow: 8 },
};

function pickFromBand(moves, [lo, hi]) {
  const n = moves.length;
  if (n === 0) return null;
  let start = Math.floor(lo * n);
  let end = Math.max(start + 1, Math.ceil(hi * n));
  start = Math.min(start, n - 1);
  end = Math.min(end, n);
  const idx = start + Math.floor(Math.random() * (end - start));
  return moves[Math.min(idx, n - 1)];
}

/**
 * Decide the AI's action.
 * Returns { type: 'play', move } | { type: 'exchange', count } | { type: 'pass' }.
 */
export function chooseMove(grid, rack, trie, level = 'medium') {
  const cfg = LEVELS[level] || LEVELS.medium;
  let moves = generateMoves(grid, rack, trie);

  // Difficulty filters.
  if (!cfg.allowBingo) moves = moves.filter((m) => m.placements.length < 7);
  if (cfg.maxScore !== Infinity) {
    const capped = moves.filter((m) => m.score <= cfg.maxScore);
    if (capped.length) moves = capped; // only enforce the cap if it leaves options
  }

  moves.sort((a, b) => b.score - a.score);

  if (moves.length === 0) {
    return { type: 'pass' };
  }

  const choice = level === 'insane' ? moves[0] : pickFromBand(moves, cfg.band);

  // Weak racks: lower levels would rather swap tiles than dump a 3-pointer.
  if (choice.score < cfg.exchangeBelow) {
    return { type: 'exchange', count: Math.min(rack.length, 5) };
  }
  return { type: 'play', move: choice };
}
