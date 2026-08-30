(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function renderCollectionSlot(cat, selectedId) {
    var unlocked = cat.unlocked;
    var selected = unlocked && cat.id === selectedId;
    var className = "collection-slot" + (selected ? " is-selected" : "") + (unlocked ? "" : " is-locked");

    return (
      '<button class="' +
      className +
      '" ' +
      (unlocked ? 'data-inspect-collection-cat="' + cat.id + '"' : "disabled") +
      ">" +
      (unlocked
        ? '<img class="collection-slot-art" src="' +
          game.utils.catArt.buildCatSvg(cat, 110) +
          '" alt="' +
          format.escapeHtml(getText(cat, "name")) +
          '" /><strong>' +
          format.escapeHtml(getText(cat, "name")) +
          '</strong><span class="helper-text">' +
          t("collection_slot_click") +
          "</span>"
        : '<div class="collection-slot-placeholder">?</div><strong>' +
          t("collection_slot_locked") +
          '</strong><span class="helper-text">---</span>') +
      "</button>"
    );
  }

  function renderCollectionDetail(cat) {
    var pregnancyCountdown = game.systems.collectionSystem.getPregnancyCountdown(cat);

    return (
      '<article class="page-card">' +
      '<div class="item-title"><img class="cat-illustration" src="' +
      game.utils.catArt.buildCatSvg(cat, 120) +
      '" alt="' +
      format.escapeHtml(getText(cat, "name")) +
      '" /><div><p class="section-eyebrow">' + t("cat_collection_entry") + '</p><h3 class="panel-title">' +
      format.escapeHtml(getText(cat, "name")) +
      "</h3><p class=\"page-copy\">" +
      format.escapeHtml(getText(cat, "breed")) +
      " · " +
      format.escapeHtml(format.formatAgeYears(game.systems.catSystem.getCatAgeYears(cat))) +
      '</p><p class="helper-text" style="margin-top: 6px;">' +
      t("gender_label") +
      "：" +
      t(cat.gender === "female" ? "gender_female" : "gender_male") +
      (pregnancyCountdown !== null ? " · " + t("pregnancy_due") + " " + format.formatDuration(pregnancyCountdown) : "") +
      "</p></div></div>" +
      '<div style="margin-top: 16px;">' +
      game.ui.helpers.renderBar(t("hunger_label"), cat.hunger) +
      game.ui.helpers.renderBar(t("clean_label"), cat.clean) +
      game.ui.helpers.renderBar(t("mood_label"), cat.mood) +
      game.ui.helpers.renderBar(t("health_label"), cat.health) +
      game.ui.helpers.renderBar(t("energy_label"), cat.energy) +
      "</div></article>"
    );
  }

  function renderCollectionPanel(state) {
    var stats = game.systems.collectionSystem.getCollectionStats();
    var allCats = state.cats.slice();
    var selectedCat = allCats.find(function (cat) {
      return cat.id === game.state.collectionInspectCatId && cat.unlocked;
    }) || null;
    var galleryMarkup = allCats.length
      ? allCats.map(function (cat) {
          return renderCollectionSlot(cat, selectedCat ? selectedCat.id : "");
        }).join("")
      : '<div class="empty-state">' + t("no_cat_data") + "</div>";

    return (
      '<section class="page-header">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("page_collection") + "</p>" +
      '<h2 class="page-title">' + t("collection_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("collection_panel_copy") + "</p>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("collection_stats") + "</p>" +
      '<div class="notice-list" style="margin-top: 12px;">' +
      '<div class="notice-item"><p><strong>' + t("collection_total_cats") + "</strong></p><p>" + stats.totalCats + "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("collection_unique_looks") + "</strong></p><p>" + stats.uniqueLooks + "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("collection_kittens") + "</strong></p><p>" + stats.kittens + "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("collection_slot_locked") + "</strong></p><p>" +
      allCats.filter(function (cat) { return !cat.unlocked; }).length +
      "</p></div>" +
      "</div></div></section>" +
      '<section class="collection-layout">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("collection_gallery") + '</p><h3 class="panel-title">' + t("collection_gallery") + "</h3>" +
      '<p class="page-copy" style="margin-top: 8px;">' + t("collection_gallery_copy") + "</p>" +
      '<div class="collection-grid" style="margin-top: 16px;">' +
      galleryMarkup +
      "</div></div></section>"
      +
      '<section class="page-card" style="margin-top: 18px;">' +
      '<p class="section-eyebrow">' + t("collection_detail_title") + '</p><h3 class="panel-title">' + t("collection_detail_title") + "</h3>" +
      '<p class="page-copy" style="margin-top: 8px;">' +
      (selectedCat ? t("collection_slot_click") : t("collection_slot_hint")) +
      "</p>" +
      '<div style="margin-top: 16px;">' +
      (selectedCat ? renderCollectionDetail(selectedCat) : '<div class="empty-state">' + t("collection_detail_empty") + "</div>") +
      "</div></section>"
    );
  }

  game.ui.renderCollectionPanel = renderCollectionPanel;
})(window.CatGame);
