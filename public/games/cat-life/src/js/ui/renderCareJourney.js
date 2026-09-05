(function (game) {
  var t = game.utils.i18n.t;
  var safe = game.utils.format.escapeHtml;
  var learning = game.systems.onboardingSystem;

  function renderAction(rec) {
    if (!rec.buttonKey) return "";
    var attributes = "";
    if (rec.kind === "page") attributes = 'data-page-target="' + safe(rec.page) + '"' + (rec.catId ? ' data-select-cat="' + safe(rec.catId) + '"' : "");
    if (rec.kind === "cat") attributes = 'data-cat-action="' + safe(rec.action) + '" data-cat-id="' + safe(rec.catId) + '"';
    if (rec.kind === "rescue") attributes = 'data-rescue-cat="' + safe(rec.catId) + '"';
    if (rec.kind === "treat") attributes = 'data-treat-cat="' + safe(rec.catId) + '"';
    if (rec.kind === "meet") attributes = 'data-learning-meet="' + safe(rec.catId) + '"';
    if (rec.kind === "supplies") attributes = "data-learning-supplies";
    if (rec.kind === "meal") attributes = "data-care-meal";
    if (rec.kind === "sleep") attributes = "data-player-sleep";
    if (rec.kind === "player-item") attributes = 'data-use-player-item="' + safe(rec.itemId) + '"';
    return '<button type="button" class="primary-button" ' + attributes + '>' + safe(t(rec.buttonKey, rec.params)) + '</button>';
  }

  function renderProgress(state) {
    var data = learning.data(state);
    if (!data.eligible) return "";
    var protectedNow = learning.active(state);
    var steps = ["metCat", "fed", "played", "worked"];
    if (!protectedNow && steps.every(function (step) { return data[step]; })) return "";
    var current = steps.find(function (step) { return !data[step]; });
    return '<div class="care-journey-progress"><div class="care-journey-days"><strong>' +
      safe(t("learning_days", { count: data.careDates.length })) + '</strong><span class="care-journey-stamps" aria-hidden="true">' +
      [1, 2, 3].map(function (day) { return '<span class="' + (day <= data.careDates.length ? "is-done" : "") + '">' + day + '</span>'; }).join("") +
      '</span></div><p class="helper-text">' + safe(t(protectedNow ? "learning_protection" : "learning_safety_continues")) +
      '</p><ol class="care-journey-steps" aria-label="' + safe(t("learning_steps")) + '">' +
      steps.map(function (step, index) {
        var done = data[step];
        return '<li data-learning-step="' + step + '" class="' + (done ? "is-done" : step === current ? "is-current" : "") + '"' +
          (step === current ? ' aria-current="step"' : "") + '><span aria-hidden="true">' + (index + 1) +
          '</span><div>' + safe(t("learning_step_" + step)) + '<small>' +
          safe(t(done ? "learning_done" : step === current ? "learning_next" : "learning_later")) + '</small></div></li>';
      }).join("") + '</ol><details class="care-journey-rules"><summary>' + safe(t("learning_rule_label")) +
      '</summary><p class="care-journey-fineprint">' + safe(t("learning_day_rule")) + '</p></details></div>';
  }

  function renderCareJourney(state, cat) {
    var rec = learning.recommendation(state, cat);
    var novice = learning.data(state).eligible && learning.active(state);
    var needsSupport = rec.kind === "rescue" || rec.kind === "meal";
    return '<section class="care-journey' + (cat ? ' is-compact cat-recommendation' : '') +
      (needsSupport ? ' care-support-card' : '') + '" data-care-journey aria-label="' + safe(t("learning_journey")) + '">' +
      '<div class="care-journey-heading"><div><p class="section-eyebrow">' + safe(t(novice ? "learning_journey" : "learning_return")) +
      (rec.params.name ? ' · ' + safe(rec.params.name) : '') + '</p><h3 class="panel-title" tabindex="-1">' + safe(t(rec.titleKey, rec.params)) +
      '</h3><p class="page-copy">' + safe(t(rec.copyKey, rec.params)) + '</p></div>' + renderAction(rec) + '</div>' +
      renderProgress(state) + '</section>';
  }
  game.ui.renderCareJourney = renderCareJourney;
})(window.CatGame);
