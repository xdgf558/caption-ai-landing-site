(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function renderTaskCard(categoryLabel, categoryKey, task) {
    var claimable = task.progress >= task.target && !task.claimed;
    var buttonLabel = task.claimed ? t("task_claimed") : claimable ? t("claim_reward") : t("unfinished");

    return (
      '<article class="task-card ' +
      (task.claimed ? "is-complete" : "") +
      '">' +
      '<p class="section-eyebrow">' +
      format.escapeHtml(categoryLabel) +
      "</p>" +
      '<h3 class="panel-title">' +
      format.escapeHtml(getText(task, "title")) +
      "</h3>" +
      '<p class="page-copy">' +
      format.escapeHtml(getText(task, "description")) +
      "</p>" +
      '<div class="bar-track" style="margin-top: 14px;"><div class="bar-fill ' +
      format.getBarTone(format.toPercent(task.progress, task.target)) +
      '" style="width:' +
      format.toPercent(task.progress, task.target) +
      '%;"></div></div>' +
      '<div class="inline-row" style="margin-top: 10px;"><span class="task-meta">' +
      task.progress +
      " / " +
      task.target +
      '</span><span class="task-meta">' + t("reward") + '：' +
      (task.reward.gold || 0) +
      " " + t("gold_unit") + " / " +
      (task.reward.exp || 0) +
      " " + t("exp_unit") + "</span></div>" +
      '<div class="inline-row" style="margin-top: 16px;">' +
      '<span class="status-pill ' +
      (task.claimed ? "is-success" : claimable ? "is-warning" : "") +
      '">' +
      (task.claimed ? t("task_completed") : claimable ? t("task_claimable") : t("task_in_progress")) +
      "</span>" +
      '<button class="task-button ' +
      (claimable ? "is-claimable" : "") +
      '" data-task-claim="' +
      task.id +
      '" data-task-category="' +
      categoryKey +
      '" ' +
      (!claimable ? "disabled" : "") +
      ">" +
      buttonLabel +
      "</button></div>" +
      "</article>"
    );
  }

  function renderTaskSection(title, categoryKey, list) {
    var displayTitleMap = {
      tutorial: t("tutorial_tasks"),
      daily: t("daily_tasks"),
      achievements: t("achievement_tasks"),
    };

    return (
      '<section class="page-card">' +
      '<div class="inline-row"><div><p class="section-eyebrow">' + t("task_system") + '</p><h3 class="panel-title">' +
      title +
      "</h3></div><span class=\"pill\">" +
      list.filter(function (task) {
        return task.claimed;
      }).length +
      "/" +
      list.length +
      "</span></div>" +
      '<div class="task-grid" style="margin-top: 16px;">' +
      list
        .map(function (task) {
          return renderTaskCard(displayTitleMap[categoryKey], categoryKey, task);
        })
        .join("") +
      "</div></section>"
    );
  }

  function renderTaskPanel(state) {
    return (
      '<section class="page-header">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("page_tasks") + "</p>" +
      '<h2 class="page-title">' + t("tasks_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("tasks_panel_copy") + "</p>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("reset_rules") + "</p>" +
      '<p class="page-copy">' + t("reset_rules_copy") + "</p>" +
      "</div></section>" +
      renderTaskSection(t("tutorial_tasks"), "tutorial", state.tasks.tutorial) +
      renderTaskSection(t("daily_tasks"), "daily", state.tasks.daily) +
      renderTaskSection(t("achievement_tasks"), "achievements", state.tasks.achievements)
    );
  }

  game.ui.renderTaskPanel = renderTaskPanel;
})(window.CatGame);
