export const GAME_PLATFORMS = {
  macos: { icon: 'laptop', tone: 'mac' },
  ios: { icon: 'mobile', tone: 'ios' },
  wechat: { icon: 'wechat', tone: 'wechat' },
  steam: { icon: 'gamepad', tone: 'steam' },
  web: { icon: 'web', tone: 'web' },
  android: { icon: 'mobile', tone: 'android' },
};

export const ECOSYSTEM_PLATFORMS = ['macos', 'ios', 'wechat', 'steam'];

// Flip to true once the Mac TestFlight public link in App Store Connect is
// actively accepting new testers.
export const MAC_TESTFLIGHT_OPEN = false;
export const MAC_TESTFLIGHT_URL = 'https://testflight.apple.com/join/vxUY5pqR';
export const IOS_TESTFLIGHT_URL = 'https://testflight.apple.com/join/UV4nkZnA';

const macChannel = MAC_TESTFLIGHT_OPEN
  ? {
      id: 'macos-testflight',
      platform: 'macos',
      channel: 'TestFlight',
      status: 'new',
      primary: true,
      href: MAC_TESTFLIGHT_URL,
      copyKey: 'catLifeMac',
    }
  : {
      id: 'macos-testflight',
      platform: 'macos',
      channel: 'TestFlight',
      status: 'closed',
      primary: false,
      href: null,
      copyKey: 'catLifeMacPending',
    };

const iosChannel = {
  id: 'ios-testflight',
  platform: 'ios',
  channel: 'TestFlight',
  status: 'beta',
  primary: !MAC_TESTFLIGHT_OPEN,
  href: IOS_TESTFLIGHT_URL,
  copyKey: 'catLifeIos',
};

// Extensible per-game release channels for the frontend layout.
// Note: Content Admin publishing validation still expects browser runtime fields
// today; backend support for publishing native-only games is a separate follow-up.
export const GAME_RELEASES = {
  'cat-life-game': {
    webRetired: true,
    screenshots: [
      { url: '/images/games/cat-life-mac/home-front.jpg', width: 1000, height: 573 },
      { url: '/images/games/cat-life-mac/home-side.jpg', width: 1000, height: 578 },
      { url: '/images/games/cat-life-mac/title.jpg', width: 1000, height: 582 },
    ],
    channels: MAC_TESTFLIGHT_OPEN ? [macChannel, iosChannel] : [iosChannel, macChannel],
  },
};

export function resolveGameDistribution(game) {
  const release = game?.slug ? GAME_RELEASES[game.slug] : null;
  const channels = Array.isArray(game?.channels) && game.channels.length
    ? game.channels
    : (release?.channels || []);
  const screenshots = release?.screenshots?.length ? release.screenshots : (game?.screenshots || []);
  const webRetired = Boolean(release?.webRetired);
  const supportsBrowserLaunch = !webRetired && game?.launchPath === '/games/cat-life/';
  return { channels, screenshots, webRetired, supportsBrowserLaunch };
}
