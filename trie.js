// UI layer: rendering, tap/drag interaction, and the human/AI turn loop.

import { SIZE, CENTER, PREMIUM, LETTER_VALUES } from './constants.js';
import { analyze } from './engine.js';
import { rackValue } from './game.js';
import { enableBoardZoom } from './zoom.js';

const $ = (sel) => document.querySelector(sel);

// Celebratory pop-ups shown when the player completes a word. 💖
const PRAISES = [
  'Sandra, you are amazing! 💖',
  'Z-A-Z-A spells A-M-A-Z-I-N-G! 🌟',
  'Zaza — the best maker of words ever! 📖✨',
  'Brilliant play, my love! 😘',
  'Sandra, you absolute genius! 🧠💫',
  'Word wizard Zaza strikes again! 🪄',
  'Unstoppable, Sandra! 🔥',
  'Zaza makes Scrabble look easy! 😍',
  "That's my clever girl! 💚",
  'Sandra, simply spectacular! 🎉',
  'Zaza = pure word magic! ✨',
  'Incredible, Sandra! Do it again! 👏',
  "You're glowing, Zaza! 🌈",
  'Queen of the tiles — Sandra! 👑',
  'Sandra, you wonderful human! 💕',
  'Zaza for the win! 🏆',
  'Smartest, loveliest Sandra! 💞',
  "Oh Zaza, you've done it again! 🤩",
  'Masterpiece, Sandra! 🎨',
  'Z-A-Z-A, you are the best! 💖',
  'Sandra, my Scrabble superstar! ⭐',
  'Dazzling word, Zaza! 💎',
];

export class UI {
  constructor(game) {
    this.game = game;
    this.pending = [];          // [{ r, c, letter, blank, rackIndex }]
    this.selected = null;       // selected rack index
    this.exchangeMode = false;
    this.exchangeSel = new Set();
    this.busy = false;          // AI thinking / animating
    this.cacheEls();
    this.bindControls();
    this.buildBoard();
    this.initZoom();
    this.initPraise();
    this.render();
  }

  // ---- Praise pop-ups -----------------------------------------------------

  initPraise() {
    this.praiseEl = $('#praise');
    this._lastPraise = -1;
    this.praiseOn = (() => {
      try { return localStorage.getItem('zaza_praise') !== 'off'; } catch { return true; }
    })();
    $('#praise-toggle').onclick = () => this.togglePraise();
    this.updatePraiseButton();
  }

  updatePraiseButton() {
    const b = $('#praise-toggle');
    if (!b) return;
    b.classList.toggle('off', !this.praiseOn);
    b.textContent = this.praiseOn ? '💖' : '🤍';
    b.title = this.praiseOn ? 'Praise pop-ups: ON' : 'Praise pop-ups: off';
  }

  togglePraise() {
    this.praiseOn = !this.praiseOn;
    try { localStorage.setItem('zaza_praise', this.praiseOn ? 'on' : 'off'); } catch {}
    this.updatePraiseButton();
    if (this.praiseOn) this.showPraise();
    else this.praiseEl.classList.remove('show');
  }

  showPraise() {
    if (!this.praiseOn || !this.praiseEl) return;
    let idx;
    do { idx = Math.floor(Math.random() * PRAISES.length); }
    while (PRAISES.length > 1 && idx === this._lastPraise);
    this._lastPraise = idx;
    this.praiseEl.textContent = PRAISES[idx];
    this.praiseEl.classList.remove('show');
    void this.praiseEl.offsetWidth; // restart the animation
    this.praiseEl.classList.add('show');
    clearTimeout(this._praiseTimer);
    this._praiseTimer = setTimeout(() => this.praiseEl.classList.remove('show'), 3600);
  }

  initZoom() {
    this.zoom = enableBoardZoom(this.viewportEl, this.boardEl);
    document.querySelector('#zoom-in').onclick = () => this.zoom.zoomIn();
    document.querySelector('#zoom-out').onclick = () => this.zoom.zoomOut();
    document.querySelector('#zoom-reset').onclick = () => this.zoom.reset();
  }

  cacheEls() {
    this.boardEl = $('#board');
    this.viewportEl = $('#board-viewport');
    this.rackEl = $('#rack');
    this.msgEl = $('#message');
    this.logEl = $('#log');
    this.humanScoreEl = $('#human-score');
    this.aiScoreEl = $('#ai-score');
    this.aiLabelEl = $('#ai-label');
    this.bagCountEl = $('#bag-count');
    this.blankModal = $('#blank-modal');
    this.endModal = $('#end-modal');
  }

  bindControls() {
    $('#btn-play').onclick = () => this.playMove();
    $('#btn-recall').onclick = () => this.recallAll();
    $('#btn-shuffle').onclick = () => this.shuffleRack();
    $('#btn-pass').onclick = () => this.passTurn();
    $('#btn-exchange').onclick = () => this.toggleExchange();
    $('#btn-newgame').onclick = () => this.startNewGame();
    $('#difficulty').onchange = (e) => { this.pendingDifficulty = e.target.value; };
    $('#end-newgame').onclick = () => { this.endModal.classList.add('hidden'); this.startNewGame(); };

    this.boardEl.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (cell) this.onBoardCell(+cell.dataset.r, +cell.dataset.c);
    });
    this.rackEl.addEventListener('click', (e) => {
      if (this._suppressRackClick) { this._suppressRackClick = false; return; }
      const tile = e.target.closest('.rack-tile');
      if (tile) this.onRackTile(+tile.dataset.i);
    });
    this.rackEl.addEventListener('pointerdown', (e) => this.onRackPointerDown(e));
    this._onDragMove = (e) => this.onDragMove(e);
    this._onDragUp = (e) => this.onDragUp(e);
  }

  // ---- Drag and drop (rack -> board) -------------------------------------

  onRackPointerDown(e) {
    if (this.busy || this.game.gameOver || this.exchangeMode) return;
    const tile = e.target.closest('.rack-tile');
    if (!tile) return;
    const i = +tile.dataset.i;
    if (this.pending.some((p) => p.rackIndex === i)) return; // already on board
    this._drag = {
      i, letter: this.game.racks.human[i],
      startX: e.clientX, startY: e.clientY, pointerId: e.pointerId,
      srcEl: tile, active: false,
    };
    window.addEventListener('pointermove', this._onDragMove, { passive: false });
    window.addEventListener('pointerup', this._onDragUp);
    window.addEventListener('pointercancel', this._onDragUp);
  }

  onDragMove(e) {
    const d = this._drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 8) return;
      d.active = true;
      this.startGhost(d);
      document.body.classList.add('dragging-tile');
      d.srcEl.classList.add('dragging-src');
    }
    e.preventDefault();
    this.moveGhost(e.clientX, e.clientY);
    this.updateDropTarget(e.clientX, e.clientY);
  }

  onDragUp(e) {
    const d = this._drag;
    if (!d || e.pointerId !== d.pointerId) return;
    window.removeEventListener('pointermove', this._onDragMove);
    window.removeEventListener('pointerup', this._onDragUp);
    window.removeEventListener('pointercancel', this._onDragUp);
    this._drag = null;
    if (!d.active) return; // it was a tap; let the click handler select it

    this.endGhost();
    document.body.classList.remove('dragging-tile');
    d.srcEl.classList.remove('dragging-src');
    this._suppressRackClick = true; // swallow the click that trails a drag
    clearTimeout(this._suppressTimer);
    this._suppressTimer = setTimeout(() => { this._suppressRackClick = false; }, 350);

    const x = e.clientX, y = e.clientY;
    const cell = this.cellFromPoint(x, y);
    const cellEmpty = cell &&
      !this.game.grid[+cell.dataset.r][+cell.dataset.c] &&
      !this.pending.some((p) => p.r === +cell.dataset.r && p.c === +cell.dataset.c);
    this.clearHighlights();

    if (cellEmpty) {
      this.selected = d.i;
      this.onBoardCell(+cell.dataset.r, +cell.dataset.c); // place + blank chooser + render
    } else if (this.overRack(x, y)) {
      this.reorderRack(d.i, this.computeRackDropIndex(x, d.i)); // rearrange tray
    }
  }

  cellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('.cell') : null;
  }

  startGhost(d) {
    const g = document.createElement('div');
    g.className = 'tile-ghost';
    const val = d.letter === '_' ? 0 : LETTER_VALUES[d.letter];
    g.innerHTML = d.letter === '_' ? '<span class="blank-face">?</span>' : `${d.letter}<sub>${val}</sub>`;
    const rect = d.srcEl.getBoundingClientRect();
    g.style.width = `${rect.width}px`;
    g.style.height = `${rect.height}px`;
    document.body.appendChild(g);
    this._ghost = g;
  }

  moveGhost(x, y) {
    if (this._ghost) this._ghost.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -65%)`;
  }

  endGhost() {
    if (this._ghost) { this._ghost.remove(); this._ghost = null; }
  }

  updateDropTarget(x, y) {
    const cell = this.cellFromPoint(x, y);
    const r = cell ? +cell.dataset.r : -1, c = cell ? +cell.dataset.c : -1;
    const cellEmpty = cell && !this.game.grid[r][c] && !this.pending.some((p) => p.r === r && p.c === c);
    if (cellEmpty) {
      this.clearRackIndicator();
      if (cell !== this._dropCell) { this.clearCellHighlight(); cell.classList.add('drop-target'); this._dropCell = cell; }
    } else {
      this.clearCellHighlight();
      if (this.overRack(x, y)) this.updateRackIndicator(x);
      else this.clearRackIndicator();
    }
  }

  clearCellHighlight() {
    if (this._dropCell) { this._dropCell.classList.remove('drop-target'); this._dropCell = null; }
  }

  clearHighlights() { this.clearCellHighlight(); this.clearRackIndicator(); }

  // Is the pointer over (or just outside) the rack tray?
  overRack(x, y) {
    const r = this.rackEl.getBoundingClientRect();
    return x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 28 && y <= r.bottom + 28;
  }

  // Insertion index in the tray, ignoring the tile being dragged.
  computeRackDropIndex(x, fromIndex) {
    let to = 0;
    [...this.rackEl.children].forEach((el, k) => {
      if (k === fromIndex) return;
      const r = el.getBoundingClientRect();
      if (x > r.left + r.width / 2) to++;
    });
    return to;
  }

  updateRackIndicator(x) {
    this.clearRackIndicator();
    const others = [...this.rackEl.children].filter((_, k) => k !== this._drag.i);
    const to = this.computeRackDropIndex(x, this._drag.i);
    if (to < others.length) others[to].classList.add('drop-left');
    else if (others.length) others[others.length - 1].classList.add('drop-right');
  }

  clearRackIndicator() {
    for (const el of this.rackEl.children) el.classList.remove('drop-left', 'drop-right');
  }

  // Move a tray tile to a new slot, keeping pending-tile indices correct.
  reorderRack(from, to) {
    const rack = this.game.racks.human;
    if (from < 0 || from >= rack.length) return;
    const [tile] = rack.splice(from, 1);
    to = Math.max(0, Math.min(to, rack.length));
    rack.splice(to, 0, tile);
    const remap = (j) => { let k = j > from ? j - 1 : j; if (k >= to) k++; return k; };
    for (const p of this.pending) p.rackIndex = remap(p.rackIndex);
    this.selected = null;
    this.render();
  }

  // ---- Board / rack interaction ------------------------------------------

  onRackTile(i) {
    if (this.busy || this.game.gameOver) return;
    if (this.pending.some((p) => p.rackIndex === i)) return; // already on board
    if (this.exchangeMode) {
      if (this.exchangeSel.has(i)) this.exchangeSel.delete(i);
      else this.exchangeSel.add(i);
      this.renderRack();
      return;
    }
    this.selected = this.selected === i ? null : i;
    this.renderRack();
  }

  onBoardCell(r, c) {
    if (this.busy || this.game.gameOver || this.exchangeMode) return;
    const pendingHere = this.pending.find((p) => p.r === r && p.c === c);
    if (pendingHere) { this.recallTile(pendingHere); return; }
    if (this.game.grid[r][c]) return;        // occupied by a committed tile
    if (this.selected === null) return;       // nothing to place

    const rackTile = this.game.racks.human[this.selected];
    if (rackTile === '_') {
      this.askBlankLetter((letter) => this.place(r, c, letter, true));
    } else {
      this.place(r, c, rackTile, false);
    }
  }

  place(r, c, letter, blank) {
    this.pending.push({ r, c, letter, blank, rackIndex: this.selected });
    this.selected = null;
    this.setMessage('');
    this.render();
  }

  recallTile(p) {
    this.pending = this.pending.filter((x) => x !== p);
    this.render();
  }

  recallAll() {
    if (this.busy) return;
    this.pending = [];
    this.selected = null;
    this.render();
  }

  shuffleRack() {
    if (this.busy) return;
    const rack = this.game.racks.human;
    for (let i = rack.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rack[i], rack[j]] = [rack[j], rack[i]];
    }
    this.pending = [];
    this.selected = null;
    this.render();
  }

  // ---- Turns --------------------------------------------------------------

  playMove() {
    if (this.busy || this.game.gameOver) return;
    if (this.pending.length === 0) { this.setMessage('Place some tiles first.'); return; }
    const placements = this.pending.map(({ r, c, letter, blank }) => ({ r, c, letter, blank }));
    const check = analyze(this.game.grid, placements, this.game.trie);
    if (!check.ok) { this.setMessage('⛔ ' + check.reason); return; }

    const res = this.game.applyMove('human', placements);
    this.pending = [];
    this.selected = null;
    const extra = res.words.length > 1 ? ` (${res.words.map((w) => w.word).join(', ')})` : '';
    this.setMessage(`✅ ${res.main} — ${res.score} pts${res.placements.length === 7 ? ' · BINGO! +50' : ''}${extra}`);
    this.render();
    this.showPraise();
    this.afterHuman();
  }

  passTurn() {
    if (this.busy || this.game.gameOver) return;
    if (!confirm('Pass your turn?')) return;
    this.recallAll();
    this.game.pass('human');
    this.setMessage('You passed.');
    this.render();
    this.afterHuman();
  }

  toggleExchange() {
    if (this.busy || this.game.gameOver) return;
    if (!this.exchangeMode) {
      if (this.game.bag.length < 1) { this.setMessage('Bag is empty — can\'t exchange.'); return; }
      this.recallAll();
      this.exchangeMode = true;
      this.exchangeSel.clear();
      this.setMessage('Select tiles to swap, then press Exchange again.');
      $('#btn-exchange').textContent = 'Confirm Swap';
    } else {
      const tiles = [...this.exchangeSel].map((i) => this.game.racks.human[i]);
      this.exitExchange();
      if (tiles.length === 0) { this.setMessage('Exchange cancelled.'); return; }
      const res = this.game.exchange('human', tiles);
      if (!res.ok) { this.setMessage('⛔ ' + res.reason); this.render(); return; }
      this.setMessage(`Swapped ${res.count} tile(s).`);
      this.render();
      this.afterHuman();
    }
    this.render();
  }

  exitExchange() {
    this.exchangeMode = false;
    this.exchangeSel.clear();
    $('#btn-exchange').textContent = 'Swap';
  }

  afterHuman() {
    if (this.game.gameOver) { this.render(); this.showEnd(); return; }
    this.game.nextTurn();
    this.busy = true;
    this.render();
    this.setMessage(`${this.aiName()} is thinking…`, true);
    setTimeout(() => this.runAI(), 500 + Math.random() * 600);
  }

  runAI() {
    const result = this.game.runAI();
    let msg;
    if (result.type === 'play') {
      msg = `${this.aiName()} played ${result.word} for ${result.score}${result.placements.length === 7 ? ' · BINGO!' : ''}`;
    } else if (result.type === 'exchange') {
      msg = `${this.aiName()} swapped ${result.count} tile(s).`;
    } else {
      msg = `${this.aiName()} passed.`;
    }
    this.busy = false;
    if (this.game.gameOver) { this.render(); this.setMessage(msg); this.showEnd(); return; }
    this.game.nextTurn();
    this.render();
    this.setMessage(msg);
  }

  startNewGame() {
    const diff = this.pendingDifficulty || this.game.difficulty;
    this.exitExchange();
    this.pending = [];
    this.selected = null;
    this.busy = false;
    this.game.newGame(diff);
    this.endModal.classList.add('hidden');
    this.setMessage(`New ${diff} game. You go first!`);
    this.render();
  }

  aiName() {
    const d = this.game.difficulty;
    return 'Bot (' + d.charAt(0).toUpperCase() + d.slice(1) + ')';
  }

  // ---- Blank chooser ------------------------------------------------------

  askBlankLetter(cb) {
    const grid = this.blankModal.querySelector('.blank-grid');
    grid.innerHTML = '';
    for (let i = 65; i <= 90; i++) {
      const ch = String.fromCharCode(i);
      const b = document.createElement('button');
      b.textContent = ch;
      b.onclick = () => { this.blankModal.classList.add('hidden'); cb(ch); };
      grid.appendChild(b);
    }
    this.blankModal.classList.remove('hidden');
    this.blankModal.querySelector('.blank-cancel').onclick = () =>
      this.blankModal.classList.add('hidden');
  }

  // ---- Rendering ----------------------------------------------------------

  buildBoard() {
    this.boardEl.innerHTML = '';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const div = document.createElement('div');
        div.className = 'cell';
        div.dataset.r = r;
        div.dataset.c = c;
        this.boardEl.appendChild(div);
      }
    }
    this.cellEls = [...this.boardEl.children];
  }

  render() {
    this.renderBoard();
    this.renderRack();
    this.renderStatus();
  }

  renderBoard() {
    const pendMap = new Map(this.pending.map((p) => [p.r * SIZE + p.c, p]));
    const lastSet = new Set(this.game.lastMoveCells.map((m) => m.r * SIZE + m.c));
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const el = this.cellEls[r * SIZE + c];
        const k = r * SIZE + c;
        const committed = this.game.grid[r][c];
        const pend = pendMap.get(k);
        const prem = PREMIUM[r][c];
        el.className = 'cell';
        if (committed) {
          el.innerHTML = this.tileHTML(committed.letter, committed.blank);
          el.classList.add('filled');
          if (lastSet.has(k)) el.classList.add('last');
        } else if (pend) {
          el.innerHTML = this.tileHTML(pend.letter, pend.blank);
          el.classList.add('filled', 'pending');
        } else if (r === CENTER && c === CENTER) {
          el.innerHTML = '<span class="star">★</span>';
          el.classList.add('prem', 'center');
        } else if (prem.label) {
          el.innerHTML = `<span class="prem-label">${prem.label}</span>`;
          el.classList.add('prem', 'prem-' + prem.label);
        } else {
          el.innerHTML = '';
        }
      }
    }
  }

  tileHTML(letter, blank) {
    const val = blank ? 0 : LETTER_VALUES[letter];
    return `<span class="tile${blank ? ' blank' : ''}">${letter}<sub>${val}</sub></span>`;
  }

  renderRack() {
    const rack = this.game.racks.human;
    this.rackEl.innerHTML = '';
    rack.forEach((t, i) => {
      const onBoard = this.pending.some((p) => p.rackIndex === i);
      const div = document.createElement('div');
      div.className = 'rack-tile';
      div.dataset.i = i;
      if (onBoard) div.classList.add('used');
      if (this.selected === i) div.classList.add('selected');
      if (this.exchangeMode && this.exchangeSel.has(i)) div.classList.add('swap');
      const val = t === '_' ? 0 : LETTER_VALUES[t];
      div.innerHTML = t === '_'
        ? '<span class="blank-face">?</span>'
        : `${t}<sub>${val}</sub>`;
      this.rackEl.appendChild(div);
    });
  }

  renderStatus() {
    this.humanScoreEl.textContent = this.game.scores.human;
    this.aiScoreEl.textContent = this.game.scores.ai;
    this.aiLabelEl.textContent = this.aiName();
    this.bagCountEl.textContent = this.game.bag.length;
    document.body.classList.toggle('your-turn', this.game.turn === 'human' && !this.busy && !this.game.gameOver);

    const turnEl = $('#turn-indicator');
    if (this.game.gameOver) turnEl.textContent = 'Game over';
    else if (this.busy) turnEl.textContent = this.aiName() + '’s turn';
    else turnEl.textContent = this.game.turn === 'human' ? 'Your turn' : this.aiName() + '’s turn';

    // Recent log (last 6 entries).
    this.logEl.innerHTML = this.game.log.slice(-6).reverse().map((e) => {
      const who = e.who === 'human' ? 'You' : 'Bot';
      if (e.type === 'play') return `<li><b>${who}</b>: ${e.word} (+${e.score})</li>`;
      if (e.type === 'exchange') return `<li><b>${who}</b>: swapped ${e.count}</li>`;
      return `<li><b>${who}</b>: passed</li>`;
    }).join('');
  }

  setMessage(text, thinking = false) {
    this.msgEl.textContent = text;
    this.msgEl.classList.toggle('thinking', thinking);
  }

  showEnd() {
    const g = this.game;
    const title = g.winner === 'tie' ? "It's a tie!" : g.winner === 'human' ? '🎉 You win!' : `${this.aiName()} wins`;
    $('#end-title').textContent = title;
    $('#end-detail').textContent = `Final score — You ${g.scores.human}, ${this.aiName()} ${g.scores.ai}.`;
    this.endModal.classList.remove('hidden');
  }
}
