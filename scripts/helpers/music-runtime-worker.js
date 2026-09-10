import { musicRuntime, checkMusicDatabase } from '../../src/music/runtime.js';
import { verifyStoredMusicAudio } from '../../src/music/storage.js';
import { validateMeasuredPreview } from '../../src/music/audioValidation.js';
import { executeMusicPublication } from '../../src/music/publication.js';
import { readMusicMembership } from '../../src/music/membership.js';
import { seedMusicRuntimeFixture, fixtureEvidenceProof, seedLargeRuntimeAudio } from './music-runtime-fixture.js';

// Only bundled by the local test runner. Never deploy this fixture router or its synthetic approvals.
export default {
  async fetch(request, env) {
    try {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const { db, bucket, flags } = musicRuntime(env), path = new URL(request.url).pathname;
      let result;
      if (path === '/database') result = { ...await checkMusicDatabase(db), flags };
      else if (path === '/seed') result = await seedMusicRuntimeFixture(db, await request.json());
      else if (path === '/stress-seed') result = await seedLargeRuntimeAudio(bucket, await request.json());
      else if (path === '/verify') result = await verifyStoredMusicAudio(bucket, await request.json());
      else if (path === '/membership') result = await readMusicMembership(request, env);
      else if (path === '/publish') result = await executeMusicPublication(db, await request.json(), {
        actorId: 'fixture@example.test',
        verifyResources: async assets => {
          const proofs = [];
          // Sequential verification bounds simultaneous native body/carry allocations per request.
          for (const a of assets) proofs.push(['audio', 'preview'].includes(a.kind)
            ? await verifyStoredMusicAudio(bucket, a) : fixtureEvidenceProof(a));
          const full = assets.find(a => a.kind === 'audio'), preview = assets.find(a => a.kind === 'preview');
          validateMeasuredPreview(full, preview, proofs.find(p => p.id === full.id), proofs.find(p => p.id === preview.id));
          return { assets: proofs, checkedAt: Date.now() };
        }
      });
      else return new Response(null, { status: 404 });
      return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      return Response.json({ code: error.code || 'FIXTURE_FAILURE' }, { status: error.status || 503,
        headers: { 'Cache-Control': 'private, no-store' } });
    }
  }
};
