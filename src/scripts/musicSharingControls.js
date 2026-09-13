import { musicShareUrl, shareMusicLink } from '../music/navigation.js';
import { mountMusicShareCardPanel } from './musicShareCardControls.js';

export function mountMusicSharing(root, { t, locale, origin = globalThis.location.origin, navigator = globalThis.navigator, fetcher = globalThis.fetch, panels } = {}) {
  const abort = new AbortController();
  let selected = {}, cardOrigin = 'track', epochs = { track: 0, collection: 0 };
  const cards = panels ? mountMusicShareCardPanel(root, { t, locale, origin, navigator, fetcher, panels }) : null;
  const id = (kind, value = selected[kind]) => kind === 'track' ? value?.id : value?.slug;
  for (const kind of ['track', 'collection']) {
    const message = root.querySelector(`[data-share-message="${kind}"]`), input = root.querySelector(`[data-share-url="${kind}"]`);
    for (const action of ['share', 'copy']) root.querySelector(`[data-${action}-music="${kind}"]`).addEventListener('click', async () => {
      const value = selected[kind], key = id(kind);
      if (!key) return;
      if (kind === 'track' && action === 'share' && cards) { cardOrigin = 'track'; cards.update(selected.track); cards.open(); return; }
      const epoch = ++epochs[kind]; input.hidden = true; message.textContent = '';
      const result = await shareMusicLink({ title: value.title, url: musicShareUrl(origin, locale, { [kind]: key }) }, { navigator, copyOnly: action === 'copy' });
      if (abort.signal.aborted || epochs[kind] !== epoch || id(kind) !== key) return;
      message.textContent = t({ shared: '分享窗口已完成。', copied: '链接已复制。', manual: '请选中并复制下面的链接。', cancelled: '' }[result.status]);
      if (result.status === 'manual') { input.value = result.url; input.hidden = false; input.focus(); input.select(); }
    }, { signal: abort.signal });
  }
  return {
    openNow(opener) {
      if (!selected.now || !cards) return;
      cardOrigin = 'now'; cards.update(selected.now); cards.open(opener);
    },
    update(value) {
      for (const kind of ['track', 'collection']) {
        const changed = id(kind, value[kind]) !== id(kind);
        if (changed) {
          epochs[kind]++; root.querySelector(`[data-share-message="${kind}"]`).textContent = '';
          const input = root.querySelector(`[data-share-url="${kind}"]`); input.hidden = true; input.value = '';
        }
        for (const action of ['share', 'copy']) root.querySelector(`[data-${action}-music="${kind}"]`).disabled = !id(kind, value[kind]);
      }
      selected = value;
      cards?.update(value[cardOrigin]);
      root.querySelector('[data-collection-share]').hidden = !selected.collection;
    }, destroy() { cards?.destroy(); abort.abort(); }
  };
}
