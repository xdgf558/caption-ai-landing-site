// Presentation-only motion for the public paper theme. No content depends on it:
// elements are hidden only after html.sc-motion is set, and every effect is
// skipped when the visitor prefers reduced motion.
const revealSelectors = [
  '.paper-hero .gentle-hero-content > *', '.paper-hero-photo', '.paper-ribbon',
  '.gentle-feature', '.gentle-promotion', '.home-selected', '.home-selected-item', '.home-clips > .gentle-section-header', '.home-clip-card', '.gentle-news-item',
  '.sc-music-intro', '.sc-music-destinations', '.sc-song-hero', '.sc-music-selected > h2', '.sc-song-card', '.sc-clip-card', '.sc-music-catalog-header', '.sc-music-section',
  '.sc-game-heading', '.sc-game-ios', '.sc-game-card', '.sc-game-gallery a', '.sc-game-save', '.sc-game-device-note',
  '.sc-about > :not(.sc-about-destinations)', '.sc-about-card',
  '.sc-member-heading', '.sc-member-card', '.reader-auth-intro', '.reader-auth-card-wrap',
].join(',');
const tiltSelectors = '.gentle-feature, .sc-about-card, .sc-game-card, .paper-hero-photo';
const maxStagger = 6, staggerMs = 80;

export function mountStationMotion(body = document.body) {
  if (!body?.classList.contains('station-paper') || body.dataset.motionMounted) return () => {};
  body.dataset.motionMounted = 'true';
  const listeners = new AbortController(), cleanups = [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  // Header state works without motion too, so it stays outside the reduced-motion guard.
  let headerFrame = 0;
  const syncHeader = () => { headerFrame = 0; body.dataset.scScrolled = String(scrollY > 12); };
  addEventListener('scroll', () => { if (!headerFrame) headerFrame = requestAnimationFrame(syncHeader); }, { passive: true, signal: listeners.signal });
  syncHeader();

  if (!reduced.matches && 'IntersectionObserver' in window) cleanups.push(mountReveal(body));
  if (!reduced.matches) cleanups.push(mountParallax(body, listeners.signal));
  if (!reduced.matches && matchMedia('(hover: hover) and (pointer: fine)').matches) mountTilt(body, listeners.signal);

  return () => {
    listeners.abort(); cancelAnimationFrame(headerFrame);
    for (const cleanup of cleanups) cleanup();
    delete body.dataset.motionMounted;
  };
}

function mountReveal(body) {
  const targets = [...body.querySelectorAll(revealSelectors)]
    .filter(el => !el.closest('dialog, [data-sc-player-dock], [hidden]') && !el.hasAttribute('data-sc-reveal'));
  if (!targets.length) return () => {};
  const siblingIndex = new Map();
  for (const el of targets) {
    const parent = el.parentElement, index = siblingIndex.get(parent) ?? 0;
    siblingIndex.set(parent, index + 1);
    el.style.setProperty('--sc-reveal-delay', `${Math.min(index, maxStagger) * staggerMs}ms`);
    el.setAttribute('data-sc-reveal', '');
  }
  document.documentElement.classList.add('sc-motion');
  // After the entrance finishes, drop the reveal hooks so component hover transitions take over again.
  const settle = el => el.addEventListener('transitionend', event => {
    if (event.target !== el) return;
    el.removeAttribute('data-sc-reveal'); el.classList.remove('is-revealed'); el.style.removeProperty('--sc-reveal-delay');
  }, { once: true });
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-revealed'); settle(entry.target); observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
  for (const el of targets) observer.observe(el);
  // Never leave content hidden if an observer callback is lost (background tabs, odd embeds).
  const failsafe = setTimeout(() => {
    for (const el of targets) if (!el.classList.contains('is-revealed') && el.getBoundingClientRect().top < innerHeight) { el.classList.add('is-revealed'); settle(el); }
  }, 2500);
  return () => {
    observer.disconnect(); clearTimeout(failsafe);
    for (const el of targets) { el.removeAttribute('data-sc-reveal'); el.classList.remove('is-revealed'); el.style.removeProperty('--sc-reveal-delay'); }
    document.documentElement.classList.remove('sc-motion');
  };
}

function mountParallax(body, signal) {
  const layers = [...body.querySelectorAll('[data-sc-parallax]')];
  if (!layers.length) return () => {};
  let frame = 0;
  const update = () => {
    frame = 0;
    for (const layer of layers) {
      const rect = layer.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      const depth = Number(layer.dataset.scParallax) || 0.08;
      const offset = (rect.top + rect.height / 2 - innerHeight / 2) * -depth;
      layer.style.setProperty('translate', `0 ${offset.toFixed(1)}px`);
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  addEventListener('scroll', schedule, { passive: true, signal });
  addEventListener('resize', schedule, { passive: true, signal });
  update();
  return () => { cancelAnimationFrame(frame); for (const layer of layers) layer.style.removeProperty('translate'); };
}

function mountTilt(body, signal) {
  for (const card of body.querySelectorAll(tiltSelectors)) {
    let frame = 0, x = 0, y = 0;
    // The individual `rotate` property composes with the hover/reveal `transform`, so the two never fight.
    const apply = () => {
      frame = 0;
      const angle = Math.min(Math.hypot(x, y), 0.7) * 3.2;
      card.style.setProperty('rotate', angle < 0.05 ? 'none' : `${(-y).toFixed(3)} ${x.toFixed(3)} 0 ${angle.toFixed(2)}deg`);
    };
    card.addEventListener('pointermove', event => {
      const rect = card.getBoundingClientRect();
      x = (event.clientX - rect.left) / rect.width - 0.5; y = (event.clientY - rect.top) / rect.height - 0.5;
      if (!frame) frame = requestAnimationFrame(apply);
    }, { signal });
    card.addEventListener('pointerleave', () => { cancelAnimationFrame(frame); frame = 0; card.style.removeProperty('rotate'); }, { signal });
  }
}
