import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { sampleMotion, duration, FOOD_SURFACE, BOWL, FLOOR_Y, HEAD_ART, MOUTH_LOCAL, MOUTH_OPEN_SCALE, NECK_LOCAL, NECK_HOME, headLandmark, headSkinPoint } from '../src/motion.js';
import { LEG_WIDTH, legSkinPoint } from '../src/skin.js';

const meta = JSON.parse(await readFile(new URL('../public/assets/rig-meta.json', import.meta.url)));

test('round toe caps keep their original artwork aspect ratio in every clip', () => {
  for (const action of Object.keys(duration)) for (let t = 0; t <= duration[action]; t += .08) {
    for (const leg of sampleMotion(action, t).legs) {
      const art = meta[leg.kind === 'back' ? 'back-leg' : 'front-leg'];
      const a = legSkinPoint(.3, .84, leg, art), b = legSkinPoint(.7, .84, leg, art), c = legSkinPoint(.3, .98, leg, art);
      assert(Math.abs(a.y - b.y) < 1e-9, 'toe rows must not slope into the ground');
      assert(Math.abs(a.x - c.x) < 1e-9, 'toe columns must not shear into a pointed hoof');
      const scaleX = (b.x - a.x) / (.4 * art.width), scaleY = (c.y - a.y) / (.14 * art.height);
      assert(Math.abs(scaleX - scaleY) < 1e-9, 'do not vertically squash the painted toes');
      assert(Math.abs(scaleX - LEG_WIDTH[leg.kind] / art.width) < 1e-9);
    }
  }
});

test('all bottom paw vertices stay on their foot target, never below the floor', () => {
  for (const action of Object.keys(duration)) for (let t = 0; t <= duration[action]; t += .05) {
    for (const leg of sampleMotion(action, t).legs) {
      const art = meta[leg.kind === 'back' ? 'back-leg' : 'front-leg'];
      for (let u = 0; u <= 1; u += .1) {
        const point = legSkinPoint(u, 1, leg, art);
        assert.equal(point.y, leg.points.at(-1).y);
        assert(point.y <= 0);
      }
    }
  }
});

test('mouth follows the food surface with clearance throughout lowering and lifting', () => {
  for (let t = 0; t <= duration.eat; t += .007) {
    const pose = sampleMotion('eat', t);
    assert(pose.mouth.y <= FOOD_SURFACE.y - 11, `mouth crossed bowl at ${t}`);
    if (pose.lower > .99999) {
      assert(Math.abs(pose.mouth.x - FOOD_SURFACE.x) < .01);
      assert(pose.mouth.y >= FOOD_SURFACE.y - 13);
      assert(pose.legs.every(leg => leg.planted));
    }
  }
});

test('opaque face pixels do not descend into the lower ceramic bowl body', async () => {
  const { data, info } = await sharp(await readFile(new URL('../public/assets/head.webp', import.meta.url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let t = 2.4; t <= duration.eat; t += .075) {
    const pose = sampleMotion('eat', t);
    for (let y = 0; y < info.height; y += 5) for (let x = 0; x < info.width; x += 5) {
      if (data[(y * info.width + x) * 4 + 3] < 200) continue;
      const point = headLandmark(pose.head, headSkinPoint(x / info.width, y / info.height, pose.time), pose.rootX);
      if (point.x > BOWL.x - 34 && point.x < BOWL.x + 34) assert(point.y < FLOOR_Y - 18, `face entered bowl body at ${t}`);
    }
  }
});

test('head attachment stays exactly on its animated neck joint in every clip', () => {
  for (const action of Object.keys(duration)) for (let t = 0; t <= duration[action]; t += .017) {
    const pose = sampleMotion(action, t), actual = headLandmark(pose.head, NECK_LOCAL, pose.rootX);
    assert(Math.abs(actual.x - pose.rootX - pose.neck.x) < 1e-9);
    assert(Math.abs(actual.y - FLOOR_Y - pose.neck.y) < 1e-9);
    if (pose.lower === 0) {
      assert.equal(pose.neck.x, NECK_HOME.x);
      assert.equal(pose.neck.y, NECK_HOME.y + pose.bob);
    }
  }
});

test('neck joint sits within opaque shoulder artwork, including feeding and return', async () => {
  const { data, info } = await sharp(await readFile(new URL('../public/assets/torso.webp', import.meta.url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const action of Object.keys(duration)) for (let t = 0; t <= duration[action]; t += .031) {
    const pose = sampleMotion(action, t), u = (pose.neck.x + 141) / 290;
    const chest = (1 - u) ** 2 * pose.lower * 23;
    const v = (pose.neck.y + 204 - chest - pose.bob) / 139;
    assert(u > 0 && u < 1 && v > 0 && v < 1);
    const x = Math.round(u * (info.width - 1)), y = Math.round(v * (info.height - 1));
    assert(data[(y * info.width + x) * 4 + 3] > 240, `neck outside torso at ${action} ${t}`);
  }
});

test('neck taper does not move the upper lip or anatomical attachment', () => {
  for (const point of [MOUTH_LOCAL, NECK_LOCAL]) {
    const p = headSkinPoint((point.x - HEAD_ART.left) / HEAD_ART.width, (point.y - HEAD_ART.top) / HEAD_ART.height);
    assert(Math.abs(p.x - point.x) < 1e-9);assert(Math.abs(p.y - point.y) < 1e-9);
  }
  const bottom = headSkinPoint(.7, .98);
  assert(bottom.x > HEAD_ART.left + .7 * HEAD_ART.width + 20);
  assert(bottom.y < HEAD_ART.top + .98 * HEAD_ART.height - 6);
});

test('open mouth artwork also stays out of the lower bowl body', async () => {
  const art = JSON.parse(await readFile(new URL('../public/assets/feeding-meta.json', import.meta.url))).mouth;
  const { data, info } = await sharp(await readFile(new URL('../public/assets/mouth-open.webp', import.meta.url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let t = 3.9; t < 8; t += .019) {
    const pose = sampleMotion('eat', t), jaw = pose.bite.jaw;
    if (jaw <= .015) continue;
    for (let y = 0; y < info.height; y += 3) for (let x = 0; x < info.width; x += 3) {
      if (data[(y * info.width + x) * 4 + 3] < 200) continue;
      const point = headLandmark(pose.head, {
        x: MOUTH_LOCAL.x + (x - art.upperLip.x + art.crop.left) * MOUTH_OPEN_SCALE.x,
        y: MOUTH_LOCAL.y + (y - art.upperLip.y + art.crop.top) * MOUTH_OPEN_SCALE.y * jaw
      }, pose.rootX);
      if (point.x > BOWL.x - 34 && point.x < BOWL.x + 34) assert(point.y < FLOOR_Y - 18);
    }
  }
});

test('feeding assets carry actual transparent alpha and match the crop metadata', async () => {
  for (const name of ['mouth-open', 'kibble']) {
    const buffer = await readFile(new URL(`../public/assets/${name}.webp`, import.meta.url));
    const metadata = await sharp(buffer).metadata();
    assert(metadata.hasAlpha);
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let clear = 0, solid = 0;
    for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) clear++; if (data[i] > 200) solid++; }
    assert(clear > info.width * info.height * .1);
    assert(solid > info.width * info.height * .1);
    if (name === 'mouth-open') {
      const art = JSON.parse(await readFile(new URL('../public/assets/feeding-meta.json', import.meta.url))).mouth;
      assert.equal(info.width, art.crop.width);assert.equal(info.height, art.crop.height);
    }
  }
});
