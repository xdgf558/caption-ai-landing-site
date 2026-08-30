(function (game) {
  var clamp = game.utils.format.clamp;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function getPlayer() {
    return game.state.game.player;
  }

  function getConditionConfig() {
    return game.config.playerCondition;
  }

  function clampPlayerValue(value) {
    var config = getConditionConfig();
    return clamp(value, config.min, config.max);
  }

  function roundValue(value) {
    return Math.round(Number(value || 0) * 10) / 10;
  }

  function getMoodStatus(moodValue) {
    var mood = typeof moodValue === "number" ? moodValue : getPlayer().mood;

    return getConditionConfig().moodLevels.find(function (entry) {
      return mood >= entry.min;
    }) || getConditionConfig().moodLevels[getConditionConfig().moodLevels.length - 1];
  }

  function getWorkMoodProfile(moodValue) {
    var mood = typeof moodValue === "number" ? moodValue : getPlayer().mood;
    var thresholds = getConditionConfig().workMoodThresholds;
    var modifiers = getConditionConfig().workMoodModifiers;

    if (mood >= thresholds.normal) {
      return {
        tier: "normal",
        durationMultiplier: modifiers.normal.durationMultiplier,
        penaltyChance: modifiers.normal.penaltyChance,
        penaltyRange: modifiers.normal.penaltyRange,
      };
    }

    if (mood >= thresholds.tired) {
      return {
        tier: "tired",
        durationMultiplier: modifiers.tired.durationMultiplier,
        penaltyChance: modifiers.tired.penaltyChance,
        penaltyRange: modifiers.tired.penaltyRange,
      };
    }

    return {
      tier: "burnedOut",
      durationMultiplier: modifiers.burnedOut.durationMultiplier,
      penaltyChance: modifiers.burnedOut.penaltyChance,
      penaltyRange: modifiers.burnedOut.penaltyRange,
    };
  }

  function getInventoryCount(itemId) {
    var item = game.data.itemMap[itemId];

    if (!item || !item.inventoryField) {
      return 0;
    }

    return Number(game.state.game.inventory[item.inventoryField] || 0);
  }

  function getPlayerConsumables() {
    return game.data.items.filter(function (item) {
      return item.type === "playerConsumable";
    });
  }

  function getPlayerConsumablesByCategory(category) {
    return getPlayerConsumables().filter(function (item) {
      return item.category === category;
    });
  }

  function hasActiveSleep() {
    return Boolean(getPlayer().activeSleep);
  }

  function getActiveSleep() {
    return getPlayer().activeSleep;
  }

  function getDisplayStats(nowDate) {
    var now = nowDate || game.systems.timeSystem.getNow();
    var player = getPlayer();
    var activeSleep = player.activeSleep;
    var elapsedHours;
    var staminaGain;
    var moodGain;

    if (!activeSleep) {
      return {
        stamina: player.stamina,
        mood: player.mood,
        hunger: player.hunger,
      };
    }

    elapsedHours = Math.max(0, now.getTime() - new Date(activeSleep.startedAt).getTime()) / (60 * 60 * 1000);
    staminaGain = Math.min(
      getConditionConfig().max - activeSleep.baseStamina,
      elapsedHours * getConditionConfig().sleepRecoveryPerHour.stamina
    );
    moodGain = Math.min(
      getConditionConfig().max - activeSleep.baseMood,
      elapsedHours * getConditionConfig().sleepRecoveryPerHour.mood
    );

    return {
      stamina: clampPlayerValue(activeSleep.baseStamina + staminaGain),
      mood: clampPlayerValue(activeSleep.baseMood + moodGain),
      hunger: player.hunger,
    };
  }

  function getSleepElapsedMs(nowDate) {
    var activeSleep = getActiveSleep();
    var now = nowDate || game.systems.timeSystem.getNow();

    if (!activeSleep) {
      return 0;
    }

    return Math.max(0, now.getTime() - new Date(activeSleep.startedAt).getTime());
  }

  function getSleepRecovery(nowDate) {
    var player = getPlayer();
    var activeSleep = player.activeSleep;
    var now = nowDate || game.systems.timeSystem.getNow();
    var elapsedHours;
    var staminaGain;
    var moodGain;

    if (!activeSleep) {
      return {
        elapsedMs: 0,
        staminaGain: 0,
        moodGain: 0,
        currentStamina: player.stamina,
        currentMood: player.mood,
      };
    }

    elapsedHours = getSleepElapsedMs(now) / (60 * 60 * 1000);
    staminaGain = Math.min(
      getConditionConfig().max - activeSleep.baseStamina,
      elapsedHours * getConditionConfig().sleepRecoveryPerHour.stamina
    );
    moodGain = Math.min(
      getConditionConfig().max - activeSleep.baseMood,
      elapsedHours * getConditionConfig().sleepRecoveryPerHour.mood
    );

    return {
      elapsedMs: getSleepElapsedMs(now),
      staminaGain: roundValue(staminaGain),
      moodGain: roundValue(moodGain),
      currentStamina: roundValue(clampPlayerValue(activeSleep.baseStamina + staminaGain)),
      currentMood: roundValue(clampPlayerValue(activeSleep.baseMood + moodGain)),
    };
  }

  function getCurrentHunger(nowDate) {
    var player = getPlayer();
    var now = nowDate || game.systems.timeSystem.getNow();
    var updatedAt = player.hungerUpdatedAt ? new Date(player.hungerUpdatedAt).getTime() : now.getTime();
    var elapsed = Math.max(0, now.getTime() - updatedAt);
    var steps = Math.floor(elapsed / getConditionConfig().hungerIncreaseIntervalMs);

    return clampPlayerValue(player.hunger + steps * getConditionConfig().hungerIncreaseAmount);
  }

  function getHungerCountdown(nowDate) {
    var player = getPlayer();
    var now = nowDate || game.systems.timeSystem.getNow();
    var elapsed;

    if (!player.hungerUpdatedAt || player.hunger >= getConditionConfig().max) {
      return null;
    }

    elapsed = Math.max(0, now.getTime() - new Date(player.hungerUpdatedAt).getTime());
    return getConditionConfig().hungerIncreaseIntervalMs - (elapsed % getConditionConfig().hungerIncreaseIntervalMs || 0);
  }

  function getHungerBlockEta(nowDate) {
    var hunger = getCurrentHunger(nowDate);
    var threshold = getConditionConfig().hungerBlockThreshold;
    var countdown = getHungerCountdown(nowDate);

    if (hunger >= threshold || countdown === null) {
      return null;
    }

    return countdown + Math.max(0, threshold - hunger - getConditionConfig().hungerIncreaseAmount) *
      (getConditionConfig().hungerIncreaseIntervalMs / getConditionConfig().hungerIncreaseAmount);
  }

  function syncPlayerState(nowDate, source) {
    var now = nowDate || game.systems.timeSystem.getNow();
    var player = getPlayer();
    var previousHunger = player.hunger;
    var nextHunger = getCurrentHunger(now);
    var changed = false;
    var messages = [];

    if (!player.hungerUpdatedAt) {
      player.hungerUpdatedAt = now.toISOString();
      return {
        changed: false,
        messages: [],
      };
    }

    if (nextHunger !== player.hunger) {
      player.hunger = nextHunger;
      player.hungerUpdatedAt = now.toISOString();
      changed = true;

      if (
        source !== "timer" &&
        previousHunger < getConditionConfig().hungerBlockThreshold &&
        player.hunger >= getConditionConfig().hungerBlockThreshold
      ) {
        messages.push(t("work_hunger_warning"));
      }
    }

    return {
      changed: changed,
      messages: messages,
    };
  }

  function advanceLifeTime(hours) {
    var player = getPlayer();
    var safeHours = Math.max(0, Number(hours || 0));
    var previousDay = Math.floor(player.currentDay || 1);
    var currentHour = Number(player.currentHour || 0);
    var totalHours = currentHour + safeHours;
    var dayAdvance = Math.floor(totalHours / 24);
    var nextHour = totalHours % 24;
    var nextDay = previousDay + dayAdvance;

    player.currentHour = roundValue(nextHour);
    player.currentDay = nextDay;

    if (game.systems.bankSystem) {
      return game.systems.bankSystem.syncLoanInterestForDayChange(previousDay, nextDay);
    }

    return {
      changed: dayAdvance > 0,
      messages: [],
      daysPassed: dayAdvance,
    };
  }

  function startSleep() {
    var player = getPlayer();
    var now = game.systems.timeSystem.getNow();

    if (player.activeWork) {
      return {
        ok: false,
        message: t("sleep_blocked_work"),
      };
    }

    if (player.activeSleep) {
      return {
        ok: false,
        message: t("sleep_already_active"),
      };
    }

    player.activeSleep = {
      startedAt: now.toISOString(),
      baseStamina: player.stamina,
      baseMood: player.mood,
    };

    return {
      ok: true,
      forceSave: true,
      messages: [
        t("sleep_started"),
        t("sleep_started_rate", {
          stamina: getConditionConfig().sleepRecoveryPerHour.stamina,
          mood: getConditionConfig().sleepRecoveryPerHour.mood,
        }),
      ],
    };
  }

  function wakeUp() {
    var player = getPlayer();
    var recovery;
    var now;
    var lifeAdvanceResult;
    var messages = [];

    if (!player.activeSleep) {
      return {
        ok: false,
        message: t("sleep_not_active"),
      };
    }

    now = game.systems.timeSystem.getNow();
    recovery = getSleepRecovery(now);
    player.stamina = recovery.currentStamina;
    player.mood = recovery.currentMood;
    player.staminaUpdatedAt = now.toISOString();
    player.lastSleepAt = now.toISOString();
    lifeAdvanceResult = advanceLifeTime(recovery.elapsedMs / (60 * 60 * 1000));
    player.activeSleep = null;

    if (lifeAdvanceResult && lifeAdvanceResult.messages) {
      messages = messages.concat(lifeAdvanceResult.messages);
    }
    messages.unshift(
      t("sleep_summary", {
        stamina: recovery.staminaGain,
        mood: recovery.moodGain,
        duration: game.utils.format.formatDuration(recovery.elapsedMs),
      })
    );
    messages.unshift(t("sleep_success"));

    return {
      ok: true,
      forceSave: true,
      messages: messages,
    };
  }

  function sleep() {
    if (hasActiveSleep()) {
      return wakeUp();
    }
    return startSleep();
  }

  function consumeItem(itemId) {
    var item = game.data.itemMap[itemId];
    var player = getPlayer();
    var currentCount;
    var staminaBefore;
    var moodBefore;
    var hungerBefore;
    var staminaGain;
    var moodGain;
    var hungerReduce;
    var now = game.systems.timeSystem.getNow();

    if (!item || item.type !== "playerConsumable") {
      return {
        ok: false,
        message: t("player_item_invalid"),
      };
    }

    if (player.activeSleep) {
      return {
        ok: false,
        message: t("sleep_action_blocked"),
      };
    }

    syncPlayerState(now, "action");

    currentCount = getInventoryCount(itemId);
    if (currentCount <= 0) {
      return {
        ok: false,
        message: t("player_item_empty", { name: getText(item, "name") }),
      };
    }

    staminaBefore = player.stamina;
    moodBefore = player.mood;
    hungerBefore = player.hunger;

    game.state.game.inventory[item.inventoryField] = currentCount - 1;
    player.stamina = clampPlayerValue(player.stamina + (item.staminaRestore || 0));
    player.mood = clampPlayerValue(player.mood + (item.moodRestore || 0));
    player.hunger = clampPlayerValue(player.hunger - (item.hungerReduce || 0));
    player.staminaUpdatedAt = now.toISOString();
    player.hungerUpdatedAt = now.toISOString();

    staminaGain = roundValue(player.stamina - staminaBefore);
    moodGain = roundValue(player.mood - moodBefore);
    hungerReduce = roundValue(hungerBefore - player.hunger);

    return {
      ok: true,
      forceSave: true,
      messages: [
        t("player_item_used", { name: getText(item, "name") }),
        t("player_item_summary", {
          stamina: staminaGain,
          mood: moodGain,
          hunger: hungerReduce,
          count: game.state.game.inventory[item.inventoryField],
        }),
      ],
    };
  }

  game.systems.playerSystem = {
    getMoodStatus: getMoodStatus,
    getWorkMoodProfile: getWorkMoodProfile,
    getInventoryCount: getInventoryCount,
    getPlayerConsumables: getPlayerConsumables,
    getPlayerConsumablesByCategory: getPlayerConsumablesByCategory,
    getDisplayStats: getDisplayStats,
    getCurrentHunger: getCurrentHunger,
    getHungerCountdown: getHungerCountdown,
    getHungerBlockEta: getHungerBlockEta,
    getActiveSleep: getActiveSleep,
    hasActiveSleep: hasActiveSleep,
    getSleepElapsedMs: getSleepElapsedMs,
    getSleepRecovery: getSleepRecovery,
    syncPlayerState: syncPlayerState,
    advanceLifeTime: advanceLifeTime,
    sleep: sleep,
    consumeItem: consumeItem,
  };
})(window.CatGame);
