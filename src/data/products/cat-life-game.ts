export const catLifeGameProduct = {
  name: 'Cat Life Game',
  zhHantName: '打工養貓日記',
  zhHansName: '打工养猫日记',
  jaName: '働いて猫を育てる日記',
  latestVersion: '1.22.0',
  productPath: '/en/apps/cat-life-game/',
  zhHantProductPath: '/zh-hant/apps/cat-life-game/',
  zhHansProductPath: '/zh-hans/apps/cat-life-game/',
  jaProductPath: '/ja/apps/cat-life-game/',
  gamePath: '/games/cat-life/',
  upstreamSourceCommit: '0cc839f',
  assets: {
    icon: '/games/cat-life/src/assets/cats/orange-tabby.png',
    community: '/games/cat-life/src/assets/community/npc-cat-sprites.png',
    shopFood: '/games/cat-life/src/assets/shop/shop-food.jpg',
    shopBed: '/games/cat-life/src/assets/shop/shop-bed.jpg',
    moonlitTabby: '/games/cat-life/src/assets/premium/moonlit-tabby.png',
    stationRoom: '/games/cat-life/src/assets/premium/station-room-set.jpg',
    stationBench: '/games/cat-life/src/assets/premium/station-bench.png',
    stationSignalLamp: '/games/cat-life/src/assets/premium/station-signal-lamp.png',
    stationClockBoard: '/games/cat-life/src/assets/premium/station-clock-board.png'
  }
} as const;

export type CatLifeGameProduct = typeof catLifeGameProduct;
