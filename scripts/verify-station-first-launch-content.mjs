export function assessFirstLaunchContent(rows) {
  const expected = { published_tracks: 0, published_promotions: 0, published_clips: 0,
    published_games: 1, game_contract: 1, published_homes: 1, home_contract: 1 };
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
    Object.keys(rows[0]).length !== Object.keys(expected).length ||
    Object.entries(rows[0]).some(([name, value]) => !Object.hasOwn(expected, name) || !Number.isSafeInteger(value))) throw new Error('STATION_FIRST_LAUNCH_CONTENT_RESULT');
  const failed = Object.entries(expected).filter(([name, value]) => rows[0][name] !== value).map(([name]) => name);
  // Matching draft/publication counts is a prerequisite, never an asset rights,
  // R2 readiness, identity, performance or production deployment certificate.
  return { contentScopeMatches: failed.length === 0, failed, rightsAndHttpVerified: false };
}
