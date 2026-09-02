(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function safe(value) {
    return format.escapeHtml(String(value == null ? "" : value));
  }

  function asset(path) {
    return new URL(path, document.baseURI).href;
  }

  function getUnlockedCats(state) {
    return (state.cats || []).filter(function (cat) {
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
    var activeSleep = game.systems.playerSystem.getActiveSleep();

    if (sick) {
      return {
        title: t("headline_sick_title", { name: getText(sick, "name") }),
        copy: t("headline_sick_copy", { health: sick.health }),
        button: t("go_hospital"), page: "hospital", routeKey: "care",
      };
    }
    if (hungry) {
      if (state.inventory.food <= 0) {
        return {
          title: t("headline_hungry_title", { name: getText(hungry, "name") }),
          copy: t("headline_hungry_empty_copy", { value: hungry.hunger }),
          button: t("headline_buy_cat_food"), page: "shop", routeKey: "shop",
        };
      }
      return {
        title: t("headline_hungry_title", { name: getText(hungry, "name") }),
        copy: t("headline_hungry_copy", { value: hungry.hunger }),
        button: t("headline_feed_now"), action: "feedBasic", catId: hungry.id, routeKey: "care",
      };
    }
    if (dirty) {
      if (state.inventory.litter <= 0) {
        return {
          title: t("headline_dirty_title", { name: getText(dirty, "name") }),
          copy: t("headline_dirty_empty_copy", { value: dirty.clean }),
          button: t("headline_buy_litter"), page: "shop", routeKey: "shop",
        };
      }
      return {
        title: t("headline_dirty_title", { name: getText(dirty, "name") }),
        copy: t("headline_dirty_copy", { value: dirty.clean }),
        button: t("headline_clean_now"), action: "clean", catId: dirty.id, routeKey: "care",
      };
    }
    if (activeSleep) {
      return {
        title: t("headline_sleep_title"),
        copy: t("headline_sleep_copy"),
        button: t("wake_action"), playerSleep: true, routeKey: "sleep",
      };
    }
    if (playerHunger >= hungerBlockThreshold) {
      return { title: t("headline_player_hungry_title"), copy: t("headline_player_hungry_copy"), button: t("headline_buy_food"), page: "shop", routeKey: "shop" };
    }
    if (work) {
      return {
        title: t("headline_work_title", { job: getText(job, "name") }),
        copy: t("headline_work_copy"), button: t("headline_view_work"), page: "work", routeKey: "work",
      };
    }
    return { title: t("headline_calm_title"), copy: t("headline_calm_copy"), button: t("headline_go_work"), page: "work", routeKey: "work" };
  }

  function renderHeadlineAction(headline, className) {
    var buttonClass = className || "primary-button";

    if (headline.playerSleep) {
      return '<button class="' + buttonClass + '" type="button" data-player-sleep>' + safe(headline.button) + "</button>";
    }
    if (headline.action) {
      return '<button class="' + buttonClass + '" type="button" data-cat-action="' + safe(headline.action) + '" data-cat-id="' +
        safe(headline.catId) + '">' + safe(headline.button) + "</button>";
    }
    return '<button class="' + buttonClass + '" type="button" data-page-target="' + safe(headline.page) + '">' +
      safe(headline.button) + "</button>";
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

  function getJournalDate() {
    var now = game.systems.timeSystem.getNow();
    var dateKey = format.formatDateKey(now).split("-");
    var year = Number(dateKey[0]);
    var month = Number(dateKey[1]);
    var day = Number(dateKey[2]);
    var language = game.utils.i18n.getLanguage();
    var weekdays = language === "en"
      ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
      : language === "ja"
        ? ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"]
        : ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    var dateLabel = language === "en"
      ? month + "/" + day + "/" + year
      : language === "ja"
        ? year + "年" + month + "月" + day + "日"
        : year + " 年 " + month + " 月 " + day + " 日";

    return t("home_journal_date", { date: dateLabel, weekday: weekdays[now.getDay()] });
  }

  function getRouteSteps() {
    return [
      { key: "care", titleKey: "home_route_care_title", copyKey: "home_route_care_copy", image: "src/assets/shop/shop-bowl.jpg" },
      { key: "work", titleKey: "home_route_work_title", copyKey: "home_route_work_copy", image: "src/assets/jobs/job-flyer.svg" },
      { key: "shop", titleKey: "home_route_shop_title", copyKey: "home_route_shop_copy", image: "src/assets/jobs/job-store.svg" },
      { key: "room", titleKey: "home_route_room_title", copyKey: "home_route_room_copy", image: "src/assets/shop/shop-litter.jpg" },
      { key: "sleep", titleKey: "home_route_sleep_title", copyKey: "home_route_sleep_copy", image: "src/assets/poses/nap.png" },
    ];
  }

  function getRouteContext(state, headline, needy) {
    var activeSleep = game.systems.playerSystem.getActiveSleep();
    var routeKey = activeSleep ? "sleep" : headline.routeKey || "work";
    var steps = getRouteSteps();

    return {
      currentKey: routeKey,
      currentIndex: Math.max(0, steps.findIndex(function (step) { return step.key === routeKey; })),
      needy: needy,
      activeSleep: activeSleep,
      state: state,
    };
  }

  function getRouteTitle(step, headline) {
    if (step.key === "care" && headline.action === "clean") {
      return t("headline_clean_now");
    }
    if (step.key === "care" && headline.page === "hospital") {
      return t("go_hospital");
    }
    return t(step.titleKey);
  }

  function isRouteComplete(step, context) {
    var player = context.state.player;

    if (step.key === "care") {
      return context.needy.length === 0 && context.currentKey !== "care";
    }
    if (step.key === "work") {
      return Number(player.workTimesToday || 0) > 0 && !player.activeWork && context.currentKey !== "work";
    }
    return false;
  }

  function renderRouteEntry(step, index, context, headline) {
    var isCurrent = step.key === context.currentKey;
    var isComplete = !isCurrent && isRouteComplete(step, context);
    var status = isCurrent ? t("home_route_now") : isComplete ? t("home_route_done") : t("home_route_not_started");
    var copy = isCurrent && step.key === "care" && (headline.action === "clean" || headline.page === "hospital")
      ? headline.copy
      : t(step.copyKey);
    var stateClass = isCurrent ? " is-now" : isComplete ? " is-done" : "";
    var currentAction = isCurrent
      ? '<div class="home-route-action">' + renderHeadlineAction(headline, "primary-button") + "</div>"
      : "";

    return (
      '<article class="home-route-entry' + stateClass + '" data-home-route="' + safe(step.key) + '" data-home-route-index="' + index + '">' +
      '<div class="home-route-node" aria-hidden="true"></div><div class="home-route-image"><img src="' + safe(asset(step.image)) +
      '" alt="" width="112" height="88" loading="lazy" decoding="async" /></div><div class="home-route-content"><div class="home-route-heading"><h4>' +
      safe(getRouteTitle(step, headline)) + '</h4><span class="home-route-status">' + safe(status) + '</span></div><p>' + safe(copy) +
      '</p>' + currentAction + '</div></article>'
    );
  }

  function renderRoute(state, headline, needy) {
    var context = getRouteContext(state, headline, needy);
    var entries = getRouteSteps().map(function (step, index) {
      return renderRouteEntry(step, index, context, headline);
    }).join("");

    return '<section class="home-route-panel" aria-labelledby="home-route-title"><div class="home-route-heading-row"><div><p class="section-eyebrow">' +
      safe(t("home_route_label")) + '</p><h3 id="home-route-title" class="panel-title">' + safe(t("home_route_title")) +
      '</h3></div><span class="home-route-context">' + safe(t("home_route_context")) + '</span></div><div class="home-route-track">' +
      entries + "</div></section>";
  }

  function renderTaskList(state) {
    var tasks = state.tasks && Array.isArray(state.tasks.daily) ? state.tasks.daily.slice(0, 3) : [];

    if (!tasks.length) {
      return '<p class="helper-text">' + safe(t("unfinished")) + "</p>";
    }

    return tasks.map(function (task) {
      var current = Number(task.progress || 0);
      var target = Number(task.target || 0);
      var completed = Boolean(task.claimed || (target > 0 && current >= target));
      return '<div class="home-task-row ' + (completed ? "is-complete" : "") + '"><span class="home-task-check" aria-hidden="true"></span>' +
        '<span class="home-task-title">' + safe(getText(task, "title")) + '</span><strong>' + current + " / " + target + "</strong></div>";
    }).join("");
  }

  function getWorkProgress(activeWork) {
    var startedAt = activeWork ? new Date(activeWork.startedAt).getTime() : 0;
    var endsAt = activeWork ? new Date(activeWork.endsAt).getTime() : 0;

    if (!activeWork || !Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) {
      return 0;
    }
    return format.toPercent(game.systems.timeSystem.getNow().getTime() - startedAt, endsAt - startedAt);
  }

  function getJobImage(job) {
    return asset(job && job.iconPath ? job.iconPath : "src/assets/jobs/job-flyer.svg");
  }

  function renderWorkSummary(state) {
    var activeWork = state.player.activeWork;
    var activeJob = activeWork ? game.data.jobMap[activeWork.jobId] || activeWork : null;
    var jobName = activeJob ? getText(activeJob, "name") : "";
    var workContent;

    if (activeWork) {
      var progress = getWorkProgress(activeWork);
      workContent = '<div class="home-work-state is-active"><div class="home-work-visual"><img src="' + safe(getJobImage(activeJob)) +
        '" alt="" width="84" height="84" decoding="async" /></div><div class="home-work-copy"><span class="status-pill is-success" data-work-live-status>' +
        safe(t("work_scene_active")) + '</span><h4>' + safe(jobName || t("current_work")) + '</h4><p>' + safe(t("work_active_copy")) +
        '</p><strong class="home-work-remaining" data-active-work-remaining>' + safe(format.formatDuration(game.systems.workSystem.getRemainingMs(activeWork))) +
        '</strong><div class="home-work-progress"><div class="bar-track"><div class="bar-fill is-normal" data-active-work-progress role="progressbar" aria-label="' +
        safe(t("work_active_progress")) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + progress + '" style="width:' + progress +
        '%"></div></div></div></div></div>';
    } else {
      workContent = '<div class="home-work-state"><div class="home-work-visual"><img src="' + safe(getJobImage(null)) +
        '" alt="" width="84" height="84" decoding="async" /></div><div class="home-work-copy"><h4>' + safe(t("home_work_idle_title")) +
        '</h4><p>' + safe(t("home_work_idle_copy")) + '</p><button class="primary-button" type="button" data-page-target="work">' +
        safe(t("headline_go_work")) + "</button></div></div>";
    }

    var home = state.home || {};
    var inventory = state.inventory || {};
    return '<section class="home-journal-work" aria-labelledby="home-work-title"><div class="section-heading"><div><p class="section-eyebrow">' +
      safe(t("current_work")) + '</p><h3 id="home-work-title" class="panel-title">' + safe(t("home_work_panel_title")) + '</h3></div>' +
      '<button class="text-link" type="button" data-page-target="work">' + safe(t("headline_view_work")) + ' →</button></div>' + workContent +
      '<dl class="home-work-facts"><div><dt>' + safe(t("comfort_label")) + '</dt><dd>' + safe(home.comfortScore || 0) + '</dd></div><div><dt>' +
      safe(t("placed_furniture")) + '</dt><dd>' + safe(Array.isArray(home.placedFurniture) ? home.placedFurniture.length : 0) + '</dd></div><div><dt>' +
      safe(t("bag_inventory")) + '</dt><dd>' + safe(Number(inventory.food || 0) + " / " + Number(inventory.litter || 0) + " / " + Number(inventory.toys || 0)) +
      '</dd></div></dl></section>';
  }

  function renderCareSummary(needy) {
    if (needy.length <= 1) {
      return "";
    }

    return '<section class="home-care-summary" aria-labelledby="home-care-summary-title"><div class="section-heading"><div><p class="section-eyebrow">' +
      safe(t("care_list_title")) + '</p><h3 id="home-care-summary-title" class="panel-title">' + safe(t("care_list_need", { count: needy.length })) +
      '</h3></div><button class="text-link" type="button" data-page-target="cats">' + safe(t("headline_all_cats")) + ' →</button></div><div class="home-care-links">' +
      needy.slice(0, 3).map(function (cat) {
        return '<button class="ghost-button" type="button" data-page-target="cats" data-select-cat="' + safe(cat.id) + '">' +
          safe(getText(cat, "name")) + ' · ' + safe(getCatState(cat).label) + '</button>';
      }).join("") + "</div></section>";
  }

  function renderScene(stageCat, stageCondition) {
    if (!stageCat) {
      return '<div class="cat-stage-art home-journal-scene is-empty"><img class="home-journal-room" src="' + safe(asset("src/assets/home/home-house-scene.webp")) +
        '" alt="" width="1672" height="941" decoding="async" /><span class="home-scene-empty-copy">' + safe(t("no_cat_data")) + "</span></div>";
    }

    var name = getText(stageCat, "name");
    var reaction = game.utils.catArt.getCatReaction(stageCat);
    return '<div class="cat-stage-art home-journal-scene ' + (reaction ? "has-reaction" : "") + '" data-cat-reaction="' + safe(reaction) + '">' +
      '<img class="home-journal-cat" src="' + safe(game.utils.catArt.getCatStageUrl(stageCat)) + '" alt="' + safe(name) + '" width="420" height="420" decoding="async" />' +
      '<img class="home-journal-room" src="' + safe(asset("src/assets/home/home-house-scene.webp")) + '" alt="" width="1200" height="800" decoding="async" />' +
      '<div class="home-scene-caption"><span>' + safe(t("cat_home_stamp")) + '</span><strong>' + safe(name) + '</strong><span class="status-pill ' +
      safe(stageCondition.className) + '">' + safe(stageCondition.label) + '</span></div></div>';
  }

  function renderHome(state) {
    var headline = getHeadline(state);
    var needy = getNeedyCats(state);
    var unlockedCats = getUnlockedCats(state);
    var stageCat = needy[0] || unlockedCats[0];
    var stageCondition = stageCat ? getCatState(stageCat) : null;
    var scene = renderScene(stageCat, stageCondition);

    return '<section class="home-journal-page home-cat-stage" aria-labelledby="home-journal-title"><div class="home-journal-cover"><div class="home-journal-intro">' +
      '<p class="home-journal-date">' + safe(getJournalDate()) + '</p><h2 id="home-journal-title">' + safe(t("home_journal_title")) +
      '</h2><p class="home-journal-copy">' + safe(t("home_journal_copy")) + '</p></div>' + scene +
      '</div>' + renderRoute(state, headline, needy) + renderCareSummary(needy) + '<div class="home-journal-divider"></div><div class="home-journal-lower"><section class="home-journal-tasks" aria-labelledby="home-tasks-title"><div class="section-heading"><div><h3 id="home-tasks-title" class="panel-title">' +
      safe(t("home_tasks_panel_title")) + '</h3></div><button class="text-link" type="button" data-page-target="tasks">' +
      safe(t("go_tasks_claim")) + ' →</button></div><div class="home-task-list">' + renderTaskList(state) + '</div></section>' + renderWorkSummary(state) + '</div></section>';
  }

  game.ui.renderHome = renderHome;
})(window.CatGame);
