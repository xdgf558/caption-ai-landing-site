(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function renderShopCard(item, gold, owned, priceState) {
    var count = item.type === "furniture" ? null : game.systems.playerSystem.getInventoryCount(item.id);
    var sleeping = game.systems.playerSystem.hasActiveSleep();
    var buttonLabel = owned ? t("owned") : t("buy");
    var disabled = gold < priceState.price || owned;
    var useButton =
      item.type === "playerConsumable"
        ? '<button class="secondary-button" data-use-player-item="' +
          item.id +
          '" ' +
          (count <= 0 || sleeping ? "disabled" : "") +
          ">" +
          t("use_item") +
          "</button>"
        : "";

    return (
      '<article class="shop-card ' +
      (owned ? "is-owned" : "") +
      '">' +
      '<div class="shop-art"><img src="' + format.escapeHtml(item.image) + '" alt="' +
      format.escapeHtml(getText(item, "name")) + '" width="800" height="600" loading="lazy" /></div>' +
      '<div class="shop-row"><div><p class="section-eyebrow">' +
      (item.type === "furniture"
        ? t("furniture")
        : item.type === "playerConsumable"
          ? t(item.category === "playerDrink" ? "player_drinks_title" : "player_foods_title")
          : t("item")) +
      '</p><div class="item-title"><h3 class="panel-title">' +
      format.escapeHtml(getText(item, "name")) +
      "</h3></div></div>" +
      '<div class="price-stack">' +
      '<span class="pill ' + (priceState.isDiscount ? "is-sale" : "") + '">' +
      priceState.price +
      " " + t("gold_unit") + "</span>" +
      (priceState.isDiscount
        ? '<span class="price-old">' + t("shop_base_price", { price: priceState.basePrice }) + "</span>"
        : "") +
      "</div></div>" +
      '<p class="page-copy">' +
      format.escapeHtml(getText(item, "description")) +
      "</p>" +
      '<p class="shop-meta" style="margin-top: 10px;">' + t("effect") + '：' +
      format.escapeHtml(getText(item, "effectText")) +
      "</p>" +
      (priceState.isDiscount
        ? '<p class="sale-copy" style="margin-top: 8px;">' +
          t("shop_discount_badge", {
            percent: priceState.discountPercent,
            count: priceState.remainingStock,
          }) +
          "</p>"
        : "") +
      (item.type === "playerConsumable"
        ? '<p class="helper-text" style="margin-top: 8px;">' + t("owned_count", { count: count }) + "</p>"
        : "") +
      '<div class="inline-row shop-actions" style="margin-top: 16px;">' +
      '<span class="status-pill ' +
      (gold >= priceState.price ? "is-success" : "is-warning") +
      '">' +
      (priceState.isDiscount
        ? t("shop_discount_status")
        : gold >= priceState.price
        ? t("can_buy")
        : t("not_enough_gold")) +
      "</span>" +
      '<button class="store-button" data-store-item="' +
      item.id +
      '" ' +
      (disabled ? "disabled" : "") +
      ">" +
      buttonLabel +
      "</button>" +
      useButton +
      "</div>" +
      "</article>"
    );
  }

  function renderShopPanel(state) {
    var now = game.systems.timeSystem.getNow();
    var discountActive = game.systems.shopSystem.isDiscountWindow(now);
    var activeOffers = game.systems.shopSystem.getActiveOffers(now);
    var catItems = game.data.items.filter(function (item) {
      return item.type === "consumable";
    });
    var playerFoods = game.data.items.filter(function (item) {
      return item.type === "playerConsumable" && item.category === "playerFood";
    });
    var playerDrinks = game.data.items.filter(function (item) {
      return item.type === "playerConsumable" && item.category === "playerDrink";
    });
    var furniture = game.data.items.filter(function (item) {
      return item.type === "furniture";
    });

    return (
      '<section class="page-header">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("page_shop") + "</p>" +
      '<h2 class="page-title">' + t("shop_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("shop_panel_copy") + "</p>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("shopping_info") + "</p>" +
      '<p class="page-copy">' + t("shopping_copy") + "</p>" +
      '<p class="helper-text" style="margin-top: 8px;">' + t("shop_discount_window_copy", { start: "20:00", end: "22:00" }) + "</p>" +
      "</div>" +
      "</section>" +
      '<section class="page-card">' +
      '<div class="inline-row"><div><p class="section-eyebrow">' + t("shop_discount_title") + '</p><h3 class="panel-title">' + t("shop_discount_panel_title") + "</h3></div></div>" +
      '<p class="page-copy" style="margin-top: 8px;">' +
      (discountActive
        ? t("shop_discount_panel_live")
        : t("shop_discount_panel_waiting", { start: "20:00", end: "22:00" })) +
      "</p>" +
      (activeOffers.length
        ? '<div class="shop-grid" style="margin-top: 16px;">' +
          activeOffers
            .map(function (entry) {
              return renderShopCard(
                entry.item,
                state.player.gold,
                entry.item.type === "furniture" && state.inventory.furnitureOwned.indexOf(entry.item.id) !== -1,
                entry.priceState
              );
            })
            .join("") +
          "</div>"
        : '<div class="empty-state" style="margin-top: 16px;">' + t(discountActive ? "shop_discount_empty" : "shop_discount_resting") + "</div>") +
      "</section>" +
      '<section class="page-card">' +
      '<div class="inline-row"><div><p class="section-eyebrow">' + t("consumables") + '</p><h3 class="panel-title">' + t("daily_supplies") + "</h3></div></div>" +
      '<div class="shop-grid" style="margin-top: 16px;">' +
      catItems
        .map(function (item) {
          return renderShopCard(
            item,
            state.player.gold,
            false,
            game.systems.shopSystem.getPriceState(item.id, now)
          );
        })
        .join("") +
      "</div></section>" +
      '<section class="page-card">' +
      '<div class="inline-row"><div><p class="section-eyebrow">' + t("player_supplies_title") + '</p><h3 class="panel-title">' + t("player_foods_title") + "</h3></div></div>" +
      '<div class="shop-grid" style="margin-top: 16px;">' +
      playerFoods
        .map(function (item) {
          return renderShopCard(
            item,
            state.player.gold,
            false,
            game.systems.shopSystem.getPriceState(item.id, now)
          );
        })
        .join("") +
      "</div></section>" +
      '<section class="page-card">' +
      '<div class="inline-row"><div><p class="section-eyebrow">' + t("player_supplies_title") + '</p><h3 class="panel-title">' + t("player_drinks_title") + "</h3></div></div>" +
      '<div class="shop-grid" style="margin-top: 16px;">' +
      playerDrinks
        .map(function (item) {
          return renderShopCard(
            item,
            state.player.gold,
            false,
            game.systems.shopSystem.getPriceState(item.id, now)
          );
        })
        .join("") +
      "</div></section>" +
      '<section class="page-card">' +
      '<div class="inline-row"><div><p class="section-eyebrow">' + t("furniture") + '</p><h3 class="panel-title">' + t("warm_home") + "</h3></div></div>" +
      '<div class="shop-grid" style="margin-top: 16px;">' +
      furniture
        .map(function (item) {
          return renderShopCard(
            item,
            state.player.gold,
            state.inventory.furnitureOwned.indexOf(item.id) !== -1,
            game.systems.shopSystem.getPriceState(item.id, now)
          );
        })
        .join("") +
      "</div></section>"
    );
  }

  game.ui.renderShopPanel = renderShopPanel;
})(window.CatGame);
