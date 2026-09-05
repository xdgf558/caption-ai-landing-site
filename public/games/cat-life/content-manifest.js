(function () {
  "use strict";

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) {
      deepFreeze(value[key]);
    });
    return Object.freeze(value);
  }

  var manifest = deepFreeze({
    schemaVersion: 1,
    releaseVersion: "1.24.0",
    products: [
      {
        productId: "cat-life.skin.moonlit-tabby",
        entitlementKey: "cat-life.cosmetic.skin.moonlit-tabby.v1",
        kind: "skin",
        image: "src/assets/premium/moonlit-tabby.png",
        imageSize: { width: 480, height: 480 },
        skins: [
          {
            id: "moonlit-tabby",
            targetCatIds: ["cat_001"],
            sprite: "src/assets/premium/moonlit-tabby.png",
            walkSprite: "src/assets/cats/moonlit-tabby-walk.png",
          },
        ],
      },
      {
        productId: "cat-life.bundle.station-room",
        entitlementKey: "cat-life.content.furniture.station-room.v1",
        kind: "room",
        image: "src/assets/premium/station-room-preview.webp",
        imageSize: { width: 759, height: 428 },
        roomTheme: {
          options: {
            wall: { value: "station-green", labelKey: "room_wall_station" },
            floor: { value: "station-stripe", labelKey: "room_floor_station" },
            decor: { value: "station-signal", labelKey: "room_decor_station" },
            layout: { value: "station-waiting", labelKey: "room_layout_station" },
          },
          layoutPositions: {
            "station-waiting": [
              { left: "8%", top: "56%" },
              { left: "34%", top: "48%" },
              { left: "62%", top: "56%" },
              { left: "72%", top: "30%" },
            ],
          },
          fixtures: [
            {
              id: "station-clock-board",
              asset: "src/assets/premium/station-clock-board.png",
              width: 640,
              height: 640,
              when: { wall: "station-green" },
            },
            {
              id: "station-signal-lamp",
              asset: "src/assets/premium/station-signal-lamp.png",
              width: 600,
              height: 640,
              when: { decor: "station-signal" },
            },
            {
              id: "station-bench",
              asset: "src/assets/premium/station-bench.png",
              width: 640,
              height: 640,
              when: { layout: "station-waiting" },
            },
          ],
        },
      },
    ],
  });

  var productsById = manifest.products.reduce(function (result, product) {
    result[product.productId] = product;
    return result;
  }, {});
  deepFreeze(productsById);

  function getProduct(productId) {
    return productsById[productId] || null;
  }

  function getSkin(productId, catId) {
    var product = getProduct(productId);
    if (!product || product.kind !== "skin") return null;
    return product.skins.find(function (skin) {
      return skin.targetCatIds.indexOf(catId) !== -1;
    }) || null;
  }

  function getRoomTheme() {
    var product = getProduct("cat-life.bundle.station-room");
    return product ? product.roomTheme : null;
  }

  window.CatGameContentManifest = deepFreeze({
    manifest: manifest,
    productsById: productsById,
    getProduct: getProduct,
    getSkin: getSkin,
    getRoomTheme: getRoomTheme,
  });
})();
