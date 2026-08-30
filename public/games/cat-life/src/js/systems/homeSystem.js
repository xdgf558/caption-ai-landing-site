(function (game) {
  var t = game.utils.i18n.t;
  var wallOptions = [
    { value: "sunny", labelKey: "room_wall_sunny" },
    { value: "mint", labelKey: "room_wall_mint" },
    { value: "starlight", labelKey: "room_wall_starlight" },
  ];
  var floorOptions = [
    { value: "oak", labelKey: "room_floor_oak" },
    { value: "cream", labelKey: "room_floor_cream" },
    { value: "berry", labelKey: "room_floor_berry" },
  ];
  var decorOptions = [
    { value: "plants", labelKey: "room_decor_plants" },
    { value: "posters", labelKey: "room_decor_posters" },
    { value: "lanterns", labelKey: "room_decor_lanterns" },
  ];
  var layoutOptions = [
    { value: "cozy", labelKey: "room_layout_cozy" },
    { value: "window", labelKey: "room_layout_window" },
    { value: "playful", labelKey: "room_layout_playful" },
  ];

  function recalculateComfort() {
    syncPlacedFurnitureCapacity(true);
    var baseComfort = 10;
    var furnitureScore = game.state.game.home.placedFurniture.reduce(function (sum, furnitureId) {
      var item = game.data.itemMap[furnitureId];
      return sum + (item && item.comfort ? item.comfort : 0);
    }, 0);

    game.state.game.home.comfortScore = baseComfort + furnitureScore;
    return game.state.game.home.comfortScore;
  }

  function getPlacedFurniture() {
    syncPlacedFurnitureCapacity(true);
    return game.state.game.home.placedFurniture
      .map(function (furnitureId) {
        return game.data.itemMap[furnitureId];
      })
      .filter(Boolean);
  }

  function getRoomStep(level) {
    var steps = game.config.roomUpgradeSteps || [];
    return steps.find(function (step) {
      return step.level === level;
    }) || steps[0] || { level: 1, capacity: 3, width: 620, height: 360, upgradeCost: null };
  }

  function getCurrentRoomStep() {
    return getRoomStep(game.state.game.home.roomLevel || 1);
  }

  function getCurrentRoomCapacity() {
    return getCurrentRoomStep().capacity || 3;
  }

  function getRoomUpgradeCost() {
    return getCurrentRoomStep().upgradeCost;
  }

  function canUpgradeRoom() {
    var cost = getRoomUpgradeCost();
    return cost !== null && typeof cost === "number" && game.state.game.player.gold >= cost;
  }

  function ensureFurnitureLayout() {
    var scene = game.state.game.home.roomScene;
    var layout = game.state.game.home.furnitureLayout || {};

    game.state.game.home.placedFurniture.forEach(function (furnitureId, index) {
      if (!layout[furnitureId]) {
        layout[furnitureId] = getFurniturePlacement(scene.layout, index);
      }
    });

    game.state.game.home.furnitureLayout = layout;
    return layout;
  }

  function syncPlacedFurnitureCapacity(fillAvailable) {
    var state = game.state.game;
    var owned = Array.isArray(state.inventory.furnitureOwned) ? state.inventory.furnitureOwned.slice() : [];
    var placed = [];
    var seen = {};
    var capacity = getCurrentRoomCapacity();
    var hidden = [];

    (state.home.placedFurniture || []).forEach(function (furnitureId) {
      if (owned.indexOf(furnitureId) !== -1 && !seen[furnitureId]) {
        seen[furnitureId] = true;
        placed.push(furnitureId);
      }
    });

    owned.forEach(function (furnitureId) {
      if (!seen[furnitureId]) {
        hidden.push(furnitureId);
      }
    });

    if (placed.length > capacity) {
      hidden = placed.slice(capacity).concat(hidden);
      placed = placed.slice(0, capacity);
    }

    if (fillAvailable !== false && placed.length < capacity) {
      var availableSlots = capacity - placed.length;
      placed = placed.concat(hidden.slice(0, availableSlots));
      hidden = hidden.slice(availableSlots);
    }

    state.home.placedFurniture = placed;
    return {
      placed: placed.slice(),
      hidden: hidden.slice(),
    };
  }

  function getFurniturePlacement(layout, index) {
    var layoutMap = {
      cozy: [
        { left: "10%", top: "58%" },
        { left: "56%", top: "54%" },
        { left: "34%", top: "40%" },
        { left: "70%", top: "34%" },
      ],
      window: [
        { left: "8%", top: "60%" },
        { left: "28%", top: "34%" },
        { left: "58%", top: "36%" },
        { left: "70%", top: "60%" },
      ],
      playful: [
        { left: "14%", top: "46%" },
        { left: "44%", top: "58%" },
        { left: "62%", top: "30%" },
        { left: "24%", top: "28%" },
      ],
    };
    var points = layoutMap[layout] || layoutMap.cozy;
    return points[index % points.length];
  }

  function getFurniturePosition(furnitureId, index, layoutName) {
    var layout = ensureFurnitureLayout();
    return layout[furnitureId] || getFurniturePlacement(layoutName, index);
  }

  function setFurniturePosition(furnitureId, left, top) {
    var layout = ensureFurnitureLayout();

    layout[furnitureId] = {
      left: left,
      top: top,
    };
  }

  function resetFurnitureLayout() {
    var scene = game.state.game.home.roomScene;
    var layout = {};

    syncPlacedFurnitureCapacity(true).placed.forEach(function (furnitureId, index) {
      layout[furnitureId] = getFurniturePlacement(scene.layout, index);
    });

    game.state.game.home.furnitureLayout = layout;
  }

  function upgradeRoom() {
    var cost = getRoomUpgradeCost();
    var state = game.state.game;
    var previousPlacedCount;
    var synced;
    var messages;

    if (cost === null || typeof cost !== "number") {
      return { ok: false, message: t("room_upgrade_maxed") };
    }

    if (state.player.gold < cost) {
      return { ok: false, message: t("room_upgrade_gold_needed", { cost: cost }) };
    }

    previousPlacedCount = syncPlacedFurnitureCapacity(true).placed.length;
    state.player.gold -= cost;
    state.player.totalSpend += cost;
    state.home.roomLevel += 1;
    resetFurnitureLayout();
    synced = syncPlacedFurnitureCapacity(true);
    messages = [
      t("room_upgrade_success", {
        level: game.state.game.home.roomLevel,
        capacity: getCurrentRoomCapacity(),
      }),
    ];

    if (synced.placed.length > previousPlacedCount) {
      messages.push(
        t("room_upgrade_auto_fill", {
          count: synced.placed.length - previousPlacedCount,
        })
      );
    }

    return {
      ok: true,
      forceSave: true,
      messages: messages,
    };
  }

  function getStoredFurniture() {
    return syncPlacedFurnitureCapacity(true).hidden
      .map(function (furnitureId) {
        return game.data.itemMap[furnitureId];
      })
      .filter(Boolean);
  }

  function renderRoomScene(scene, cats, furniture) {
    var roomStep = getCurrentRoomStep();
    syncPlacedFurnitureCapacity(true);
    ensureFurnitureLayout();

    var catMarkup = cats
      .map(function (cat, index) {
        return (
          '<img class="room-cat-sprite room-cat-path-' +
          ((index % 3) + 1) +
          '" src="' +
          game.utils.catArt.buildCatSvg(cat, 88) +
          '" alt="' +
          cat.name +
          '" style="animation-delay:' +
          index * 0.6 +
          's;" />'
        );
      })
      .join("");

    var furnitureMarkup = furniture
      .map(function (item, index) {
        var spot = getFurniturePosition(item.id, index, scene.layout);
        return (
          '<div class="room-furniture" data-furniture-id="' +
          item.id +
          '" style="left:' +
          spot.left +
          ";top:" +
          spot.top +
          ';">' +
          '<span class="room-furniture-icon">' +
          item.icon +
          "</span>" +
          "</div>"
        );
      })
      .join("");

    return (
      '<div class="room-scene wall-' +
      scene.wall +
      " floor-" +
      scene.floor +
      " decor-" +
      scene.decor +
      " room-level-" +
      roomStep.level +
      '" style="max-width:' +
      roomStep.width +
      "px;min-height:" +
      roomStep.height +
      'px;">' +
      '<div class="room-scene-badge">' +
      t("room_capacity_text", { count: roomStep.capacity }) +
      "</div>" +
      '<div class="room-wall-art"></div>' +
      '<div class="room-floor"></div>' +
      furnitureMarkup +
      catMarkup +
      "</div>"
    );
  }

  game.systems.homeSystem = {
    recalculateComfort: recalculateComfort,
    getPlacedFurniture: getPlacedFurniture,
    getCurrentRoomStep: getCurrentRoomStep,
    getCurrentRoomCapacity: getCurrentRoomCapacity,
    getRoomUpgradeCost: getRoomUpgradeCost,
    canUpgradeRoom: canUpgradeRoom,
    upgradeRoom: upgradeRoom,
    syncPlacedFurnitureCapacity: syncPlacedFurnitureCapacity,
    getStoredFurniture: getStoredFurniture,
    ensureFurnitureLayout: ensureFurnitureLayout,
    getFurniturePosition: getFurniturePosition,
    setFurniturePosition: setFurniturePosition,
    resetFurnitureLayout: resetFurnitureLayout,
    renderRoomScene: renderRoomScene,
    roomWallOptions: wallOptions,
    roomFloorOptions: floorOptions,
    roomDecorOptions: decorOptions,
    roomLayoutOptions: layoutOptions,
  };
})(window.CatGame);
