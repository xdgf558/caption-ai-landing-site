(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;

  var groups = [
    { label: "nav_group_life", pages: ["home", "work", "bank", "shop", "member_store"] },
    { label: "nav_group_cats", pages: ["cats", "hospital", "collection"] },
    { label: "nav_group_town", pages: ["community", "arcade", "tasks"] },
    { label: "nav_group_system", pages: ["version", "save", "settings"] },
  ];

  var mobilePages = ["home", "work", "cats", "community", "more"];
  var mobileMarks = {
    home: "⌂",
    work: "◆",
    cats: "●",
    community: "▦",
    more: "•••",
  };
  var desktopMarks = {
    home: "⌂", work: "▣", bank: "◇", shop: "▤", member_store: "★",
    cats: "猫", hospital: "+", collection: "▥", community: "⌖", arcade: "◎",
    tasks: "✓", version: "i", save: "▧", settings: "⚙",
  };

  function getCounts(state) {
    var needy = state.cats.filter(function (cat) {
      return cat.unlocked && cat.isAlive !== false && (cat.hunger <= 30 || cat.clean <= 30 || game.systems.catSystem.getCatDisease(cat));
    }).length;
    var sick = game.systems.hospitalSystem.getSickCats().length;
    var claimable = ["tutorial", "daily", "achievements"].reduce(function (total, category) {
      return total + (state.tasks[category] || []).filter(function (task) {
        return !task.claimed && task.progress >= task.target;
      }).length;
    }, 0);

    return { needy: needy, sick: sick, claimable: claimable };
  }

  function renderBadge(page, state, counts) {
    if (page === "work" && state.player.activeWork) {
      return '<span class="nav-dot" aria-label="' + format.escapeHtml(t("work_in_progress")) + '"></span>';
    }
    if (page === "cats" && counts.needy) {
      return '<span class="nav-badge is-alert">' + counts.needy + "</span>";
    }
    if (page === "hospital" && counts.sick) {
      return '<span class="nav-badge is-alert">' + counts.sick + "</span>";
    }
    if (page === "tasks" && counts.claimable) {
      return '<span class="nav-badge">' + counts.claimable + "</span>";
    }
    return "";
  }

  function renderDesktopNavigation(state) {
    var counts = getCounts(state);
    return groups.map(function (group) {
      return (
        '<section class="nav-group"><p class="nav-group-title">' + t(group.label) + "</p>" +
        group.pages.map(function (page) {
          return (
            '<button class="nav-button" data-page-target="' + page + '"><span class="nav-mark" aria-hidden="true">' +
            desktopMarks[page] + '</span><span class="nav-label">' + t("nav_" + page) + "</span>" +
            renderBadge(page, state, counts) + "</button>"
          );
        }).join("") +
        "</section>"
      );
    }).join("");
  }

  function renderMobileNavigation(state) {
    var counts = getCounts(state);
    return mobilePages.map(function (page) {
      var isMoreActive = page === "more" && ["home", "work", "cats", "community"].indexOf(game.state.currentPage) === -1;
      return (
        '<button class="mobile-nav-button" data-page-target="' + page + '" aria-label="' + format.escapeHtml(t("nav_" + page)) + '">' +
        '<span class="mobile-nav-mark" aria-hidden="true">' + mobileMarks[page] + "</span>" +
        '<span>' + t("nav_" + page) + "</span>" +
        (page === "cats" ? renderBadge("cats", state, counts) : "") +
        (isMoreActive ? '<span class="mobile-current-dot" aria-hidden="true"></span>' : "") +
        "</button>"
      );
    }).join("");
  }

  game.ui.renderDesktopNavigation = renderDesktopNavigation;
  game.ui.renderMobileNavigation = renderMobileNavigation;
  game.ui.getNavigationCounts = getCounts;
})(window.CatGame);
