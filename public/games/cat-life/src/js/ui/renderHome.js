(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function getUnlockedCats(state) {
    return state.cats.filter(function (cat) {
      return cat.unlocked && cat.isAlive !== false;
    });
  }

  function getNeedyCats(state) {
    return getUnlockedCats(state).filter(function (cat) {
      return cat.hunger <= 30 || cat.clean <= 30 || game.systems.catSystem.getCatDisease(cat);
    });
  }

  function getHeadline(state) {
    var cats = getUnlockedCats(state);
    var sick = cats.find(function (cat) { return game.systems.catSystem.getCatDisease(cat); });
    var hungry = cats.filter(function (cat) { return cat.hunger <= 30; }).sort(function (a, b) { return a.hunger - b.hunger; })[0];
    var dirty = cats.filter(function (cat) { return cat.clean <= 30; }).sort(function (a, b) { return a.clean - b.clean; })[0];
    var playerHunger = game.systems.playerSystem.getCurrentHunger();
    var hungerBlockThreshold = game.config.playerCondition.hungerBlockThreshold;
    var work = state.player.activeWork;
    var job = work ? game.data.jobMap[work.jobId] || work : null;

    if (sick) {
      return {
        title: t("headline_sick_title", { name: getText(sick, "name") }),
        copy: t("headline_sick_copy", { health: sick.health }),
        button: t("go_hospital"), page: "hospital",
      };
    }
    if (hungry) {
      if (state.inventory.food <= 0) {
        return {
          title: t("headline_hungry_title", { name: getText(hungry, "name") }),
          copy: t("headline_hungry_empty_copy", { value: hungry.hunger }),
          button: t("headline_buy_cat_food"), page: "shop",
        };
      }
      return {
        title: t("headline_hungry_title", { name: getText(hungry, "name") }),
        copy: t("headline_hungry_copy", { value: hungry.hunger }),
        button: t("headline_feed_now"), action: "feedBasic", catId: hungry.id,
      };
    }
    if (dirty) {
      if (state.inventory.litter <= 0) {
        return {
          title: t("headline_dirty_title", { name: getText(dirty, "name") }),
          copy: t("headline_dirty_empty_copy", { value: dirty.clean }),
          button: t("headline_buy_litter"), page: "shop",
        };
      }
      return {
        title: t("headline_dirty_title", { name: getText(dirty, "name") }),
        copy: t("headline_dirty_copy", { value: dirty.clean }),
        button: t("headline_clean_now"), action: "clean", catId: dirty.id,
      };
    }
    if (playerHunger >= hungerBlockThreshold) {
      return { title: t("headline_player_hungry_title"), copy: t("headline_player_hungry_copy"), button: t("headline_buy_food"), page: "shop" };
    }
    if (work) {
      return {
        title: t("headline_work_title", { job: getText(job, "name") }),
        copy: t("headline_work_copy"), button: t("headline_view_work"), page: "work",
      };
    }
    return { title: t("headline_calm_title"), copy: t("headline_calm_copy"), button: t("headline_go_work"), page: "work" };
  }

  function renderHeadlineAction(headline) {
    if (headline.action) {
      return '<button class="primary-button" data-cat-action="' + format.escapeHtml(headline.action) + '" data-cat-id="' +
        format.escapeHtml(headline.catId) + '">' + format.escapeHtml(headline.button) + '</button>';
    }
    return '<button class="primary-button" data-page-target="' + format.escapeHtml(headline.page) + '">' +
      format.escapeHtml(headline.button) + '</button>';
  }

  function getCatState(cat) {
    if (game.systems.catSystem.getCatDisease(cat)) {
      return { label: t("cat_state_sick"), className: "is-alert", copy: t("cat_state_sick_copy"), page: "hospital" };
    }
    if (cat.hunger <= 30) {
      return { label: t("cat_state_hungry"), className: "is-alert", copy: t("cat_state_hungry_copy", { value: cat.hunger }), action: "feedBasic" };
    }
    if (cat.clean <= 30) {
      return { label: t("cat_state_dirty"), className: "is-cyan", copy: t("cat_state_dirty_copy", { value: cat.clean }), action: "clean" };
    }
    return { label: t("cat_state_well"), className: "", copy: t("cat_state_well_copy"), action: "play" };
  }

  function renderCatCareCard(cat, state) {
    var condition = getCatState(cat);
    var needsShop = (condition.action === "feedBasic" && state.inventory.food <= 0) ||
      (condition.action === "clean" && state.inventory.litter <= 0);
    var shopLabel = condition.action === "clean" ? t("headline_buy_litter") : t("headline_buy_cat_food");
    var mainAction = condition.page
      ? '<button class="secondary-button" data-page-target="' + condition.page + '">' + t("go_hospital") + '</button>'
      : needsShop
      ? '<button class="secondary-button" data-page-target="shop">' + shopLabel + '</button>'
      : '<button class="secondary-button" data-cat-action="' + format.escapeHtml(condition.action) + '" data-cat-id="' +
        format.escapeHtml(cat.id) + '">' +
        t(condition.action === "feedBasic" ? "headline_feed_now" : condition.action === "clean" ? "headline_clean_now" : "play_action") + '</button>';

    return (
      '<article class="care-card"><div class="cat-news-photo halftone"><img src="' + game.utils.catArt.buildCatSvg(cat, 144) +
      '" alt="' + format.escapeHtml(getText(cat, "name")) + '" /></div><div class="care-card-copy"><div class="care-card-title"><h4>' +
      format.escapeHtml(getText(cat, "name")) + '</h4><span class="tag ' + condition.className + '">' + format.escapeHtml(condition.label) +
      '</span></div><p>' + format.escapeHtml(condition.copy) + '</p><div class="compact-actions">' + mainAction +
      '<button class="ghost-button" data-page-target="cats" data-select-cat="' + format.escapeHtml(cat.id) + '">' + t("cat_details") +
      '</button></div></div></article>'
    );
  }

  function renderHome(state) {
    var headline = getHeadline(state);
    var needy = getNeedyCats(state);
    var careCats = (needy.length ? needy : getUnlockedCats(state)).slice(0, 3);
    var activeWork = state.player.activeWork;
    var activeJob = activeWork ? game.data.jobMap[activeWork.jobId] || activeWork : null;
    var furniture = game.systems.homeSystem.getPlacedFurniture();

    return (
      '<section class="headline"><p class="section-eyebrow">' + t("today_headline") + '</p><h2>' + format.escapeHtml(headline.title) +
      '</h2><p class="headline-deck">' + format.escapeHtml(headline.copy) + '</p><div class="headline-actions">' + renderHeadlineAction(headline) +
      '<button class="ghost-button" data-page-target="cats">' + t("headline_all_cats") + '</button></div></section>' +
      '<div class="editorial-divider"></div>' +
      '<section class="dashboard-grid"><div><div class="section-heading"><h3>' + t("care_list_title") + '</h3><span>' +
      (needy.length ? t("care_list_need", { count: needy.length }) : t("care_list_clear")) + '</span></div><div class="care-list">' +
      careCats.map(function (cat) { return renderCatCareCard(cat, state); }).join("") + '</div></div>' +
      '<aside class="dashboard-rail"><section><div class="section-heading"><h3>' + t("today_tasks_title") + '</h3></div><div class="task-brief-list">' +
      state.tasks.daily.map(function (task) { return game.ui.helpers.renderTaskBadge(getText(task, "title"), task.progress, task.target); }).join("") +
      '</div><button class="text-link" data-page-target="tasks">' + t("go_tasks_claim") + ' →</button></section>' +
      '<section><div class="section-heading"><h3>' + t("current_work") + '</h3></div>' +
      (activeWork ? '<p class="rail-number" data-active-work-remaining>' + format.formatDuration(game.systems.workSystem.getRemainingMs(activeWork)) +
        '</p><p>' + format.escapeHtml(getText(activeJob, "name")) + '</p>' : '<p>' + t("home_no_work_copy") + '</p>') +
      '<button class="text-link" data-page-target="work">' + t("headline_view_work") + ' →</button></section>' +
      '<section><div class="section-heading"><h3>' + t("home_status") + '</h3></div><dl class="home-facts"><div><dt>' + t("comfort_label") +
      '</dt><dd>' + state.home.comfortScore + '</dd></div><div><dt>' + t("placed_furniture") + '</dt><dd>' + furniture.length +
      '</dd></div><div><dt>' + t("bag_inventory") + '</dt><dd>' + state.inventory.food + ' / ' + state.inventory.litter + ' / ' + state.inventory.toys +
      '</dd></div></dl></section></aside></section>'
    );
  }

  game.ui.renderHome = renderHome;
})(window.CatGame);
