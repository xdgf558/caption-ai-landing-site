(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;

  function getReleaseNotes() {
    return game.config.releaseNotes[game.utils.i18n.getLanguage()] || game.config.releaseNotes["zh-CN"] || [];
  }

  function renderVersionPanel(state) {
    var isNewVersion = state.meta.lastSeenVersion !== game.config.version;
    var releaseNotes = getReleaseNotes()
      .map(function (note) {
        return '<div class="notice-item"><p>• ' + format.escapeHtml(note) + "</p></div>";
      })
      .join("");

    return (
      '<section class="page-header">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("page_version") + "</p>" +
      '<h2 class="page-title">' + t("version_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("version_panel_copy") + "</p>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + (isNewVersion ? t("release_update") : t("release_current")) + "</p>" +
      '<h3 class="panel-title">' + t("version_current_title", { version: game.config.version }) + "</h3>" +
      '<p class="page-copy">' + (isNewVersion ? t("version_new_copy") : t("version_seen_copy")) + "</p>" +
      '<p class="helper-text" style="margin-top: 8px;">' + t("version_auto_replace_copy") + "</p>" +
      (isNewVersion
        ? '<div class="inline-row" style="margin-top: 16px;"><span class="status-pill is-warning">' + t("release_update") + '</span><button class="secondary-button" data-dismiss-release-note>' + t("release_ack") + "</button></div>"
        : '<div class="inline-row" style="margin-top: 16px;"><span class="status-pill is-success">' + t("release_current") + "</span></div>") +
      "</div>" +
      "</section>" +
      '<section class="page-card">' +
      '<div class="inline-row"><div><p class="section-eyebrow">' + t("release_content") + '</p><h3 class="panel-title">' +
      t("version_current_title", { version: game.config.version }) +
      "</h3></div></div>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      releaseNotes +
      "</div>" +
      "</section>"
    );
  }

  game.ui.renderVersionPanel = renderVersionPanel;
})(window.CatGame);
