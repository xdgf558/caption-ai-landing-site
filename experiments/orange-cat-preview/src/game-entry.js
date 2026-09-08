import 'pixi.js/unsafe-eval'; // CSP-compatible synchronizers; does NOT require unsafe-eval in the site policy.
import { Application, Assets, Container, Sprite } from 'pixi.js';
import { OrangeCatRig } from './rig.js';
import { sampleMotion, BOWL } from './motion.js';
import { roomPose, feedingTime } from './game-pose.js';
import meta from '../public/assets/rig-meta.json';
import feedingMeta from '../public/assets/feeding-meta.json';

const game = window.CatGame;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const base = new URL('src/vendor/cat-motion/', document.baseURI);
let app, rig, world, bowl, initializing, broken = false, entries = [], frame = 0, lastFrame = 0;
const epoch = performance.now();

function clearEntry(entry) {
  entry.node.classList.remove('has-cat-motion');
  entry.node.removeAttribute('data-motion-action');
  entry.canvas.remove();
}
function stop() { cancelAnimationFrame(frame); frame = 0; }
function fail(error) {
  if (broken) return;
  console.warn('Cat motion unavailable; retaining original artwork.', error instanceof Error ? error.message : 'renderer lost');
  broken = true; stop(); entries.forEach(clearEntry); entries = [];
  if (app?.renderer) app.destroy(true, { children: true });
  app = null;
}
async function initialize() {
  if (initializing) return initializing;
  initializing = (async () => {
    // One shared WebGL context, even with several cats. Visible canvases receive
    // a synchronous copy; page rerenders reuse them instead of leaking contexts.
    app = new Application();
    await app.init({ width: 640, height: 440, resolution: 1, backgroundAlpha: 0, antialias: true, preference: 'webgl', autoStart: false });
    app.canvas.addEventListener('webglcontextlost', fail, { once: true });
    await Assets.init({ preferences: { preferWorkers: false, preferCreateImageBitmap: true } });
    const names = ['torso', 'head', 'front-leg', 'back-leg', 'tail', 'mouth-open', 'kibble'];
    const textures = Object.fromEntries(await Promise.all(names.map(async name => [name, await Assets.load(new URL(name + '.webp', base).href)])));
    textures.bowl = await Assets.load(new URL('../../assets/rooms/furniture-bowl.png', base).href);
    world = new Container(); app.stage.addChild(world);
    bowl = new Sprite(textures.bowl); bowl.anchor.set(.5, 1); bowl.position.set(BOWL.x, BOWL.baseY); bowl.width = BOWL.width; bowl.height = BOWL.height;
    rig = new OrangeCatRig(textures, meta, feedingMeta); world.addChild(bowl, rig.root);
  })().catch(fail);
  return initializing;
}
function valid(entry) {
  return entry.owner === game.state.game && game.state.game.cats.includes(entry.cat) && game.utils.catMotion.eligible(entry.cat);
}
function paint(entry, now) {
  const bounds = entry.canvas.getBoundingClientRect();
  const width = bounds.width, height = bounds.height;
  if (!width || !height) return;
  if (entry.node.classList.contains('has-cat-motion') && (bounds.bottom < 0 || bounds.top > innerHeight || bounds.right < 0 || bounds.left > innerWidth)) return;
  const room = entry.node.dataset.catMotionArea === 'room';
  const seconds = (performance.now() - epoch) / 1000;
  let pose, elapsed = room ? null : feedingTime(game.systems.catInteractionSystem.current(entry.cat), now);
  if (room) {
    const actor = entry.node.closest('.room-cat-actor');
    const x = actor.getBoundingClientRect().left;
    const delta = entry.x == null ? 0 : x - entry.x;
    const scale = Math.min(width / 520, height / 340);
    const moving = !entry.node.closest('.is-editing') && Math.abs(delta) > .025 && Math.abs(delta) < 30;
    if (moving) { entry.distance += Math.abs(delta) / scale; entry.facing = delta > 0 ? -1 : 1; }
    entry.x = x;
    pose = roomPose(entry.distance, seconds, moving);
    entry.canvas.style.transform = 'scaleX(' + (entry.facing || 1) + ')';
  } else {
    pose = elapsed === null ? sampleMotion('idle', seconds % 6) : sampleMotion('eat', elapsed);
  }
  // Stable framing: feeding uses the same body position as idle, so the head
  // lowers to the bowl without the whole cat teleporting sideways.
  const logicalWidth = 520, logicalHeight = 340;
  const renderWidth = Math.min(800, Math.ceil(width * Math.min(devicePixelRatio || 1, 2)));
  const renderHeight = Math.max(1, Math.round(renderWidth * height / width));
  if (entry.canvas.width !== renderWidth || entry.canvas.height !== renderHeight) { entry.canvas.width = renderWidth; entry.canvas.height = renderHeight; }
  app.renderer.resize(renderWidth, renderHeight);
  const scale = Math.min(renderWidth / logicalWidth, renderHeight / logicalHeight);
  world.scale.set(scale);
  world.position.set(renderWidth / 2 - pose.rootX * scale, renderHeight - 445 * scale);
  bowl.visible = pose.bowl;
  rig.draw(pose);
  app.render();
  entry.ctx.clearRect(0, 0, renderWidth, renderHeight);
  entry.ctx.drawImage(app.canvas, 0, 0);
  entry.node.classList.add('has-cat-motion');
  entry.node.dataset.motionAction = pose.action;
}
function tick(timestamp) {
  frame = 0;
  if (broken || document.hidden || reduced.matches || !entries.length) return;
  if (timestamp - lastFrame >= 1000 / 30) {
    lastFrame = timestamp;
    try {
      entries = entries.filter(entry => { if (entry.node.isConnected && valid(entry)) return true; clearEntry(entry); return false; });
      entries.forEach(entry => paint(entry, Date.now()));
    } catch (_) { fail(); return; }
  }
  if (entries.length) frame = requestAnimationFrame(tick);
}
async function sync() {
  stop();
  if (broken || reduced.matches) { entries.forEach(clearEntry); entries = []; return; }
  // Query only after awaiting: a route/save can change while assets load.
  await initialize();
  if (broken || reduced.matches) return;
  const previous = entries;
  entries = Array.from(document.querySelectorAll('[data-cat-motion-id]')).filter(node => {
    return game.utils.catMotion.eligible(game.state.game.cats.find(item => item.id === node.dataset.catMotionId));
  }).slice(0, 3).flatMap(node => {
    const cat = game.state.game.cats.find(item => item.id === node.dataset.catMotionId);
    if (!game.utils.catMotion.eligible(cat)) return [];
    const entry = previous.find(item => item.cat === cat && item.owner === game.state.game && item.area === node.dataset.catMotionArea);
    if (entry) { clearEntry(entry); entry.node = node; entry.x = null; }
    const canvas = entry?.canvas || document.createElement('canvas');
    canvas.className = 'cat-motion-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', game.utils.i18n.getDataText(cat, 'name'));
    const ctx = entry?.ctx || canvas.getContext('2d');
    if (!ctx) return [];
    const result = entry || { canvas, ctx, cat, owner: game.state.game, node, area: node.dataset.catMotionArea, distance: 0 };
    node.appendChild(canvas);
    if (result.routeTime != null) {
      const animation = node.closest('.room-cat-actor')?.getAnimations()[0];
      if (animation) animation.currentTime = result.routeTime;
    }
    return [result];
  }); // Bound mobile GPU work; remaining companions keep their artwork.
  previous.filter(entry => !entries.includes(entry)).forEach(clearEntry);
  if (!document.hidden && entries.length && !frame) frame = requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else sync(); });
reduced.addEventListener('change', sync);
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', event => { if (event.persisted) sync(); });
game.utils.catMotionRuntime = { sync, beforeRender() {
  entries.forEach(entry => {
    const animation = entry.node.closest('.room-cat-actor')?.getAnimations()[0];
    if (animation) entry.routeTime = animation.currentTime;
  });
} };
