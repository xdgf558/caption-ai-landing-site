(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function getSpritePosition(sprite) {
    var column = Math.max(0, Math.min(4, Number((sprite && sprite.column) || 0)));
    var row = Math.max(0, Math.min(3, Number((sprite && sprite.row) || 0)));
    return {
      x: (column / 4) * 100,
      y: (row / 3) * 100,
    };
  }

  function renderCatSprite(cat, extraClass) {
    var sprite = cat.sprite || {};
    var position = getSpritePosition(sprite);
    var filter = sprite.filter || "none";

    return (
      '<span class="community-cat-sprite ' + (extraClass || "") + '" style="background-position:' +
      position.x +
      "% " +
      position.y +
      "%; filter:" +
      format.escapeHtml(filter) +
      ';" title="' +
      format.escapeHtml(getText(cat, "name")) +
      '"></span>'
    );
  }

  function renderNpcCats(cats) {
    return (cats || [])
      .map(function (cat) {
        return (
          '<div class="community-cat">' +
          renderCatSprite(cat, "is-small") +
          '<div><strong>' + format.escapeHtml(getText(cat, "name")) + '</strong><p class="helper-text">' +
          format.escapeHtml(getText(cat, "type")) + " · " + format.escapeHtml(getText(cat, "personality")) +
          "</p></div></div>"
        );
      })
      .join("");
  }

  function renderRequirementList(list) {
    return (list || [])
      .map(function (entry) {
        var item = game.data.itemMap[entry.itemId];
        return item
          ? item.icon + " " + format.escapeHtml(getText(item, "name")) + " ×" + entry.count
          : entry.itemId + " ×" + entry.count;
      })
      .join(" / ");
  }

  function renderNeighborCard(npc) {
    var relationship = game.systems.communitySystem.getRelationship(npc.id);
    var level = game.systems.communitySystem.getRelationshipLevel(relationship.friendship);

    return (
      '<article class="shop-card community-card">' +
      '<div class="shop-row"><div class="item-title"><span class="item-icon">' + npc.icon + '</span><div>' +
      '<p class="section-eyebrow">' + t("community_neighbor") + '</p><h3 class="panel-title">' +
      format.escapeHtml(getText(npc, "name")) +
      '</h3></div></div><span class="status-pill is-success">' +
      t("community_relationship_level", { level: level }) +
      "</span></div>" +
      '<p class="page-copy">' + format.escapeHtml(getText(npc, "homeStyle")) + "</p>" +
      '<p class="helper-text" style="margin-top: 8px;">' + format.escapeHtml(getText(npc, "personality")) + "</p>" +
      '<div style="margin-top: 12px;">' + game.ui.helpers.renderBar(t("community_friendship"), relationship.friendship) + "</div>" +
      '<div class="community-cat-list" style="margin-top: 12px;">' + renderNpcCats(npc.cats) + "</div>" +
      '<div class="inline-row" style="margin-top: 16px;">' +
      '<button class="primary-button" data-community-neighbor="' + npc.id + '">' + t("community_visit_home") + "</button>" +
      "</div></article>"
    );
  }

  function renderTownLandmark(className, content) {
    return '<span class="community-landmark ' + className + '">' + content + "</span>";
  }

  function renderPlayerHomeMarker(roomStep, state) {
    return (
      '<button class="community-map-marker is-player-home" data-community-home style="--marker-x: 50%; --marker-y: 52%;">' +
      '<span class="community-house is-player-house"><span class="community-house-roof"></span><span class="community-house-body">🏠</span></span>' +
      '<span class="community-marker-label">' + t("community_player_home") + "</span>" +
      '<span class="community-marker-meta">' +
      t("room_level_text", { level: roomStep.level }) +
      " · " +
      t("room_capacity_text", { count: roomStep.capacity }) +
      " · " +
      t("comfort_label") +
      " " +
      state.home.comfortScore +
      "</span></button>"
    );
  }

  function renderNeighborMarker(npc) {
    var relationship = game.systems.communitySystem.getRelationship(npc.id);
    var level = game.systems.communitySystem.getRelationshipLevel(relationship.friendship);
    var position = npc.mapPosition || { x: 50, y: 50 };
    var cats = (npc.cats || []).slice(0, 3);

    return (
      '<button class="community-map-marker is-neighbor" data-community-neighbor="' +
      npc.id +
      '" style="--marker-x:' +
      Number(position.x || 50) +
      "%; --marker-y:" +
      Number(position.y || 50) +
      "%; --house-color:" +
      format.escapeHtml(npc.houseColor || "#f1c27d") +
      ';">' +
      '<span class="community-house"><span class="community-house-roof"></span><span class="community-house-body">' +
      npc.icon +
      "</span></span>" +
      '<span class="community-marker-cats">' +
      cats.map(function (cat) {
        return renderCatSprite(cat, "is-map-cat");
      }).join("") +
      "</span>" +
      '<span class="community-marker-label">' +
      format.escapeHtml(getText(npc, "name")) +
      "</span>" +
      '<span class="community-marker-meta">' +
      t("community_relationship_level", { level: level }) +
      " · " +
      relationship.friendship +
      "/100</span></button>"
    );
  }

  function renderCommunityMain(state) {
    var neighbors = game.systems.communitySystem.getNeighbors();
    var roomStep = game.systems.homeSystem.getCurrentRoomStep();

    return (
      '<section class="page-card community-town-intro">' +
      '<p class="section-eyebrow">' + t("page_community") + "</p>" +
      '<h2 class="page-title">' + t("community_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("community_panel_copy") + "</p>" +
      "</section>" +
      '<section class="page-card community-town-card">' +
      '<div class="inline-row community-town-heading"><div><p class="section-eyebrow">' + t("community_map") + '</p><h3 class="panel-title">' + t("community_neighbors_title") + "</h3></div>" +
      '<span class="status-pill is-success">' + t("community_map_hint") + "</span></div>" +
      '<div class="community-town-map" role="group" aria-label="' + t("community_map") + '">' +
      renderTownLandmark("is-pond", " ") +
      renderTownLandmark("is-garden", "🌷") +
      renderTownLandmark("is-market", "☕") +
      '<span class="community-path is-path-one"></span>' +
      '<span class="community-path is-path-two"></span>' +
      '<span class="community-path is-path-three"></span>' +
      renderPlayerHomeMarker(roomStep, state) +
      neighbors.map(renderNeighborMarker).join("") +
      "</div>" +
      '<div class="community-map-help">' +
      '<span>' + t("community_map_player_home_hint") + "</span>" +
      '<span>' + t("community_map_neighbor_hint") + "</span>" +
      "</div></section>"
    );
  }

  function renderGiftPanel(npc, relationship) {
    var giftableItems = game.systems.communitySystem.getGiftableItems();
    var giftLimitReached = relationship.giftsGivenToday >= game.config.community.maxGiftsPerNpcPerDay;

    return (
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("community_gift_panel") + '</p><h3 class="panel-title">' + t("community_gift_title") + "</h3>" +
      '<p class="page-copy">' + t("community_gift_copy", {
        count: relationship.giftsGivenToday,
        max: game.config.community.maxGiftsPerNpcPerDay,
      }) + "</p>" +
      '<div class="button-cloud" style="margin-top: 14px;">' +
      giftableItems
        .map(function (item) {
          var count = game.systems.communitySystem.getInventoryCount(item.id);
          return (
            '<button class="chip-button" data-community-gift="' + item.id + '" data-community-npc="' + npc.id + '" ' +
            (count <= 0 || giftLimitReached ? "disabled" : "") +
            ">" + item.icon + " " + format.escapeHtml(getText(item, "name")) + " ×" + count + "</button>"
          );
        })
        .join("") +
      "</div></div>"
    );
  }

  function renderExchangePanel(npc) {
    var exchanges = game.systems.communitySystem.getExchangesForNpc(npc.id);

    return (
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("community_exchange_panel") + '</p><h3 class="panel-title">' + t("community_exchange_title") + "</h3>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      exchanges
        .map(function (exchange) {
          var validation = game.systems.communitySystem.canExchange(exchange.id);
          return (
            '<div class="notice-item"><p><strong>' + format.escapeHtml(getText(exchange, "label")) + "</strong></p>" +
            '<p>' + format.escapeHtml(getText(exchange, "description")) + "</p>" +
            '<p class="helper-text" style="margin-top: 6px;">' + t("community_exchange_require") + "：" +
            (renderRequirementList(exchange.give) || t("none_text")) +
            (exchange.payMoney ? " / " + exchange.payMoney + " " + t("gold_unit") : "") +
            "</p>" +
            '<p class="helper-text" style="margin-top: 4px;">' + t("community_exchange_receive") + "：" +
            (renderRequirementList(exchange.receive) || t("none_text")) +
            (exchange.receiveMoney ? " / " + exchange.receiveMoney + " " + t("gold_unit") : "") +
            "</p>" +
            '<p class="helper-text" style="margin-top: 4px;">' + t("community_exchange_level_need", { level: exchange.requiredRelationshipLevel }) + "</p>" +
            '<p style="margin-top: 10px;"><button class="secondary-button" data-community-exchange="' + exchange.id + '" ' +
            (validation.ok ? "" : "disabled") +
            ">" + t(validation.ok ? "community_exchange_action" : validation.key, validation.vars || {}) + "</button></p></div>"
          );
        })
        .join("") +
      "</div></div>"
    );
  }

  function renderNpcHome(state, npc) {
    var relationship = game.systems.communitySystem.getRelationship(npc.id);
    var level = game.systems.communitySystem.getRelationshipLevel(relationship.friendship);
    var dialogue = relationship.lastDialogue || game.utils.random.pick((npc.dialogues.visit && npc.dialogues.visit.level1) || []);

    return (
      '<section class="page-header">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("community_npc_home") + "</p>" +
      '<h2 class="page-title">' + format.escapeHtml(getText(npc, "name")) + "</h2>" +
      '<p class="page-copy">' + format.escapeHtml(getText(npc, "homeStyle")) + " · " + format.escapeHtml(getText(npc, "personality")) + "</p>" +
      '<div class="inline-row" style="margin-top: 16px;">' +
      '<button class="secondary-button" data-community-back>' + t("community_back") + "</button>" +
      '<button class="primary-button" data-community-visit="' + npc.id + '">' + t("community_visit_action") + "</button>" +
      "</div></div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("community_relationship") + "</p>" +
      '<h3 class="panel-title">' + t("community_relationship_level", { level: level }) + "</h3>" +
      '<div style="margin-top: 14px;">' + game.ui.helpers.renderBar(t("community_friendship"), relationship.friendship) + "</div>" +
      '<p class="page-copy" style="margin-top: 12px;">' + format.escapeHtml(dialogue || t("community_dialogue_empty")) + "</p>" +
      "</div></section>" +
      '<section class="home-grid">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("community_npc_cats") + '</p><h3 class="panel-title">' + t("community_npc_cats_title") + "</h3>" +
      '<div class="community-cat-list" style="margin-top: 14px;">' +
      (npc.cats || [])
        .map(function (cat) {
          return (
            '<div class="community-cat is-large">' + renderCatSprite(cat, "is-large") + "<div>" +
            '<strong>' + format.escapeHtml(getText(cat, "name")) + '</strong><p class="helper-text">' +
            format.escapeHtml(getText(cat, "type")) + " · " + format.escapeHtml(getText(cat, "personality")) +
            '</p><p class="helper-text">' + format.escapeHtml(getText(cat, "moodText")) + "</p></div></div>"
          );
        })
        .join("") +
      "</div></div>" +
      renderGiftPanel(npc, relationship) +
      "</section>" +
      '<section class="home-grid">' +
      renderExchangePanel(npc) +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("community_story") + '</p><h3 class="panel-title">' + t("community_story_title") + "</h3>" +
      '<p class="page-copy">' + t("community_story_copy", { level: level, name: getText(npc, "name") }) + "</p>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      '<div class="notice-item"><p><strong>' + t("community_daily_limits") + "</strong></p><p>" +
      t("community_gifts_today", { count: relationship.giftsGivenToday, max: game.config.community.maxGiftsPerNpcPerDay }) +
      " / " +
      t("community_exchanges_today", { count: relationship.exchangesToday, max: game.config.community.maxExchangesPerNpcPerDay }) +
      "</p></div></div></div></section>"
    );
  }

  function renderCommunityPanel(state) {
    var npc;

    if (game.state.communityView === "player_home") {
      return (
        '<section class="page-card">' +
        '<div class="inline-row"><div><p class="section-eyebrow">' + t("page_community") + '</p><h3 class="panel-title">' + t("community_player_home") + "</h3></div>" +
        '<button class="secondary-button" data-community-back>' + t("community_back") + "</button></div>" +
        "</section>" +
        game.ui.renderRoomPanel(state)
      );
    }

    if (game.state.selectedCommunityNpcId) {
      npc = game.systems.communitySystem.getNeighbor(game.state.selectedCommunityNpcId);
      if (npc) {
        return renderNpcHome(state, npc);
      }
    }

    return renderCommunityMain(state);
  }

  game.ui.renderCommunityPanel = renderCommunityPanel;
})(window.CatGame);
