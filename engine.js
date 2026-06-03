// Game engine: board helpers, authoritative move analysis (validation + scoring,
// shared by human and AI), and a trie-driven move generator for the AI.

import { SIZE, CENTER, PREMIUM, LETTER_VALUES, BINGO_BONUS } from './constants.js';

export const key = (r, c) => r * SIZE + c;
export const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

export function boardIsEmpty(grid) {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (grid[r][c]) return false;
  return true;
}

const tileValue = (cell) => (cell.blank ? 0 : LETTER_VALUES[cell.letter]);

// Walk the maximal run of filled cells through (r,c) in a direction.
// horizontal=true scans the row, false scans the column.
function wordCells(grid, r, c, horizontal) {
  const dr = horizontal ? 0 : 1;
  const dc = horizontal ? 1 : 0;
  let sr = r, sc = c;
  while (inBounds(sr - dr, sc - dc) && grid[sr - dr][sc - dc]) { sr -= dr; sc -= dc; }
  const cells = [];
  let er = sr, ec = sc;
  while (inBounds(er, ec) && grid[er][ec]) {
    cells.push({ r: er, c: ec, ...grid[er][ec] });
    er += dr; ec += dc;
  }
  return cells;
}

function cellsToWord(cells) {
  return cells.map((c) => c.letter).join('');
}

// Score one formed word. placedSet contains keys of the tiles placed THIS turn,
// which are the only ones that get premium-square bonuses.
function scoreWord(cells, placedSet) {
  let sum = 0;
  let wordMult = 1;
  for (const cell of cells) {
    let v = tileValue(cell);
    if (placedSet.has(key(cell.r, cell.c))) {
      const p = PREMIUM[cell.r][cell.c];
      v *= p.letter;
      wordMult *= p.word;
    }
    sum += v;
  }
  return sum * wordMult;
}

/**
 * Authoritative analysis of a placement on `grid`.
 * placements: [{ r, c, letter, blank }]
 * Returns { ok, reason, score, words:[{word,score}], main, horizontal }.
 */
export function analyze(grid, placements, trie) {
  if (!placements || placements.length === 0)
    return { ok: false, reason: 'No tiles placed.' };

  // Validate target squares are empty, in bounds, and unique.
  const placedSet = new Set();
  for (const p of placements) {
    if (!inBounds(p.r, p.c)) return { ok: false, reason: 'Tile off board.' };
    if (grid[p.r][p.c]) return { ok: false, reason: 'Square already filled.' };
    const k = key(p.r, p.c);
    if (placedSet.has(k)) return { ok: false, reason: 'Two tiles on one square.' };
    placedSet.add(k);
  }

  const firstMove = boardIsEmpty(grid);
  if (firstMove && !placedSet.has(key(CENTER, CENTER)))
    return { ok: false, reason: 'First word must cover the centre star.' };

  // Determine orientation.
  const rows = new Set(placements.map((p) => p.r));
  const cols = new Set(placements.map((p) => p.c));
  if (rows.size > 1 && cols.size > 1)
    return { ok: false, reason: 'Tiles must be in a single row or column.' };

  // Apply placements to a working copy.
  const temp = grid.map((row) => row.slice());
  for (const p of placements) temp[p.r][p.c] = { letter: p.letter, blank: !!p.blank };

  let horizontal;
  if (placements.length === 1) {
    const { r, c } = placements[0];
    const hasH = (inBounds(r, c - 1) && temp[r][c - 1]) || (inBounds(r, c + 1) && temp[r][c + 1]);
    horizontal = !!hasH; // default to vertical when only a column neighbour exists
  } else {
    horizontal = rows.size === 1;
  }

  // Contiguity along the main axis (no gaps between placed tiles).
  const sorted = [...placements].sort((a, b) => (horizontal ? a.c - b.c : a.r - b.r));
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (horizontal) {
      for (let cc = a.c + 1; cc < b.c; cc++) if (!temp[a.r][cc]) return { ok: false, reason: 'Gap in your word.' };
    } else {
      for (let rr = a.r + 1; rr < b.r; rr++) if (!temp[rr][a.c]) return { ok: false, reason: 'Gap in your word.' };
    }
  }

  // Collect formed words.
  const words = [];
  const anchor = placements[0];
  const mainCells = wordCells(temp, anchor.r, anchor.c, horizontal);
  if (mainCells.length >= 2) words.push(mainCells);
  for (const p of placements) {
    const cross = wordCells(temp, p.r, p.c, !horizontal);
    if (cross.length >= 2) words.push(cross);
  }

  if (words.length === 0)
    return { ok: false, reason: 'A word must be at least two letters.' };

  // Connectivity: after the first move, some existing tile must be part of a
  // formed word (extension or a new cross-word).
  if (!firstMove) {
    const touches = words.some((cells) => cells.some((c) => !placedSet.has(key(c.r, c.c))));
    if (!touches) return { ok: false, reason: 'New word must connect to the board.' };
  }

  // Validate against the dictionary.
  for (const cells of words) {
    const w = cellsToWord(cells);
    if (!trie.has(w)) return { ok: false, reason: `${w} isn't in the dictionary.` };
  }

  // Score.
  let score = 0;
  const wordList = [];
  for (const cells of words) {
    const s = scoreWord(cells, placedSet);
    score += s;
    wordList.push({ word: cellsToWord(cells), score: s });
  }
  if (placements.length === 7) score += BINGO_BONUS;

  return { ok: true, score, words: wordList, main: cellsToWord(mainCells), horizontal, placements };
}

// ---------------------------------------------------------------------------
// Move generation for the AI.
// ---------------------------------------------------------------------------

function transpose(grid) {
  const t = emptyBoard();
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      t[c][r] = grid[r][c];
  return t;
}

// In a given orientation (horizontal words), compute the set of letters allowed
// on each empty square so the perpendicular (vertical) word stays valid.
function crossChecks(grid, trie) {
  const allowed = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c]) continue;
      let up = '', down = '';
      let rr = r - 1;
      while (rr >= 0 && grid[rr][c]) { up = grid[rr][c].letter + up; rr--; }
      rr = r + 1;
      while (rr < SIZE && grid[rr][c]) { down += grid[rr][c].letter; rr++; }
      if (!up && !down) continue; // unconstrained
      const set = new Set();
      for (let i = 65; i <= 90; i++) {
        const ch = String.fromCharCode(i);
        if (trie.has(up + ch + down)) set.add(ch);
      }
      allowed[r][c] = set;
    }
  }
  return allowed;
}

function anchorsFor(grid) {
  if (boardIsEmpty(grid)) return [[CENTER, CENTER]];
  const list = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c]) continue;
      const adj =
        (inBounds(r - 1, c) && grid[r - 1][c]) ||
        (inBounds(r + 1, c) && grid[r + 1][c]) ||
        (inBounds(r, c - 1) && grid[r][c - 1]) ||
        (inBounds(r, c + 1) && grid[r][c + 1]);
      if (adj) list.push([r, c]);
    }
  }
  return list;
}

// Generate candidate horizontal placements in this orientation. Returns arrays
// of placements [{r,c,letter,blank}] (orientation-local coordinates).
function generateHorizontal(grid, rack, trie) {
  const allowed = crossChecks(grid, trie);
  const anchors = anchorsFor(grid);
  const anchorSet = new Set(anchors.map(([r, c]) => key(r, c)));
  const counts = Object.create(null);
  for (const t of rack) counts[t] = (counts[t] || 0) + 1;
  const results = [];

  const takeTile = (ch) => {
    if (counts[ch] > 0) { counts[ch]--; return false; }
    if (counts['_'] > 0) { counts['_']--; return true; }
    return undefined; // not available
  };
  const giveTile = (ch, isBlank) => { if (isBlank) counts['_']++; else counts[ch]++; };

  for (const [ar, ac] of anchors) {
    const record = (placed) => {
      if (placed.length === 0) return;
      results.push(placed.map((p) => ({ ...p })));
    };

    const extendRight = (node, c, placed) => {
      if (c >= SIZE) {
        if (node.terminal) record(placed);
        return;
      }
      const cell = grid[ar][c];
      if (cell) {
        const child = node.children[cell.letter];
        if (child) extendRight(child, c + 1, placed);
        return;
      }
      if (node.terminal) record(placed);
      const cross = allowed[ar][c];
      for (const ch in node.children) {
        if (cross && !cross.has(ch)) continue;
        const isBlank = takeTile(ch);
        if (isBlank === undefined) continue;
        placed.push({ r: ar, c, letter: ch, blank: isBlank });
        extendRight(node.children[ch], c + 1, placed);
        placed.pop();
        giveTile(ch, isBlank);
      }
    };

    const leftFilled = ac > 0 && grid[ar][ac - 1];
    if (leftFilled) {
      // Fixed prefix from existing tiles.
      let c = ac - 1;
      while (c > 0 && grid[ar][c - 1]) c--;
      let prefix = '';
      for (let cc = c; cc < ac; cc++) prefix += grid[ar][cc].letter;
      const node = trie.nodeFor(prefix);
      if (node) extendRight(node, ac, []);
    } else {
      // Free left part, bounded by empties up to the previous anchor/edge.
      let limit = 0, cc = ac - 1;
      while (cc >= 0 && !grid[ar][cc] && !anchorSet.has(key(ar, cc))) { limit++; cc--; }
      limit = Math.min(limit, rack.length - 1);

      const leftPart = (node, lim, placed) => {
        extendRight(node, ac, placed.slice());
        if (lim <= 0) return;
        const col = ac - placed.length - 1;
        if (col < 0) return;
        const cross = allowed[ar][col];
        for (const ch in node.children) {
          if (cross && !cross.has(ch)) continue;
          const isBlank = takeTile(ch);
          if (isBlank === undefined) continue;
          placed.push({ r: ar, c: col, letter: ch, blank: isBlank });
          leftPart(node.children[ch], lim - 1, placed);
          placed.pop();
          giveTile(ch, isBlank);
        }
      };
      leftPart(trie.root, limit, []);
    }
  }
  return results;
}

/**
 * Generate every legal move for `rack` on `grid`, scored via analyze().
 * Returns [{ placements, score, words, main }] (may contain duplicates removed).
 */
export function generateMoves(grid, rack, trie) {
  const raw = [];
  for (const p of generateHorizontal(grid, rack, trie)) raw.push(p);
  // Vertical words: generate on the transposed board, then swap coordinates.
  const tg = transpose(grid);
  for (const p of generateHorizontal(tg, rack, trie)) {
    raw.push(p.map((t) => ({ r: t.c, c: t.r, letter: t.letter, blank: t.blank })));
  }

  const seen = new Set();
  const moves = [];
  for (const placements of raw) {
    const sig = placements
      .map((p) => `${p.r},${p.c},${p.letter},${p.blank ? 1 : 0}`)
      .sort()
      .join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    const res = analyze(grid, placements, trie);
    if (res.ok) moves.push({ placements, score: res.score, words: res.words, main: res.main });
  }
  return moves;
}
