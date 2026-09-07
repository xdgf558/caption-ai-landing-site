const dialog = document.querySelector('[data-article-share-dialog]');

// Pixel-measured wrapping handles mixed CJK/Latin and unbroken URLs without overflowing.
export function wrapCardText(ctx, text, width, limit) {
  const parts = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(item => item.segment)
    : Array.from(text);
  const lines = [];
  let line = '';
  for (const part of parts) {
    if (ctx.measureText(line + part).width > width && line) {
      lines.push(line.trimEnd());
      line = '';
      if (lines.length === limit) {
        let last = lines.pop();
        while (ctx.measureText(last + '…').width > width) last = Array.from(last).slice(0, -1).join('');
        return [...lines, last + '…'];
      }
    }
    line += part;
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

async function loadLogo() {
  const image = new Image();
  image.src = '/images/optimized/station-cat-logo-1668c2e5-160.webp';
  let timeout;
  try {
    await Promise.race([image.decode(), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Image timeout')), 8000); })]);
    return image;
  } finally { clearTimeout(timeout); }
}

export async function createArticleCard(data, copy) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1440;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Canvas unavailable');
  const font = '"PingFang SC", "PingFang TC", "Hiragino Sans", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#fcfcfa';
  ctx.fillRect(0, 0, 1080, 1440);
  ctx.fillStyle = '#286153';
  ctx.fillRect(0, 0, 1080, 16);
  let logo;
  try { logo = await loadLogo(); } catch { /* Text branding remains available offline. */ }
  if (logo) ctx.drawImage(logo, 72, 64, 88, 88);
  ctx.fillStyle = '#243c34';
  ctx.font = `bold 32px ${font}`;
  ctx.fillText('Station Cat', logo ? 180 : 72, 103);
  ctx.fillStyle = '#68766e';
  ctx.font = `20px ${font}`;
  ctx.fillText('ARTICLES / @statiocat', logo ? 180 : 72, 139);
  ctx.fillStyle = '#cfdad3';
  ctx.fillRect(72, 192, 936, 2);
  ctx.fillStyle = '#286153';
  ctx.font = `24px ${font}`;
  ctx.fillText(data.date, 72, 256);
  const title = data.title.replace(/\s+/g, ' ').trim();
  let titleSize = 64;
  ctx.font = `bold ${titleSize}px ${font}`;
  while (wrapCardText(ctx, title, 936, 5).at(-1)?.endsWith('…') && titleSize > 46) {
    titleSize -= 2;
    ctx.font = `bold ${titleSize}px ${font}`;
  }
  const titles = wrapCardText(ctx, title, 936, 5);
  ctx.fillStyle = '#1e3029';
  titles.forEach((line, i) => ctx.fillText(line, 72, 354 + i * 82));
  const summaryY = Math.max(584, 354 + titles.length * 82 + 34);
  ctx.fillStyle = '#59655f';
  ctx.font = `32px ${font}`;
  const summaryLimit = Math.max(2, Math.floor((1040 - summaryY) / 53));
  wrapCardText(ctx, data.description.replace(/\s+/g, ' ').trim(), 936, summaryLimit)
    .forEach((line, i) => ctx.fillText(line, 72, summaryY + i * 53));
  ctx.fillStyle = '#e9efea';
  ctx.fillRect(0, 1104, 1080, 336);
  ctx.fillStyle = '#243c34';
  ctx.font = `bold 30px ${font}`;
  wrapCardText(ctx, copy.scan, 585, 2).forEach((line, i) => ctx.fillText(line, 72, 1200 + i * 42));
  ctx.font = `23px ${font}`;
  ctx.fillText('wwwstationcat.org', 72, 1294);
  ctx.fillStyle = '#68766e';
  ctx.font = `20px ${font}`;
  ctx.fillText('@statiocat', 72, 1336);
  const count = data.modules.length;
  const cell = Math.floor(248 / (count + 8));
  const size = (count + 8) * cell;
  const x = 1008 - size, y = 1148;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#13241c';
  data.modules.forEach((row, r) => Array.from(row).forEach((bit, c) => {
    if (bit === '1') ctx.fillRect(x + (c + 4) * cell, y + (r + 4) * cell, cell, cell);
  }));
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('PNG unavailable')), 'image/png'));
}

if (dialog) {
  const copy = JSON.parse(dialog.dataset.copy);
  const image = dialog.querySelector('[data-share-image]');
  const preview = dialog.querySelector('.article-share-preview');
  const status = dialog.querySelector('[role="status"]');
  const save = dialog.querySelector('[data-share-save]');
  const native = dialog.querySelector('[data-share-native]');
  const retry = dialog.querySelector('[data-share-retry]');
  const urlInput = dialog.querySelector('[data-share-url]');
  let current, opener, imageUrl, file, generation = 0;
  const cleanImage = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
    file = null;
    image.removeAttribute('src');
    image.hidden = save.hidden = native.hidden = true;
    save.removeAttribute('href');
  };
  async function generate() {
    const token = ++generation;
    cleanImage();
    retry.hidden = true;
    preview.setAttribute('aria-busy', 'true');
    status.textContent = copy.loading;
    try {
      const blob = await createArticleCard(current, copy);
      if (token !== generation || !dialog.open) return;
      imageUrl = URL.createObjectURL(blob);
      image.src = imageUrl;
      image.alt = `${copy.ready}: ${current.title}`;
      save.href = imageUrl;
      file = new File([blob], 'station-cat-article.png', { type: 'image/png' });
      image.hidden = save.hidden = false;
      try { native.hidden = !(navigator.canShare?.({ files: [file] }) && navigator.share); } catch { native.hidden = true; }
      status.textContent = copy.ready;
    } catch {
      if (token !== generation || !dialog.open) return;
      status.textContent = copy.failed;
      retry.hidden = false;
    } finally {
      if (token === generation) preview.setAttribute('aria-busy', 'false');
    }
  }
  for (const button of document.querySelectorAll('[data-article-share]')) {
    button.hidden = false;
    button.addEventListener('click', () => {
      opener = button;
      current = JSON.parse(button.dataset.articleShare);
      urlInput.value = current.url;
      dialog.showModal();
      generate();
    });
  }
  dialog.querySelector('[data-share-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; cleanImage(); opener?.focus(); });
  retry.addEventListener('click', generate);
  dialog.querySelector('[data-share-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(current.url); status.textContent = copy.copied; }
    catch { urlInput.focus(); urlInput.select(); status.textContent = copy.manual; }
  });
  native.addEventListener('click', async () => {
    if (!file || native.disabled) return;
    native.disabled = true;
    try { await navigator.share({ files: [file], title: current.title }); }
    catch (error) { if (error.name !== 'AbortError') status.textContent = copy.shareFailed; }
    finally { native.disabled = false; }
  });
}
