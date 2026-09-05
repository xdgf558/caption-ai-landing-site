(function (game) {
  var t = game.utils.i18n.t;
  var DAY = 86400000;
  var bundle = { food: 2, litter: 1, toys: 2 };

  function now() { return game.systems.timeSystem.getNow(); }
  function dayKey(date) { return date.toISOString().slice(0, 10); }
  function data(state) {
    var saved = state.player.careLearning;
    return saved && saved.version === 1 ? saved : game.state.createCareLearning(false);
  }
  function active(state, date) {
    var learning = data(state);
    return learning.eligible && (learning.careDates.length < 3 || Date.parse(learning.protectedUntil) > (date || now()).getTime());
  }
  function lessonFor(state, date) {
    var learning = data(state);
    var today = dayKey(date || now());
    var last = learning.careDates[learning.careDates.length - 1];
    if (!learning.eligible || (last && today < last)) return 0;
    var lesson = learning.careDates.length + (last === today ? 0 : 1);
    return lesson <= 3 ? lesson : 0;
  }
  function canClaim(state, date) {
    var lesson = lessonFor(state, date);
    return lesson > 0 && data(state).supplyClaims.indexOf(lesson) === -1 &&
      state.cats.some(function (cat) { return cat.unlocked && cat.isAlive !== false && cat.careStatus !== "sheltered"; });
  }
  function claimSupplies() {
    var state = game.state.game;
    if (!canClaim(state)) return { ok: false, message: t("learning_supply_unavailable") };
    var lesson = lessonFor(state);
    Object.keys(bundle).forEach(function (key) { state.inventory[key] += bundle[key]; });
    data(state).supplyClaims.push(lesson);
    return { ok: true, forceSave: true, message: t("learning_supply_received", { lesson: lesson }) };
  }
  function meetCat(catId) {
    var state = game.state.game;
    var cat = state.cats.find(function (entry) { return entry.id === catId; });
    if (!cat || !cat.unlocked || cat.isAlive === false || cat.careStatus === "sheltered" || !data(state).eligible || data(state).metCat) {
      return { ok: false, message: t("learning_unavailable") };
    }
    data(state).metCat = true;
    return { ok: true, forceSave: true, message: t("learning_met", { name: game.utils.i18n.getDataText(cat, "name") }) };
  }
  function recordCare(cat, action, before) {
    var state = game.state.game;
    var learning = data(state);
    var keys = { feedBasic: ["hunger"], feedPremium: ["hunger"], clean: ["clean"],
      play: ["mood", "intimacy"], rest: ["energy", "health", "mood"], medicine: ["health"], catGrass: ["mood", "intimacy"] };
    var meaningful = action === "treat" ? Boolean(before.diseaseId && !cat.diseaseId) :
      (keys[action] || []).some(function (key) { return cat[key] > before[key]; });
    if (!learning.eligible || !cat.unlocked || cat.isAlive === false || cat.careStatus === "sheltered" || !meaningful) return false;
    var changed = !learning.metCat;
    learning.metCat = true;
    if (action === "feedBasic" || action === "feedPremium") { changed = changed || !learning.fed; learning.fed = true; }
    if (action === "play") { changed = changed || !learning.played; learning.played = true; }
    var date = now();
    var today = dayKey(date);
    var last = learning.careDates[learning.careDates.length - 1];
    // Monotonic UTC dates prevent local-timezone changes and clock rollback
    // from counting the same learning day twice. Render/claim/rescue never call this.
    if (learning.careDates.length < 3 && (!last || today > last)) {
      learning.careDates.push(today);
      if (learning.careDates.length === 3) learning.protectedUntil = new Date(Date.parse(today) + DAY).toISOString();
      changed = true;
    }
    return changed;
  }
  function recordWork() {
    var learning = data(game.state.game);
    if (learning.eligible) learning.worked = true;
  }
  function canTreatFree(cat, state, date) {
    return Boolean(cat && cat.unlocked && cat.isAlive !== false && cat.careStatus !== "sheltered" &&
      game.systems.catSystem.getCatDisease(cat) && active(state, date) && !data(state).treatmentUsed);
  }
  function recommendation(state, preferredCat) {
    var learning = data(state);
    var live = state.cats.filter(function (cat) { return cat.unlocked && cat.isAlive !== false; });
    function needy(cat) { return cat.careStatus === "sheltered" || cat.diseaseId || cat.hunger <= 30 || cat.health <= 30; }
    var cat = preferredCat || live.find(needy) || live[0] || state.cats.find(function (entry) { return entry.unlocked; });
    var params = { name: cat ? game.utils.i18n.getDataText(cat, "name") : "", lesson: lessonFor(state), count: learning.careDates.length };
    function result(kind, title, copy, button, extra) {
      return Object.assign({ kind: kind, titleKey: title, copyKey: copy, buttonKey: button, params: params, catId: cat && cat.id, routeKey: "care" }, extra || {});
    }
    function page(target, title, copy, button) { return result("page", title, copy, button, { page: target, routeKey: target === "work" ? "work" : target === "shop" ? "shop" : "care" }); }
    function action(key, title, copy, button) { return result("cat", title, copy, button, { action: key }); }
    function supply() { return result("supplies", "learning_supply_title", "learning_supply_copy", "learning_supply_claim"); }
    function work() {
      if (state.player.activeSleep) return result("sleep", "headline_sleep_title", "headline_sleep_copy", "wake_action", { routeKey: "sleep" });
      if (state.player.activeWork) return page("work", "learning_work_running", "learning_work_running_copy", "headline_view_work");
      if (game.systems.playerSystem.getCurrentHunger(undefined, state.player) >= game.config.playerCondition.hungerBlockThreshold) {
        var food = game.data.items.find(function (item) { return item.hungerReduce > 0 && state.inventory[item.inventoryField] > 0; });
        if (food) return result("player-item", "learning_player_food", "learning_player_food_copy", "learning_eat", { itemId: food.id, routeKey: "shop" });
        if (game.systems.careSystem.canGetMeal(state)) return result("meal", "care_meal_title", "care_meal_copy", "care_meal_action", { routeKey: "shop" });
        return page("shop", "headline_player_hungry_title", "headline_player_hungry_copy", "headline_buy_food");
      }
      var jobs = state.jobs.filter(function (job) { return job.unlocked; });
      if (jobs.length && !jobs.some(function (job) { return state.player.stamina >= job.staminaCost; })) {
        return result("sleep", "learning_sleep_title", "learning_sleep_copy", "sleep_action", { routeKey: "sleep" });
      }
      return page("work", "learning_work_title", "learning_work_copy", "headline_go_work");
    }
    if (!cat) return page(state.cats.length ? "collection" : "save", "learning_no_cat", state.cats.length ? "learning_locked_copy" : "learning_empty_copy", state.cats.length ? "page_collection" : "page_save");
    if (!cat.unlocked) return page("collection", "learning_no_cat", "learning_locked_copy", "page_collection");
    var reason = game.systems.careSystem.rescueReason(cat, state);
    if (reason === "legacy" || reason === "sheltered") return result("rescue", reason === "legacy" ? "care_legacy_title" : "care_sheltered", reason === "legacy" ? "care_legacy_copy" : "care_sheltered_copy", reason === "legacy" ? "care_legacy_action" : "care_pick_up");
    var disease = game.systems.catSystem.getCatDisease(cat);
    if (disease && (canTreatFree(cat, state) || state.player.gold >= disease.treatmentCost)) {
      params.cost = canTreatFree(cat, state) ? 0 : disease.treatmentCost;
      return result("treat", "learning_treat_title", canTreatFree(cat, state) ? "learning_treatment_help" : "learning_treat_copy", canTreatFree(cat, state) ? "learning_treat_free" : "treat_now");
    }
    if (reason) return result("rescue", "care_rescue_title", "care_rescue_copy", "care_rescue_action");
    if (game.systems.careSystem.canGetMeal(state)) return result("meal", "care_meal_title", "care_meal_copy", "care_meal_action", { routeKey: "shop" });
    var needed = game.systems.catSystem.getFoodUnitsNeeded(cat);
    function feed() {
      if (state.inventory.food >= needed) return action("feedBasic", "learning_feed_title", "learning_feed_copy", "feed_basic");
      if (state.inventory.premiumFood >= needed) return action("feedPremium", "learning_feed_title", "learning_feed_copy", "feed_premium");
      if (canClaim(state)) return supply();
      return state.player.gold >= game.data.itemMap.food_basic.price * needed ? page("shop", "learning_food_missing", "learning_food_missing_copy", "headline_buy_cat_food") : work();
    }
    if (cat.hunger <= 30) return feed();
    if (learning.eligible && !learning.metCat) return result("meet", "learning_meet_title", "learning_meet_copy", "learning_meet_action");
    if (canClaim(state)) return supply();
    if ((learning.eligible && !learning.fed && cat.hunger < 100) || cat.hunger <= 80) return feed();
    if (cat.clean <= 65 && state.inventory.litter > 0) return action("clean", "learning_clean_title", "learning_clean_copy", "clean_action");
    if (cat.energy < 40) return action("rest", "learning_rest_title", "learning_rest_copy", "rest_action");
    if ((learning.eligible && !learning.played) || cat.mood < 65) {
      if (state.inventory.toys > 0 && (cat.mood < 100 || cat.intimacy < 100)) return action("play", "learning_play_title", "learning_play_copy", "play_action");
      if (!state.inventory.toys) return state.player.gold >= game.data.itemMap.toy_wand.price ? page("shop", "learning_toy_missing", "learning_toy_missing_copy", "page_shop") : work();
    }
    if (learning.eligible && !learning.worked) return work();
    if (learning.eligible && (!learning.fed || !learning.played)) return page("work", "learning_no_rush", "learning_no_rush_copy", "page_work");
    if (state.player.activeSleep || state.player.activeWork ||
      game.systems.playerSystem.getCurrentHunger(undefined, state.player) >= game.config.playerCondition.hungerBlockThreshold) return work();
    return page("cats", "learning_calm_title", "learning_calm_copy", "care_open_companion");
  }
  game.systems.onboardingSystem = { data: data, active: active, lessonFor: lessonFor, canClaim: canClaim,
    claimSupplies: claimSupplies, meetCat: meetCat, recordCare: recordCare, recordWork: recordWork,
    canTreatFree: canTreatFree, recommendation: recommendation };
})(window.CatGame);
