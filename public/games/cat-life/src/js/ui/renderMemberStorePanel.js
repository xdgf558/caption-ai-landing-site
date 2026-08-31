(function (game) {
  var t = game.utils.i18n.t;

  function renderMemberStorePanel() {
    if (window.CatGameCommerce && typeof window.CatGameCommerce.renderShopSection === "function") {
      return window.CatGameCommerce.renderShopSection();
    }
    return (
      '<section class="page-card"><p class="section-eyebrow">Station Points</p>' +
      '<h2 class="page-title">' + t("nav_member_store") + "</h2>" +
      '<p class="page-copy">' + t("member_store_loading") + "</p></section>"
    );
  }

  game.ui.renderMemberStorePanel = renderMemberStorePanel;
})(window.CatGame);
