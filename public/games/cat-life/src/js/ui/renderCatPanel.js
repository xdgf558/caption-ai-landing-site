(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  var catActions = [
    { key: "feedBasic", labelKey: "feed_basic", itemId: "food_basic", inventoryField: "food", tone: "orange" },
    { key: "feedPremium", labelKey: "feed_premium", itemId: "food_premium", inventoryField: "premiumFood", tone: "gold" },
    { key: "clean", labelKey: "clean_action", itemId: "litter_basic", inventoryField: "litter", tone: "blue" },
    { key: "play", labelKey: "play_action", itemId: "toy_wand", inventoryField: "toys", tone: "pink" },
    { key: "rest", labelKey: "rest_action", imagePath: "src/assets/rooms/furniture-bed.png", tone: "mint", copyKey: "cat_rest_copy", effectKey: "cat_rest_effect" },
    { key: "catGrass", labelKey: "cat_grass_action", itemId: "cat_grass", inventoryField: "catGrass", tone: "green" },
    { key: "medicine", labelKey: "medicine_action", itemId: "medicine_basic", inventoryField: "medicine", tone: "red" },
  ];

  var statDefinitions = [
    { key: "hunger", labelKey: "hunger_label", tone: "orange" },
    { key: "clean", labelKey: "clean_label", tone: "blue" },
    { key: "mood", labelKey: "mood_label", tone: "pink" },
    { key: "health", labelKey: "health_label", tone: "green" },
    { key: "energy", labelKey: "energy_label", tone: "gold" },
  ];

  function safe(value) {
    return format.escapeHtml(value === undefined || value === null ? "" : value);
  }

  function asset(path) {
    return new URL(path, document.baseURI).href;
  }

  function percent(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function number(value) {
    return format.formatNumber(Number(value) || 0);
  }

  function getInventoryCount(state, field) {
    return Number(state.inventory && state.inventory[field]) || 0;
  }

  function getActionMeta(actionKey) {
    return catActions.find(function (action) {
      return action.key === actionKey;
    }) || catActions[0];
  }

  function getActionItem(action) {
    return action.itemId && game.data.itemMap ? game.data.itemMap[action.itemId] : null;
  }

  function getActionImage(action) {
    var item = getActionItem(action);
    return item && item.image ? item.image : action.imagePath ? asset(action.imagePath) : asset("src/assets/rooms/furniture-bowl.png");
  }

  function getActionCount(action, state) {
    if (!action.inventoryField) {
      return null;
    }
    return getInventoryCount(state, action.inventoryField);
  }

  function getActionRequiredCount(action, cat) {
    return action.key === "feedBasic" || action.key === "feedPremium"
      ? game.systems.catSystem.getFoodUnitsNeeded(cat)
      : 1;
  }

  function canPerformAction(action, state, cat) {
    var count = getActionCount(action, state);
    return count === null || count >= getActionRequiredCount(action, cat);
  }

  function getStatusMeta(cat, isLocked, isDead, disease, visual) {
    if (isDead) {
      return { className: "is-danger", label: t("dead_label"), icon: visual.icon };
    }
    if (isLocked) {
      return { className: "is-warning", label: t("later_unlock"), icon: "◇" };
    }
    if (disease) {
      return { className: "is-warning", label: t("sick_state"), icon: visual.icon };
    }
    return { className: "is-success", label: t("alive_at_home"), icon: visual.icon };
  }

  function renderCatChip(cat, selectedId) {
    var selected = cat.id === selectedId;
    var isLocked = !cat.unlocked;
    var isDead = cat.isAlive === false;
    var visual = isLocked ? { icon: "◇", labelKey: "later_unlock" } : game.systems.catSystem.getCatVisualState(cat);
    var stateLabel = isLocked ? t("later_unlock") : isDead ? t("dead_label") : t(visual.labelKey);
    var className = "cat-roster-card";

    if (selected) className += " is-selected";
    if (isLocked) className += " is-locked";
    if (isDead) className += " is-dead";

    return (
      '<button type="button" class="' + className + '" data-select-cat="' + safe(cat.id) + '" aria-pressed="' + selected +
      '" aria-label="' + safe(getText(cat, "name") + " · " + getText(cat, "breed") + " · " + stateLabel) + '">' +
      '<span class="cat-roster-art"><img src="' + safe(game.utils.catArt.buildCatSvg(cat, 76)) + '" alt="" width="76" height="76" /></span>' +
      '<span class="cat-roster-copy"><strong>' + safe(getText(cat, "name")) + '</strong><span>' + safe(getText(cat, "breed")) + '</span></span>' +
      '<span class="cat-roster-status"><i aria-hidden="true"></i>' + safe(stateLabel) + '</span>' +
      '</button>'
    );
  }

  function renderUnlockInfo(cat) {
    var status = game.systems.catSystem.getUnlockStatus(cat);
    var goldPercent = status.requiredGold ? percent(status.currentGold / status.requiredGold * 100) : 100;
    var agePercent = status.requiredAge ? percent(status.currentAge / status.requiredAge * 100) : 100;

    if (status.isBaseCat || cat.unlocked) {
      return "";
    }

    return (
      '<section class="cat-unlock-card" aria-labelledby="cat-unlock-title"><div class="section-heading"><div>' +
      '<p class="section-eyebrow">' + t("cat_unlock_label") + '</p><h3 id="cat-unlock-title" class="panel-title">' +
      t("unlock_condition") + '</h3></div><span class="cat-lock-mark" aria-hidden="true">◇</span></div>' +
      '<p class="page-copy">' + t("cat_unlock_copy") + '</p><div class="cat-unlock-requirements">' +
      '<div class="cat-unlock-requirement ' + (status.goldReady ? "is-ready" : "") + '"><div class="cat-unlock-line"><span>' +
      t("gold") + '</span><strong>' + number(status.currentGold) + ' / ' + number(status.requiredGold) + '</strong></div>' +
      '<div class="cat-signal-track"><span style="width:' + goldPercent + '%" role="progressbar" aria-label="' + safe(t("gold")) +
      '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + goldPercent + '"></span></div><small>' +
      (status.goldReady ? t("unlock_gold_ready") : t("unlock_waiting")) + '</small></div>' +
      '<div class="cat-unlock-requirement ' + (status.ageReady ? "is-ready" : "") + '"><div class="cat-unlock-line"><span>' +
      t("age_label") + '</span><strong>' + safe(format.formatAgeYears(status.currentAge)) + ' / ' + safe(format.formatAgeYears(status.requiredAge)) +
      '</strong></div><div class="cat-signal-track"><span style="width:' + agePercent + '%" role="progressbar" aria-label="' +
      safe(t("age_label")) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + agePercent + '"></span></div><small>' +
      (status.ageReady ? t("unlock_age_ready") : t("unlock_waiting")) + '</small></div>' +
      '</div></section>'
    );
  }

  function renderCatSignal(cat, definition) {
    var value = percent(cat[definition.key]);
    var levelClass = value <= 25 ? " is-low" : value >= 80 ? " is-high" : "";

    return (
      '<div class="cat-signal cat-signal-' + definition.tone + levelClass + '"><div class="cat-signal-heading"><span>' +
      t(definition.labelKey) + '</span><strong>' + value + '</strong></div><div class="cat-signal-track"><span style="width:' +
      value + '%" role="progressbar" aria-label="' + safe(t(definition.labelKey)) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      value + '"></span></div></div>'
    );
  }

  function renderCatSignals(cat, isLocked) {
    if (isLocked) {
      return '<section class="cat-profile-section cat-profile-section-muted"><div class="cat-profile-section-heading"><p class="section-eyebrow">' +
        t("cat_state_snapshot") + '</p><h3 class="panel-title">' + t("later_unlock") + '</h3></div><p class="page-copy">' +
        t("cat_locked_state_copy") + '</p></section>';
    }

    return '<section class="cat-profile-section" aria-labelledby="cat-signals-title"><div class="cat-profile-section-heading"><p class="section-eyebrow">' +
      t("cat_state_snapshot") + '</p><h3 id="cat-signals-title" class="panel-title">' + t("cat_overview") + '</h3></div>' +
      '<div class="cat-signal-grid">' + statDefinitions.map(function (definition) {
        return renderCatSignal(cat, definition);
      }).join("") + '</div></section>';
  }

  function renderCatScene(cat, catVisual, isDead, isLocked, activeReaction, reactionCue) {
    var name = getText(cat, "name");

    return (
      '<div class="cat-profile-scene ' + (activeReaction ? "has-reaction" : "") + (isDead ? " is-dead" : "") + (isLocked ? " is-locked" : "") + '" data-cat-reaction="' +
      safe(activeReaction) + '"><img class="cat-profile-room" src="' + safe(asset("src/assets/rooms/room-storybook-empty.webp")) +
      '" alt="" width="1672" height="941" /><div class="cat-profile-room-tint" aria-hidden="true"></div><div class="cat-profile-cat-wrap">' +
      '<img class="cat-profile-cat" src="' + safe(game.utils.catArt.getCatStageUrl(cat)) + '" alt="' + safe(name) + '" width="280" height="280" />' +
      (reactionCue ? '<span class="cat-reaction-cue" aria-hidden="true">' + safe(reactionCue) + '</span>' : "") +
      '</div><div class="cat-profile-scene-caption"><span class="cat-scene-state-icon" aria-hidden="true">' + safe(catVisual.icon) +
      '</span><span><span class="mini-label">' + t("cat_portrait") + '</span><strong>' + t(catVisual.labelKey) +
      '</strong></span></div><span class="cat-profile-scene-stamp">' + (isDead ? t("dead_label") : isLocked ? t("later_unlock") : t("cat_home_stamp")) + '</span></div>'
    );
  }

  function renderNameEditor(cat) {
    return '<section class="cat-name-editor" aria-labelledby="cat-name-title"><div class="cat-name-editor-heading"><div><p class="section-eyebrow">' +
      t("cat_name") + '</p><h3 id="cat-name-title" class="panel-title">' + t("cat_name_editor_title") + '</h3></div><span class="cat-name-pencil" aria-hidden="true">✎</span></div>' +
      '<label class="sr-only" for="cat-name-input">' + t("cat_name") + '</label><input id="cat-name-input" class="field" type="text" maxlength="12" value="' +
      safe(getText(cat, "name")) + '" /><div class="cat-name-editor-footer"><button type="button" class="ghost-button" data-rename-cat="' +
      safe(cat.id) + '">' + t("rename_cat") + '</button><span class="helper-text">' + t("rename_hint") + '</span></div></section>';
  }

  function renderCatFacts(cat, disease) {
    var genderLabel = t(cat.gender === "female" ? "gender_female" : "gender_male");
    var diseaseLabel = disease ? getText(disease, "name") : t("disease_none");

    return '<div class="cat-fact-grid"><div class="cat-fact"><span class="mini-label">' + t("age_label") + '</span><strong>' +
      safe(format.formatAgeYears(game.systems.catSystem.getCatAgeYears(cat))) + '</strong></div><div class="cat-fact"><span class="mini-label">' +
      t("gender_label") + '</span><strong>' + genderLabel + (cat.isPregnant ? " · " + t("pregnancy_active") : "") +
      '</strong></div><div class="cat-fact cat-fact-wide"><span class="mini-label">' + t("disease_label") + '</span><strong>' +
      safe(diseaseLabel) + '</strong></div></div>';
  }

  function renderBondMeter(cat) {
    var value = percent(cat.intimacy);
    return '<section class="cat-bond-card" aria-labelledby="cat-bond-title"><div class="cat-bond-heading"><div><p class="section-eyebrow">' +
      t("cat_bond_label") + '</p><h3 id="cat-bond-title" class="panel-title">' + t("cat_bond_title") + '</h3></div><strong>' +
      value + '<small>/100</small></strong></div><div class="cat-bond-track"><span style="width:' + value +
      '%" role="progressbar" aria-label="' + safe(t("cat_bond_label")) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + value +
      '"></span></div><p class="helper-text">' + t("friendship_health", { intimacy: value, health: percent(cat.health) }) + '</p></section>';
  }

  function getRecommendedAction(cat, state, disease, isDead, isLocked) {
    var neededFood = game.systems.catSystem.getFoodUnitsNeeded(cat);
    var candidates = [];

    if (isDead || isLocked) {
      return null;
    }
    if (disease && getInventoryCount(state, "medicine") > 0) {
      candidates.push("medicine");
    }
    if (cat.hunger <= 85 && getInventoryCount(state, "food") >= neededFood) {
      candidates.push("feedBasic");
    }
    if (cat.clean <= 65 && getInventoryCount(state, "litter") > 0) {
      candidates.push("clean");
    }
    if (cat.health <= 55 && getInventoryCount(state, "medicine") > 0) {
      candidates.push("medicine");
    }
    if (cat.mood <= 55 && getInventoryCount(state, "toys") > 0) {
      candidates.push("play");
    }
    if (cat.energy <= 45) {
      candidates.push("rest");
    }
    if (cat.mood <= 65 && getInventoryCount(state, "catGrass") > 0) {
      candidates.push("catGrass");
    }
    if (cat.hunger <= 95 && getInventoryCount(state, "premiumFood") >= neededFood) {
      candidates.push("feedPremium");
    }

    return candidates[0] || "rest";
  }

  function renderRecommendation(actionKey, state, cat) {
    var action = getActionMeta(actionKey);
    var item = getActionItem(action);
    var actionLabel = t(action.labelKey);
    var actionCount = getActionCount(action, state);
    var effectText = item ? getText(item, "effectText") : t(action.effectKey);
    var detailText = item ? getText(item, "description") : t(action.copyKey);
    var stockText = actionCount === null
      ? t("cat_no_consumable")
      : t("cat_stock_label", { count: number(actionCount) });

    return '<section class="cat-recommendation" aria-labelledby="cat-recommendation-title"><div class="cat-recommendation-heading"><div>' +
      '<p class="section-eyebrow">' + t("cat_recommendation_label") + '</p><h3 id="cat-recommendation-title" class="panel-title">' +
      t("cat_recommendation_title") + '</h3></div><span class="cat-recommendation-badge">' + t("cat_recommendation_badge") + '</span></div>' +
      '<div class="cat-recommendation-body"><div class="cat-recommendation-art"><img src="' + safe(getActionImage(action)) + '" alt="' +
      safe(item ? getText(item, "name") : actionLabel) + '" width="160" height="120" decoding="async" /><span class="cat-recommendation-stock">' +
      safe(stockText) + '</span></div><div class="cat-recommendation-copy"><h4>' + safe(actionLabel) + '</h4><p>' + safe(detailText) +
      '</p><div class="cat-recommendation-meta"><span>' + safe(effectText) + '</span><span>' + safe(stockText) + '</span></div><button type="button" class="primary-button" data-cat-action="' +
      safe(action.key) + '" aria-label="' + safe(actionLabel) + '">' + t("cat_execute") + '</button></div></div><p class="cat-recommendation-note">' +
      t("cat_recommendation_copy", { name: safe(getText(cat, "name")) }) + '</p></section>';
  }

  function renderActionCard(action, state, cat) {
    var item = getActionItem(action);
    var count = getActionCount(action, state);
    var required = getActionRequiredCount(action, cat);
    var available = canPerformAction(action, state, cat);
    var actionLabel = t(action.labelKey);
    var detailText = item ? getText(item, "effectText") : t(action.effectKey);
    var stockText = count === null
      ? t("cat_no_consumable")
      : t("cat_stock_label", { count: number(count) });

    return '<button type="button" class="cat-action-card cat-action-' + action.tone + (!available ? " is-unavailable" : "") + '" data-cat-action="' +
      safe(action.key) + '" ' + (!available ? "disabled" : "") + ' aria-label="' + safe(actionLabel + " · " + stockText) + '"><span class="cat-action-art"><img src="' +
      safe(getActionImage(action)) + '" alt="" width="96" height="72" loading="lazy" decoding="async" /></span><span class="cat-action-copy"><strong>' +
      safe(actionLabel) + '</strong><span>' + safe(detailText) + '</span><small>' + safe(stockText) + (required > 1 ? " · " + t("cat_food_required", { count: required }) : "") +
      '</small></span></button>';
  }

  function renderCareActions(state, cat, disease, isDead, isLocked) {
    if (isDead) {
      return '<section class="cat-care-state is-dead"><div class="cat-care-state-heading"><span class="cat-care-state-icon" aria-hidden="true">🪦</span><div><p class="section-eyebrow">' +
        t("death_state") + '</p><h3 class="panel-title">' + t("cat_unavailable") + '</h3></div></div><p class="page-copy">' +
        t("death_desc", { name: safe(getText(cat, "name")) }) + '</p><div class="cat-readopt-action"><button type="button" class="secondary-button" data-readopt-cat="' +
        safe(cat.id) + '">' + t("readopt_action") + '</button><span class="helper-text">' + t("readopt_cost", { cost: game.config.readoptCost }) + '</span></div></section>';
    }

    if (isLocked) {
      return '<section class="cat-care-state is-locked"><div class="cat-care-state-heading"><span class="cat-care-state-icon" aria-hidden="true">◇</span><div><p class="section-eyebrow">' +
        t("cat_locked_label") + '</p><h3 class="panel-title">' + t("later_unlock") + '</h3></div></div><p class="page-copy">' +
        t("cat_locked_care_copy") + '</p></section>';
    }

    return '<section class="cat-action-section" aria-labelledby="cat-actions-title"><div class="section-heading"><div><p class="section-eyebrow">' +
      t("cat_action_label") + '</p><h3 id="cat-actions-title" class="panel-title">' + t("cat_actions_title") + '</h3></div><span class="pill">' +
      t("cat_action_count", { count: catActions.length }) + '</span></div><div class="cat-action-grid" role="group" aria-label="' +
      safe(t("cat_actions_title")) + '">' + catActions.map(function (action) {
        return renderActionCard(action, state, cat);
      }).join("") + '</div></section>';
  }

  function renderCountdownItem(cat, statKey, label, showDeathEta) {
    var nextDrop = game.systems.catSystem.getStatCountdown(cat, statKey);
    var deathEta = showDeathEta ? game.systems.catSystem.getHungerDeathEta(cat) : null;

    return '<li class="cat-time-row"><span>' + safe(label) + '</span><strong><span data-cat-stat-countdown data-cat-id="' + safe(cat.id) +
      '" data-cat-stat="' + safe(statKey) + '" aria-live="polite">' + (nextDrop === null ? t("stopped") : format.formatDuration(nextDrop)) +
      '</span></strong>' + (showDeathEta ? '<small>' + t("zero_eta") + ' · <span data-cat-hunger-zero data-cat-id="' + safe(cat.id) +
      '" aria-live="polite">' + (deathEta === null ? t("dead_label") : format.formatDuration(deathEta)) + '</span></small>' : "") + '</li>';
  }

  function renderStateChanges(cat, disease, isDead, isLocked) {
    if (isLocked) {
      return '<section class="cat-change-board" aria-labelledby="cat-change-title"><div class="section-heading"><div><p class="section-eyebrow">' +
        t("cat_state_changes_label") + '</p><h3 id="cat-change-title" class="panel-title">' + t("cat_state_changes_title") + '</h3></div><span class="pill">◇</span></div>' +
        '<div class="cat-change-card is-muted"><p class="page-copy">' + t("cat_locked_state_copy") + '</p></div></section>';
    }

    if (isDead) {
      return '<section class="cat-change-board" aria-labelledby="cat-change-title"><div class="section-heading"><div><p class="section-eyebrow">' +
        t("cat_state_changes_label") + '</p><h3 id="cat-change-title" class="panel-title">' + t("cat_state_changes_title") + '</h3></div><span class="pill">' +
        t("dead_label") + '</span></div><div class="cat-change-card is-muted"><p class="page-copy">' +
        t("death_desc", { name: safe(getText(cat, "name")) }) + '</p></div></section>';
    }

    var diseaseCountdown = game.systems.catSystem.getDiseaseProgressCountdown(cat);
    var diseaseMarkup = disease
      ? '<p class="cat-change-disease-name">' + safe(getText(disease, "name")) + '</p><p class="page-copy">' + t("cat_disease_active_copy", { disease: safe(getText(disease, "name")) }) +
        '</p><div class="cat-disease-timer"><span>' + t("next_worsen") + '</span><strong><span data-cat-disease-countdown data-cat-id="' + safe(cat.id) + '" aria-live="polite">' +
        (diseaseCountdown === null ? t("stopped") : format.formatDuration(diseaseCountdown)) + '</span></strong></div><button type="button" class="secondary-button cat-hospital-button" data-page-target="hospital">' +
        t("go_hospital") + '</button>'
      : '<p class="cat-change-disease-name">' + t("disease_none") + '</p><p class="page-copy">' + t("cat_no_disease_copy") + '</p><span class="status-pill is-success">' +
        t("cat_stable_badge") + '</span>';

    return '<section class="cat-change-board" aria-labelledby="cat-change-title"><div class="section-heading"><div><p class="section-eyebrow">' +
      t("cat_state_changes_label") + '</p><h3 id="cat-change-title" class="panel-title">' + t("cat_state_changes_title") + '</h3></div><span class="pill">' +
      (isDead ? t("dead_label") : t("realtime")) + '</span></div><div class="cat-change-grid"><article class="cat-change-card"><p class="section-eyebrow">' +
      t("cat_next_drop_label") + '</p><ul class="cat-time-list">' + renderCountdownItem(cat, "hunger", t("hunger_next_drop"), true) +
      renderCountdownItem(cat, "clean", t("clean_label"), false) + renderCountdownItem(cat, "mood", t("mood_label"), false) + '</ul></article><article class="cat-change-card ' +
      (disease ? "is-warning" : "is-calm") + '"><p class="section-eyebrow">' + t("cat_disease_progress_label") + '</p>' + diseaseMarkup + '</article></div></section>';
  }

  function renderSupplies(state, cat) {
    var supplyItems = [
      { itemId: "food_basic", field: "food" },
      { itemId: "food_premium", field: "premiumFood" },
      { itemId: "litter_basic", field: "litter" },
      { itemId: "toy_wand", field: "toys" },
      { itemId: "cat_grass", field: "catGrass" },
      { itemId: "medicine_basic", field: "medicine" },
    ];

    return '<section class="cat-supplies" aria-labelledby="cat-supplies-title"><div class="cat-supplies-heading"><div><p class="section-eyebrow">' +
      t("bag_inventory") + '</p><h3 id="cat-supplies-title" class="panel-title">' + t("cat_supplies_title") + '</h3></div><button type="button" class="text-link" data-page-target="shop">' +
      t("cat_shop_link") + '</button></div><div class="cat-supply-list">' + supplyItems.map(function (entry) {
        var item = game.data.itemMap[entry.itemId];
        return '<span class="cat-supply-chip"><img src="' + safe(item.image) + '" alt="" width="34" height="26" loading="lazy" decoding="async" /><strong>' +
          number(getInventoryCount(state, entry.field)) + '</strong><span>' + safe(getText(item, "name")) + '</span>';
      }).join("") + '</div><p class="helper-text">' + t("cat_supply_copy", { name: safe(getText(cat, "name")) }) + '</p></section>';
  }

  function renderPregnancy(cat) {
    if (!cat.isPregnant) {
      return "";
    }

    var countdown = game.systems.collectionSystem && game.systems.collectionSystem.getPregnancyCountdown
      ? game.systems.collectionSystem.getPregnancyCountdown(cat)
      : null;

    return '<section class="cat-extra-note is-pregnant"><p class="section-eyebrow">' + t("pregnancy_status") + '</p><h3 class="panel-title">' +
      t("pregnancy_active") + '</h3><p class="page-copy">' + t("pregnancy_food_hint", { count: game.systems.catSystem.getFoodUnitsNeeded(cat) }) +
      (countdown !== null ? '<br />' + t("pregnancy_due") + "：" + format.formatDuration(countdown) : "") + '</p></section>';
  }

  function renderCatPanel(state) {
    var cats = state.cats || [];
    var selectedCat = cats.find(function (cat) {
      return cat.id === game.state.selectedCatId;
    }) || cats.find(function (cat) {
      return cat.unlocked;
    }) || cats[0];

    if (!selectedCat) {
      return '<section class="empty-state"><h2 class="panel-title">' + t("page_cats") + '</h2><p>' + t("no_cat_data") + '</p></section>';
    }

    var isDead = selectedCat.isAlive === false;
    var isLocked = !selectedCat.unlocked;
    var catVisual = isLocked ? { icon: "◇", labelKey: "later_unlock" } : game.systems.catSystem.getCatVisualState(selectedCat);
    var catDisease = game.systems.catSystem.getCatDisease(selectedCat);
    var status = getStatusMeta(selectedCat, isLocked, isDead, catDisease, catVisual);
    var activeReaction = game.utils.catArt.getCatReaction(selectedCat);
    var reactionCue = game.utils.catArt.getCatReactionCue(selectedCat);
    var recommendedAction = getRecommendedAction(selectedCat, state, catDisease, isDead, isLocked);

    return '<section class="page-header cat-page-intro"><div class="page-card cat-intro-card"><p class="section-eyebrow">' + t("page_cats") + '</p><h2 class="page-title">' +
      t("cat_journal_label") + '</h2><p class="page-copy">' + t("cat_journal_copy") + '</p><div class="cat-intro-rule" aria-hidden="true"></div><span class="cat-intro-note">' +
      t("cats_panel_copy") + '</span></div><div class="page-card cat-intro-note-card"><p class="section-eyebrow">' + t("interaction_info") + '</p><p class="page-copy">' +
      t("cat_interaction_copy") + '</p><div class="cat-intro-status"><span class="cat-intro-status-icon" aria-hidden="true">' + safe(status.icon) + '</span><span><small>' +
      t("current_cat") + '</small><strong>' + safe(getText(selectedCat, "name")) + ' · ' + safe(getText(selectedCat, "breed")) + '</strong></span><span class="status-pill ' +
      status.className + '">' + status.label + '</span></div></div></section><section class="cat-journal-layout cat-layout"><aside class="cat-roster" aria-label="' +
      safe(t("cat_roster_label")) + '"><div class="cat-roster-heading"><div><p class="section-eyebrow">' + t("cat_roster_label") + '</p><h3 class="panel-title">' +
      t("cat_roster_title") + '</h3></div><span class="pill">' + cats.length + '</span></div><div class="cat-roster-list">' + cats.map(function (cat) {
        return renderCatChip(cat, selectedCat.id);
      }).join("") + '</div><p class="cat-roster-help">' + t("cat_roster_copy") + '</p></aside><div class="cat-journal-spread"><section class="page-card cat-journal-profile" aria-labelledby="cat-profile-title">' +
      '<div class="cat-profile-heading"><div><p class="section-eyebrow">' + t("cat_profile_label") + '</p><h2 id="cat-profile-title" class="page-title">' + safe(getText(selectedCat, "name")) +
      '</h2><p class="cat-profile-breed">' + safe(getText(selectedCat, "breed")) + '</p></div><span class="status-pill ' + status.className + '"><span aria-hidden="true">' +
      safe(status.icon) + '</span>' + status.label + '</span></div>' + renderCatScene(selectedCat, catVisual, isDead, isLocked, activeReaction, reactionCue) + renderCatFacts(selectedCat, catDisease) +
      (isLocked ? renderUnlockInfo(selectedCat) : renderNameEditor(selectedCat) + renderBondMeter(selectedCat)) + renderCatSignals(selectedCat, isLocked) + '</section><section class="page-card cat-journal-care" aria-labelledby="cat-care-title">' +
      '<div class="cat-care-heading"><div><p class="section-eyebrow">' + t("cat_today_label") + '</p><h2 id="cat-care-title" class="page-title">' + t("cat_today_title") + '</h2></div><span class="cat-care-date">' +
      t("cat_today_badge") + '</span></div><p class="page-copy cat-care-copy">' + t("cat_today_copy", { name: safe(getText(selectedCat, "name")) }) + '</p>' +
      (recommendedAction ? renderRecommendation(recommendedAction, state, selectedCat) : "") + renderCareActions(state, selectedCat, catDisease, isDead, isLocked) +
      (!isDead && !isLocked ? renderSupplies(state, selectedCat) : "") + renderPregnancy(selectedCat) + renderStateChanges(selectedCat, catDisease, isDead, isLocked) +
      (!isLocked ? '<section class="cat-care-tips"><p class="section-eyebrow">' + t("care_tips") + '</p><p class="page-copy">' + t("care_tips_copy") + '</p></section>' : "") +
      '</section></div></section>';
  }

  game.ui.renderCatPanel = renderCatPanel;
})(window.CatGame);
