(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function renderSelect(label, key, currentValue, options) {
    return (
      '<div class="notice-item"><p><strong>' +
      label +
      '</strong></p><select class="field" data-room-setting="' +
      key +
      '">' +
      options
        .map(function (option) {
          return (
            '<option value="' +
            option.value +
            '" ' +
            (currentValue === option.value ? "selected" : "") +
            ">" +
            t(option.labelKey || option.label) +
            "</option>"
          );
        })
        .join("") +
      "</select></div>"
    );
  }

  function renderRoomPanel(state) {
    var scene = state.home.roomScene;
    var cats = game.systems.collectionSystem.getUnlockedCats().filter(function (cat) {
      return cat.isAlive !== false;
    });
    var furniture = game.systems.homeSystem.getPlacedFurniture();
    var storedFurniture = game.systems.homeSystem.getStoredFurniture();
    var roomStep = game.systems.homeSystem.getCurrentRoomStep();
    var upgradeCost = game.systems.homeSystem.getRoomUpgradeCost();

    return (
      '<section class="page-header">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("page_room") + "</p>" +
      '<h2 class="page-title">' + t("room_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("room_panel_copy") + "</p>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("room_custom_title") + "</p>" +
      '<div class="notice-list" style="margin-top: 12px;">' +
      '<div class="notice-item"><p><strong>' + t("room_upgrade_title") + '</strong></p><p>' +
      t("room_level_text", { level: roomStep.level }) +
      " · " +
      t("room_capacity_text", { count: roomStep.capacity }) +
      '<br />' +
      (upgradeCost === null
        ? t("room_upgrade_maxed")
        : t("room_upgrade_next_cost", { cost: upgradeCost })) +
      '</p><p style="margin-top:8px;"><button class="primary-button" data-upgrade-room ' +
      (upgradeCost === null ? "disabled" : "") +
      ">" + t("room_upgrade_action") + "</button></p></div>" +
      renderSelect(t("room_wall"), "wall", scene.wall, game.systems.homeSystem.roomWallOptions) +
      renderSelect(t("room_floor"), "floor", scene.floor, game.systems.homeSystem.roomFloorOptions) +
      renderSelect(t("room_decor"), "decor", scene.decor, game.systems.homeSystem.roomDecorOptions) +
      renderSelect(t("room_layout"), "layout", scene.layout, game.systems.homeSystem.roomLayoutOptions) +
      "</div></div></section>" +
      '<section class="home-grid">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("room_preview") + '</p><h3 class="panel-title">' + t("room_scene_title") + "</h3>" +
      '<p class="page-copy" style="margin-top: 8px;">' + t("room_drag_hint") + "</p>" +
      game.systems.homeSystem.renderRoomScene(scene, cats, furniture) +
      '<div class="inline-row" style="margin-top: 16px; flex-wrap: wrap;">' +
      '<button class="secondary-button" data-reset-room-layout>' + t("room_reset_layout") + "</button>" +
      '<span class="status-pill">' + t("room_drag_status") + "</span>" +
      "</div>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("room_collection_hint") + '</p><h3 class="panel-title">' + t("room_collection_title") + "</h3>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      '<div class="notice-item"><p><strong>' + t("placed_furniture") + "</strong></p><p>" +
      (furniture.length
        ? furniture.map(function (item) {
            return item.icon + " " + format.escapeHtml(getText(item, "name"));
          }).join(" / ")
        : t("room_empty_furniture")) +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("room_size_label") + "</strong></p><p>" +
      roomStep.width +
      "px × " +
      roomStep.height +
      "px</p></div>" +
      '<div class="notice-item"><p><strong>' + t("room_owned_count") + "</strong></p><p>" +
      state.inventory.furnitureOwned.length +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("room_unplaced_count") + "</strong></p><p>" +
      storedFurniture.length +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("room_cat_count") + "</strong></p><p>" + cats.length + "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("room_future_copy") + "</strong></p><p>" + t("room_future_detail") + "</p></div>" +
      "</div></div></section>"
    );
  }

  game.ui.renderRoomPanel = renderRoomPanel;
})(window.CatGame);
