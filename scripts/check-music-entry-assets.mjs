import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVipMembershipCopy } from '../src/data/vip-membership.js';

// Inspect rendered HTML, not just source branches: this also detects a stale
// activated dist accidentally paired with a closed production candidate.
export async function checkMusicEntryAssets(root, enabled = false) {
  if (root instanceof URL) root = fileURLToPath(root);
  for (const [locale, home, prefix] of [
    ['zh-Hant', '', 'zh-hant'], ['zh-Hans', 'zh-hans', 'zh-hans'],
    ['en', 'en', 'en'], ['ja', 'ja', 'ja']
  ]) {
    const homeHtml = await readFile(path.join(root, home, 'index.html'), 'utf8');
    assert.equal(/<section\b[^>]*id="music"/.test(homeHtml), enabled, `${locale}: homepage music section`);
    for (const [kind, html] of [
      ['home', homeHtml],
      ['library', await readFile(path.join(root, prefix, 'library/index.html'), 'utf8')],
      ['points', await readFile(path.join(root, prefix, 'points/index.html'), 'utf8')]
    ]) {
      assert.equal(/<a\b[^>]*href="\/(?:en\/|ja\/|zh-hans\/)?music\/?(?:[?#][^"]*)?"/.test(html), enabled,
        `${locale}/${kind}: music navigation must match activation`);
      if (kind !== 'home') {
        const copy = getVipMembershipCopy(locale, enabled);
        const opposite = getVipMembershipCopy(locale, !enabled);
        assert.ok(html.includes(copy.musicDescription), `${locale}/${kind}: current music description`);
        assert.ok(!html.includes(opposite.musicDescription), `${locale}/${kind}: incorrect music availability`);
        if (kind === 'library') assert.ok(html.includes(copy.notice), `${locale}: membership notice`);
        else assert.ok(html.includes(copy.useIntro), `${locale}: points usage`);
      }
    }
  }
}
