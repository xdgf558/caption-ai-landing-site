(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function renderBar(label, value, options) {
    var safeValue = Math.max(0, Math.min(100, Math.round(value || 0)));
    var isDanger = options && options.inverseTone ? safeValue >= 70 : safeValue <= 25;
    var valueAttribute = options && options.valueAttribute ? " " + options.valueAttribute : "";
    var barAttribute = options && options.barAttribute ? " " + options.barAttribute : "";
    return (
      '<div class="stat-row"><div class="stat-row-heading"><span class="stat-label">' + label +
      '</span><strong' + valueAttribute + '>' + safeValue + '</strong></div><div class="bar-track"><div class="bar-fill ' +
      (isDanger ? "is-danger" : "is-normal") + '"' + barAttribute + ' style="width:' + safeValue + '%"></div></div></div>'
    );
  }

  function renderTaskBadge(title, current, total) {
    var percent = format.toPercent(current, total);
    return (
      '<div class="task-brief"><div class="task-brief-line"><strong>' + format.escapeHtml(title) +
      '</strong><span>' + current + ' / ' + total + '</span></div><div class="bar-track"><div class="bar-fill is-normal" style="width:' +
      percent + '%"></div></div></div>'
    );
  }

  function getConditionCopy(displayStats, hunger) {
    var hungerBlockThreshold = game.config.playerCondition.hungerBlockThreshold;
    if (displayStats.mood < 35) {
      return t("work_low_mood_warning");
    }
    if (hunger >= hungerBlockThreshold) {
      return t("work_hunger_warning");
    }
    return t("player_status_copy");
  }

  function renderHeader(state) {
    var player = state.player;
    var displayStats = game.systems.playerSystem.getDisplayStats();
    var hunger = game.systems.playerSystem.getCurrentHunger();
    var activeWork = player.activeWork;
    var activeJob = activeWork ? game.data.jobMap[activeWork.jobId] || activeWork : null;
    var activeSleep = game.systems.playerSystem.getActiveSleep();
    var sleepRecovery = game.systems.playerSystem.getSleepRecovery();

    return (
      '<div class="masthead-rule is-heavy"></div>' +
      '<div class="masthead"><div class="masthead-title"><h1>' + t("brandTitle") +
      '</h1><span>' + t("masthead_edition") + '</span></div><div class="masthead-meta"><span>' +
      t("day_label", { day: player.currentDay || 1 }) + '</span><span data-live-clock>' + format.formatGameTime() +
      '</span><span>v' + format.escapeHtml(game.config.version) + '</span></div></div>' +
      '<div class="masthead-rule is-fine"></div>' +
      '<div class="statusbar"><div class="cash-block"><span>' + t("cash_outside_bank") +
      '</span><strong>' + format.formatNumber(player.gold) + ' ' + t("gold_unit") + '</strong></div><div class="statusbar-stats">' +
      renderBar(t("stamina"), displayStats.stamina, {
        valueAttribute: "data-player-stamina-live",
        barAttribute: "data-player-stamina-bar",
      }) +
      renderBar(t("mood"), displayStats.mood, {
        valueAttribute: "data-player-mood-live",
        barAttribute: "data-player-mood-bar",
      }) +
      renderBar(t("player_hunger"), hunger, {
        inverseTone: true,
        valueAttribute: "data-player-hunger-live",
        barAttribute: "data-player-hunger-bar",
      }) +
      '</div><div class="statusbar-tools"><div class="statusbar-note"><span data-player-condition-copy>' +
      getConditionCopy(displayStats, hunger) + '</span>' +
      (activeWork ? '<strong>' + format.escapeHtml(getText(activeJob, "name")) + ' · <span data-active-work-remaining>' +
        format.formatDuration(game.systems.workSystem.getRemainingMs(activeWork)) + '</span></strong>' : '') +
      '</div><button class="secondary-button sleep-control" data-player-sleep>' +
      (activeSleep ? t("wake_action") : t("sleep_action")) + '</button><span class="sleep-live-copy">' +
      (activeSleep
        ? t("sleeping_now") + ' · <span data-player-sleep-duration>' + format.formatDuration(sleepRecovery.elapsedMs) + '</span>'
        : t("sleep_ready_copy")) +
      '</span></div></div><div class="masthead-rule is-medium"></div>'
    );
  }

  game.ui.helpers = {
    renderBar: renderBar,
    renderTaskBadge: renderTaskBadge,
  };
  game.ui.renderHeader = renderHeader;
})(window.CatGame);
