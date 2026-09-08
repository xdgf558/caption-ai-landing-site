import { sampleMotion, gaitFoot, solveIK } from './motion.js';

// CSS owns the room route. Only the articulated feet follow travelled distance;
// the renderer must not translate the character a second time.
export function roomPose(distance, time, moving) {
  const pose = sampleMotion('idle', time % 6);
  if (!moving) return pose;
  pose.action = 'walk';
  pose.legs = pose.legs.map(leg => {
    const gait = gaitFoot(distance, leg.offset);
    const farY = leg.far ? -8 : 0;
    const foot = { x: leg.foot + gait.x, y: farY + gait.y };
    const shoulder = { x: leg.x, y: -138 + farY * .2 };
    const ankle = { x: foot.x + 3, y: foot.y - 34 };
    const knee = solveIK(shoulder, ankle, leg.kind === 'front' ? 58 : 66, leg.kind === 'front' ? 60 : 68, leg.bend);
    return { ...leg, points: [shoulder, knee, ankle, foot], planted: gait.planted, worldFoot: { x: -distance + foot.x, y: foot.y } };
  });
  return pose;
}

export function feedingTime(receipt, now) {
  if (!receipt || !['feedBasic', 'feedPremium'].includes(receipt.action)) return null;
  const elapsed = (now - receipt.startedAt) / 1000;
  // A game care action begins at the bowl, not at the preview's distant start.
  // Re-rendering uses the same receipt clock, never another inventory action.
  return elapsed >= 0 && elapsed < 7.6 ? elapsed + 2.4 : null;
}
