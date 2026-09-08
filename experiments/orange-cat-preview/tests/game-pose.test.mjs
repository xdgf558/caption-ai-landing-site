import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomPose, feedingTime } from '../src/game-pose.js';
test('room feet cancel actual route travel instead of repeating a timed slide', () => {
  let checked = 0;
  for (let distance = 0; distance < 270; distance += .5) {
    const a = roomPose(distance, 2, true), b = roomPose(distance + .05, 2.01, true);
    a.legs.forEach((leg, index) => {
      if (leg.planted && b.legs[index].planted && Math.abs(leg.worldFoot.x - b.legs[index].worldFoot.x) < 20) {
        assert.ok(Math.abs(leg.worldFoot.x - b.legs[index].worldFoot.x) < 1e-8); checked++;
      }
    });
  }
  assert.ok(checked > 1000);
  assert.equal(roomPose(32, 1, false).action, 'idle');
});
test('feeding uses the successful receipt clock, clamps rollback and ends without replay', () => {
  const receipt = { action: 'feedBasic', startedAt: 10000 };
  assert.equal(feedingTime(receipt, 10000), 2.4);
  assert.equal(feedingTime(receipt, 12000), 4.4);
  assert.equal(feedingTime(receipt, 17600), null);
  assert.equal(feedingTime(receipt, 9000), null);
  assert.equal(feedingTime({ ...receipt, action: 'play' }, 11000), null);
  assert.equal(feedingTime(null, 11000), null);
});
