(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function renderJobCard(job, player) {
    var hasActiveWork = Boolean(player.activeWork);
    var activeSleep = game.systems.playerSystem.hasActiveSleep();
    var projected = game.systems.workSystem.getProjectedWorkState(job, player.mood);
    var hungerBlocked = player.hunger >= game.config.playerCondition.hungerBlockThreshold;
    var disabled = !job.unlocked || player.stamina < job.staminaCost || hasActiveWork || hungerBlocked || activeSleep;
    var buttonText = !job.unlocked
      ? t("level_unlock", { level: job.unlockLevel })
      : activeSleep
        ? t("wake_up_first")
        : hungerBlocked
          ? t("work_hunger_blocked")
      : player.stamina < job.staminaCost
        ? t("not_enough_stamina")
        : hasActiveWork
          ? t("current_running")
          : t("start_work");

    return (
      '<article class="work-card">' +
      '<div class="work-row">' +
      '<div><p class="section-eyebrow">' + t("work_opportunity") + '</p><h3 class="panel-title">' +
      format.escapeHtml(getText(job, "name")) +
      "</h3></div>" +
      '<span class="status-pill ' +
      (job.unlocked ? "is-success" : "is-warning") +
      '">' +
      (job.unlocked ? t("unlocked") : t("locked")) +
      "</span></div>" +
      '<p class="page-copy">' +
      format.escapeHtml(getText(job, "description")) +
      "</p>" +
      '<div class="notice-list" style="margin-top: 14px;">' +
      '<div class="notice-item"><p><strong>' + t("realtime_duration") + "</strong></p><p>" +
      projected.durationMinutes +
      " " + t("minutes_unit") +
      (projected.durationMultiplier > 1
        ? " · " + t("work_duration_plus", { percent: Math.round((projected.durationMultiplier - 1) * 100) })
        : "") +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("stamina_cost") + "</strong></p><p>" +
      job.staminaCost +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("mood_cost") + "</strong></p><p>" +
      (job.moodCost || 0) +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("base_reward") + "</strong></p><p>" +
      job.goldReward +
      " " + t("gold_unit") + " / " +
      job.expReward +
      " " + t("exp_unit") + "</p></div>" +
      "</div>" +
      (projected.tier === "burnedOut"
        ? '<p class="warning-copy" style="margin-top: 14px;">' + t("work_low_mood_warning") + "</p>"
        : "") +
      '<div class="inline-row" style="margin-top: 16px;">' +
      '<span class="pill">' + t("total_completed", { count: job.workCount }) + "</span>" +
      '<button class="primary-button" data-job-id="' +
      job.id +
      '" ' +
      (disabled ? "disabled" : "") +
      ">" +
      buttonText +
      "</button></div>" +
      "</article>"
    );
  }

  function renderLastWorkResult(state) {
    var result = state.player.lastWorkResult;

    if (!result) {
      return "";
    }

    return (
      '<section class="page-card">' +
      '<div class="inline-row"><div><p class="section-eyebrow">' + t("work_result_title") + '</p><h3 class="panel-title">' +
      t("work_result_latest") +
      "</h3></div>" +
      '<span class="status-pill ' +
      (result.penaltyApplied ? "is-warning" : "is-success") +
      '">' +
      (result.penaltyApplied ? t("work_penalty_happened") : t("work_penalty_none")) +
      "</span></div>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      '<div class="notice-item"><p><strong>' + t("realtime_duration") + "</strong></p><p>" +
      result.durationMinutes +
      " " + t("minutes_unit") + "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("stamina_change") + "</strong></p><p>" +
      result.staminaChange +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("mood_change") + "</strong></p><p>" +
      result.moodChange +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("gold_result") + "</strong></p><p>+" +
      (typeof result.finalCashGain === "number" ? result.finalCashGain : result.goldEarned) +
      " " + t("gold_unit") + "</p></div>" +
      "</div>" +
      (result.loanAutoPayment > 0
        ? '<p class="helper-text" style="margin-top: 10px;">' +
          t("work_result_loan_auto", {
            deducted: result.loanAutoPayment,
            final: typeof result.finalCashGain === "number" ? result.finalCashGain : result.goldEarned,
          }) +
          "</p>"
        : "") +
      (result.penaltyApplied
        ? '<p class="warning-copy" style="margin-top: 14px;">' +
          t("work_result_penalty", {
            amount: result.penaltyAmount,
            reason: t(result.penaltyReasonKey || "work_penalty_mistake"),
          }) +
          "</p>"
        : '<p class="helper-text" style="margin-top: 14px;">' + t("work_result_normal") + "</p>") +
      "</section>"
    );
  }

  function renderWorkPanel(state) {
    var activeWork = state.player.activeWork;
    var activeJob = activeWork ? game.data.jobMap[activeWork.jobId] || activeWork : null;
    var staminaCountdown = game.systems.timeSystem.getStaminaRecoveryCountdown();
    var moodStatus = game.systems.playerSystem.getMoodStatus(state.player.mood);
    var activeSleep = game.systems.playerSystem.getActiveSleep();
    var hungerCountdown = game.systems.playerSystem.getHungerCountdown();
    var currentHunger = game.systems.playerSystem.getCurrentHunger();

    return (
      '<section class="page-header">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("page_work") + "</p>" +
      '<h2 class="page-title">' + t("work_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("work_panel_copy") + "</p>" +
      (activeSleep
        ? '<p class="warning-copy" style="margin-top: 14px;">' + t("wake_up_first") + "</p>"
        : "") +
      (state.player.mood < game.config.playerCondition.workMoodThresholds.tired
        ? '<p class="warning-copy" style="margin-top: 14px;">' + t("work_low_mood_warning") + "</p>"
        : "") +
      (currentHunger >= game.config.playerCondition.hungerBlockThreshold
        ? '<p class="warning-copy" style="margin-top: 14px;">' + t("work_hunger_warning") + "</p>"
        : "") +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' +
      (activeWork ? t("current_running") : t("work_hint")) +
      "</p>" +
      (activeWork
        ? '<h3 class="panel-title">' +
          format.escapeHtml(getText(activeJob, "name")) +
          '</h3><p class="page-copy">' + t("start_time") + '：' +
          format.escapeHtml(format.formatRealDateTime(activeWork.startedAt)) +
          '</p><p class="page-copy">' + t("expected_finish") + '：' +
          format.escapeHtml(format.formatRealDateTime(activeWork.endsAt)) +
          '</p><p class="helper-text" style="margin-top: 10px;">' + t("remaining") + '：<span data-active-work-remaining>' +
          format.formatDuration(game.systems.workSystem.getRemainingMs(activeWork)) +
          "</span></p>"
        : '<p class="page-copy">' + t("work_panel_copy") + "</p>") +
      '<div class="notice-list" style="margin-top: 16px;">' +
      '<div class="notice-item"><p><strong>' + t("stamina") + "</strong></p><p>" +
      state.player.stamina +
      " / 100</p></div>" +
      '<div class="notice-item"><p><strong>' + t("player_hunger") + "</strong></p><p>" +
      currentHunger +
      " / 100" +
      (hungerCountdown === null
        ? ""
        : " · " + t("player_hunger_next_rise") + ' <span data-player-hunger-countdown>' +
          format.formatDuration(hungerCountdown) +
          "</span>") +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("mood") + "</strong></p><p>" +
      state.player.mood +
      " / 100 · " + t(moodStatus.key) + "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("stamina_recovery_rule") + "</strong></p><p>" +
      (staminaCountdown === null
        ? t("stamina_full")
        : t("stamina_recovery_text", { points: game.config.staminaRecoveryAmount }) +
          ' · <span data-stamina-recovery>' +
          format.formatDuration(staminaCountdown) +
          "</span>") +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("current_level") + "</strong></p><p>Lv." +
      state.player.level +
      "</p></div>" +
      "</div>" +
      "</div>" +
      "</section>" +
      renderLastWorkResult(state) +
      '<section class="work-grid">' +
      state.jobs
        .map(function (job) {
          return renderJobCard(job, state.player);
        })
        .join("") +
      "</section>"
    );
  }

  game.ui.renderWorkPanel = renderWorkPanel;
})(window.CatGame);
