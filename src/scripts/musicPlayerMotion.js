import { gsap } from 'gsap';

// Presentation only: no audio, playback state or catalog mutations.
export function mountMusicPlayerMotion(root, { host = window } = {}) {
  const doc = root.ownerDocument;
  const dialog = root.querySelector('[data-now-dialog]');
  const target = root.querySelector('[data-now-target]');
  const cover = root.querySelector('[data-now-cover]');
  const mini = root.querySelector('[data-mini-cover]');
  const reduced = host.matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  let timeline = null, ghost = null, origin = null, palette = null, coverKey = '';
  const reset = () => {
    timeline?.kill(); timeline = null;
    ghost?.remove(); ghost = null;
    gsap.set(target, { clearProps: 'transform,opacity' });
    cover.style.removeProperty('visibility');
  };
  const rect = image => {
    if (image.hidden || !image.getClientRects().length) return null;
    const box = image.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    // A spinning label's bounding box grows at 45 degrees; use its actual size.
    const width = image === cover ? image.offsetWidth : box.width;
    const height = image === cover ? image.offsetHeight : box.height;
    return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
  };
  const artwork = (from, to, duration) => {
    if (!from || !to || cover.hidden || !cover.complete || !cover.naturalWidth) return;
    ghost = doc.createElement('img'); ghost.src = cover.currentSrc || cover.src;
    ghost.alt = ''; ghost.setAttribute('aria-hidden', 'true'); ghost.dataset.musicMotionArt = '';
    Object.assign(ghost.style, { position: 'fixed', zIndex: '2', objectFit: 'cover', pointerEvents: 'none', maxWidth: 'none' });
    // Native dialog top layer keeps this decorative image above the sheet.
    dialog.append(ghost); cover.style.visibility = 'hidden';
    const matrix = host.getComputedStyle(cover.parentElement).transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
    const angle = matrix ? Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI : 0;
    gsap.set(ghost, { ...from, rotation: from === origin ? 0 : angle, borderRadius: from === origin ? 8 : '50%' });
    timeline.to(ghost, { ...to, rotation: to === origin ? 0 : angle, borderRadius: to === origin ? 8 : '50%', duration, ease: 'power3.inOut' }, 0);
  };
  const setPalette = color => {
    palette?.kill();
    palette = gsap.to(dialog, { '--music-cover-tint': color, duration: reduced.matches ? 0 : .8, ease: 'sine.inOut' });
  };
  const sample = () => {
    if (!coverKey || cover.hidden || !cover.complete || !cover.naturalWidth) return;
    try {
      const canvas = doc.createElement('canvas'); canvas.width = canvas.height = 12;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(cover, 0, 0, 12, 12);
      const pixels = ctx.getImageData(0, 0, 12, 12).data;
      const sum = [0, 0, 0]; let weight = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3] / 255; weight += a;
        for (let c = 0; c < 3; c++) sum[c] += pixels[i + c] * a;
      }
      // Keep even bright artwork subdued so lyrics and controls remain legible.
      const rgb = sum.map((n, c) => Math.round(n / Math.max(weight, 1) * .27 + [16, 20, 25][c]));
      setPalette(`rgb(${rgb.join(',')})`);
    } catch { setPalette('#293139'); }
  };
  cover.addEventListener('load', sample, { signal: abort.signal });
  cover.addEventListener('error', () => setPalette('#293139'), { signal: abort.signal });
  reduced.addEventListener('change', () => { reset(); palette?.progress(1); }, { signal: abort.signal });
  return {
    capture() { origin = rect(mini) || origin; },
    open() {
      reset(); if (reduced.matches) return;
      const destination = rect(cover);
      timeline = gsap.timeline({ onComplete: reset });
      timeline.fromTo(target, { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: .48, ease: 'power3.out' }, 0);
      artwork(origin, destination, .48);
    },
    close() {
      reset(); if (reduced.matches) return;
      const source = rect(cover);
      timeline = gsap.timeline();
      timeline.to(target, { y: 24, opacity: 0, duration: .38, ease: 'power2.in' }, 0);
      artwork(source, origin, .38);
    },
    setCover(url) {
      if (url === coverKey) return;
      coverKey = url || '';
      // A rapid track change must never leave the previous artwork flying above it.
      if (ghost) { gsap.killTweensOf(ghost); ghost.remove(); ghost = null; cover.style.removeProperty('visibility'); }
      if (!url) setPalette('#293139'); else sample();
    },
    reset,
    destroy() { reset(); palette?.kill(); abort.abort(); dialog.style.removeProperty('--music-cover-tint'); }
  };
}
