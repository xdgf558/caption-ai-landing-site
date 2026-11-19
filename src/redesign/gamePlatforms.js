export const GAME_PLATFORMS = {
  macos: { icon: 'laptop', tone: 'mac' },
  ios: { icon: 'mobile', tone: 'ios' },
  wechat: { icon: 'wechat', tone: 'wechat' },
  steam: { icon: 'gamepad', tone: 'steam' },
  web: { icon: 'web', tone: 'web' },
  android: { icon: 'mobile', tone: 'android' },
};

export const ECOSYSTEM_PLATFORMS = ['macos', 'ios', 'wechat', 'steam'];

// Extensible per-game release channels. Future cat games (WeChat Mini Games, Steam,
// App Store, etc.) can register their platform entries here or supply `game.channels`.
export const GAME_RELEASES = {
  'cat-life-game': {
    webRetired: true,
    channels: [
      {
        id: 'macos-testflight',
        platform: 'macos',
        channel: 'TestFlight',
        status: 'new',
        primary: true,
        href: 'https://testflight.apple.com/join/vxUY5pqR',
        copyKey: 'catLifeMac',
      },
      {
        id: 'ios-testflight',
        platform: 'ios',
        channel: 'TestFlight',
        status: 'beta',
        primary: false,
        href: 'https://testflight.apple.com/join/UV4nkZnA',
        copyKey: 'catLifeIos',
      },
    ],
  },
};

export function resolveGameDistribution(game) {
  const release = game?.slug ? GAME_RELEASES[game.slug] : null;
  const channels = Array.isArray(game?.channels) && game.channels.length
    ? game.channels
    : (release?.channels || []);
  const webRetired = Boolean(release?.webRetired);
  const supportsBrowserLaunch = !webRetired && game?.launchPath === '/games/cat-life/';
  return { channels, webRetired, supportsBrowserLaunch };
}
