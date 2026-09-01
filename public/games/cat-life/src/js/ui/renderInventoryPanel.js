(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  var catActions = {
    food_basic: "feedBasic",
    food_premium: "feedPremium",
    litter_basic: "clean",
    toy_wand: "play",
    medicine_basic: "medicine",
    cat_grass: "catGrass",
  };

  function getItemCount(state, item) {
    if (item.type === "furniture") {
      return state.inventory.furnitureOwned.indexOf(item.id) === -1 ? 0 : 1;
    }
    return game.systems.playerSystem.getInventoryCount(item.id);
  }

  function getGroup(item) {
    if (item.type === "furniture") return "furniture";
    if (item.type === "playerConsumable") return "player";
    if (item.type === "material" || item.category === "community") return "materials";
    return "cat";
  }

  function getSelectedCat(state) {
    var availableCats = state.cats.filter(function (cat) {
      return cat.unlocked && cat.isAlive !== false;
    });
    var selected = availableCats.find(function (cat) {
      return cat.id === game.state.selectedCatId;
    }) || availableCats[0] || null;

    if (selected) {
      game.state.selectedCatId = selected.id;
    }
    return selected;
  }

  function renderCatSelector(state, selectedCat) {
    var cats = state.cats.filter(function (cat) {
      return cat.unlocked && cat.isAlive !== false;
    });

    if (!cats.length) {
      return '<p class="helper-text">' + t("inventory_no_cat_target") + "</p>";
    }

    return '<div class="inventory-cat-selector" aria-label="' + format.escapeHtml(t("inventory_cat_target")) + '">' +
      cats.map(function (cat) {
        var name = getText(cat, "name");
        var selected = selectedCat && selectedCat.id === cat.id;
        return '<button class="inventory-cat-chip ' + (selected ? "is-selected" : "") +
          '" data-select-cat="' + format.escapeHtml(cat.id) + '" aria-pressed="' + selected + '">' +
          '<img src="' + format.escapeHtml(game.utils.catArt.getCatSpriteUrl(cat)) + '" alt="" />' +
          '<span>' + format.escapeHtml(name) + "</span></button>";
      }).join("") + "</div>";
  }

  function renderAction(item, count, selectedCat, sleeping) {
    var action = catActions[item.id];

    if (item.type === "playerConsumable") {
      return '<button class="secondary-button" data-use-player-item="' + format.escapeHtml(item.id) + '" ' +
        (count <= 0 || sleeping ? "disabled" : "") + ">" + t("use_item") + "</button>";
    }

    if (action) {
      return '<button class="action-button" data-cat-action="' + action + '" data-cat-id="' +
        format.escapeHtml(selectedCat ? selectedCat.id : "") + '" ' +
        (count <= 0 || !selectedCat ? "disabled" : "") + ">" +
        format.escapeHtml(t("inventory_use_for", { name: selectedCat ? getText(selectedCat, "name") : t("nav_cats") })) +
        "</button>";
    }

    if (item.type === "furniture") {
      return '<button class="ghost-button" data-community-home>' + t("inventory_go_home") + "</button>";
    }

    return '<button class="ghost-button" data-page-target="community">' + t("inventory_go_town") + "</button>";
  }

  function renderItemCard(entry, selectedCat, sleeping) {
    var item = entry.item;
    var image = item.type === "furniture" ? (item.roomImage || item.image) : item.image;

    return '<article class="inventory-card">' +
      '<div class="inventory-art"><img src="' + format.escapeHtml(image) + '" alt="' +
      format.escapeHtml(getText(item, "name")) + '" width="512" height="384" loading="lazy" /></div>' +
      '<div class="inventory-card-copy"><div class="inventory-card-heading"><div><p class="section-eyebrow">' +
      t("inventory_group_" + entry.group) + '</p><h4 class="panel-title">' +
      format.escapeHtml(getText(item, "name")) + '</h4></div><span class="inventory-count">' +
      (item.type === "furniture" ? t("owned") : "x" + format.formatNumber(entry.count)) + "</span></div>" +
      '<p class="page-copy">' + format.escapeHtml(getText(item, "description")) + "</p>" +
      '<p class="shop-meta">' + t("effect") + "：" + format.escapeHtml(getText(item, "effectText")) + "</p>" +
      '<div class="inventory-actions">' + renderAction(item, entry.count, selectedCat, sleeping) + "</div></div></article>";
  }

  function renderGroup(group, entries, selectedCat, sleeping) {
    if (!entries.length) return "";

    return '<section class="inventory-section" aria-labelledby="inventory-group-' + group + '">' +
      '<div class="section-heading"><div><p class="section-eyebrow">' + t("inventory_group_label") +
      '</p><h3 id="inventory-group-' + group + '" class="panel-title">' + t("inventory_group_" + group) +
      '</h3></div><span class="pill">' + t("inventory_group_count", { count: entries.length }) + "</span></div>" +
      '<div class="inventory-grid">' + entries.map(function (entry) {
        return renderItemCard(entry, selectedCat, sleeping);
      }).join("") + "</div></section>";
  }

  function renderInventoryPanel(state) {
    var selectedCat = getSelectedCat(state);
    var sleeping = game.systems.playerSystem.hasActiveSleep();
    var entries = game.data.items.map(function (item) {
      return { item: item, count: getItemCount(state, item), group: getGroup(item) };
    }).filter(function (entry) {
      return entry.count > 0;
    });
    var totalUnits = entries.reduce(function (total, entry) {
      return total + entry.count;
    }, 0);
    var furnitureCount = entries.filter(function (entry) {
      return entry.group === "furniture";
    }).length;
    var groups = ["player", "cat", "materials", "furniture"];

    return '<section class="page-header inventory-header"><div class="page-card page-intro-card">' +
      '<p class="section-eyebrow">' + t("page_inventory") + '</p><h2 class="page-title">' +
      t("inventory_panel_title") + '</h2><p class="page-copy">' + t("inventory_panel_copy") +
      '</p><div class="inventory-summary" aria-label="' + format.escapeHtml(t("inventory_summary")) + '">' +
      '<div><strong>' + entries.length + '</strong><span>' + t("inventory_unique_items") + '</span></div>' +
      '<div><strong>' + format.formatNumber(totalUnits) + '</strong><span>' + t("inventory_total_units") + '</span></div>' +
      '<div><strong>' + furnitureCount + '</strong><span>' + t("inventory_furniture_count") +
      "</span></div></div></div>" +
      '<aside class="page-card inventory-target-card"><p class="section-eyebrow">' + t("inventory_cat_target") +
      '</p><h3 class="panel-title">' + (selectedCat ? format.escapeHtml(getText(selectedCat, "name")) : t("nav_cats")) +
      '</h3><p class="helper-text">' + t("inventory_cat_target_copy") + "</p>" +
      renderCatSelector(state, selectedCat) + "</aside></section>" +
      (entries.length
        ? groups.map(function (group) {
            return renderGroup(group, entries.filter(function (entry) {
              return entry.group === group;
            }), selectedCat, sleeping);
          }).join("")
        : '<section class="page-card inventory-empty"><h3 class="panel-title">' + t("inventory_empty_title") +
          '</h3><p class="page-copy">' + t("inventory_empty_copy") +
          '</p><button class="primary-button" data-page-target="shop">' + t("inventory_go_shop") + "</button></section>");
  }

  game.ui.renderInventoryPanel = renderInventoryPanel;
})(window.CatGame);
