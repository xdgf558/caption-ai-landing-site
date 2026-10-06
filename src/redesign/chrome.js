// Geometry only. Audio ownership, persisted playback and game handoff belong to T09/T13.
export function mountStationChrome(root = document.querySelector('[data-station-shell]')) {
  if (!root || root.dataset.chromeMounted) return () => {};
  root.dataset.chromeMounted = 'true';
  const nav = root.querySelector('[data-sc-bottom-nav]');
  const player = root.querySelector('[data-sc-player-dock]');
  let frame;
  const setSize = (name, value) => {
    const size = `${Math.ceil(value)}px`;
    if (root.style.getPropertyValue(name) !== size) root.style.setProperty(name, size);
  };
  const measure = () => {
    const runtime = root.dataset.gameRuntime === 'true';
    const navBox = nav?.getBoundingClientRect();
    // Safe-area padding is counted separately in the shared reserve and dock offset.
    const safePadding = nav ? parseFloat(getComputedStyle(nav).paddingBottom) || 0 : 0;
    const basePadding = 6;
    setSize('--sc-nav-bar-height', runtime || !navBox?.height ? 0 : navBox.height - Math.max(0, safePadding - basePadding));
    setSize('--sc-player-height', runtime || player?.hidden ? 0 : player?.getBoundingClientRect().height || 0);
  };
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
  const resize = new ResizeObserver(schedule);
  for (const element of [nav, player]) if (element) resize.observe(element);
  const mutations = new MutationObserver(schedule);
  mutations.observe(root, { attributes: true, attributeFilter: ['data-game-runtime'] });
  if (player) mutations.observe(player, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  measure();
  return () => {
    cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect();
    window.removeEventListener('resize', schedule);
    delete root.dataset.chromeMounted;
  };
}
