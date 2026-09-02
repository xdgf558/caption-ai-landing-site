(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function safe(value) {
    return format.escapeHtml(value === null || typeof value === "undefined" ? "" : String(value));
  }

  function number(value) {
    return format.formatNumber(Number(value) || 0);
  }

  function percent(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function renderProgress(current, total) {
    var progress = total ? percent(current / total * 100) : 0;

    return '<div class="collection-journal-progress-track" role="progressbar" aria-label="' + safe(t("collection_progress_label")) +
      '" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + current + '" aria-valuetext="' +
      safe(t("collection_progress_value", { current: current, total: total })) + '"><span style="width:' + progress + '%"></span></div>';
  }

  function renderRouteArt(cat, unlocked) {
    var source = unlocked
      ? game.utils.catArt.buildCatSvg(cat, 168)
      : new URL("src/assets/poses/question.png", document.baseURI).href;

    return '<span class="collection-route-art' + (unlocked ? "" : " is-unknown") + '"><img src="' + safe(source) +
      '" alt="" width="168" height="168" decoding="async"' + (unlocked ? "" : ' loading="lazy"') + ' /></span>';
  }

  function renderRouteEntry(cat, selectedId, index, nextLockedIndex) {
    var unlocked = Boolean(cat.unlocked);
    var selected = unlocked && cat.id === selectedId;
    var isNow = !unlocked && index === nextLockedIndex;
    var stateKey = unlocked ? "collection_step_recorded" : isNow ? "collection_step_now" : "collection_step_locked";
    var className = "collection-route-entry " + (unlocked ? "is-recorded" : isNow ? "is-now" : "is-locked");
    var name = unlocked ? getText(cat, "name") : t("collection_slot_locked");
    var copy = unlocked
      ? getText(cat, "breed")
      : isNow
        ? t("collection_next_hint")
        : t("collection_slot_locked");
    var label = unlocked
      ? getText(cat, "name") + " · " + t(stateKey) + " · " + t("collection_slot_click")
      : name + " · " + copy;

    if (selected) {
      className += " is-selected";
    }

    return '<li class="collection-route-step"><button type="button" class="' + className + '" ' +
      (unlocked ? 'data-inspect-collection-cat="' + safe(cat.id) + '" ' : "disabled ") +
      'aria-pressed="' + selected + '" aria-label="' + safe(label) + '">' +
      '<span class="collection-route-state">' + safe(t(stateKey)) + '</span>' +
      renderRouteArt(cat, unlocked) +
      '<span class="collection-route-name">' + safe(name) + '</span>' +
      '<span class="collection-route-copy">' + safe(copy) + '</span>' +
      (index < nextLockedIndex || (nextLockedIndex === -1 && unlocked) ? '<span class="collection-route-check" aria-hidden="true"></span>' : "") +
      '</button></li>';
  }

  function renderMetric(label, value, tone) {
    var safeValue = percent(value);

    return '<div class="collection-record-metric ' + (tone ? "is-" + tone : "") + '"><div class="collection-record-metric-heading"><span>' +
      safe(label) + '</span><strong>' + safeValue + '</strong></div><div class="collection-record-metric-track"><span role="progressbar" aria-label="' +
      safe(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + safeValue + '" style="width:' + safeValue + '%"></span></div></div>';
  }

  function renderSelectedRecord(cat) {
    var pregnancyCountdown = game.systems.collectionSystem.getPregnancyCountdown(cat);
    var age = format.formatAgeYears(game.systems.catSystem.getCatAgeYears(cat));
    var detailMeta = t("gender_label") + "：" + t(cat.gender === "female" ? "gender_female" : "gender_male");

    if (pregnancyCountdown !== null) {
      detailMeta += " · " + t("pregnancy_due") + " " +
        '<span data-pregnancy-countdown data-cat-id="' + safe(cat.id) + '" aria-live="polite">' +
        safe(format.formatDuration(pregnancyCountdown)) + "</span>";
    }

    return '<section class="collection-record" aria-labelledby="collection-record-title"><div class="collection-record-identity">' +
      '<p class="section-eyebrow">' + safe(t("collection_record_label")) + '</p><h3 id="collection-record-title" class="panel-title">' +
      safe(getText(cat, "name")) + '</h3><p class="collection-record-breed">' + safe(getText(cat, "breed")) + " · " + safe(age) +
      '</p><p class="helper-text collection-record-meta">' + detailMeta + '</p></div><div class="collection-record-metrics">' +
      renderMetric(t("cat_bond_label"), cat.intimacy, "bond") +
      renderMetric(t("health_label"), cat.health, "health") +
      renderMetric(t("energy_label"), cat.energy, "energy") +
      '</div><div class="collection-record-actions"><p class="helper-text">' + safe(t("collection_record_copy")) +
      '</p><button type="button" class="primary-button" data-page-target="cats" data-select-cat="' + safe(cat.id) + '">' +
      safe(t("collection_open_cats")) + '</button></div></section>';
  }

  function renderEmptyRecord() {
    return '<section class="collection-record is-empty" aria-labelledby="collection-record-title"><div class="collection-record-identity">' +
      '<p class="section-eyebrow">' + safe(t("collection_record_label")) + '</p><h3 id="collection-record-title" class="panel-title">' +
      safe(t("collection_detail_title")) + '</h3><p class="helper-text">' + safe(t("collection_detail_empty")) + '</p></div></section>';
  }

  function renderCollectionPanel(state) {
    var stats = game.systems.collectionSystem.getCollectionStats();
    var allCats = (state.cats || []).slice();
    var unlockedCats = allCats.filter(function (cat) { return cat.unlocked; });
    var lockedCats = allCats.filter(function (cat) { return !cat.unlocked; });
    var routeCats = unlockedCats.concat(lockedCats);
    var nextLockedIndex = unlockedCats.length < routeCats.length ? unlockedCats.length : -1;
    var selectedCat = unlockedCats.find(function (cat) {
      return cat.id === game.state.collectionInspectCatId;
    }) || unlockedCats[0] || null;
    var total = allCats.length;
    var current = unlockedCats.length;
    var routeMarkup = routeCats.length
      ? routeCats.map(function (cat, index) {
          return renderRouteEntry(cat, selectedCat ? selectedCat.id : "", index, nextLockedIndex);
        }).join("")
      : '<li class="collection-route-empty"><p class="panel-title">' + safe(t("no_cat_data")) + '</p></li>';
    var objectiveCopy = nextLockedIndex === -1 ? t("collection_all_complete") : t("collection_next_copy");

    return '<section class="collection-journal-page" aria-labelledby="collection-journal-title">' +
      '<header class="collection-journal-cover"><div class="collection-journal-heading"><p class="section-eyebrow">' + safe(t("page_collection")) +
      '</p><h2 id="collection-journal-title" class="page-title">' + safe(t("collection_panel_title")) + '</h2><p class="page-copy">' +
      safe(t("collection_panel_copy")) + '</p></div><div class="collection-journal-progress"><div class="collection-journal-progress-heading"><span>' +
      safe(t("collection_progress_label")) + '</span><strong>' + safe(t("collection_progress_value", { current: current, total: total })) +
      '</strong></div>' + renderProgress(current, total) + '<dl class="collection-journal-facts"><div><dt>' + safe(t("collection_total_cats")) +
      '</dt><dd>' + safe(number(stats.totalCats)) + '</dd></div><div><dt>' + safe(t("collection_unique_looks")) + '</dt><dd>' + safe(number(stats.uniqueLooks)) +
      '</dd></div><div><dt>' + safe(t("collection_kittens")) + '</dt><dd>' + safe(number(stats.kittens)) + '</dd></div></dl></div></header>' +
      '<section class="collection-journal-objective" aria-labelledby="collection-objective-title"><div><p class="section-eyebrow">' +
      safe(t("collection_next_label")) + '</p><h3 id="collection-objective-title" class="panel-title">' + safe(t("collection_next_hint")) +
      '</h3><p class="page-copy">' + safe(objectiveCopy) + '</p></div><button type="button" class="primary-button" data-page-target="cats">' +
      safe(t("collection_open_cats")) + '</button></section>' +
      '<section class="collection-route-book" aria-labelledby="collection-route-title"><div class="collection-route-heading"><div><p class="section-eyebrow">' +
      safe(t("collection_route_label")) + '</p><h3 id="collection-route-title" class="page-title">' + safe(t("collection_route_title")) +
      '</h3></div><p class="page-copy">' + safe(t("collection_route_copy")) + '</p></div><ol class="collection-route-track">' + routeMarkup +
      '</ol>' + (selectedCat ? renderSelectedRecord(selectedCat) : renderEmptyRecord()) + '</section></section>';
  }

  game.ui.renderCollectionPanel = renderCollectionPanel;
})(window.CatGame);
