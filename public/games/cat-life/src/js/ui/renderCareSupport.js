(function (game) {
  var t = game.utils.i18n.t;
  var safe = game.utils.format.escapeHtml;

  function renderCareSupport(cat, state) {
    var reason = game.systems.careSystem.rescueReason(cat, state);
    if (!reason) return "";
    var legacy = reason === "legacy";
    var sheltered = reason === "sheltered";
    var label = t(legacy ? "care_legacy_action" : sheltered ? "care_pick_up" : "care_rescue_action");
    return '<section class="care-support-card" aria-label="' + safe(t("care_support_title")) + '">' +
      '<div><p class="section-eyebrow">' + safe(t("care_support_title")) + ' · ' + safe(game.utils.i18n.getDataText(cat, "name")) + '</p><h3 class="panel-title">' +
      safe(t(sheltered ? "care_sheltered" : legacy ? "care_legacy_title" : "care_rescue_title")) + '</h3><p class="page-copy">' +
      safe(t(legacy ? "care_legacy_copy" : sheltered ? "care_sheltered_copy" : "care_rescue_copy")) + '</p></div>' +
      '<button type="button" class="primary-button" data-rescue-cat="' + safe(cat.id) + '">' + safe(label) + '</button></section>';
  }

  function renderReliefMeal(state) {
    if (!game.systems.careSystem.canGetMeal(state)) return "";
    return '<section class="care-support-card" aria-label="' + safe(t("care_meal_title")) + '"><div><h3 class="panel-title">' +
      safe(t("care_meal_title")) + '</h3><p class="page-copy">' + safe(t("care_meal_copy")) + '</p></div>' +
      '<button type="button" class="primary-button" data-care-meal>' + safe(t("care_meal_action")) + '</button></section>';
  }

  game.ui.renderCareSupport = renderCareSupport;
  game.ui.renderReliefMeal = renderReliefMeal;
})(window.CatGame);
