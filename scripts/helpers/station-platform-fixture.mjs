import { platformFixture } from './station-content-fixture.mjs';
import { fixtureId } from './station-redesign-database.mjs';

// Opt-in disposable preview/test rows. These URLs name synthetic, nonexistent
// works; they are never release/verification evidence and no remote data writes.
export async function seedStationPlatformCases(db, content) {
  const tracks = content.additional.slice(0, 5);
  const providers = [
    ['netease', 'https://music.163.com/song?id=station-cat-local-synthetic'],
    ['qishui', 'https://music.douyin.com/qishui/share/track?track_id=station-cat-local-synthetic'],
    ['apple_music', 'https://music.apple.com/sg/album/station-cat-local-synthetic/0']
  ];
  for (let i = 0; i < providers.length; i++) {
    const [provider, url] = providers[i];
    await platformFixture(db, tracks[0], { id: fixtureId(5100 + i), provider, url, sort_order: 2 - i });
    await platformFixture(db, tracks[1], { id: fixtureId(5110 + i), provider, url, status: 'planned', verified_at: null });
    await platformFixture(db, tracks[2], { id: fixtureId(5120 + i), provider, url, status: 'removed' });
  }
  await platformFixture(db, tracks[3], { id: fixtureId(5130), territories_json: '["AQ"]' });
  await platformFixture(db, tracks[4], { id: fixtureId(5140), verified_at: Date.UTC(2030, 0, 1) });
  return Object.fromEntries(['live', 'planned', 'removed', 'regional', 'unverified'].map((state, i) => [state, tracks[i].slug]));
}
