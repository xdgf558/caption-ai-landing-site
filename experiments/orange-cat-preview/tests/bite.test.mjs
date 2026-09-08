import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleBite, BITE_START, BITE_LENGTH, BITE_COUNT } from '../src/bite.js';

test('food only enters an already open mouth, and vanishes before it closes', () => {
  for (let t = 0; t <= 10; t += .003) {
    const bite = sampleBite(t);
    assert(bite.jaw >= 0 && bite.jaw <= 1);
    assert(bite.foodProgress >= 0 && bite.foodProgress <= 1);
    if (bite.foodVisible) assert(bite.jaw > .8, `food through closed lips at ${t}`);
    if (bite.phase === 'chewing' || bite.phase === 'swallowing') assert.equal(bite.foodVisible, false);
  }
});

test('each bite opens, takes food, closes, chews, then swallows', () => {
  for (let i = 0; i < BITE_COUNT; i++) {
    const start = BITE_START + i * BITE_LENGTH;
    for (const [dt, phase] of [[.12,'opening'],[.4,'taking'],[.7,'closing'],[.96,'chewing'],[1.2,'swallowing']]) assert.equal(sampleBite(start + dt).phase, phase);
    assert.equal(sampleBite(start + .7).consumed, i + 1);
  }
});

test('no mouth activity or food flight outside the feeding window', () => {
  for (const time of [-10, 0, 3.9, 7.9, 10, Infinity, NaN]) {
    const bite = sampleBite(time);
    assert.equal(bite.jaw, 0);
    assert.equal(bite.foodVisible, false);
  }
});

test('timeline seeking reconstructs visual consumption without accumulating state', () => {
  assert.equal(sampleBite(8).consumed, 3);
  assert.equal(sampleBite(0).consumed, 0);
  assert.deepEqual(sampleBite(4.4), sampleBite(4.4));
  assert.equal(sampleBite(BITE_START + .4).index, 0);
});
