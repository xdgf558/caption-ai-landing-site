(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function renderCatChip(cat, selectedId) {
    var className = "cat-chip";
    if (cat.id === selectedId) {
      className += " is-selected";
    }
    if (!cat.unlocked) {
      className += " is-locked";
    }
    if (cat.isAlive === false) {
      className += " is-dead";
    }

    return (
      '<button class="' +
      className +
      '" data-select-cat="' +
      cat.id +
      '">' +
      '<div class="inline-row"><img class="cat-chip-art" src="' + game.utils.catArt.buildCatSvg(cat, 64) + '" alt="" />' +
      '<strong>' +
      format.escapeHtml(getText(cat, "name")) +
      "</strong><span class=\"pill\">" +
      format.escapeHtml(getText(cat, "breed")) +
      "</span></div>" +
      '<p class="page-copy" style="margin-top: 6px;">' +
      (cat.unlocked
        ? cat.isAlive === false
          ? t("dead_label")
          : t("alive_at_home")
        : t("later_unlock")) +
      "</p>" +
      "</button>"
    );
  }

  function renderUnlockInfo(cat) {
    var status = game.systems.catSystem.getUnlockStatus(cat);

    if (status.isBaseCat || cat.unlocked) {
      return "";
    }

    return (
      '<div class="notice-item" style="margin-top: 14px;"><p><strong>' + t("unlock_condition") + '</strong></p><p>' +
      t("unlock_gold_condition", { current: status.currentGold, target: status.requiredGold }) +
      '<br />' +
      t("unlock_age_condition", {
        current: format.formatAgeYears(status.currentAge),
        target: format.formatAgeYears(status.requiredAge),
      }) +
      '</p><p style="margin-top:8px;">' +
      (status.goldReady ? "✅ " : "⏳ ") + t(status.goldReady ? "unlock_gold_ready" : "unlock_waiting") +
      " / " +
      (status.ageReady ? "✅ " : "⏳ ") + t(status.ageReady ? "unlock_age_ready" : "unlock_waiting") +
      "</p></div>"
    );
  }

  function renderCountdownItem(cat, statKey, label, showDeathEta) {
    var nextDrop = game.systems.catSystem.getStatCountdown(cat, statKey);
    var deathEta = showDeathEta ? game.systems.catSystem.getHungerDeathEta(cat) : null;

    return (
      '<div class="notice-item"><p><strong>' +
      label +
      "</strong></p><p>" + t("next_drop") + '：<span data-cat-stat-countdown data-cat-id="' +
      cat.id +
      '" data-cat-stat="' +
      statKey +
      '">' +
      (nextDrop === null ? t("stopped") : format.formatDuration(nextDrop)) +
      "</span>" +
      (showDeathEta
        ? '<br />' + t("zero_eta") + '：<span data-cat-hunger-zero data-cat-id="' +
          cat.id +
          '">' +
          (deathEta === null ? t("dead_label") : format.formatDuration(deathEta)) +
          "</span>"
        : "") +
      "</p></div>"
    );
  }

  function renderCatPanel(state) {
    var selectedCat =
      state.cats.find(function (cat) {
        return cat.id === game.state.selectedCatId;
      }) ||
      state.cats.find(function (cat) {
        return cat.unlocked;
      });
    var isDead = selectedCat.isAlive === false;
    var catVisual = game.systems.catSystem.getCatVisualState(selectedCat);
    var catDisease = game.systems.catSystem.getCatDisease(selectedCat);
    var diseaseCountdown = game.systems.catSystem.getDiseaseProgressCountdown(selectedCat);
    var isLocked = !selectedCat.unlocked;
    var noToys = state.inventory.toys <= 0;
    var pregnancyCountdown = game.systems.collectionSystem && selectedCat.isPregnant
      ? game.systems.collectionSystem.getPregnancyCountdown(selectedCat)
      : null;
    var genderLabel = t(selectedCat.gender === "female" ? "gender_female" : "gender_male");
    var activeReaction = game.utils.catArt.getCatReaction(selectedCat);
    var reactionCue = game.utils.catArt.getCatReactionCue(selectedCat);

    return (
      '<section class="page-header">' +
      '<div class="page-card cat-detail-card">' +
      '<p class="section-eyebrow">' + t("page_cats") + "</p>" +
      '<h2 class="page-title">' + t("cats_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("cats_panel_copy") + "</p>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("interaction_info") + "</p>" +
      '<p class="page-copy">' + t("cat_interaction_copy") + "</p>" +
      "</div>" +
      "</section>" +
      '<section class="cat-layout">' +
      '<div class="cat-list">' +
      state.cats
        .map(function (cat) {
          return renderCatChip(cat, selectedCat.id);
        })
        .join("") +
      "</div>" +
      '<div class="page-card">' +
      '<div class="inline-row"><div><p class="section-eyebrow">' + t("current_cat") + '</p><h3 class="panel-title">' +
      format.escapeHtml(getText(selectedCat, "name")) +
      " · " +
      format.escapeHtml(getText(selectedCat, "breed")) +
      '</h3></div><span class="status-pill ' +
      (isDead ? "is-danger" : isLocked ? "is-warning" : "is-success") +
      '">' +
      (isDead
        ? t("dead_label")
        : isLocked
          ? t("later_unlock")
          : t("friendship_health", { intimacy: selectedCat.intimacy, health: selectedCat.health })) +
      "</span></div>" +
      '<div class="cat-portrait cat-stage ' + (activeReaction ? "has-reaction" : "") + '" data-cat-reaction="' +
      format.escapeHtml(activeReaction) + '" style="margin-top: 14px;"><div class="cat-detail-photo"><img src="' +
      game.utils.catArt.getCatStageUrl(selectedCat) +
      '" alt="' + format.escapeHtml(getText(selectedCat, "name")) + '" />' +
      (reactionCue ? '<span class="cat-reaction-cue" aria-hidden="true">' + reactionCue + '</span>' : '') +
      '</div><div><p class="mini-label">' +
      t("cat_portrait") + '</p><p class="page-copy">' + t(catVisual.labelKey) + "</p></div></div>" +
      (!isLocked
        ? '<div class="notice-item" style="margin-top: 14px;"><p><strong>' + t("cat_name") + '</strong></p>' +
          '<input id="cat-name-input" class="field" type="text" maxlength="12" value="' +
          format.escapeHtml(getText(selectedCat, "name")) +
          '" />' +
          '<div class="inline-row" style="margin-top: 10px;"><button class="primary-button" data-rename-cat="' +
          selectedCat.id +
          '">' +
          t("rename_cat") +
          '</button><span class="task-meta">' +
          t("rename_hint") +
          "</span></div></div>"
        : "") +
      '<div class="notice-list" style="margin-top: 14px;">' +
      '<div class="notice-item"><p><strong>' + t("age_label") + "</strong></p><p>" +
      format.escapeHtml(format.formatAgeYears(game.systems.catSystem.getCatAgeYears(selectedCat))) +
      '</p></div><div class="notice-item"><p><strong>' + t("gender_label") + "</strong></p><p>" +
      genderLabel +
      (selectedCat.isPregnant ? " · " + t("pregnancy_active") : "") +
      '</p></div><div class="notice-item"><p><strong>' + t("disease_label") + "</strong></p><p>" +
      (catDisease
        ? format.escapeHtml(getText(catDisease, "name")) +
          (diseaseCountdown !== null ? ' · ' + t("next_worsen") + " " + format.formatDuration(diseaseCountdown) : "")
        : t("disease_none")) +
      "</p></div></div>" +
      renderUnlockInfo(selectedCat) +
      (isDead
        ? '<div class="notice-item" style="margin-top: 14px;"><p><strong>' + t("death_state") + '</strong></p><p>' +
          t("death_desc", { name: getText(selectedCat, "name") }) +
          '</p><p style="margin-top:8px;"><button class="secondary-button" data-readopt-cat="' +
          selectedCat.id +
          '">' +
          t("readopt_action") +
          "</button></p><p class=\"helper-text\" style=\"margin-top:8px;\">" +
          t("readopt_cost", { cost: game.config.readoptCost }) +
          "</p></div>"
        : "") +
      '<div style="margin-top: 14px;">' +
      game.ui.helpers.renderBar(t("hunger_label"), selectedCat.hunger) +
      game.ui.helpers.renderBar(t("clean_label"), selectedCat.clean) +
      game.ui.helpers.renderBar(t("mood_label"), selectedCat.mood) +
      game.ui.helpers.renderBar(t("health_label"), selectedCat.health) +
      game.ui.helpers.renderBar(t("energy_label"), selectedCat.energy) +
      "</div>" +
      '<div class="inline-row" style="margin-top: 16px; flex-wrap: wrap;">' +
      '<button class="action-button" data-cat-action="feedBasic" ' +
      (isDead || isLocked ? "disabled" : "") +
      '>' + t("feed_basic") + "</button>" +
      '<button class="secondary-button" data-cat-action="feedPremium" ' +
      (isDead || isLocked ? "disabled" : "") +
      '>' + t("feed_premium") + "</button>" +
      '<button class="ghost-button" data-cat-action="clean" ' +
      (isDead || isLocked ? "disabled" : "") +
      '>' + t("clean_action") + "</button>" +
      '<button class="primary-button" data-cat-action="play" ' +
      (isDead || isLocked || noToys ? "disabled" : "") +
      '>' + t("play_action") + "</button>" +
      '<button class="chip-button" data-cat-action="rest" ' +
      (isDead || isLocked ? "disabled" : "") +
      '>' + t("rest_action") + "</button>" +
      '<button class="ghost-button" data-cat-action="catGrass" ' +
      (isDead || isLocked ? "disabled" : "") +
      '>' + t("cat_grass_action") + "</button>" +
      '<button class="secondary-button" data-cat-action="medicine" ' +
      (isDead || isLocked ? "disabled" : "") +
      '>' + t("medicine_action") + "</button>" +
      (catDisease && !isDead
        ? '<button class="secondary-button" data-page-target="hospital">' + t("go_hospital") + "</button>"
        : "") +
      "</div>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      '<div class="notice-item"><p><strong>' + t("bag_inventory") + "</strong></p><p>🥣 " +
      state.inventory.food +
      " / 🍗 " +
      state.inventory.premiumFood +
      " / 🧺 " +
      state.inventory.litter +
      " / 🪶 " +
      state.inventory.toys +
      " " +
      t("uses_remaining") +
      " / 🌿 " +
      state.inventory.catGrass +
      " / 💊 " +
      state.inventory.medicine +
      "</p></div>" +
      (!isLocked
        ? '<div class="notice-item"><p><strong>' + t("play_action") + '</strong></p><p>' +
          (noToys ? t("toy_required_play") : t("toy_bonus_used", { count: state.inventory.toys - 1 < 0 ? 0 : state.inventory.toys - 1 })) +
          "</p></div>"
        : "") +
      (selectedCat.isPregnant
        ? '<div class="notice-item"><p><strong>' + t("pregnancy_status") + '</strong></p><p>' +
          t("pregnancy_food_hint", { count: game.systems.catSystem.getFoodUnitsNeeded(selectedCat) }) +
          (pregnancyCountdown !== null ? "<br />" + t("pregnancy_due") + "：" + format.formatDuration(pregnancyCountdown) : "") +
          "</p></div>"
        : "") +
      '<div class="notice-item"><p><strong>' + t("care_tips") + "</strong></p><p>" + t("care_tips_copy") + "</p></div>" +
      (isLocked ? "" : renderCountdownItem(selectedCat, "hunger", t("hunger_next_drop"), true)) +
      (isLocked ? "" : renderCountdownItem(selectedCat, "clean", t("clean_label"), false)) +
      (isLocked ? "" : renderCountdownItem(selectedCat, "mood", t("mood_label"), false)) +
      (isLocked ? "" : renderCountdownItem(selectedCat, "health", t("health_label"), false)) +
      (isLocked ? "" : renderCountdownItem(selectedCat, "energy", t("energy_label"), false)) +
      "</div>" +
      "</div>" +
      "</section>"
    );
  }

  game.ui.renderCatPanel = renderCatPanel;
})(window.CatGame);
