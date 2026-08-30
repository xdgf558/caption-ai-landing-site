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

    if (!cat || !cat.unlocked || cat.isAlive === false) {
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

    if (state.player.gold < disease.treatmentCost) {
      return {
        ok: false,
        message: t("treatment_failed_gold", { cost: disease.treatmentCost }),
      };
    }

    state.player.gold -= disease.treatmentCost;
    state.player.totalSpend += disease.treatmentCost;
    state.player.hospitalVisits += 1;
    cat.diseaseId = null;
    cat.diseaseStartedAt = null;
    cat.diseaseProgressAt = nowIso;
    cat.diseaseCheckAt = nowIso;
    cat.health = clamp(cat.health + 12, 0, 100);
    cat.mood = clamp(cat.mood + 6, 0, 100);

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
          cost: disease.treatmentCost,
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
