// Bootstrap: load the dictionary, wire up the game and UI.

import { loadDictionary } from './trie.js';
import { Game } from './game.js';
import { UI } from './ui.js';

async function main() {
  const status = document.getElementById('loading');
  try {
    status.textContent = 'Loading dictionary…';
    const trie = await loadDictionary('./words.txt');
    status.textContent = `Dictionary ready (${trie.size.toLocaleString()} words).`;
    const game = new Game(trie);
    window.__ui = new UI(game); // exposed for debugging
    document.getElementById('app').classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 1200);
  } catch (err) {
    status.textContent = 'Could not load the dictionary. Make sure the game is served over http(s), not opened as a file.';
    console.error(err);
  }
}

main();
