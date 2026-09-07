import { test, expect } from '@playwright/test';

async function open(page, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    window.musicProbe = { starts: [], stops: 0, errors: [] };
    window.addEventListener('unhandledrejection', e => window.musicProbe.errors.push(String(e.reason)));
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function (...args) {
      const source = original.apply(this, args), context = this;
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...values) => {
        if (source.buffer?.duration > 70) {
          window.musicProbe.context = context; window.musicProbe.buffer = source.buffer;
          window.musicProbe.starts.push({ at: values[0], offset: values[1], duration: source.buffer.duration, loop: source.loop, loopEnd: source.loopEnd });
        }
        return start(...values);
      };
      source.stop = (...values) => { if (source.buffer?.duration > 70) window.musicProbe.stops++; return stop(...values); };
      return source;
    };
  });
  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('[data-top-sound-toggle]')).toBeVisible();
}
async function startViaToggle(page) {
  await page.locator('[data-top-sound-toggle]').click(); // first gesture switches the saved default off
  await expect.poll(() => page.evaluate(() => window.musicProbe.starts.length)).toBe(0);
  await page.locator('[data-top-sound-toggle]').click();
  await expect.poll(() => page.evaluate(() => window.musicProbe.starts.length)).toBe(1);
}

for (const width of [390, 1280]) {
  test(`${width}px: approved AAC decodes after gesture, loops and survives all page changes without restarting`, async ({ page }) => {
    let requests = 0; page.on('request', request => { if (request.url().endsWith('moonlight-tiptoes-soft.m4a')) requests++; });
    await open(page, width);
    expect(requests).toBe(0);
    await startViaToggle(page);
    const info = await page.evaluate(() => ({ ...window.musicProbe.starts[0], state: window.musicProbe.context.state, channels: window.musicProbe.buffer.numberOfChannels }));
    expect(info.duration).toBeCloseTo(75, 1); expect(info.loopEnd).toBe(75); expect(info.channels).toBe(2); expect(info.loop).toBe(true); expect(info.state).toBe('running');
    for (const currentPage of ['work', 'cats', 'arcade', 'settings', 'home']) {
      await page.evaluate(value => { window.CatGame.state.currentPage = value; window.CatGameApp.render(true); }, currentPage);
    }
    expect(await page.evaluate(() => window.musicProbe.starts.length)).toBe(1);
    expect(requests).toBe(1);
    expect(await page.evaluate(() => window.musicProbe.errors)).toEqual([]);
  });

  test(`${width}px: mute, volume and hidden/BFCache restoration pause and resume the same decoded track`, async ({ page }) => {
    await open(page, width); await startViaToggle(page);
    await expect.poll(() => page.evaluate(() => window.musicProbe.context.currentTime)).toBeGreaterThan(0.3);
    await page.locator('[data-top-sound-toggle]').click();
    expect(await page.evaluate(() => window.musicProbe.stops)).toBe(1);
    await page.locator('[data-top-sound-toggle]').click();
    await expect.poll(() => page.evaluate(() => window.musicProbe.starts.length)).toBe(2);
    expect(await page.evaluate(() => window.musicProbe.starts[1].offset)).toBeGreaterThan(0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await page.evaluate(() => window.musicProbe.stops)).toBe(2);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => page.evaluate(() => window.musicProbe.starts.length)).toBe(3);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    expect(await page.evaluate(() => window.musicProbe.stops)).toBe(3);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect.poll(() => page.evaluate(() => window.musicProbe.starts.length)).toBe(4);
    await page.evaluate(() => { window.CatGame.state.game.settings.bgmVolume = 0; window.CatGameApp.render(true); });
    expect(await page.evaluate(() => window.musicProbe.stops)).toBe(4);
    await page.evaluate(() => { window.CatGame.state.game.settings.bgmVolume = 60; window.CatGameApp.render(true); });
    await expect.poll(() => page.evaluate(() => window.musicProbe.starts.length)).toBe(5);
    expect(await page.evaluate(() => window.musicProbe.errors)).toEqual([]);
  });
}

test('native decoded loop crosses the 75-second boundary without a silent padding gap', async ({ page }) => {
  await open(page); await startViaToggle(page);
  const result = await page.evaluate(async () => {
    const buffer = window.musicProbe.buffer, sampleRate = buffer.sampleRate, loopEnd = window.musicProbe.starts[0].loopEnd;
    const offline = new OfflineAudioContext(2, Math.ceil((loopEnd + 0.1) * sampleRate), sampleRate);
    const source = offline.createBufferSource(); source.buffer = buffer; source.loop = true; source.loopEnd = loopEnd; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    const rms = (at) => {
      const samples = rendered.getChannelData(0).slice(Math.floor(at * sampleRate), Math.floor((at + 0.01) * sampleRate));
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    };
    return [rms(loopEnd - 0.02), rms(loopEnd), rms(loopEnd + 0.02)];
  });
  for (const rms of result) expect(rms).toBeGreaterThan(0.001);
});

test('delayed asset cannot play after mute; failed requests stay quiet until a fresh gesture', async ({ page }) => {
  let finish, calls = 0;
  await page.route('**/moonlight-tiptoes-soft.m4a', async route => {
    calls++;
    if (calls === 1) { await new Promise(resolve => { finish = resolve; }); await route.fulfill({ status: 503, body: '' }); }
    else await route.continue();
  });
  await open(page);
  await page.locator('[data-top-sound-toggle]').click();
  await page.locator('[data-top-sound-toggle]').click();
  await expect.poll(() => calls).toBe(1);
  await page.locator('[data-top-sound-toggle]').click(); finish();
  await expect.poll(() => page.evaluate(() => window.CatGame.systems.musicSystem.getCurrentTrackLabel())).toContain('unavailable');
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.CatGameApp.render(true));
  expect(calls).toBe(1); expect(await page.evaluate(() => window.musicProbe.starts.length)).toBe(0);
  await page.locator('[data-top-sound-toggle]').click();
  await expect.poll(() => page.evaluate(() => window.musicProbe.starts.length)).toBe(1);
  expect(calls).toBe(2); expect(await page.evaluate(() => window.musicProbe.errors)).toEqual([]);
});

test('existing custom music stays selected, pauses/resumes, and clearing restores the new default', async ({ page }) => {
  await open(page);
  // A local valid PCM WAV fixture, never an account or cloud-save write.
  await page.evaluate(() => {
    const bytes = new Uint8Array(44 + 16000), view = new DataView(bytes.buffer);
    for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) [...text].forEach((ch, i) => bytes[offset + i] = ch.charCodeAt(0));
    view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 16000, true);
    Object.assign(window.CatGame.state.game.settings, { customMusicEnabled: true, customMusicName: 'My local song', customMusicData: 'data:audio/wav;base64,' + btoa(String.fromCharCode(...bytes)) });
    window.customProbe = [];
    const Original = window.Audio;
    window.Audio = function (...args) { const audio = new Original(...args); window.customProbe.push(audio); return audio; };
  });
  await page.locator('[data-top-sound-toggle]').click(); await page.locator('[data-top-sound-toggle]').click();
  await expect.poll(() => page.evaluate(() => window.customProbe[0]?.paused)).toBe(false);
  expect(await page.evaluate(() => window.musicProbe.starts.length)).toBe(0);
  expect(await page.evaluate(() => window.CatGame.systems.musicSystem.getCurrentTrackLabel())).toBe('My local song');
  await page.evaluate(() => { window.CatGame.state.currentPage = 'work'; window.CatGameApp.render(true); });
  expect(await page.evaluate(() => window.customProbe.length)).toBe(1);
  await page.locator('[data-top-sound-toggle]').click();
  expect(await page.evaluate(() => window.customProbe[0].paused)).toBe(true);
  await page.locator('[data-top-sound-toggle]').click();
  await expect.poll(() => page.evaluate(() => window.customProbe[0].paused)).toBe(false);
  await page.evaluate(() => { window.CatGame.systems.musicSystem.clearCustomMusic(); window.CatGameApp.render(true); });
  await expect.poll(() => page.evaluate(() => window.musicProbe.starts.length)).toBe(1);
  expect(await page.evaluate(() => window.customProbe[0].paused)).toBe(true);
  expect(await page.evaluate(() => window.musicProbe.errors)).toEqual([]);
});
