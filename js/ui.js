// UI layer: rendering, tap/drag interaction, and the human/AI turn loop.

import { SIZE, CENTER, PREMIUM, LETTER_VALUES } from './constants.js';
import { analyze } from './engine.js';
import { rackValue } from './game.js';

const $ = (sel) => document.querySelector(sel);

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
    this.render();
  }

  cacheEls() {
    this.boardEl = $('#board');
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
      const tile = e.target.closest('.rack-tile');
      if (tile) this.onRackTile(+tile.dataset.i);
    });
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
