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
const ART = '/images/games/cat-life-art/';

// Shared hub artwork for the games catalog (CG illustration, not a device capture).
export const GAMES_HUB_ART = {
  panorama: { url: ART + 'street.webp', width: 2400, height: 480 },
};

export const GAME_RELEASES = {
  'cat-life-game': {
    webRetired: true,
    // Key art and feature sprites are promotional CG illustrations from the
    // native game's art set; they intentionally replace device screenshots.
    art: {
      key: { url: ART + 'key-art.webp', small: ART + 'key-art-720.webp', width: 1200, height: 1200 },
      panorama: GAMES_HUB_ART.panorama,
    },
    features: [
      { key: 'care', image: ART + 'feature-care.webp', width: 480, height: 378 },
      { key: 'home', image: ART + 'feature-home.webp', width: 400, height: 416 },
      { key: 'work', image: ART + 'feature-work.webp', width: 400, height: 492 },
      { key: 'town', image: ART + 'feature-town.webp', width: 400, height: 470 },
    ],
    channels: MAC_TESTFLIGHT_OPEN ? [macChannel, iosChannel] : [iosChannel, macChannel],
  },
};

export function resolveGameDistribution(game) {
  const release = game?.slug ? GAME_RELEASES[game.slug] : null;
  const channels = Array.isArray(game?.channels) && game.channels.length
    ? game.channels
    : (release?.channels || []);
  const screenshots = game?.screenshots || [];
  // Prefer curated key art; fall back to the first published screenshot for other games.
  const keyArt = release?.art?.key
    || (screenshots[0] ? { url: screenshots[0].url, width: screenshots[0].width || 1280, height: screenshots[0].height || 900 } : null);
  const webRetired = Boolean(release?.webRetired);
  const supportsBrowserLaunch = !webRetired && game?.launchPath === '/games/cat-life/';
  return {
    channels,
    screenshots,
    keyArt,
    panorama: release?.art?.panorama || null,
    features: release?.features || [],
    webRetired,
    supportsBrowserLaunch,
  };
}
