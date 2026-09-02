(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var safe = format.escapeHtml;

  function asset(path) {
    return new URL(path, document.baseURI).href;
  }

  function renderMorePanel(state) {
    var counts = game.ui.getNavigationCounts(state);
    var bank = game.systems.bankSystem.getBank();
    var unlockedCats = state.cats.filter(function (cat) { return cat.unlocked; }).length;
    var totalCats = state.cats.length;
    var dailyDone = state.tasks.daily.filter(function (task) { return task.claimed; }).length;
    var language = game.utils.i18n.getLanguage();
    var items = [
      { page: "bank", image: "src/assets/bank/bank-counter-clerk.webp", meta: t("more_bank_meta", { amount: format.formatNumber(bank.balance) }) },
      { page: "shop", image: "src/assets/shop/shop-bowl.jpg", meta: t("more_shop_meta") },
      { page: "inventory", image: "src/assets/shop/shop-toys.jpg", meta: t("more_inventory_meta") },
      { page: "member_store", image: "src/assets/premium/station-signal-lamp.png", fit: "contain", meta: t("more_member_store_meta") },
      { page: "hospital", image: "src/assets/shop/shop-med.jpg", meta: t("more_hospital_meta", { count: counts.sick }) },
      { page: "collection", image: "src/assets/cats/orange-tabby.png", fit: "contain", meta: t("more_collection_meta", { current: unlockedCats, total: totalCats }) },
      { page: "arcade", image: "src/assets/arcade/slot-machine-cabinet.webp", meta: t("more_arcade_meta") },
      { page: "tasks", image: "src/assets/jobs/job-flyer.svg", fit: "contain", meta: t("more_tasks_meta", { current: dailyDone, total: state.tasks.daily.length }) },
      { page: "version", image: "src/assets/rooms/decor-poster.webp", fit: "contain", meta: t("more_version_meta", { version: game.config.version }) },
      { page: "save", image: "src/assets/home/home-house-scene.webp", meta: t("more_save_meta") },
      { page: "settings", image: "src/assets/rooms/decor-lanterns.webp", meta: t("more_settings_meta", { language: language }) },
    ];

    return (
      '<section class="page-intro"><p class="section-eyebrow">' + safe(t("nav_more")) + '</p><h2 class="page-title">' + safe(t("more_title")) +
      '</h2><p class="page-copy">' + safe(t("more_copy")) + "</p></section>" +
      '<section class="more-grid" aria-label="' + safe(t("more_title")) + '">' + items.map(function (item) {
        return '<button class="more-link" type="button" data-page-target="' + safe(item.page) + '">' +
          '<span class="more-link-art' + (item.fit === "contain" ? " is-contain" : "") + '"><img src="' + safe(asset(item.image)) +
          '" alt="" width="800" height="600" decoding="async" /></span>' +
          '<span class="more-link-copy"><strong>' + safe(t("nav_" + item.page)) +
          '</strong><span class="more-link-meta">' + safe(item.meta) + '</span></span>' +
          '<span class="more-link-arrow" aria-hidden="true">→</span></button>';
      }).join("") + "</section>"
    );
  }

  game.ui.renderMorePanel = renderMorePanel;
})(window.CatGame);
