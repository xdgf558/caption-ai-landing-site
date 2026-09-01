(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function renderModeButton(mode, label, currentMode) {
    return (
      '<button type="button" class="room-mode-button ' +
      (currentMode === mode ? "is-active" : "") +
      '" data-room-mode-target="' +
      mode +
      '" aria-pressed="' +
      (currentMode === mode ? "true" : "false") +
      '">' +
      label +
      "</button>"
    );
  }

  function renderRoomOptions(label, key, currentValue, options) {
    return (
      '<fieldset class="room-option-group"><legend>' +
      label +
      '</legend><div class="room-option-list">' +
      options
        .map(function (option) {
          var value = format.escapeHtml(option.value);
          var isActive = currentValue === option.value;
          return (
            '<button type="button" class="room-option-button room-option-button--' +
            format.escapeHtml(key) +
            "-" +
            value +
            (isActive ? " is-active" : "") +
            '" data-room-option-key="' +
            format.escapeHtml(key) +
            '" data-room-option-value="' +
            value +
            '" aria-pressed="' +
            (isActive ? "true" : "false") +
            '"><span class="room-option-swatch" aria-hidden="true"></span><span>' +
            format.escapeHtml(t(option.labelKey || option.label)) +
            "</span></button>"
          );
        })
        .join("") +
      "</div></fieldset>"
    );
  }

  function renderFurnitureShelf(furniture, storedFurniture) {
    var allFurniture = furniture.concat(storedFurniture);

    if (!allFurniture.length) {
      return '<p class="room-empty-copy">' + t("room_empty_furniture") + "</p>";
    }

    return (
      '<div class="room-furniture-shelf">' +
      allFurniture
        .map(function (item) {
          var isPlaced = furniture.some(function (placed) {
            return placed.id === item.id;
          });
          return (
            '<div class="room-furniture-shelf-item ' +
            (isPlaced ? "is-placed" : "is-stored") +
            '"><img src="' +
            format.escapeHtml(item.image) +
            '" alt="" loading="lazy" /><span>' +
            format.escapeHtml(getText(item, "name")) +
            '</span><small>' +
            t(isPlaced ? "room_furniture_placed" : "room_furniture_stored") +
            "</small></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderRoomPanel(state) {
    var scene = game.systems.homeSystem.getRenderableRoomScene(state.home.roomScene);
    var cats = game.systems.collectionSystem.getUnlockedCats().filter(function (cat) {
      return cat.isAlive !== false;
    });
    var furniture = game.systems.homeSystem.getPlacedFurniture();
    var storedFurniture = game.systems.homeSystem.getStoredFurniture();
    var roomStep = game.systems.homeSystem.getCurrentRoomStep();
    var upgradeCost = game.systems.homeSystem.getRoomUpgradeCost();
    var roomMode = game.state.roomMode === "edit" ? "edit" : "life";

    return (
      '<section class="room-home-page" data-room-mode="' +
      roomMode +
      '">' +
      '<header class="room-home-header">' +
      '<div class="room-home-heading"><p class="section-eyebrow">' +
      t("page_room") +
      '</p><h2 class="page-title">' +
      t("room_home_title") +
      '</h2><p class="page-copy">' +
      t("room_home_copy") +
      "</p></div>" +
      '<dl class="room-home-metrics"><div><dt>' +
      t("room_level_short") +
      '</dt><dd>Lv.' +
      roomStep.level +
      "</dd></div><div><dt>" +
      t("room_capacity_short") +
      "</dt><dd>" +
      furniture.length +
      " / " +
      roomStep.capacity +
      "</dd></div><div><dt>" +
      t("comfort_label") +
      "</dt><dd>" +
      state.home.comfortScore +
      "</dd></div></dl>" +
      '<button type="button" class="ghost-button room-community-back" data-community-back>' +
      t("community_back") +
      "</button></header>" +
      '<div class="room-home-workspace">' +
      '<section class="room-stage-panel" aria-labelledby="room-stage-title">' +
      '<div class="room-stage-heading"><div><p class="section-eyebrow">' +
      t("room_preview") +
      '</p><h3 class="panel-title" id="room-stage-title">' +
      t("room_scene_title") +
      '</h3></div><span class="room-scene-status">' +
      t(roomMode === "edit" ? "room_scene_editing" : "room_scene_roaming") +
      "</span></div>" +
      game.systems.homeSystem.renderRoomScene(scene, cats, furniture, { mode: roomMode }) +
      '<div class="room-stage-footer"><p>' +
      t(roomMode === "edit" ? "room_edit_hint" : "room_life_hint") +
      '</p><span>' +
      t("room_cat_count") +
      ": <strong>" +
      cats.length +
      "</strong></span></div></section>" +
      '<aside class="room-editor-rail" aria-label="' +
      format.escapeHtml(t("room_custom_title")) +
      '">' +
      '<div class="room-mode-switch" role="group" aria-label="' +
      format.escapeHtml(t("room_mode_label")) +
      '">' +
      renderModeButton("life", t("room_mode_life"), roomMode) +
      renderModeButton("edit", t("room_mode_edit"), roomMode) +
      "</div>" +
      '<section class="room-mode-panel" ' +
      (roomMode === "life" ? "" : "hidden") +
      '><p class="section-eyebrow">' +
      t("room_life_overview") +
      '</p><h3 class="panel-title">' +
      t("room_furniture_title") +
      '</h3><p class="room-rail-copy">' +
      t("room_life_overview_copy") +
      "</p>" +
      renderFurnitureShelf(furniture, storedFurniture) +
      '</section><section class="room-mode-panel room-mode-panel--edit" ' +
      (roomMode === "edit" ? "" : "hidden") +
      '><div class="room-renovation-row"><div><p class="section-eyebrow">' +
      t("room_upgrade_title") +
      '</p><p class="room-renovation-copy">' +
      (upgradeCost === null
        ? t("room_upgrade_maxed")
        : t("room_upgrade_next_cost", { cost: upgradeCost })) +
      '</p></div><button type="button" class="primary-button" data-upgrade-room ' +
      (upgradeCost === null ? "disabled" : "") +
      ">" +
      t("room_upgrade_action") +
      "</button></div>" +
      renderRoomOptions(t("room_wall"), "wall", scene.wall, game.systems.homeSystem.getRoomWallOptions()) +
      renderRoomOptions(t("room_floor"), "floor", scene.floor, game.systems.homeSystem.getRoomFloorOptions()) +
      renderRoomOptions(t("room_decor"), "decor", scene.decor, game.systems.homeSystem.getRoomDecorOptions()) +
      renderRoomOptions(t("room_layout"), "layout", scene.layout, game.systems.homeSystem.getRoomLayoutOptions()) +
      '<div class="room-editor-actions"><button type="button" class="ghost-button" data-reset-room-layout>' +
      t("room_reset_layout") +
      '</button><button type="button" class="secondary-button" data-room-mode-target="life">' +
      t("room_finish_edit") +
      "</button></div></section></aside></div></section>"
    );
  }

  game.ui.renderRoomPanel = renderRoomPanel;
})(window.CatGame);
