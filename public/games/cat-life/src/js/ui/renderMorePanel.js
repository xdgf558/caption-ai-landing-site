(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;

  function renderMorePanel(state) {
    var counts = game.ui.getNavigationCounts(state);
    var bank = game.systems.bankSystem.getBank();
    var unlockedCats = state.cats.filter(function (cat) { return cat.unlocked; }).length;
    var totalCats = state.cats.length;
    var dailyDone = state.tasks.daily.filter(function (task) { return task.claimed; }).length;
    var language = game.utils.i18n.getLanguage();
    var items = [
      { page: "bank", meta: t("more_bank_meta", { amount: format.formatNumber(bank.balance) }) },
      { page: "shop", meta: t("more_shop_meta") },
      { page: "hospital", meta: t("more_hospital_meta", { count: counts.sick }) },
      { page: "collection", meta: t("more_collection_meta", { current: unlockedCats, total: totalCats }) },
      { page: "arcade", meta: t("more_arcade_meta") },
      { page: "tasks", meta: t("more_tasks_meta", { current: dailyDone, total: state.tasks.daily.length }) },
      { page: "version", meta: t("more_version_meta", { version: game.config.version }) },
      { page: "save", meta: t("more_save_meta") },
      { page: "settings", meta: t("more_settings_meta", { language: language }) },
    ];

    return (
      '<section class="page-intro"><p class="section-eyebrow">' + t("nav_more") + '</p><h2 class="page-title">' + t("more_title") +
      '</h2><p class="page-copy">' + t("more_copy") + "</p></section>" +
      '<section class="more-grid">' + items.map(function (item) {
        return '<button class="more-link" data-page-target="' + item.page + '"><strong>' + t("nav_" + item.page) +
          '</strong><span>' + item.meta + "</span></button>";
      }).join("") + "</section>"
    );
  }

  game.ui.renderMorePanel = renderMorePanel;
})(window.CatGame);
