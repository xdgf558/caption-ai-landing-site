(function (game) {
  var clamp = game.utils.format.clamp;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function getJob(jobId) {
    return game.state.game.jobs.find(function (job) {
      return job.id === jobId;
    });
  }

  function refreshJobUnlocks() {
    game.state.game.jobs.forEach(function (job) {
      job.unlocked = game.state.game.player.level >= job.unlockLevel;
    });
  }

  function grantInventoryItem(itemId, amount) {
    var item = game.data.itemMap[itemId];
    var count = amount || 1;
    var field;

    if (!item) {
      return;
    }

    if (item.type === "furniture") {
      if (game.state.game.inventory.furnitureOwned.indexOf(item.id) === -1) {
        game.state.game.inventory.furnitureOwned.push(item.id);
      }
      if (game.systems.homeSystem) {
        game.systems.homeSystem.recalculateComfort();
      }
      return;
    }

    field = item.inventoryField;
    if (typeof game.state.game.inventory[field] !== "number") {
      game.state.game.inventory[field] = 0;
    }
    game.state.game.inventory[field] += count;
  }

  function addExp(amount) {
    var player = game.state.game.player;
    var gained = Math.max(0, amount || 0);
    var messages = [];

    player.exp += gained;

    while (player.exp >= player.level * 100) {
      player.exp -= player.level * 100;
      player.level += 1;
      messages.push(t("level_up_notice", { level: player.level }));
    }

    refreshJobUnlocks();
    return messages;
  }

  function getActiveWork() {
    return game.state.game.player.activeWork;
  }

  function hasActiveWork() {
    return Boolean(getActiveWork());
  }

  function getRemainingMs(activeWork, nowDate) {
    if (!activeWork) {
      return 0;
    }
    return Math.max(0, new Date(activeWork.endsAt).getTime() - new Date(nowDate || Date.now()).getTime());
  }

  function getProjectedWorkState(job, moodValue) {
    var moodProfile = game.systems.playerSystem.getWorkMoodProfile(moodValue);
    var durationMinutes = Math.max(
      1,
      Math.ceil((job.durationMinutes || job.duration || 1) * moodProfile.durationMultiplier)
    );

    return {
      durationMinutes: durationMinutes,
      durationMultiplier: moodProfile.durationMultiplier,
      penaltyChance: moodProfile.penaltyChance,
      tier: moodProfile.tier,
    };
  }

  function buildPenalty(job, moodProfile) {
    var penaltyRange = moodProfile.penaltyRange || [0, 0];
    var ratio;
    var amount;
    var reasonKey = "work_penalty_mistake";

    if (!moodProfile.penaltyChance || !game.utils.random.chance(moodProfile.penaltyChance)) {
      return {
        applied: false,
        amount: 0,
        reasonKey: null,
      };
    }

    ratio = penaltyRange[0] + Math.random() * (penaltyRange[1] - penaltyRange[0]);
    amount = Math.max(1, Math.round(job.goldReward * ratio));

    if (Math.random() < 0.34) {
      reasonKey = "work_penalty_broke";
    } else if (Math.random() < 0.5) {
      reasonKey = "work_penalty_fined";
    }

    return {
      applied: true,
      amount: amount,
      reasonKey: reasonKey,
    };
  }

  function startJob(jobId) {
    var state = game.state.game;
    var player = state.player;
    var job = getJob(jobId);
    var event;
    var moodProfile;
    var projected;
    var penalty;
    var moodCost;
    var baseDuration;
    var baseReward;
    var eventDelta;
    var finalGold;
    var now;
    var endAt;
    var messages = [];

    game.systems.playerSystem.syncPlayerState(game.systems.timeSystem.getNow(), "action");

    if (!job) {
      return { ok: false, message: t("work_missing") };
    }
    if (player.activeWork) {
      return { ok: false, message: t("work_already_running") };
    }
    if (player.activeSleep) {
      return { ok: false, message: t("wake_up_first") };
    }
    if (!job.unlocked) {
      return { ok: false, message: t("work_level_low") };
    }
    if (player.stamina < job.staminaCost) {
      return { ok: false, message: t("not_enough_stamina") };
    }
    if (player.hunger >= game.config.playerCondition.hungerBlockThreshold) {
      return { ok: false, message: t("work_too_hungry") };
    }

    baseDuration = job.durationMinutes || job.duration || 1;
    baseReward = job.goldReward || 0;
    moodCost = job.moodCost || 0;
    moodProfile = game.systems.playerSystem.getWorkMoodProfile(player.mood);
    projected = getProjectedWorkState(job, player.mood);
    event = game.utils.random.pick(job.eventPool) || { text: "", textEn: "", goldDelta: 0 };
    eventDelta = event.goldDelta || 0;
    penalty = buildPenalty(job, moodProfile);
    finalGold = Math.max(0, baseReward + eventDelta - penalty.amount);
    now = game.systems.timeSystem.getNow();
    endAt = new Date(now.getTime() + projected.durationMinutes * 60 * 1000);

    player.stamina = clamp(player.stamina - job.staminaCost, 0, 100);
    player.mood = clamp(player.mood - moodCost, 0, 100);
    player.activeWork = {
      jobId: job.id,
      jobName: job.name,
      jobNameEn: job.nameEn || job.name,
      startedAt: now.toISOString(),
      endsAt: endAt.toISOString(),
      baseDurationMinutes: baseDuration,
      durationMinutes: projected.durationMinutes,
      durationMultiplier: projected.durationMultiplier,
      rewardGold: finalGold,
      baseRewardGold: baseReward,
      eventGoldDelta: eventDelta,
      expReward: job.expReward,
      inGameHours: job.duration || Math.max(1, Math.round((projected.durationMinutes || 1) / 2)),
      eventText: event.text,
      eventTextEn: event.textEn || event.text,
      itemReward: event.itemReward || null,
      itemAmount: event.itemAmount || 0,
      staminaCost: job.staminaCost,
      moodCost: moodCost,
      startedMood: player.mood + moodCost,
      moodTier: moodProfile.tier,
      penaltyApplied: penalty.applied,
      penaltyAmount: penalty.amount,
      penaltyReasonKey: penalty.reasonKey,
    };

    messages.push(
      t("work_started", {
        name: getText(job, "name"),
        minutes: projected.durationMinutes,
      })
    );
    messages.push(
      t("work_start_costs", {
        stamina: job.staminaCost,
        mood: moodCost,
      })
    );

    if (projected.durationMultiplier > 1) {
      messages.push(
        t("work_duration_warning", {
          percent: Math.round((projected.durationMultiplier - 1) * 100),
        })
      );
    }

    if (moodProfile.tier === "burnedOut") {
      messages.push(t("work_low_mood_warning"));
    }

    return {
      ok: true,
      messages: messages,
      forceSave: true,
    };
  }

  function completeStoredWork(activeWork, source) {
    var state = game.state.game;
    var player = state.player;
    var job = getJob(activeWork.jobId);
    var messages = [];
    var lifeAdvanceResult;
    var autoRepayResult = { deducted: 0, netIncome: activeWork.rewardGold, loanCleared: false };

    if (game.systems.playerSystem) {
      lifeAdvanceResult = game.systems.playerSystem.advanceLifeTime(activeWork.inGameHours || 0);
      if (lifeAdvanceResult && lifeAdvanceResult.messages) {
        messages = messages.concat(lifeAdvanceResult.messages);
      }
    }

    if (game.systems.bankSystem) {
      autoRepayResult = game.systems.bankSystem.autoRepayFromWork(activeWork.rewardGold);
    }

    player.gold += autoRepayResult.netIncome;
    player.totalIncome += autoRepayResult.netIncome;
    player.workTimes += 1;
    player.workTimesToday += 1;

    if (job) {
      job.workCount += 1;
    }

    if (activeWork.itemReward) {
      grantInventoryItem(activeWork.itemReward, activeWork.itemAmount || 1);
    }

    messages = messages.concat(addExp(activeWork.expReward));

    player.lastWorkResult = {
      jobId: activeWork.jobId,
      finishedAt: new Date().toISOString(),
      durationMinutes: activeWork.durationMinutes,
      staminaChange: -Math.abs(activeWork.staminaCost || 0),
      moodChange: -Math.abs(activeWork.moodCost || 0),
      goldEarned: activeWork.rewardGold,
      loanAutoPayment: autoRepayResult.deducted,
      finalCashGain: autoRepayResult.netIncome,
      penaltyApplied: Boolean(activeWork.penaltyApplied),
      penaltyAmount: activeWork.penaltyAmount || 0,
      penaltyReasonKey: activeWork.penaltyReasonKey || null,
      moodTier: activeWork.moodTier || "normal",
    };

    if (game.systems.taskSystem) {
      game.systems.taskSystem.refreshAllTasks();
    }

    messages.unshift(
      t(source === "init" ? "work_finished_offline" : "work_finished_now", {
        name: getText(job || activeWork, "name"),
        gold: autoRepayResult.netIncome,
      })
    );
    messages.push(
      t("work_result_summary", {
        minutes: activeWork.durationMinutes,
        stamina: activeWork.staminaCost,
        mood: activeWork.moodCost,
        gold: activeWork.rewardGold,
      })
    );
    if (autoRepayResult.deducted > 0) {
      messages.push(
        t("work_result_loan_auto", {
          deducted: autoRepayResult.deducted,
          final: autoRepayResult.netIncome,
        })
      );
      if (autoRepayResult.loanCleared) {
        messages.push(t("bank_loan_cleared"));
      }
      if (autoRepayResult.messages && autoRepayResult.messages.length) {
        messages = messages.concat(autoRepayResult.messages);
      }
    }

    if (activeWork.durationMultiplier > 1) {
      messages.push(t("work_result_slow", { minutes: activeWork.durationMinutes }));
    } else {
      messages.push(t("work_result_normal"));
    }

    if (activeWork.penaltyApplied) {
      messages.push(
        t("work_result_penalty", {
          amount: activeWork.penaltyAmount,
          reason: t(activeWork.penaltyReasonKey || "work_penalty_mistake"),
        })
      );
    }

    if (activeWork.eventText || activeWork.eventTextEn) {
      messages.push(
        game.utils.i18n.getLanguage() === "zh-CN" ? activeWork.eventText : activeWork.eventTextEn
      );
    }

    if (activeWork.itemReward) {
      messages.push(
        t("work_bonus_item", {
          name: getText(game.data.itemMap[activeWork.itemReward], "name"),
          count: activeWork.itemAmount || 1,
        })
      );
    }

    state.player.activeWork = null;

    return messages;
  }

  function syncActiveWork(nowDate, source) {
    var activeWork = getActiveWork();

    if (!activeWork) {
      return { changed: false, messages: [] };
    }

    if (getRemainingMs(activeWork, nowDate) > 0) {
      return { changed: false, messages: [] };
    }

    return {
      changed: true,
      messages: completeStoredWork(activeWork, source),
      forceSave: true,
    };
  }

  game.systems.workSystem = {
    refreshJobUnlocks: refreshJobUnlocks,
    startJob: startJob,
    addExp: addExp,
    grantInventoryItem: grantInventoryItem,
    getActiveWork: getActiveWork,
    hasActiveWork: hasActiveWork,
    getRemainingMs: getRemainingMs,
    getProjectedWorkState: getProjectedWorkState,
    syncActiveWork: syncActiveWork,
  };
})(window.CatGame);
