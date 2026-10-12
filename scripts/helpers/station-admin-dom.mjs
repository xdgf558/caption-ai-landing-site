import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createContentController } from '../../src/scripts/stationContentClient.js';
import * as workbenchState from '../../src/scripts/stationWorkbenchState.js';

// Small DOM for the actual admin entry scripts, not a reimplementation of their
// handlers. Select value/selectedOptions and appended options follow browser
// selection semantics so pagination and dirty-form event sequences can be tested.
export class AdminNode {
  constructor(tag = 'div', dataset = {}) { this.tagName = tag.toUpperCase(); this.dataset = dataset; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this._value = ''; this.hidden = false; this.disabled = false; this.textContent = ''; this.selected = false; this.resetCount = 0; }
  get options() { return this.children.filter(node => node.tagName === 'OPTION'); }
  get selectedOptions() { return this.options.filter(node => node.selected); }
  get selectedIndex() { return this.options.findIndex(node => node.selected); }
  set selectedIndex(index) { this.options.forEach((node, i) => { node.selected = i === index; }); }
  get value() { return this.tagName === 'SELECT' ? this.selectedOptions[0]?.value ?? '' : this._value; }
  set value(value) { this._value = String(value); if (this.tagName === 'SELECT') this.options.forEach(node => { node.selected = node.value === this._value; }); }
  get firstChild() { return this.children[0] ?? null; }
  get nextSibling() { const children = this.parentElement?.children ?? []; return children[children.indexOf(this) + 1] ?? null; }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); if (this.tagName === 'SELECT' && child.tagName === 'OPTION' && this.options.length === 1) child.selected = true; } }
  insertBefore(child, before) { if (child === before) return child; child.remove(); if (before === null) this.append(child); else { const index = this.children.indexOf(before); assert.ok(index >= 0); child.parentElement = this; this.children.splice(index, 0, child); } return child; }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
  replaceWith(child) { if (!this.parentElement) return; this.parentElement.insertBefore(child, this); this.remove(); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  async fire(type, extra = {}) { await Promise.all((this.listeners.get(type) ?? []).map(listener => listener({ target: this, preventDefault() {}, ...extra }))); }
  click() { if (!this.disabled) return this.fire('click'); }
  querySelector(selector) { const key = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1]?.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); for (const child of this.children) { if (key && key in child.dataset) return child; const result = child.querySelector(selector); if (result) return result; } return null; }
  closest() { return null; }
  reset() { this.resetCount++; }
  scrollIntoView() {}
  focus() { if (!this.disabled) this.focused = true; }
}

export async function adminScriptFixture(entry, { search = '', request, mediaUploader } = {}) {
  const nodes = new Map(), localeTitles = [], localeSummaries = [], creates = [], filters = [], nav = [], modules = [];
  const node = id => {
    if (!nodes.has(id)) {
      const selectIds = ['content-featured-track', 'content-featured-game', 'content-selected-tracks', 'content-selected-clips', 'content-locale', 'content-cover', 'content-lyrics', 'content-audio-mode', 'content-related', 'content-rollback-version', 'content-parent', 'content-screenshots', 'media-kind', 'media-owner'];
      const n = new AdminNode(selectIds.includes(id) ? 'select' : id.endsWith('form') ? 'form' : 'div'); n.id = id; n.parentElement = new AdminNode(); nodes.set(id, n);
      if (id.startsWith('work-icon-')) n.content = { cloneNode: () => new AdminNode('fragment') };
    }
    return nodes.get(id);
  };
  const option = (label, value) => { const n = new AdminNode('option'); n.textContent = label; n.value = value; return n; };
  node('content-locale').append(...['zh-Hans', 'zh-Hant', 'en', 'ja'].map(value => option(value, value)));
  node('media-kind').append(...['short_video', 'mv', 'poster', 'game_screenshot'].map(value => option(value, value)));
  node('media-owner').append(option('请选择', ''));
  node('content-reload-confirm').hidden = true;
  for (const locale of ['zh-Hans', 'zh-Hant', 'en', 'ja']) { localeTitles.push(new AdminNode('input', { title: locale })); localeSummaries.push(new AdminNode('textarea', { summary: locale })); }
  for (const type of workbenchState.workTypes) creates.push(new AdminNode('button', { workCreate: type }));
  for (const type of ['all', ...workbenchState.workTypes]) filters.push(new AdminNode('button', { workFilter: type }));
  for (const type of ['content', 'platforms', 'home', 'audit']) nav.push(new AdminNode('a', { adminNav: type }));
  for (const type of ['tracks', 'games', 'clips', 'assets', 'platforms', 'promotions']) modules.push(new AdminNode('button', { module: type }));
  const workbench = new AdminNode(), workFilters = new AdminNode(), workModules = new AdminNode();
  const document = {
    getElementById: node, createElement: tag => new AdminNode(tag), createDocumentFragment: () => new AdminNode('fragment'),
    querySelector(selector) {
      if (selector === '[data-station-workbench]') return workbench;
      if (selector === '.work-filters') return workFilters;
      if (selector === '.work-modules') return workModules;
      const match = /^\[data-(title|summary)="([^"]+)"\]$/.exec(selector);
      if (match) return (match[1] === 'title' ? localeTitles : localeSummaries).find(n => n.dataset[match[1]] === match[2]);
      throw new Error('Unhandled admin selector: ' + selector);
    },
    querySelectorAll(selector) {
      if (selector === '[data-title]') return localeTitles;
      if (selector === '[data-work-create]') return creates;
      if (selector === '[data-work-filter]') return filters;
      if (selector === '[data-admin-nav]') return nav;
      if (selector === '[data-module]') return modules;
      if (selector === '.content-tabs button,[data-work-filter],[data-work-create],#content-new,#content-search-submit,#content-more') return [...modules, ...filters, ...creates, node('content-new'), node('content-search-submit'), node('content-more')];
      if (selector === '#content-platform-editor input,#content-platform-editor select,#content-platform-editor button,#content-rights-editor input,#content-rights-editor select,#content-rights-editor textarea,#content-rights-editor button') {
        const result = [], walk = n => { for (const child of n.children) { if (['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(child.tagName)) result.push(child); walk(child); } }; walk(node('content-platform-editor')); walk(node('content-rights-editor')); return result;
      }
      if (selector === '[data-device]' || selector === '[data-device]:checked') return [];
      throw new Error('Unhandled admin selectors: ' + selector);
    }
  };
  const storageData = new Map(), storage = { getItem: key => storageData.get(key) ?? null, setItem: (key, value) => storageData.set(key, value) };
  const window = new AdminNode();
  window.sessionStorage = storage;
  const context = vm.createContext({ document, window, location: { search }, URLSearchParams, Date, Intl, console, crypto, sessionStorage: storage,
    request, ...workbenchState, createContentController: options => createContentController({ ...options, request }), renderStationCampaigns: async () => {},
    matchMedia: () => ({ matches: false }), Option: function(label, value) { return option(label, value); }, musicBytes: value => value + ' B',
    createStationMediaJournal: () => ({}), createStationMediaUploader: () => mediaUploader, mediaKindNames: { game_screenshot: '游戏截图', poster: '海报' }, mediaFileFormat: () => 'webp' });
  const source = (await readFile(new URL('../../src/scripts/' + entry, import.meta.url), 'utf8')).replace(/^import .+;\n/gm, '');
  vm.runInContext(source, context, { filename: entry });
  const state = () => vm.runInContext(entry === 'adminStationContent.js' ? '({dirty,busy,module,current,newObject,pending:controller?.pending()})' : '({loading,recovering,ownersBusy,preferredOwner})', context);
  async function idle() { for (let attempt = 0; attempt < 100; attempt++) { const s = state(); if (!s.busy && !s.loading && !s.recovering && !s.ownersBusy) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('admin controller did not settle'); }
  await idle();
  return { node, creates, filters, modules, nav, state, idle, storageData, context, document };
}
