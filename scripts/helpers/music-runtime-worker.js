import { musicRuntime, checkMusicDatabase } from '../../src/music/runtime.js';
import { verifyStoredMusicAudio } from '../../src/music/storage.js';
import { validateMeasuredPreview } from '../../src/music/audioValidation.js';
import { executeMusicPublication } from '../../src/music/publication.js';
import { readMusicMembership } from '../../src/music/membership.js';
import { handleMusicAdmin, isMusicAdminPath } from '../../src/music/adminHttp.js';
import { handleMusicMedia } from '../../src/music/mediaResponse.js';
import { handleMusicPublic } from '../../src/music/publicHttp.js';
import { createMusicUpload } from '../../src/music/uploads.js';
import { checkMusicRateLimit } from '../../src/music/rateLimits.js';
import { seedMusicRuntimeFixture, fixtureEvidenceProof, seedLargeRuntimeAudio } from './music-runtime-fixture.js';

// Only bundled by the local test runner. Never deploy this fixture router or its synthetic approvals.
export default {
  async fetch(request, env) {
    try {
      if (new URL(request.url).pathname.startsWith('/fixture-cleanup/admin/api/music/')) {
        const url = new URL(request.url); url.pathname = url.pathname.replace('/fixture-cleanup', '');
        return handleMusicAdmin(new Request(url, request), { ...env, MUSIC_CLEANUP_ENABLED: 'true' }, async () => 'fixture@example.test');
      }
      if (new URL(request.url).pathname.startsWith('/fixture-media/api/music/tracks/')) {
        const url = new URL(request.url); url.pathname = url.pathname.replace('/fixture-media', '');
        return handleMusicMedia(new Request(url, request), {
          ...env, MUSIC_PUBLIC_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true'
        });
      }
      if (new URL(request.url).pathname.startsWith('/fixture-public/api/music/')) {
        const url = new URL(request.url); url.pathname = url.pathname.replace('/fixture-public', '');
        return handleMusicPublic(new Request(url, request), {
          ...env, MUSIC_PUBLIC_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true'
        });
      }
      if (new URL(request.url).pathname.startsWith('/fixture-uploads/admin/api/music/')) {
        const url = new URL(request.url); url.pathname = url.pathname.replace('/fixture-uploads', '');
        return handleMusicAdmin(new Request(url, request), { ...env, MUSIC_UPLOADS_ENABLED: 'true' }, async () => 'fixture@example.test');
      }
      if (isMusicAdminPath(new URL(request.url).pathname)) {
        // Local fixture identity only; the real Worker verifies Access JWT and its email allowlist.
        return handleMusicAdmin(request, env, async () => 'fixture@example.test');
      }
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const { db, bucket, flags } = musicRuntime(env), path = new URL(request.url).pathname;
      let result;
      if (path === '/database') result = { ...await checkMusicDatabase(db), flags };
      else if (path === '/rate-check') {
        const input = await request.json();
        const limits = Object.fromEntries(['catalog','artwork','audio'].map(k => [k,{ source: input.source,global: input.global }]));
        const limited = await checkMusicRateLimit(request,{ ...env,MUSIC_RATE_LIMITS_JSON: JSON.stringify(limits) },
          input.category,{ clock: () => input.now });
        result = { allowed: limited === null,...limited };
      }
      else if (path === '/cleanup-seed') result = await createMusicUpload(db, await request.json(), {
        actorId: 'fixture@example.test', key: crypto.randomUUID(), clock: () => Date.now() - 8 * 86400000 - 1000
      });
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
