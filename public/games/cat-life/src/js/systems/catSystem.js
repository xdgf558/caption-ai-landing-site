(function (game) {
  var clamp = game.utils.format.clamp;
  var decayRules = game.config.catDecayRules;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;
  var YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  function useEnglishFallback() {
    return game.utils.i18n.getLanguage() !== "zh-CN";
  }

  function getNowIso() {
    return game.systems.timeSystem.getNow().toISOString();
  }

  function getBaseCat(catId) {
    return game.data.cats.find(function (cat) {
      return cat.id === catId;
    });
  }

  function ensureCatRuntimeFields(cat, fallbackIso) {
    var seedTime = fallbackIso || getNowIso();
    var baseCat = getBaseCat(cat.id) || {};

    if (cat.gender !== "male" && cat.gender !== "female") {
      cat.gender = baseCat.gender || (Math.random() < 0.5 ? "male" : "female");
    }
    if (typeof cat.isAlive !== "boolean") {
      cat.isAlive = true;
    }
    if (!cat.diedAt) {
      cat.diedAt = null;
    }
    if (!cat.deathReason) {
      cat.deathReason = null;
    }
    if (typeof cat.adoptionCount !== "number") {
      cat.adoptionCount = 0;
    }
    if (typeof cat.ageYears !== "number") {
      cat.ageYears = typeof baseCat.initialAgeYears === "number" ? baseCat.initialAgeYears : 0.2;
    }
    if (!cat.ageUpdatedAt) {
      cat.ageUpdatedAt = seedTime;
    }
    if (!cat.diseaseId) {
      cat.diseaseId = null;
    }
    if (!cat.diseaseStartedAt) {
      cat.diseaseStartedAt = null;
    }
    if (!cat.diseaseProgressAt) {
      cat.diseaseProgressAt = seedTime;
    }
    if (!cat.diseaseCheckAt) {
      cat.diseaseCheckAt = seedTime;
    }
    if (!Array.isArray(cat.diseaseHistory)) {
      cat.diseaseHistory = [];
    }
    if (typeof cat.isPregnant !== "boolean") {
      cat.isPregnant = false;
    }
    if (!cat.pregnancyStartedAt) {
      cat.pregnancyStartedAt = null;
    }
    if (!cat.pregnancyDueAt) {
      cat.pregnancyDueAt = null;
    }
    if (!cat.pregnancyMateId) {
      cat.pregnancyMateId = null;
    }
    if (typeof cat.pregnancyLitterSize !== "number") {
      cat.pregnancyLitterSize = 0;
    }
    if (!cat.decayTracker) {
      cat.decayTracker = {};
    }

    Object.keys(decayRules).forEach(function (key) {
      if (!cat.decayTracker[key]) {
        cat.decayTracker[key] = seedTime;
      }
    });
  }

  function getDisease(cat) {
    return cat && cat.diseaseId ? game.data.diseaseMap[cat.diseaseId] || null : null;
  }

  function getCatAgeYears(cat, nowDate) {
    var now = nowDate || game.systems.timeSystem.getNow();
    var updatedAt;
    var elapsed;

    if (!cat) {
      return 0;
    }

    ensureCatRuntimeFields(cat, now.toISOString());
    updatedAt = new Date(cat.ageUpdatedAt).getTime();
    elapsed = Math.max(0, now.getTime() - updatedAt);

    return cat.ageYears + elapsed / YEAR_MS * game.config.catAgeAcceleration;
  }

  function getUnlockStatus(cat) {
    var state = game.state.game;
    var requirement = game.config.catUnlockRequirements;
    var baseCat = getCat(requirement.baseCatId);
    var baseAge = baseCat ? getCatAgeYears(baseCat) : 0;

    if (!cat || cat.id === requirement.baseCatId) {
      return {
        isBaseCat: true,
        unlocked: true,
        goldReady: true,
        ageReady: true,
        currentGold: state.player.gold,
        currentAge: baseAge,
        requiredGold: requirement.gold,
        requiredAge: requirement.baseAgeYears,
      };
    }

    return {
      isBaseCat: false,
      unlocked: !!cat.unlocked,
      goldReady: state.player.gold >= requirement.gold,
      ageReady: baseAge >= requirement.baseAgeYears,
      currentGold: state.player.gold,
      currentAge: baseAge,
      requiredGold: requirement.gold,
      requiredAge: requirement.baseAgeYears,
    };
  }

  function resetDecayTracker(cat, statKeys, isoTime) {
    var timestamp = isoTime || getNowIso();
    ensureCatRuntimeFields(cat, timestamp);
    statKeys.forEach(function (key) {
      cat.decayTracker[key] = timestamp;
    });
  }

  function buildDeathMessage(cat, source, reason, disease) {
    var name = getText(cat, "name");
    var lang = game.utils.i18n.getLanguage();

    if (reason === "disease_zero" && disease) {
      return source === "init"
        ? lang !== "zh-CN"
          ? name + " passed away from untreated " + getText(disease, "name") + " while you were away."
          : "离线期间，" + name + "因" + getText(disease, "name") + "未及时治疗而去世。"
        : lang !== "zh-CN"
          ? name + " passed away from untreated " + getText(disease, "name") + "."
          : name + "因" + getText(disease, "name") + "未及时治疗而去世。";
    }

    return source === "init"
      ? lang !== "zh-CN"
        ? name + "'s hunger reached zero while you were away, and the cat died."
        : "离线期间，" + name + "的饱腹感归零，已经死亡。"
      : lang !== "zh-CN"
        ? name + "'s hunger reached zero and the cat died."
        : name + "的饱腹感归零，已经死亡。";
  }

  function markCatDead(cat, nowIso, source, messages, reason, disease) {
    if (!cat.isAlive) {
      return;
    }

    cat.isAlive = false;
    if (reason === "hunger_zero") {
      cat.hunger = 0;
    }
    if (reason === "disease_zero") {
      cat.health = 0;
    }
    cat.diedAt = nowIso;
    cat.deathReason = reason || "hunger_zero";
    cat.mood = 0;
    cat.energy = 0;
    cat.isPregnant = false;
    cat.pregnancyStartedAt = null;
    cat.pregnancyDueAt = null;
    cat.pregnancyMateId = null;
    cat.pregnancyLitterSize = 0;
    messages.push(buildDeathMessage(cat, source, reason || "hunger_zero", disease));
  }

  function applyDecaySteps(cat, statKey, nowDate, source, messages) {
    var rule = decayRules[statKey];
    var trackerTime = new Date(cat.decayTracker[statKey]).getTime();
    var nowTime = nowDate.getTime();
    var elapsed = nowTime - trackerTime;
    var steps = Math.floor(elapsed / rule.intervalMs);
    var nextTrackerTime = trackerTime;

    if (steps <= 0 || !cat.isAlive) {
      return false;
    }

    cat[statKey] = clamp((cat[statKey] || 0) - steps, 0, 100);
    nextTrackerTime += steps * rule.intervalMs;
    cat.decayTracker[statKey] = new Date(nextTrackerTime).toISOString();

    if (statKey === "hunger" && cat.hunger <= 0) {
      markCatDead(cat, nowDate.toISOString(), source, messages, "hunger_zero");
    }

    return true;
  }

  function updateCatAge(cat, nowDate) {
    var before = Math.floor((cat.ageYears || 0) * 100);
    var currentAge = getCatAgeYears(cat, nowDate);
    var after = Math.floor(currentAge * 100);

    cat.ageYears = currentAge;
    cat.ageUpdatedAt = nowDate.toISOString();

    return before !== after;
  }

  function refreshCatUnlocks(nowDate, messages) {
    var changed = false;

    game.state.game.cats.forEach(function (cat) {
      var status;
      if (cat.unlocked || cat.id === game.config.catUnlockRequirements.baseCatId) {
        return;
      }

      status = getUnlockStatus(cat);
      if (status.goldReady && status.ageReady) {
        cat.unlocked = true;
        ensureCatRuntimeFields(cat, nowDate.toISOString());
        changed = true;
        messages.push(t("unlock_new_cat", { name: getText(cat, "name") }));
      }
    });

    return changed;
  }

  function calculateDiseaseChance(cat, disease) {
    var chance = disease.baseChance;
    var exposureCount = game.state.game.cats.filter(function (otherCat) {
      var otherDisease = getDisease(otherCat);
      return (
        otherCat.id !== cat.id &&
        otherCat.unlocked &&
        otherCat.isAlive !== false &&
        otherDisease &&
        otherDisease.contagious &&
        otherDisease.id === disease.id
      );
    }).length;

    chance += Math.max(0, getCatAgeYears(cat) - 0.6) * 0.07;
    chance += Math.max(0, 55 - (cat.mood || 0)) / 220;
    chance += Math.max(0, 55 - (cat.clean || 0)) / 240;
    chance += Math.max(0, 50 - (cat.hunger || 0)) / 260;
    chance += Math.max(0, 65 - (cat.health || 0)) / 320;

    if (disease.contagious && exposureCount > 0) {
      chance += 0.18 + exposureCount * 0.08;
    }

    return Math.min(0.85, chance);
  }

  function infectCat(cat, disease, infectedAtIso, messages) {
    cat.diseaseId = disease.id;
    cat.diseaseStartedAt = infectedAtIso;
    cat.diseaseProgressAt = infectedAtIso;
    cat.diseaseCheckAt = infectedAtIso;
    cat.diseaseHistory.push({
      id: disease.id,
      at: infectedAtIso,
    });
    messages.push(
      t("sickness_found", {
        name: getText(cat, "name"),
        disease: getText(disease, "name"),
      })
    );
  }

  function syncDiseaseChecks(cat, nowDate, messages) {
    var trackerTime;
    var elapsed;
    var steps;
    var diseases;
    var index;
    var checkTime;
    var disease;

    if (!cat.isAlive || cat.diseaseId) {
      return false;
    }

    trackerTime = new Date(cat.diseaseCheckAt).getTime();
    elapsed = nowDate.getTime() - trackerTime;
    steps = Math.floor(elapsed / game.config.diseaseCheckIntervalMs);

    if (steps <= 0) {
      return false;
    }

    diseases = game.data.diseases.filter(function (entry) {
      return getCatAgeYears(cat, nowDate) >= entry.minAgeYears;
    });

    for (index = 1; index <= steps; index += 1) {
      checkTime = new Date(trackerTime + index * game.config.diseaseCheckIntervalMs).toISOString();
      disease = diseases.find(function (entry) {
        return game.utils.random.chance(calculateDiseaseChance(cat, entry));
      });

      if (disease) {
        infectCat(cat, disease, checkTime, messages);
        return true;
      }
    }

    cat.diseaseCheckAt = new Date(trackerTime + steps * game.config.diseaseCheckIntervalMs).toISOString();
    return false;
  }

  function syncDiseaseProgress(cat, nowDate, source, messages) {
    var disease = getDisease(cat);
    var trackerTime;
    var elapsed;
    var steps;
    var previousHealth;
    var previousMood;
    var extraDecay = 0;

    if (!cat.isAlive || !disease) {
      return false;
    }

    trackerTime = new Date(cat.diseaseProgressAt).getTime();
    elapsed = nowDate.getTime() - trackerTime;
    steps = Math.floor(elapsed / disease.progressIntervalMs);

    if (steps <= 0) {
      return false;
    }

    previousHealth = cat.health;
    previousMood = cat.mood;
    if (cat.hunger <= 20) {
      extraDecay += steps;
    }
    if (cat.clean <= 20) {
      extraDecay += steps;
    }

    cat.health = clamp(cat.health - steps * disease.healthDecay - extraDecay, 0, 100);
    cat.mood = clamp(cat.mood - steps * disease.moodDecay, 0, 100);
    cat.diseaseProgressAt = new Date(trackerTime + steps * disease.progressIntervalMs).toISOString();

    if (cat.health <= 0) {
      markCatDead(cat, nowDate.toISOString(), source, messages, "disease_zero", disease);
      return true;
    }

    if (source !== "timer" && (Math.floor(previousHealth / 20) !== Math.floor(cat.health / 20) || Math.floor(previousMood / 20) !== Math.floor(cat.mood / 20))) {
      messages.push(
        t("sickness_worse", {
          name: getText(cat, "name"),
          disease: getText(disease, "name"),
        })
      );
    }

    return true;
  }

  function syncCatState(nowDate, source) {
    var fallbackIso = nowDate.toISOString();
    var messages = [];
    var changed = false;

    game.state.game.cats.forEach(function (cat) {
      ensureCatRuntimeFields(cat, fallbackIso);

      if (cat.id === game.config.catUnlockRequirements.baseCatId || cat.unlocked) {
        changed = updateCatAge(cat, nowDate) || changed;
      }

      if (!cat.unlocked) {
        return;
      }

      if (!cat.isAlive) {
        return;
      }

      Object.keys(decayRules).forEach(function (statKey) {
        var didChange = applyDecaySteps(cat, statKey, nowDate, source, messages);
        changed = changed || didChange;
      });

      changed = syncDiseaseProgress(cat, nowDate, source, messages) || changed;
      if (cat.isAlive) {
        changed = syncDiseaseChecks(cat, nowDate, messages) || changed;
      }
    });

    changed = refreshCatUnlocks(nowDate, messages) || changed;

    return {
      changed: changed,
      messages: messages,
    };
  }

  function getStatCountdown(cat, statKey, nowDate) {
    var rule = decayRules[statKey];
    var now = nowDate || game.systems.timeSystem.getNow();
    var trackerTime;
    var elapsed;

    if (!rule) {
      return 0;
    }

    ensureCatRuntimeFields(cat, now.toISOString());

    if (!cat.isAlive) {
      return null;
    }

    trackerTime = new Date(cat.decayTracker[statKey]).getTime();
    elapsed = Math.max(0, now.getTime() - trackerTime);

    return rule.intervalMs - (elapsed % rule.intervalMs || 0);
  }

  function getHungerDeathEta(cat, nowDate) {
    var countdown = getStatCountdown(cat, "hunger", nowDate);

    if (!cat || !cat.isAlive || cat.hunger <= 0 || countdown === null) {
      return null;
    }

    return countdown + Math.max(0, cat.hunger - 1) * decayRules.hunger.intervalMs;
  }

  function getDiseaseProgressCountdown(cat, nowDate) {
    var disease = getDisease(cat);
    var now = nowDate || game.systems.timeSystem.getNow();
    var trackerTime;
    var elapsed;

    if (!cat || !cat.isAlive || !disease) {
      return null;
    }

    ensureCatRuntimeFields(cat, now.toISOString());
    trackerTime = new Date(cat.diseaseProgressAt).getTime();
    elapsed = Math.max(0, now.getTime() - trackerTime);

    return disease.progressIntervalMs - (elapsed % disease.progressIntervalMs || 0);
  }

  function getCatVisualState(cat) {
    var iconSet;

    ensureCatRuntimeFields(cat, getNowIso());
    iconSet = cat.iconSet || {};

    if (!cat.isAlive) {
      return { icon: iconSet.dead || "☠️", labelKey: "dead_state" };
    }
    if (cat.diseaseId || cat.health <= 25) {
      return { icon: iconSet.sick || "😵", labelKey: "sick_state" };
    }
    if (cat.hunger <= 25) {
      return { icon: iconSet.hungry || "😿", labelKey: "hungry_state" };
    }
    if (cat.mood >= 75) {
      return { icon: iconSet.happy || "😻", labelKey: "happy_state" };
    }
    if (cat.mood <= 35) {
      return { icon: iconSet.sad || "😾", labelKey: "sad_state" };
    }
    return { icon: iconSet.calm || "😺", labelKey: "calm_state" };
  }

  function getCat(catId) {
    return game.state.game.cats.find(function (cat) {
      return cat.id === catId;
    });
  }

  function buildReadoptTemplate(cat, baseCat) {
    var hasBaseCat = !!baseCat;
    var source = hasBaseCat ? game.state.deepClone(baseCat) : game.state.deepClone(cat);
    var fallbackAge = typeof source.initialAgeYears === "number"
      ? source.initialAgeYears
      : String(cat.id || "").indexOf("kitten_") === 0
        ? 0.08
        : 0.2;

    return Object.assign({}, source, {
      unlocked: true,
      isAlive: true,
      diedAt: null,
      deathReason: null,
      gender: source.gender || cat.gender || "male",
      initialAgeYears: fallbackAge,
      hunger: hasBaseCat ? source.hunger : 82,
      clean: hasBaseCat ? source.clean : 76,
      mood: hasBaseCat ? source.mood : 88,
      health: hasBaseCat ? source.health : 92,
      intimacy: hasBaseCat ? source.intimacy : 10,
      energy: hasBaseCat ? source.energy : 82,
      level: hasBaseCat ? source.level : 1,
      diseaseId: null,
      diseaseStartedAt: null,
      diseaseHistory: [],
      isPregnant: false,
      pregnancyStartedAt: null,
      pregnancyDueAt: null,
      pregnancyMateId: null,
      pregnancyLitterSize: 0,
    });
  }

  function getFoodUnitsNeeded(cat) {
    return cat && cat.gender === "female" && cat.isPregnant ? game.config.pregnancyFoodMultiplier : 1;
  }

  function performAction(catId, actionKey) {
    var state = game.state.game;
    var cat = getCat(catId);
    var messages = [];
    var comfortBonus = Math.floor(state.home.comfortScore / 20);
    var nowIso = getNowIso();
    var foodUnitsNeeded;

    if (!cat || !cat.unlocked) {
      return {
        ok: false,
        message: useEnglishFallback() ? "This cat has not been unlocked yet." : "这只猫咪还没有解锁。",
      };
    }
    ensureCatRuntimeFields(cat, nowIso);
    if (!cat.isAlive) {
      return {
        ok: false,
        message:
          getText(cat, "name") +
          (useEnglishFallback() ? " has died and can no longer interact." : "已经死亡，无法继续互动。"),
      };
    }

    if (actionKey === "feedBasic") {
      foodUnitsNeeded = getFoodUnitsNeeded(cat);
      if (state.inventory.food < foodUnitsNeeded) {
        return {
          ok: false,
          message: t("food_not_enough", { count: foodUnitsNeeded }),
        };
      }
      state.inventory.food -= foodUnitsNeeded;
      cat.hunger = clamp(cat.hunger + 25, 0, 100);
      cat.mood = clamp(cat.mood + 4, 0, 100);
      resetDecayTracker(cat, ["hunger", "mood"], nowIso);
      state.player.feedTimes += 1;
      state.player.feedTimesToday += 1;
      messages.push(
        getText(cat, "name") +
          (useEnglishFallback() ? " ate happily and hunger recovered nicely." : "吃得很认真，饱腹值明显回升。")
      );
      if (foodUnitsNeeded > 1) {
        messages.push(t("pregnancy_food_bonus", { name: getText(cat, "name"), count: foodUnitsNeeded }));
      }
    } else if (actionKey === "feedPremium") {
      foodUnitsNeeded = getFoodUnitsNeeded(cat);
      if (state.inventory.premiumFood < foodUnitsNeeded) {
        return { ok: false, message: t("premium_food_not_enough", { count: foodUnitsNeeded }) };
      }
      state.inventory.premiumFood -= foodUnitsNeeded;
      cat.hunger = clamp(cat.hunger + 45, 0, 100);
      cat.intimacy = clamp(cat.intimacy + 2, 0, 100);
      cat.mood = clamp(cat.mood + 6, 0, 100);
      resetDecayTracker(cat, ["hunger", "mood"], nowIso);
      state.player.feedTimes += 1;
      state.player.feedTimesToday += 1;
      messages.push(
        getText(cat, "name") +
          (useEnglishFallback() ? " enjoyed the premium food and rubbed against you happily." : "吃到了高级猫粮，开心得蹭了蹭你。")
      );
      if (foodUnitsNeeded > 1) {
        messages.push(t("pregnancy_food_bonus", { name: getText(cat, "name"), count: foodUnitsNeeded }));
      }
    } else if (actionKey === "clean") {
      if (state.inventory.litter <= 0) {
        return { ok: false, message: useEnglishFallback() ? "You're out of litter. Buy more from the shop." : "猫砂不够了，先去商店买一些。" };
      }
      state.inventory.litter -= 1;
      cat.clean = clamp(cat.clean + 30, 0, 100);
      cat.health = clamp(cat.health + 4, 0, 100);
      resetDecayTracker(cat, ["clean", "health"], nowIso);
      state.player.cleanTimes += 1;
      messages.push(
        useEnglishFallback()
          ? "You cleaned up for " + getText(cat, "name") + " and cleanliness improved."
          : "你帮" + getText(cat, "name") + "整理了环境，清洁值提升了。"
      );
    } else if (actionKey === "play") {
      if (state.inventory.toys <= 0) {
        return { ok: false, message: t("toy_required_play") };
      }
      state.inventory.toys -= 1;
      cat.mood = clamp(cat.mood + 18 + comfortBonus, 0, 100);
      cat.intimacy = clamp(cat.intimacy + 8, 0, 100);
      cat.energy = clamp(cat.energy - 10, 0, 100);
      resetDecayTracker(cat, ["mood", "energy"], nowIso);
      state.player.playTimes += 1;
      state.player.playTimesToday += 1;
      state.player.mood = clamp(state.player.mood + 4, 0, 100);
      messages.push(
        useEnglishFallback()
          ? "You played with " + getText(cat, "name") + " for a while, and the mood lightened up."
          : "你陪" + getText(cat, "name") + "玩了好一会儿，气氛变得轻松很多。"
      );
      cat.intimacy = clamp(cat.intimacy + 4, 0, 100);
      messages.push(t("toy_bonus_used", { count: state.inventory.toys }));
      if (state.inventory.toys <= 0) {
        messages.push(t("toy_depleted"));
      }
    } else if (actionKey === "rest") {
      cat.energy = clamp(cat.energy + 20 + comfortBonus, 0, 100);
      cat.health = clamp(cat.health + 5, 0, 100);
      cat.mood = clamp(cat.mood + 3, 0, 100);
      resetDecayTracker(cat, ["energy", "health", "mood"], nowIso);
      messages.push(
        getText(cat, "name") +
          (useEnglishFallback() ? " took a comfortable rest in the cat bed." : "在猫窝里舒舒服服地休息了一会儿。")
      );
    } else if (actionKey === "catGrass") {
      if (state.inventory.catGrass <= 0) {
        return { ok: false, message: t("cat_grass_empty") };
      }
      state.inventory.catGrass -= 1;
      cat.mood = clamp(cat.mood + 30, 0, 100);
      cat.intimacy = clamp(cat.intimacy + 2, 0, 100);
      resetDecayTracker(cat, ["mood"], nowIso);
      messages.push(t("cat_grass_used", { name: getText(cat, "name") }));
    } else if (actionKey === "medicine") {
      if (state.inventory.medicine <= 0) {
        return { ok: false, message: t("medicine_empty") };
      }
      state.inventory.medicine -= 1;
      cat.health = clamp(cat.health + 30, 0, 100);
      cat.mood = clamp(cat.mood + 4, 0, 100);
      resetDecayTracker(cat, ["health", "mood"], nowIso);
      messages.push(t("medicine_used", { name: getText(cat, "name") }));
    } else {
      return { ok: false, message: useEnglishFallback() ? "Unknown cat interaction." : "未知的猫咪互动。" };
    }

    if (game.systems.taskSystem) {
      game.systems.taskSystem.refreshAllTasks();
    }

    return {
      ok: true,
      messages: messages,
    };
  }

  function readoptCat(catId) {
    var state = game.state.game;
    var cat = getCat(catId);
    var baseCat = getBaseCat(catId);
    var nowIso = getNowIso();
    var adoptionCount = 0;
    var template;

    if (!cat || !cat.unlocked) {
      return {
        ok: false,
        message: useEnglishFallback() ? "This cat cannot be adopted right now." : "这只猫咪当前无法重新领养。",
      };
    }

    ensureCatRuntimeFields(cat, nowIso);
    if (cat.isAlive) {
      return { ok: false, message: t("readopt_unavailable") };
    }
    if (state.player.gold < game.config.readoptCost) {
      return { ok: false, message: t("readopt_failed_gold", { cost: game.config.readoptCost }) };
    }

    adoptionCount = (cat.adoptionCount || 0) + 1;
    state.player.gold -= game.config.readoptCost;
    state.player.totalSpend += game.config.readoptCost;

    template = buildReadoptTemplate(cat, baseCat);

    Object.assign(cat, template, {
      ageYears: typeof template.initialAgeYears === "number" ? template.initialAgeYears : 0.2,
      ageUpdatedAt: nowIso,
      diseaseProgressAt: nowIso,
      diseaseCheckAt: nowIso,
      adoptionCount: adoptionCount,
      decayTracker: {
        hunger: nowIso,
        clean: nowIso,
        mood: nowIso,
        health: nowIso,
        energy: nowIso,
      },
    });

    return {
      ok: true,
      forceSave: true,
      messages: [
        t("readopt_success", { name: getText(cat, "name") }),
        t("readopt_cost", { cost: game.config.readoptCost }),
      ],
    };
  }

  function renameCat(catId, nextName) {
    var cat = getCat(catId);
    var trimmedName = String(nextName || "").trim();
    var previousName;

    if (!cat || !cat.unlocked) {
      return { ok: false, message: t("rename_cat_locked") };
    }
    if (!trimmedName) {
      return { ok: false, message: t("rename_cat_empty") };
    }

    previousName = getText(cat, "name");
    cat.name = trimmedName;

    return {
      ok: true,
      forceSave: true,
      message: t("rename_cat_success", {
        oldName: previousName,
        newName: trimmedName,
      }),
    };
  }

  game.systems.catSystem = {
    getCat: getCat,
    performAction: performAction,
    syncCatState: syncCatState,
    getStatCountdown: getStatCountdown,
    getHungerDeathEta: getHungerDeathEta,
    getDiseaseProgressCountdown: getDiseaseProgressCountdown,
    ensureCatRuntimeFields: ensureCatRuntimeFields,
    getCatVisualState: getCatVisualState,
    getCatAgeYears: getCatAgeYears,
    getCatDisease: getDisease,
    getUnlockStatus: getUnlockStatus,
    getFoodUnitsNeeded: getFoodUnitsNeeded,
    readoptCat: readoptCat,
    renameCat: renameCat,
  };
})(window.CatGame);
