(function (game) {
  var clamp = game.utils.format.clamp;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function getDisease(diseaseId) {
    return diseaseId ? game.data.diseaseMap[diseaseId] || null : null;
  }

  function getSickCats() {
    return game.state.game.cats.filter(function (cat) {
      return cat.unlocked && cat.isAlive !== false && !!cat.diseaseId;
    });
  }

  function treatCat(catId) {
    var state = game.state.game;
    var cat = game.systems.catSystem.getCat(catId);
    var disease = cat ? getDisease(cat.diseaseId) : null;
    var nowIso = game.systems.timeSystem.getNow().toISOString();
    var free = game.systems.onboardingSystem.canTreatFree(cat, state);
    var cost = disease && !free ? disease.treatmentCost : 0;
    var careBefore = cat ? Object.assign({}, cat) : {};

    if (!cat || !cat.unlocked || cat.isAlive === false || cat.careStatus === "sheltered") {
      return {
        ok: false,
        message: t("treatment_unneeded"),
      };
    }

    if (!disease) {
      return {
        ok: false,
        message: t("treatment_unneeded"),
      };
    }

    if (state.player.gold < cost) {
      return {
        ok: false,
        message: t("treatment_failed_gold", { cost: cost }),
      };
    }

    state.player.gold -= cost;
    state.player.totalSpend += cost;
    if (free) game.systems.onboardingSystem.data(state).treatmentUsed = true;
    state.player.hospitalVisits += 1;
    cat.diseaseId = null;
    cat.diseaseStartedAt = null;
    cat.diseaseProgressAt = nowIso;
    cat.diseaseCheckAt = nowIso;
    game.systems.careSystem.protectAfterTreatment(cat, new Date(nowIso));
    cat.health = clamp(cat.health + 12, 0, 100);
    cat.mood = clamp(cat.mood + 6, 0, 100);
    game.systems.onboardingSystem.recordCare(cat, "treat", careBefore);

    if (game.systems.taskSystem) {
      game.systems.taskSystem.refreshAllTasks();
    }

    return {
      ok: true,
      forceSave: true,
      messages: [
        t("treatment_success", {
          name: getText(cat, "name"),
          disease: getText(disease, "name"),
          cost: cost,
        }),
      ],
    };
  }

  game.systems.hospitalSystem = {
    getDisease: getDisease,
    getSickCats: getSickCats,
    treatCat: treatCat,
  };
})(window.CatGame);
