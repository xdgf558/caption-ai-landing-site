import { sampleBite } from './bite.js';

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
export const duration = { idle: 6, walk: 6, eat: 10 };
export const FLOOR_Y = 430;
// Both the renderer and contact tests use the same measured artwork anchors.
export const BOWL = { x: 257, baseY: 440, width: 110, height: 110 * 341 / 512 };
export const FOOD_SURFACE = { x: BOWL.x + 12, y: BOWL.baseY - BOWL.height + 143 / 341 * BOWL.height };
export const HEAD_ART = { left: -124, top: -115, width: 181, height: 180 };
export const MOUTH_LOCAL = { x: HEAD_ART.left + 118 / 520 * HEAD_ART.width, y: HEAD_ART.top + 323 / 516 * HEAD_ART.height };
export const MOUTH_OPEN_SCALE = { x: HEAD_ART.width / 520, y: HEAD_ART.height / 516 * .66 };
// Attachment is measured on the rear of the painted neck, not at the image
// centre. In the neutral stance it sits inside the shoulder/chest volume.
export const NECK_LOCAL = { x: 26, y: 13 };
export const NECK_HOME = { x: -66, y: -141 };
const rotatePoint = (point, angle) => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
export function headSkinPoint(u, v, time = 0) {
  const ear = Math.pow(Math.max(0, 1 - v / .32), 2) * Math.sin(time * 1.9) * 1.1;
  // Taper the cutout's hanging neck/bib into the shoulder. Muzzle, jaw and
  // the anatomical attachment landmark remain outside this skinning region.
  const neckWeight = smooth((v - .78) / .22) * smooth((u - .24) / .4);
  return { x: HEAD_ART.left + u * HEAD_ART.width + ear * (u < .5 ? -1 : 1) + neckWeight * 24, y: HEAD_ART.top + v * HEAD_ART.height - neckWeight * 8 };
}
export function headLandmark(head, point, rootX) {
  const c = Math.cos(head.rotation), s = Math.sin(head.rotation);
  return { x: rootX + head.x + point.x * c - point.y * s, y: FLOOR_Y + head.y + point.x * s + point.y * c };
}
const TAU = Math.PI * 2;
export const LEG_DEFS = [
  { name: 'far-back', kind: 'back', x: 94, foot: 104, offset: 0.5, far: true, bend: 1 },
  { name: 'far-front', kind: 'front', x: -94, foot: -93, offset: 0.25, far: true, bend: -1 },
  { name: 'near-back', kind: 'back', x: 84, foot: 87, offset: 0, far: false, bend: 1 },
  { name: 'near-front', kind: 'front', x: -107, foot: -114, offset: 0.75, far: false, bend: -1 }
];

// Analytic two-bone IK: unreachable targets clamp safely, no iterative solver.
export function solveIK(root, target, upper = 72, lower = 73, bend = 1) {
  const dx = target.x - root.x, dy = target.y - root.y;
  const raw = Math.hypot(dx, dy), distance = clamp(raw, Math.abs(upper - lower) + 0.001, upper + lower - 0.001);
  const ux = raw > 0.00001 ? dx / raw : 0, uy = raw > 0.00001 ? dy / raw : 1;
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const normal = Math.sqrt(Math.max(0, upper * upper - along * along)) * bend;
  return { x: root.x + ux * along - uy * normal, y: root.y + uy * along + ux * normal };
}

// Distance-driven gait. In stance, local foot motion exactly cancels root
// travel: world X is constant even when playback velocity changes.
export function gaitFoot(distance, offset = 0, cycle = 90, duty = 0.68) {
  const phase = ((distance / cycle + offset) % 1 + 1) % 1;
  const span = cycle * duty;
  if (phase < duty) return { x: -span / 2 + phase * cycle, y: 0, planted: true, phase };
  const swing = (phase - duty) / (1 - duty);
  return { x: span / 2 - span * smooth(swing), y: -24 * Math.sin(Math.PI * swing), planted: false, phase };
}

export function sampleMotion(action, inputTime) {
  if (!(action in duration)) throw new Error('Unknown action');
  const t = clamp(Number.isFinite(inputTime) ? inputTime : 0, 0, duration[action]);
  const bite = sampleBite(action === 'eat' ? t : 0);
  let distance = 0, gaitAmount = 0, lower = 0, chew = 0, phase = 'idle';
  const startX = action === 'walk' ? 690 : action === 'eat' ? 580 : 535;
  if (action === 'walk') {
    distance = 300 * smooth(t / 5.4);
    gaitAmount = smooth(t / 0.4) * (1 - smooth((t - 4.95) / 0.45));
    phase = t < 5.4 ? 'walking' : 'settled';
  }
  if (action === 'eat') {
    distance = 148 * smooth(t / 2.4);
    gaitAmount = smooth(t / 0.35) * (1 - smooth((t - 1.95) / 0.45));
    lower = smooth((t - 2.7) / 1.05) * (1 - smooth((t - 8.25) / 1.3));
    const nibbling = smooth((t - 3.85) / 0.3) * (1 - smooth((t - 7.8) / 0.3));
    // A short pause between small bites, not a constant head oscillator.
    chew = Math.sin(t * 13) * nibbling * (Math.sin(t * 2.2) > -0.3 ? 1 : 0.1);
    phase = t < 2.4 ? 'approaching' : t < 3.75 ? 'lowering' : t < 8.25 ? 'eating' : 'lifting';
  }
  const breath = Math.sin(t * TAU / 3.6), bob = Math.cos(distance / 90 * TAU * 2) * 1.5 * gaitAmount;
  const rootX = startX - distance;
  const legs = LEG_DEFS.map(def => {
    const farY = def.far ? -8 : 0;
    const gait = gaitFoot(distance, def.offset);
    const foot = { x: def.foot + gait.x * gaitAmount, y: farY + gait.y * gaitAmount };
    const shoulder = { x: def.x - (def.kind === 'front' ? lower * 6 : 0), y: -138 + bob + (def.kind === 'front' ? lower * 24 : 0) + farY * 0.2 };
    const ankle = { x: foot.x + 3, y: foot.y - 34 };
    const knee = solveIK(shoulder, ankle, def.kind === 'front' ? 58 : 66, def.kind === 'front' ? 60 : 68, def.bend);
    return { ...def, points: [shoulder, knee, ankle, foot], planted: gaitAmount < 0.01 || gait.planted, worldFoot: { x: rootX + foot.x, y: foot.y }, phase: gait.phase };
  });
  const tail = Array.from({ length: 7 }, (_, i) => {
    const s = i / 6, angle = -0.05 - s * 1.25 + Math.sin(t * 1.5 - s * 2.6) * 0.14 * s;
    return { x: 126 + Math.cos(angle) * 127 * s, y: -157 + bob + Math.sin(angle) * 127 * s };
  });
  const feedingRotation = -.55;
  const c = Math.cos(feedingRotation), s = Math.sin(feedingRotation);
  const mouthOffset = { x: MOUTH_LOCAL.x * c - MOUTH_LOCAL.y * s, y: MOUTH_LOCAL.x * s + MOUTH_LOCAL.y * c };
  const targetHead = { x: FOOD_SURFACE.x - rootX - mouthOffset.x, y: FOOD_SURFACE.y - 12 - FLOOR_Y - mouthOffset.y + chew * .45 };
  const rotation = mix(Math.sin(t * 1.3) * .008, feedingRotation, lower);
  const feedingNeckOffset = rotatePoint(NECK_LOCAL, feedingRotation);
  const neck = {
    x: mix(NECK_HOME.x, targetHead.x + feedingNeckOffset.x, lower),
    y: mix(NECK_HOME.y + bob, targetHead.y + feedingNeckOffset.y, lower)
  };
  const neckOffset = rotatePoint(NECK_LOCAL, rotation);
  const head = { x: neck.x - neckOffset.x, y: neck.y - neckOffset.y, rotation };
  return { action, time: t, duration: duration[action], phase, rootX, distance, gaitAmount, legs, tail, breath, bob, lower, chew, head, neck, bite,
    mouth: headLandmark(head, MOUTH_LOCAL, rootX),
    ended: t >= duration[action], bowl: action === 'eat' };
}

// Smooth joint interpolation for the textured limb strips. The bones remain
// independently solved; surrounding vertices blend through each joint.
export function chainPoint(points, fraction) {
  const f = clamp(fraction) * (points.length - 1), i = Math.min(points.length - 2, Math.floor(f)), t = f - i;
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
  const coordinate = key => .5 * ((2 * p1[key]) + (-p0[key] + p2[key]) * t + (2*p0[key] - 5*p1[key] + 4*p2[key] - p3[key]) * t*t + (-p0[key] + 3*p1[key] - 3*p2[key] + p3[key]) * t*t*t);
  return { x: coordinate('x'), y: coordinate('y') };
}
