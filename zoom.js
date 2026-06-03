// A compact trie over the dictionary, used both for validating words and for
// driving the AI's move generator (prefix walking + terminal checks).

export class TrieNode {
  constructor() {
    this.children = Object.create(null); // letter -> TrieNode
    this.terminal = false;               // true if a word ends here
  }
}

export class Trie {
  constructor() {
    this.root = new TrieNode();
    this.size = 0;
  }

  add(word) {
    let node = this.root;
    for (const ch of word) {
      let next = node.children[ch];
      if (!next) {
        next = new TrieNode();
        node.children[ch] = next;
      }
      node = next;
    }
    if (!node.terminal) {
      node.terminal = true;
      this.size++;
    }
  }

  // Is `word` a complete dictionary word?
  has(word) {
    const node = this.nodeFor(word);
    return !!node && node.terminal;
  }

  // Return the node reached by walking `prefix`, or null if it falls off.
  nodeFor(prefix) {
    let node = this.root;
    for (const ch of prefix) {
      node = node.children[ch];
      if (!node) return null;
    }
    return node;
  }
}

// Load the dictionary text file and build the trie.
export async function loadDictionary(url = './words.txt') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load dictionary (${res.status})`);
  const text = await res.text();
  const trie = new Trie();
  let start = 0;
  // Manual line scan — faster than split() on a ~1.7MB file.
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 /*\n*/ || c === 13 /*\r*/) {
      if (i > start) trie.add(text.slice(start, i));
      start = i + 1;
    }
  }
  if (start < text.length) trie.add(text.slice(start));
  return trie;
}
