import { routeParts } from '../../src/redesign/routeMigrationPaths.js';

export function checkFirstLaunchScope(scope) {
  if (scope?.schemaVersion !== 1 || scope.profile !== 'brand-games' ||
    JSON.stringify(scope.navigation) !== JSON.stringify(['home', 'music', 'games', 'member', 'about']) ||
    scope.game?.slug !== 'cat-life-game' || scope.game?.runtimePath !== '/games/cat-life/' ||
    scope.music?.featuredTrackId !== null || !Array.isArray(scope.music?.selectedTrackIds) || scope.music.selectedTrackIds.length ||
    scope.music.previewEnabled !== false || scope.music.videoEnabled !== false ||
    scope.legacy?.publicContentClosed !== true || scope.legacy?.deleteStoredData !== false) {
    throw new Error('STATION_FIRST_LAUNCH_SCOPE');
  }
  return scope;
}

// These are package contents, not a public route grant. Site-shell templates
// remain private in the real Worker. Old pages cannot become an Assets fallback.
export function firstLaunchHtmlAllowed(path) {
  if (/^\/(?:admin|admin-v2)(?:\/|$)/.test(path) || /^\/games\/cat-life(?:\/|$)/.test(path)) return true;
  if (/^\/(?:music|games|member)\/site-shell(?:\/|$)/.test(path)) return true;
  const { segments: s } = routeParts(path);
  if (s.length === 1 && ['privacy', 'terms', 'support', 'points', '404'].includes(s[0])) return true;
  return false;
}
