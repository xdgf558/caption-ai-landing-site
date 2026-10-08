export const GAME_PROTOCOL = 'station-cat-game/v1';
export const GAME_ID = 'cat-life';
export const GAME_PATH = '/games/cat-life/';
export const GAME_START_TIMEOUT_MS = 20000;
export const GAME_STOP_TIMEOUT_MS = 1000;
export const gameLaunchId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function embeddedGameRequest(url) {
  return url.pathname === GAME_PATH && url.searchParams.getAll('sc_launch_id').length === 1 &&
    gameLaunchId(url.searchParams.get('sc_launch_id')) &&
    url.searchParams.getAll('sc_entry').length === 1 && url.searchParams.get('sc_entry') === '1';
}
