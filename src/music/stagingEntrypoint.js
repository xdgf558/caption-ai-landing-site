import { musicAdminActor } from '../adminAccess.js';
import { handleMusicAdmin, isMusicAdminPath, musicAdminDenied } from './adminHttp.js';
import {
  isMusicStagingRequest,
  musicStagingHost,
  musicStagingNotFound,
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

    if (url.pathname === '/admin/music') {
      url.pathname = '/admin/music/';
      return Response.redirect(url.toString(), 308);
    }

    if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
      return musicStagingUnavailable('Music staging assets are not configured.');
    }

    return env.ASSETS.fetch(request);
  }
};
