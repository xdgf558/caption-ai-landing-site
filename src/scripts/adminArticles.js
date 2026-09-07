const $ = (id) => document.getElementById(id);
const form = $('article-form');
let entry = null, entries = [], coverKey = '', page = 1, dirty = false, busy = false;
const statusNames = { draft: '草稿', published: '已发布', archived: '已下架' };
const status = (message, error = false) => { $('article-status').textContent = message; $('article-status').dataset.error = String(error); };
const api = async (path, options = {}) => {
  const response = await fetch(path, { credentials: 'same-origin', signal: AbortSignal.timeout(30000), ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.message || '请求失败，请检查后台登录状态。');
  return data;
};
const post = (path, data) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
const payload = (state = 'draft') => ({ id: entry?.id, version: entry?.metadata?.article?.version, sourceUrl: $('article-url').value,
  title: $('article-title').value, description: $('article-description').value, locale: $('article-locale').value,
  markdown: $('article-body').value, coverR2Key: coverKey, coverAlt: $('article-cover-alt').value, status: state });
const ask = (title) => new Promise((resolve) => {
  const dialog = $('confirm-dialog');
  $('confirm-title').textContent = title;
  dialog.returnValue = '';
  $('confirm-accept').onclick = () => dialog.close('yes');
  $('confirm-cancel').onclick = () => dialog.close('no');
  dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
  dialog.showModal();
});
const run = async (action) => {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll('button, input, select, textarea')];
  const disabled = controls.map(el => el.disabled);
  controls.forEach(el => { el.disabled = true; });
  try { await action(); } catch (error) {
    status(error.name === 'TimeoutError' ? '请求超时，编辑内容已保留。请刷新列表确认是否已保存，再重试。' : error.message, true);
  }
  finally {
    controls.forEach((el, index) => { el.disabled = disabled[index]; });
    busy = false;
    $('article-url').readOnly = Boolean(entry);
    $('article-locale').disabled = Boolean(entry);
    $('list-previous').disabled = page <= 1;
    $('list-next').disabled = !hasMore;
  }
};
let hasMore = false;
const renderList = () => {
  const container = $('article-list');
  container.replaceChildren();
  const visible = entries.filter(row => $('article-filter').value === 'all' || row.status === $('article-filter').value);
  if (!visible.length) { const p = document.createElement('p'); p.textContent = '暂无文章'; container.append(p); }
  visible.forEach(row => {
    const button = document.createElement('button'), title = document.createElement('strong'), meta = document.createElement('small');
    button.type = 'button'; button.setAttribute('aria-current', String(row.id === entry?.id));
    title.textContent = row.title;
    meta.textContent = `${statusNames[row.status] || row.status} · ${row.locale} · ${(row.updatedAt || '').slice(0, 10)}`;
    button.append(title, meta);
    button.onclick = async () => {
      if (busy || (dirty && !await ask('放弃未保存的修改？'))) return;
      await run(async () => {
        const data = await api(`/admin/api/articles?id=${row.id}`);
        fill(data.entry, data.markdown);
        status('已载入文章。');
      });
    };
    container.append(button);
  });
};
const load = async () => {
  const data = await api(`/admin/api/articles?page=${page}&status=${encodeURIComponent($('article-filter').value)}`);
  entries = data.entries; hasMore = data.hasMore;
  renderList();
};
const showCover = (url = '') => {
  $('cover-selected').hidden = !url;
  if (url) $('cover-image').src = url; else $('cover-image').removeAttribute('src');
};
const fill = (row = null, markdown = '') => {
  entry = row; form.reset(); coverKey = row?.coverR2Key || '';
  $('article-url').value = row?.metadata?.article?.sourceUrl || '';
  $('article-title').value = row?.title || '';
  $('article-description').value = row?.description || '';
  $('article-locale').value = row?.locale || 'zh-Hans';
  $('article-body').value = markdown;
  $('article-body-section').open = Boolean(markdown);
  $('article-cover-alt').value = row?.coverAlt || '';
  $('article-url').readOnly = Boolean(row);
  $('article-locale').disabled = Boolean(row);
  showCover(row?.coverUrl);
  $('editor-title').textContent = row ? '编辑文章' : '新文章';
  $('editor-state').textContent = row ? statusNames[row.status] : '未保存';
  $('article-save').textContent = row?.status === 'published' ? '保存修改' : '保存草稿';
  $('article-publish').hidden = row?.status === 'published';
  $('article-withdraw').hidden = row?.status !== 'published';
  dirty = false; renderList();
};
const save = (state) => {
  if (!form.reportValidity()) return;
  return run(async () => {
    const markdown = $('article-body').value;
    const result = await post('/admin/api/articles', payload(state));
    fill(result.entry, markdown); status(state === 'published' ? '文章已发布。' : state === 'archived' ? '文章已下架。' : '草稿已保存。');
    await load();
  });
};
form.addEventListener('input', () => { dirty = true; $('editor-state').textContent = '未保存修改'; });
form.addEventListener('submit', (event) => { event.preventDefault(); save('published'); });
$('article-save').onclick = () => save(entry?.status === 'published' ? 'published' : 'draft');
$('article-withdraw').onclick = async () => { if (!busy && await ask('下架这篇文章？网站将不再展示。')) save('archived'); };
$('article-new').onclick = async () => { if (!busy && (!dirty || await ask('放弃未保存的修改？'))) { fill(); status(''); $('article-url').focus(); } };
$('article-refresh').onclick = () => run(load);
const changePage = (nextPage) => run(async () => {
  const previous = page;
  page = nextPage;
  try { await load(); } catch (error) { page = previous; throw error; }
});
$('article-filter').onchange = () => changePage(1);
$('list-next').onclick = () => changePage(page + 1);
$('list-previous').onclick = () => changePage(page - 1);
$('article-metadata').onclick = () => run(async () => {
  const result = await post('/admin/api/articles/metadata', { sourceUrl: $('article-url').value });
  if (!result.available) { status('无法识别此链接，请手动填写标题和摘要。'); return; }
  if (!$('article-title').value) $('article-title').value = result.title || '';
  if (!$('article-description').value) $('article-description').value = result.description || '';
  dirty = true; status('已填入可识别信息，请核对后发布。');
});
$('article-cover').onchange = () => run(async () => {
  const file = $('article-cover').files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) throw new Error('封面不能超过 5MB。');
  const data = new FormData(); data.set('file', file); data.set('mediaKind', 'covers'); data.set('slug', 'article-cover');
  const result = await api('/admin/api/articles/cover', { method: 'POST', body: data });
  coverKey = result.media.key; showCover(result.media.url); dirty = true; status('封面已上传，保存文章后生效。');
});
$('cover-remove').onclick = () => { coverKey = ''; showCover(); $('article-cover').value = ''; dirty = true; };
$('article-preview').onclick = () => {
  if (!form.reportValidity()) return;
  run(async () => {
    const result = await post('/admin/api/articles/preview', payload());
    $('article-preview-frame').srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${location.origin}/styles/signal-articles.css"><style>body{padding:24px;color:#25342e;font-family:system-ui}</style></head><body>${result.html}</body></html>`;
    $('preview-dialog').showModal();
  });
};
$('preview-close').onclick = () => $('preview-dialog').close();
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
run(async () => { await load(); status(''); });
