(function (game) {
  var policy = game.config.gentleCare;
  var t = game.utils.i18n.t;

  function timestamp(value, fallback) {
    var parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function ensure(cat, fallbackIso) {
    if (cat.careStatus !== "sheltered") cat.careStatus = "home";
    if (!Number.isFinite(Date.parse(cat.careLastSyncAt))) cat.careLastSyncAt = fallbackIso;
  }

  function rebase(cat, now) {
    var iso = now.toISOString();
    cat.decayTracker = cat.decayTracker || {};
    Object.keys(game.config.catDecayRules).forEach(function (key) { cat.decayTracker[key] = iso; });
    cat.diseaseProgressAt = iso;
    cat.diseaseCheckAt = iso;
    cat.careLastSyncAt = iso;
  }

  function shelter(cat, now, reason, messages) {
    if (cat.isAlive === false || cat.careStatus === "sheltered") return false;
    cat.careStatus = "sheltered";
    cat.careReason = reason;
    cat.careStartedAt = now.toISOString();
    rebase(cat, now);
    messages.push(t("care_shelter_notice", { name: game.utils.i18n.getDataText(cat, "name") }));
    return true;
  }

  function windowFor(cat, now, source) {
    ensure(cat, now.toISOString());
    var previous = timestamp(cat.careLastSyncAt, now.getTime());
    var elapsed = now.getTime() - previous;
    if (elapsed < 0) {
      rebase(cat, now);
      previous = now.getTime();
    }
    // A resumed/suspended page is an absence even if its timer fires before focus.
    var away = source !== "timer" || elapsed > policy.suspendThresholdMs;
    return {
      away: away,
      end: new Date(previous + Math.min(Math.max(0, elapsed), policy.offlineCapMs)),
      longAbsence: elapsed > policy.offlineCapMs,
      floors: away ? { hunger: Math.min(cat.hunger, 20), health: Math.min(cat.health, 30) } : {},
    };
  }

  function rescueReason(cat, state) {
    if (!cat || !cat.unlocked) return null;
    if (cat.isAlive === false) return "legacy";
    if (cat.careStatus === "sheltered") return "sheltered";
    if (cat.hunger <= 20 || cat.health <= 30) return "urgent";
    var inventory = state.inventory;
    var needed = game.systems.catSystem.getFoodUnitsNeeded(cat);
    if ((cat.hunger <= 30 && inventory.food < needed && inventory.premiumFood < needed) ||
        (cat.clean <= 20 && inventory.litter < 1)) return "supplies";
    var disease = game.systems.catSystem.getCatDisease(cat);
    if (disease && state.player.gold < disease.treatmentCost) return "urgent";
    return null;
  }

  function rescueCat(catId) {
    var state = game.state.game;
    var cat = game.systems.catSystem.getCat(catId);
    var reason = rescueReason(cat, state);
    if (!reason) return { ok: false, message: t("care_not_needed") };
    var now = game.systems.timeSystem.getNow();
    if (reason === "legacy") {
      // A failed backup must leave the original companion completely untouched.
      try {
        game.state.saveSystem.backupBeforeCareRecovery();
      } catch (error) {
        return { ok: false, message: t("care_backup_failed") };
      }
      cat.careLegacyRecord = {
        diedAt: cat.diedAt, deathReason: cat.deathReason,
        restoredAt: now.toISOString(),
      };
    }
    cat.isAlive = true;
    cat.diedAt = null;
    cat.deathReason = null;
    cat.careStatus = "home";
    cat.careReason = null;
    cat.careStartedAt = null;
    ["hunger", "clean", "mood", "health", "energy"].forEach(function (key) {
      cat[key] = Math.max(Number(cat[key]) || 0, policy.rescueBaseline);
    });
    cat.diseaseId = null;
    cat.diseaseStartedAt = null;
    protectAfterTreatment(cat, now);
    rebase(cat, now);
    // No inventory, currency, intimacy, XP, task counters or adoption reset.
    return { ok: true, forceSave: true, message: t("care_rescued", { name: game.utils.i18n.getDataText(cat, "name") }) };
  }

  function protectAfterTreatment(cat, now) {
    cat.careProtectedUntil = new Date(now.getTime() + policy.recoveryProtectionMs).toISOString();
  }

  function isProtected(cat, now) {
    return timestamp(cat.careProtectedUntil, 0) > now.getTime() ||
      game.systems.onboardingSystem.active(game.state.game, now);
  }

  function canGetMeal(state) {
    return game.systems.playerSystem.getCurrentHunger(undefined, state.player) >= game.config.playerCondition.hungerBlockThreshold && state.player.gold === 0;
  }

  function getMeal() {
    var state = game.state.game;
    if (!canGetMeal(state)) return { ok: false, message: t("care_not_needed") };
    state.player.hunger = 40;
    state.player.hungerUpdatedAt = game.systems.timeSystem.getNow().toISOString();
    return { ok: true, forceSave: true, message: t("care_meal_done") };
  }

  game.systems.careSystem = {
    ensure: ensure, rebase: rebase, shelter: shelter, windowFor: windowFor,
    rescueReason: rescueReason, rescueCat: rescueCat,
    protectAfterTreatment: protectAfterTreatment, isProtected: isProtected,
    canGetMeal: canGetMeal, getMeal: getMeal,
  };
})(window.CatGame);
