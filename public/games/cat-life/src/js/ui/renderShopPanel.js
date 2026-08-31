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
    var category = ["cat", "player", "furniture", "sale"].indexOf(game.state.shopCategory) !== -1
      ? game.state.shopCategory
      : "cat";
    var categoryItems = category === "cat"
      ? catItems
      : category === "player"
        ? playerFoods.concat(playerDrinks)
        : category === "furniture"
          ? furniture
          : [];
    var categoryTitle = category === "cat"
      ? t("daily_supplies")
      : category === "player"
        ? t("player_supplies_title")
        : category === "furniture"
          ? t("warm_home")
          : t("shop_discount_panel_title");
    var categoryEyebrow = category === "cat"
      ? t("consumables")
      : category === "player"
        ? t("player_foods_title") + " / " + t("player_drinks_title")
        : category === "furniture"
          ? t("furniture")
          : t("shop_discount_title");
    var cards = category === "sale"
      ? activeOffers.map(function (entry) {
          return renderShopCard(
            entry.item,
            state.player.gold,
            entry.item.type === "furniture" && state.inventory.furnitureOwned.indexOf(entry.item.id) !== -1,
            entry.priceState
          );
        }).join("")
      : categoryItems.map(function (item) {
          return renderShopCard(
            item,
            state.player.gold,
            item.type === "furniture" && state.inventory.furnitureOwned.indexOf(item.id) !== -1,
            game.systems.shopSystem.getPriceState(item.id, now)
          );
        }).join("");

    return (
      '<section class="page-header">' +
      '<div class="page-card page-intro-card">' +
      '<p class="section-eyebrow">' + t("page_shop") + "</p>" +
      '<h2 class="page-title">' + t("shop_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("shop_panel_copy") + "</p>" +
      "</div>" +
      '<div class="page-card shop-hours-card">' +
      '<p class="section-eyebrow">' + t("shopping_info") + "</p>" +
      '<p class="page-copy">' + t("shop_discount_window_copy", { start: "20:00", end: "22:00" }) + "</p>" +
      '<span class="status-pill ' + (discountActive ? "is-success" : "is-warning") + '">' +
      (discountActive ? t("shop_discount_panel_live") : t("shop_discount_panel_waiting", { start: "20:00", end: "22:00" })) + '</span>' +
      "</div>" +
      "</section>" +
      '<div class="shop-tabs" role="tablist" aria-label="' + format.escapeHtml(t("page_shop")) + '">' +
      '<button id="shop-tab-cat" role="tab" aria-controls="shop-panel" aria-selected="' + (category === "cat") + '" tabindex="' + (category === "cat" ? "0" : "-1") + '" class="chip-button ' + (category === "cat" ? "is-active" : "") + '" data-shop-category="cat">' + t("daily_supplies") + '</button>' +
      '<button id="shop-tab-player" role="tab" aria-controls="shop-panel" aria-selected="' + (category === "player") + '" tabindex="' + (category === "player" ? "0" : "-1") + '" class="chip-button ' + (category === "player" ? "is-active" : "") + '" data-shop-category="player">' + t("player_supplies_title") + '</button>' +
      '<button id="shop-tab-furniture" role="tab" aria-controls="shop-panel" aria-selected="' + (category === "furniture") + '" tabindex="' + (category === "furniture" ? "0" : "-1") + '" class="chip-button ' + (category === "furniture" ? "is-active" : "") + '" data-shop-category="furniture">' + t("furniture") + '</button>' +
      '<button id="shop-tab-sale" role="tab" aria-controls="shop-panel" aria-selected="' + (category === "sale") + '" tabindex="' + (category === "sale" ? "0" : "-1") + '" class="chip-button ' + (category === "sale" ? "is-active" : "") + '" data-shop-category="sale">' + t("shop_discount_title") + '</button></div>' +
      '<section id="shop-panel" class="page-card shop-catalog" role="tabpanel" aria-labelledby="shop-tab-' + category + '"><div class="section-heading"><div><p class="section-eyebrow">' +
      categoryEyebrow + '</p><h3 class="panel-title">' + categoryTitle + '</h3></div><span class="pill">' +
      (category === "sale" ? activeOffers.length : categoryItems.length) + '</span></div>' +
      (cards ? '<div class="shop-grid">' + cards + '</div>' : '<div class="empty-state">' +
        t(category === "sale" ? (discountActive ? "shop_discount_empty" : "shop_discount_resting") : "shop_category_empty") + '</div>') + '</section>'
    );
  }

  game.ui.renderShopPanel = renderShopPanel;
})(window.CatGame);
