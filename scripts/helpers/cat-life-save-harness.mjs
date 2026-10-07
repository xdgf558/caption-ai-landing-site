import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const root = new URL('../../public/games/cat-life/', import.meta.url);
export function catLifeSaveHarness({ initial = {}, deniedRead = false, deniedWrite = false, main = false, session = { ok: true, authenticated: false }, cachedMember = null, entry = false } = {}) {
  const values = new Map(Object.entries(initial)), writes = [], listeners = new Map(), walls = [], timers = [];
  const storage = { getItem(key) { if (deniedRead) throw new Error('Storage denied'); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (deniedWrite) throw new Error('Quota denied'); writes.push([key, String(value)]); values.set(key, String(value)); }, removeItem(key) { writes.push([key, null]); values.delete(key); } };
  if (cachedMember) values.set('catGameMemberAccountV1', cachedMember);
  const element = () => ({ hidden: false, addEventListener() {}, querySelector() {}, querySelectorAll() { return []; }, replaceChildren() {}, classList: { add() {}, remove() {} } });
  const document = { hidden: false, baseURI: 'http://localhost/games/cat-life/', getElementById: element, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const context = vm.createContext({ console, URL, URLSearchParams, Date, Map, Set, Promise, AbortController, Blob, TextEncoder, localStorage: storage, document,
    setTimeout, clearTimeout, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } });
  context.window = context;
  context.location = { search: entry ? '?sc_entry=1' : '', reload() {}, href: document.baseURI };
  context.fetch = async () => ({ ok: true, async json() { return session; } });
  context.addEventListener = (type, listener) => { const list = listeners.get(type) || []; list.push(listener); listeners.set(type, list); };
  context.dispatchEvent = event => { for (const listener of listeners.get(event.type) || []) listener(event); };
  context.setInterval = fn => { timers.push(fn); return timers.length; }; context.clearInterval = () => {};
  const paths = [...readFileSync(new URL('index.html', root), 'utf8').matchAll(/<script src="\.\/(src\/js\/[^" ]+)"/g)].map(match => match[1]);
  for (const path of paths.filter(path => !/main\.js|musicSystem\.js|saveRecovery\.js/.test(path))) vm.runInContext(readFileSync(new URL(path, root), 'utf8'), context, { filename: path });
  const game = context.CatGame;
  game.state.game = game.state.createNewGame();
  if (main) {
    context.CatGameSaveRecovery = { selectSlot: async () => context.CatGameSaveStatus.select(storage, await context.CatGameSaveStatus.session(context.fetch)), show(status) { walls.push(status); } };
    vm.runInContext(readFileSync(new URL('src/js/main.js', root), 'utf8'), context, { filename: 'main.js' });
  }
  return { context, game, storage, values, writes, walls, timers, listeners,
    setDeniedRead(value) { deniedRead = value; }, setDeniedWrite(value) { deniedWrite = value; },
    async fire(type) { for (const listener of listeners.get(type) || []) await listener({ type }); } };
}
