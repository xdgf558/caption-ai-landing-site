import { musicAdminActor } from '../adminAccess.js';
import { handleMusicAdmin, isMusicAdminPath, musicAdminDenied } from './adminHttp.js';
import { handleMusicPublic, isMusicPublicPath } from './publicHttp.js';
import { handleMusicMedia, isMusicMediaPath } from './mediaResponse.js';
import {
  isMusicStagingRequest,
  musicStagingHost,
  musicStagingNotFound,
  musicStagingReaderRequest,
  musicStagingResponse,
  musicStagingUnavailable
} from './stagingGate.js';

export default {
  async fetch(request, env, ctx) {
    const expectedHost = musicStagingHost(env);
    if (!expectedHost) return musicStagingUnavailable('Music staging host is not configured.');

    const url = new URL(request.url);
    if (url.hostname.toLowerCase() !== expectedHost || !isMusicStagingRequest(request)) {
      return musicStagingNotFound();
    }

    if (isMusicAdminPath(url.pathname)) {
      return handleMusicAdmin(request, env, musicAdminActor);
    }

    try {
      await musicAdminActor(request, env);
    } catch (error) {
      return musicAdminDenied(request, Number.isInteger(error?.status) ? error.status : 503);
    }

    if (isMusicPublicPath(url.pathname) || isMusicMediaPath(url.pathname)) {
      const identityDb = env.MUSIC_STAGING_MEMBERSHIP_DB;
      if (!identityDb || typeof identityDb.withSession !== 'function' || identityDb === env.MUSIC_DB) {
        return musicStagingUnavailable('Music staging identities are not configured.');
      }
      const musicEnv = { ...env, WAITLIST_DB: identityDb };
      const readerRequest = musicStagingReaderRequest(request);
      const handler = isMusicMediaPath(url.pathname) ? handleMusicMedia : handleMusicPublic;
      return musicStagingResponse(await handler(readerRequest, musicEnv));
    }

    if (url.pathname === '/admin/music') {
      url.pathname = '/admin/music/';
      return musicStagingResponse(Response.redirect(url.toString(), 308));
    }

    if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
      return musicStagingUnavailable('Music staging assets are not configured.');
    }

    return musicStagingResponse(await env.ASSETS.fetch(request));
  }
};
