// Game state and turn flow. UI-agnostic: the UI layer drives it and re-renders.

import { SIZE, RACK_SIZE, LETTER_VALUES, freshBag } from './constants.js';
import { emptyBoard, analyze, boardIsEmpty } from './engine.js';
import { chooseMove } from './ai.js';

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const rackValue = (rack) => rack.reduce((s, t) => s + LETTER_VALUES[t], 0);

export class Game {
  constructor(trie) {
    this.trie = trie;
    this.newGame('medium');
  }

  newGame(difficulty = this.difficulty || 'medium') {
    this.difficulty = difficulty;
    this.grid = emptyBoard();
    this.bag = shuffle(freshBag());
    this.racks = { human: [], ai: [] };
    this.scores = { human: 0, ai: 0 };
    this.refill('human');
    this.refill('ai');
    this.turn = 'human';
    this.scorelessStreak = 0;
    this.gameOver = false;
    this.winner = null;
    this.log = [];
    this.lastMoveCells = [];
  }

  draw(n) {
    const out = [];
    for (let i = 0; i < n && this.bag.length; i++) out.push(this.bag.pop());
    return out;
  }

  refill(who) {
    const need = RACK_SIZE - this.racks[who].length;
    if (need > 0) this.racks[who].push(...this.draw(need));
  }

  // Apply an already-validated placement for `who`. Returns the analyze result.
  applyMove(who, placements) {
    const res = analyze(this.grid, placements, this.trie);
    if (!res.ok) return res;

    for (const p of placements) this.grid[p.r][p.c] = { letter: p.letter, blank: !!p.blank };

    // Remove used tiles from the rack (blanks come from '_').
    const rack = this.racks[who];
    for (const p of placements) {
      const want = p.blank ? '_' : p.letter;
      const idx = rack.indexOf(want);
      if (idx !== -1) rack.splice(idx, 1);
    }

    this.scores[who] += res.score;
    this.scorelessStreak = 0;
    this.lastMoveCells = placements.map((p) => ({ r: p.r, c: p.c }));
    this.refill(who);
    this.log.push({ who, type: 'play', word: res.main, score: res.score });

    if (rack.length === 0 && this.bag.length === 0) {
      this.finalize('out', who);
    }
    return res;
  }

  exchange(who, tiles) {
    if (this.bag.length < 1) return { ok: false, reason: 'Not enough tiles to exchange.' };
    const rack = this.racks[who];
    const returned = [];
    for (const t of tiles) {
      const idx = rack.indexOf(t);
      if (idx !== -1) { rack.splice(idx, 1); returned.push(t); }
    }
    if (returned.length === 0) return { ok: false, reason: 'No tiles selected.' };
    const drawn = this.draw(returned.length);
    rack.push(...drawn);
    this.bag.push(...returned);
    shuffle(this.bag);
    this.bumpScoreless(who, 'exchange', returned.length);
    return { ok: true, count: returned.length };
  }

  pass(who) {
    this.bumpScoreless(who, 'pass');
    return { ok: true };
  }

  bumpScoreless(who, type, count) {
    this.scorelessStreak += 1;
    this.log.push({ who, type, count });
    if (this.scorelessStreak >= 6) this.finalize('passes');
  }

  nextTurn() {
    if (this.gameOver) return;
    this.turn = this.turn === 'human' ? 'ai' : 'human';
  }

  // Run the AI's turn. Returns a description for the UI.
  runAI() {
    if (this.gameOver) return null;
    const decision = chooseMove(this.grid, this.racks.ai, this.trie, this.difficulty);
    if (decision.type === 'play') {
      const res = this.applyMove('ai', decision.move.placements);
      return { type: 'play', placements: decision.move.placements, word: res.main, score: res.score };
    }
    if (decision.type === 'exchange' && this.bag.length >= 1) {
      const tiles = this.racks.ai.slice(0, Math.min(decision.count, this.bag.length));
      this.exchange('ai', tiles);
      return { type: 'exchange', count: tiles.length };
    }
    this.pass('ai');
    return { type: 'pass' };
  }

  finalize(reason, outPlayer = null) {
    if (this.gameOver) return;
    this.gameOver = true;
    if (reason === 'out' && outPlayer) {
      const other = outPlayer === 'human' ? 'ai' : 'human';
      const remaining = rackValue(this.racks[other]);
      this.scores[outPlayer] += remaining;
      this.scores[other] -= remaining;
    } else {
      // All-pass ending: everyone loses their own rack value.
      for (const who of ['human', 'ai']) this.scores[who] -= rackValue(this.racks[who]);
    }
    this.winner =
      this.scores.human === this.scores.ai ? 'tie' : this.scores.human > this.scores.ai ? 'human' : 'ai';
    this.endReason = reason;
  }
}
