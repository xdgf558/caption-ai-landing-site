(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function getJobs(state) {
    return Array.isArray(state.jobs) ? state.jobs : [];
  }

  function getExperienceTarget(level) {
    return Math.max(100, Number(level || 1) * 100);
  }

  function getExperienceProgress(player) {
    var level = Math.max(1, Number(player.level || 1));
    var target = getExperienceTarget(level);
    var current = Math.max(0, Number(player.exp || 0));

    return {
      level: level,
      current: current,
      target: target,
      percent: format.toPercent(current, target),
      nextLevel: level + 1,
    };
  }

  function getExperienceToLevel(player, targetLevel) {
    var currentLevel = Math.max(1, Number(player.level || 1));
    var currentExp = Math.max(0, Number(player.exp || 0));
    var total = 0;
    var level;

    if (targetLevel <= currentLevel) {
      return 0;
    }

    total = Math.max(0, getExperienceTarget(currentLevel) - currentExp);
    for (level = currentLevel + 1; level < targetLevel; level += 1) {
      total += getExperienceTarget(level);
    }
    return total;
  }

  function getNextUnlock(jobs, player) {
    return jobs
      .slice()
      .sort(function (first, second) {
        return first.unlockLevel - second.unlockLevel;
      })
      .find(function (job) {
        return Number(job.unlockLevel || 1) > Number(player.level || 1) || !job.unlocked;
      }) || null;
  }

  function getSelectedJob(state, jobs) {
    var activeWork = state.player.activeWork;
    var activeJob;
    var selectedJob;

    if (activeWork) {
      activeJob = jobs.find(function (job) {
        return job.id === activeWork.jobId;
      });
      if (activeJob) {
        return activeJob;
      }
    }

    selectedJob = jobs.find(function (job) {
      return job.id === game.state.workJobId;
    });
    if (selectedJob) {
      return selectedJob;
    }

    return jobs.find(function (job) {
      return job.unlocked;
    }) || jobs[0] || null;
  }

  function getShiftLabel(player, activeWork) {
    var hour = Number(player.currentHour || 8);

    if (activeWork) {
      return t("work_shift_active");
    }
    if (hour < 12) {
      return t("work_shift_morning");
    }
    if (hour < 18) {
      return t("work_shift_afternoon");
    }
    return t("work_shift_evening");
  }

  function getWorkProgress(activeWork, nowDate) {
    var startedAt = activeWork ? new Date(activeWork.startedAt).getTime() : 0;
    var endsAt = activeWork ? new Date(activeWork.endsAt).getTime() : 0;
    var now = (nowDate || new Date()).getTime();

    if (!activeWork || !Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) {
      return 0;
    }
    return format.toPercent(now - startedAt, endsAt - startedAt);
  }

  function getActionState(job, player, activeWork, activeSleep, hunger) {
    if (!job.unlocked) {
      return {
        disabled: true,
        label: t("level_unlock", { level: job.unlockLevel }),
        reason: t("work_start_locked_hint", { level: job.unlockLevel }),
      };
    }
    if (activeSleep) {
      return {
        disabled: true,
        label: t("wake_up_first"),
        reason: t("work_start_sleep_hint"),
      };
    }
    if (hunger >= game.config.playerCondition.hungerBlockThreshold) {
      return {
        disabled: true,
        label: t("work_hunger_blocked"),
        reason: t("work_start_hunger_hint"),
      };
    }
    if (player.stamina < job.staminaCost) {
      return {
        disabled: true,
        label: t("not_enough_stamina"),
        reason: t("work_start_stamina_hint"),
      };
    }
    if (activeWork) {
      return {
        disabled: true,
        label: t("current_running"),
        reason: t("work_start_active_hint"),
      };
    }
    return {
      disabled: false,
      label: t("start_work"),
      reason: t("work_start_ready_hint"),
    };
  }

  function renderWorkMetric(label, value, detail, tone) {
    return (
      '<div class="work-metric ' + (tone || "") + '"><strong>' + format.escapeHtml(String(value)) +
      '</strong><span>' + format.escapeHtml(label) + '</span><small>' + format.escapeHtml(detail) + "</small></div>"
    );
  }

  function renderWorkScene(job, activeWork) {
    var trustedJob = game.data.jobMap[job.id] || job;
    var jobIcon = trustedJob.iconPath || "./src/assets/jobs/job-flyer.svg";
    var isFlyer = job.id === "job_flyer";
    var status = activeWork ? t("work_scene_active") : t("work_scene_ready");

    return (
      '<div class="work-scene ' + (activeWork ? "is-active" : "is-ready") + '" data-work-scene>' +
      (isFlyer
        ? '<img class="work-scene-backdrop" src="./src/assets/work/work-shift-flyer.jpg" alt="" width="960" height="720" decoding="async">'
        : '<div class="work-scene-icon-frame"><img src="' + format.escapeHtml(jobIcon) + '" alt="" width="92" height="92" decoding="async"></div>') +
      (!isFlyer
        ? '<img class="work-scene-cat" src="./src/assets/cats/orange-tabby-walk.png" alt="" width="512" height="341" decoding="async">'
        : "") +
      '<span class="work-scene-status ' + (activeWork ? "is-active" : "") + '" data-work-live-status aria-live="polite">' +
      status +
      "</span></div>"
    );
  }

  function renderWorkAction(job, player, activeWork, activeSleep, hunger) {
    var action = getActionState(job, player, activeWork, activeSleep, hunger);
    var progress = getWorkProgress(activeWork);

    if (activeWork) {
      return (
        '<div class="work-live-panel" aria-live="polite">' +
        '<div class="work-live-heading"><div><p class="section-eyebrow">' + t("work_active_progress") +
        '</p><strong data-active-work-remaining>' + format.formatDuration(game.systems.workSystem.getRemainingMs(activeWork)) +
        '</strong></div><span class="status-pill is-success" data-work-live-status>' + t("work_scene_active") +
        "</span></div>" +
        '<div class="work-progress-track"><div class="work-progress-fill" data-active-work-progress role="progressbar" aria-label="' +
        format.escapeHtml(t("work_active_progress")) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
        progress + '" style="width:' + progress + '%"></div></div>' +
        '<p class="work-live-copy">' + t("work_active_copy") + "</p>" +
        '<dl class="work-live-meta"><div><dt>' + t("work_active_started") + '</dt><dd>' +
        format.escapeHtml(format.formatRealDateTime(activeWork.startedAt)) +
        '</dd></div><div><dt>' + t("work_active_finish") + '</dt><dd>' +
        format.escapeHtml(format.formatRealDateTime(activeWork.endsAt)) +
        "</dd></div></dl></div>"
      );
    }

    return (
      '<div class="work-action-panel"><p class="section-eyebrow">' + t("work_start_reason") +
      '</p><button class="primary-button work-start-button" type="button" data-job-id="' +
      format.escapeHtml(job.id) + '" aria-describedby="work-action-note" ' + (action.disabled ? "disabled" : "") + ">" +
      action.label +
      '</button><p class="work-action-note ' + (action.disabled ? "is-blocked" : "") + '" id="work-action-note">' +
      action.reason + "</p></div>"
    );
  }

  function renderGrowthCard(player) {
    var progress = getExperienceProgress(player);

    return (
      '<section class="work-growth-card page-card">' +
      '<div class="work-card-heading"><div><p class="section-eyebrow">' + t("work_growth_title") +
      '</p><h3 class="panel-title">' + t("work_level_label") + '</h3></div>' +
      '<span class="work-level-badge">Lv.' + progress.level + "</span></div>" +
      '<div class="work-exp-line"><span>' + t("work_exp_label") + '</span><strong data-work-exp-current>' +
      format.formatNumber(progress.current) + " / " + format.formatNumber(progress.target) + " " + t("exp_unit") +
      '</strong></div><div class="work-exp-track"><div class="work-exp-fill" data-work-exp-bar role="progressbar" aria-label="' +
      format.escapeHtml(t("work_exp_label")) + '" aria-valuemin="0" aria-valuemax="' + progress.target +
      '" aria-valuenow="' + progress.current + '" style="width:' + progress.percent + '%"></div></div>' +
      '<p class="work-exp-copy" data-work-exp-copy>' + t("work_exp_to_level", {
        level: progress.nextLevel,
        amount: format.formatNumber(Math.max(0, progress.target - progress.current)),
      }) + "</p></section>"
    );
  }

  function renderNextUnlockCard(nextJob, player) {
    if (!nextJob) {
      return (
        '<section class="work-unlock-card page-card is-complete"><p class="section-eyebrow">' +
        t("work_next_unlock_title") + '</p><h3 class="panel-title">' + t("work_unlock_none") +
        '</h3><p class="page-copy">' + t("work_unlock_ready") + "</p></section>"
      );
    }

    var trustedJob = game.data.jobMap[nextJob.id] || nextJob;
    var required = getExperienceToLevel(player, Number(nextJob.unlockLevel || 1));
    var jobIcon = trustedJob.iconPath || "./src/assets/jobs/job-flyer.svg";

    return (
      '<section class="work-unlock-card page-card"><div class="work-card-heading"><div><p class="section-eyebrow">' +
      t("work_next_unlock_title") + '</p><h3 class="panel-title">' +
      format.escapeHtml(getText(nextJob, "name")) +
      '</h3></div><img class="work-unlock-icon" src="' + format.escapeHtml(jobIcon) + '" alt="" width="42" height="42" decoding="async"></div>' +
      '<div class="work-unlock-line"><span class="status-pill is-warning">' + t("work_unlock_at", { level: nextJob.unlockLevel }) +
      '</span><strong>' + t("work_exp_to_unlock", { amount: format.formatNumber(required) }) +
      '</strong></div><p class="page-copy">' + format.escapeHtml(getText(nextJob, "description")) + "</p></section>"
    );
  }

  function renderSelectedJob(job, state, activeWork, activeSleep, hunger) {
    var player = state.player;
    var projected = game.systems.workSystem.getProjectedWorkState(job, player.mood);
    var displayReward = activeWork && typeof activeWork.rewardGold === "number" ? activeWork.rewardGold : job.goldReward;
    var jobStatus = activeWork ? t("work_scene_active") : job.unlocked ? t("work_ready") : t("locked");

    return (
      '<section class="work-selected-card ' + (activeWork ? "is-active" : "") + '">' +
      '<div class="work-selected-visual">' + renderWorkScene(job, activeWork) + "</div>" +
      '<div class="work-selected-copy"><div class="work-selected-heading"><div><p class="section-eyebrow">' +
      (activeWork ? t("current_running") : t("work_selection_label")) +
      '</p><h3 class="panel-title">' + format.escapeHtml(getText(job, "name")) + '</h3></div>' +
      '<span class="status-pill ' + (activeWork || job.unlocked ? "is-success" : "is-warning") + '">' + jobStatus +
      '</span></div><p class="page-copy">' + format.escapeHtml(getText(job, "description")) +
      '</p><div class="work-metric-strip">' +
      renderWorkMetric(t("realtime_duration"), projected.durationMinutes + " " + t("minutes_unit"), t("work_metric_duration")) +
      renderWorkMetric(t("stamina_cost"), "-" + job.staminaCost, t("work_metric_stamina"), "is-cost") +
      renderWorkMetric(t("mood_cost"), "-" + (job.moodCost || 0), t("work_metric_mood"), "is-cost") +
      renderWorkMetric(t("gold_result"), "+" + displayReward, t("work_metric_reward"), "is-reward") +
      renderWorkMetric(t("experience"), "+" + job.expReward, t("work_metric_exp"), "is-exp") +
      "</div>" + renderWorkAction(job, player, activeWork, activeSleep, hunger) + "</div></section>"
    );
  }

  function getVisibleJobs(jobs) {
    var filter = game.state.workFilter || "all";

    if (filter === "unlocked") {
      return jobs.filter(function (job) {
        return job.unlocked;
      });
    }
    if (filter === "locked") {
      return jobs.filter(function (job) {
        return !job.unlocked;
      });
    }
    return jobs;
  }

  function renderRosterRow(job, index, selectedJob) {
    var trustedJob = game.data.jobMap[job.id] || job;
    var jobIcon = trustedJob.iconPath || "./src/assets/jobs/job-flyer.svg";
    var isSelected = selectedJob && selectedJob.id === job.id;
    var statusText = isSelected
      ? t("work_roster_selected")
      : job.unlocked
        ? t("unlocked")
        : t("level_unlock", { level: job.unlockLevel });

    return (
      '<button class="work-roster-row ' + (isSelected ? "is-selected " : "") + (!job.unlocked ? "is-locked" : "") +
      '" type="button" data-select-work-job="' + format.escapeHtml(job.id) + '" aria-pressed="' +
      (isSelected ? "true" : "false") + '" aria-label="' + format.escapeHtml(getText(job, "name") + " · " + statusText) + '">' +
      '<span class="work-roster-index">' + (index + 1) + '</span><span class="work-roster-icon"><img src="' +
      format.escapeHtml(jobIcon) + '" alt="" width="30" height="30" decoding="async"></span>' +
      '<span class="work-roster-name"><strong>' + format.escapeHtml(getText(job, "name")) +
      '</strong><small>' + format.escapeHtml(getText(job, "description")) +
      '</small></span><span class="work-roster-stat"><strong>' + projectedDuration(job) +
      '</strong><small>' + t("minutes_unit") + '</small></span>' +
      '<span class="work-roster-stat is-cost"><strong>- ' + job.staminaCost +
      '</strong><small>' + t("stamina_cost") + '</small></span><span class="work-roster-stat is-reward"><strong>+' +
      job.goldReward + '</strong><small>' + t("gold_unit") + '</small></span><span class="work-roster-stat is-exp"><strong>+' +
      job.expReward + '</strong><small>' + t("exp_unit") + '</small></span>' +
      '<span class="work-roster-state ' + (job.unlocked ? "is-open" : "is-locked") + '">' + statusText + "</span></button>"
    );
  }

  function projectedDuration(job) {
    return job.durationMinutes || job.duration || 1;
  }

  function renderRoster(jobs, selectedJob) {
    var visibleJobs = getVisibleJobs(jobs);
    var filter = game.state.workFilter || "all";

    return (
      '<section class="work-roster page-card"><div class="work-roster-heading"><div><p class="section-eyebrow">' +
      t("work_roster_title") + '</p><h3 class="panel-title">' + t("work_roster_copy") +
      '</h3></div><div class="work-filter" role="group" aria-label="' + format.escapeHtml(t("work_roster_title")) + '">' +
      ['all', 'unlocked', 'locked'].map(function (key) {
        return '<button class="work-filter-button ' + (filter === key ? "is-active" : "") + '" type="button" data-work-filter="' +
          key + '" aria-pressed="' + (filter === key ? "true" : "false") + '">' + t("work_filter_" + key) + "</button>";
      }).join("") +
      '</div></div><div class="work-roster-head" aria-hidden="true"><span></span><span></span><span>' + t("work_opportunity") +
      '</span><span>' + t("realtime_duration") + '</span><span>' + t("stamina_cost") + '</span><span>' +
      t("gold_result") + '</span><span>' + t("experience") + '</span><span></span></div>' +
      (visibleJobs.length
        ? '<div class="work-roster-list">' + visibleJobs.map(function (job, index) {
          return renderRosterRow(job, index, selectedJob);
        }).join("") + "</div>"
        : '<p class="empty-state work-empty-state">' + t("work_no_jobs_filter") + "</p>") +
      "</section>"
    );
  }

  function renderLastWorkResult(state) {
    var result = state.player.lastWorkResult;
    var job = result ? game.data.jobMap[result.jobId] : null;

    if (!result) {
      return "";
    }

    return (
      '<section class="work-result-card page-card"><div class="work-result-heading"><div><p class="section-eyebrow">' +
      t("work_result_title") + '</p><h3 class="panel-title">' + t("work_result_latest") +
      '</h3></div><span class="status-pill ' + (result.penaltyApplied ? "is-warning" : "is-success") + '">' +
      (result.penaltyApplied ? t("work_penalty_happened") : t("work_penalty_none")) +
      '</span></div><p class="page-copy">' + format.escapeHtml(job ? getText(job, "name") : "") +
      '</p><div class="work-result-stats">' +
      renderWorkMetric(t("realtime_duration"), result.durationMinutes + " " + t("minutes_unit"), t("work_metric_duration")) +
      renderWorkMetric(t("stamina_change"), result.staminaChange, t("work_metric_stamina"), "is-cost") +
      renderWorkMetric(t("mood_change"), result.moodChange, t("work_metric_mood"), "is-cost") +
      renderWorkMetric(t("gold_result"), "+" + (typeof result.finalCashGain === "number" ? result.finalCashGain : result.goldEarned), t("work_metric_reward"), "is-reward") +
      "</div>" +
      (result.penaltyApplied
        ? '<p class="warning-copy work-result-copy">' + t("work_result_penalty", {
          amount: result.penaltyAmount,
          reason: t(result.penaltyReasonKey || "work_penalty_mistake"),
        }) + "</p>"
        : '<p class="helper-text work-result-copy">' + t("work_result_normal") + "</p>") +
      "</section>"
    );
  }

  function renderWorkPanel(state) {
    var jobs = getJobs(state);
    var activeWork = state.player.activeWork;
    var activeJob = activeWork ? jobs.find(function (job) {
      return job.id === activeWork.jobId;
    }) : null;
    var selectedJob = activeJob || getSelectedJob(state, jobs);
    var activeSleep = game.systems.playerSystem.getActiveSleep();
    var hunger = game.systems.playerSystem.getCurrentHunger();
    var nextUnlock = getNextUnlock(jobs, state.player);
    var date = format.formatDateKey();

    if (!selectedJob) {
      return '<section class="page-card"><p class="empty-state">' + t("work_no_jobs_filter") + "</p></section>";
    }

    return (
      '<section class="work-planner-page"><div class="work-planner-top"><section class="work-shift-board page-card ' +
      (activeWork ? "is-active" : "") + '"><div class="work-board-heading"><div><p class="section-eyebrow">' +
      t("work_planner_kicker") + '</p><h2 class="page-title">' + t("work_planner_title") +
      '</h2><p class="page-copy">' + t("work_planner_copy") +
      '</p></div><dl class="work-board-date"><div><dt>' + t("work_date_label") + '</dt><dd>' + date +
      '</dd></div><div><dt>' + t("work_shift_label") + '</dt><dd>' + getShiftLabel(state.player, activeWork) +
      "</dd></div></dl></div>" +
      renderSelectedJob(selectedJob, state, activeWork, activeSleep, hunger) +
      '</section><aside class="work-progress-rail">' + renderGrowthCard(state.player) +
      renderNextUnlockCard(nextUnlock, state.player) + "</aside></div>" +
      renderRoster(jobs, selectedJob) +
      renderLastWorkResult(state) +
      "</section>"
    );
  }

  game.ui.renderWorkPanel = renderWorkPanel;
})(window.CatGame);
