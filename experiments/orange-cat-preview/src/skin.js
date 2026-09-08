import { chainPoint, clamp, mix, smooth } from './motion.js';

export const LEG_WIDTH = { front: 69, back: 99 };
export function profileAt(profile, t) {
  if (!profile?.length) return .5;
  const f = clamp(t) * (profile.length - 1), i = Math.floor(f);
  return mix(profile[i], profile[Math.min(i + 1, profile.length - 1)], f - i);
}

// The furry leg bends, but the whole toe cap keeps its painted proportions.
// Recentring each toe row or rotating it along the ankle-to-floor segment
// turned the round paw into a pointed hoof in the previous mesh.
export function legSkinPoint(u, v, leg, meta) {
  const width = LEG_WIDTH[leg.kind], pawStart = .82;
  const t = v < .44 ? v / .44 / 2 : .5 + (v - .44) / (pawStart - .44) / 2;
  const chain = leg.points.slice(0, 3);
  const p = chainPoint(chain, t);
  const before = chainPoint(chain, Math.max(0, t - .005));
  const after = chainPoint(chain, Math.min(1, t + .005));
  const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1;
  const offset = (u - profileAt(meta.profile, v)) * width;
  const bent = { x: p.x + dy / length * offset, y: p.y - dx / length * offset };
  const foot = leg.points.at(-1);
  const paw = {
    x: foot.x + (u - profileAt(meta.profile, .92)) * width,
    y: foot.y - (1 - v) * meta.height / meta.width * width
  };
  if (v >= pawStart) return paw;
  const blend = smooth((v - .65) / (pawStart - .65));
  return { x: mix(bent.x, paw.x, blend), y: mix(bent.y, paw.y, blend) };
}
