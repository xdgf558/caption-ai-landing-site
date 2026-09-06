(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;

  function getReleaseNotes(notes) {
    return notes[game.utils.i18n.getLanguage()] || notes["zh-CN"] || [];
  }

  function renderNotes(notes) {
    return getReleaseNotes(notes)
      .map(function (note) {
        return '<li class="notice-item"><p>' + format.escapeHtml(note) + "</p></li>";
      })
      .join("");
  }

  function renderVersionPanel(state) {
    var isNewVersion = state.meta.lastSeenVersion !== game.config.version;
    var history = (game.config.releaseHistory || []).filter(function (release) {
      return release.version !== game.config.version;
    }).map(function (release) {
      var open = (game.state.releaseHistoryOpen || []).indexOf(release.version) !== -1;
      return '<details class="release-history-item" data-release-version="' + format.escapeHtml(release.version) + '"' + (open ? ' open' : '') + '>' +
        '<summary><span>' + format.escapeHtml(t("version_history_version", { version: release.version })) + '</span><span class="helper-text">' +
        format.escapeHtml(t("version_history_count", { count: getReleaseNotes(release.notes).length })) + '</span></summary>' +
        '<ul class="notice-list release-note-list">' + renderNotes(release.notes) + '</ul></details>';
    }).join("");

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
      '<section class="page-card release-latest" aria-labelledby="release-latest-title">' +
      '<div class="inline-row"><div><p class="section-eyebrow">' + t("release_content") + '</p><h3 class="panel-title" id="release-latest-title">' +
      t("version_current_title", { version: game.config.version }) +
      "</h3></div></div>" +
      '<ul class="notice-list release-note-list">' +
      renderNotes(game.config.releaseNotes) +
      "</ul>" +
      "</section>" +
      (history ? '<section class="page-card release-history" aria-labelledby="release-history-title"><h3 class="panel-title" id="release-history-title">' +
        t("version_history_title") + '</h3><p class="page-copy">' + t("version_history_copy") + '</p><div class="release-history-list">' + history + '</div></section>' : '')
    );
  }

  game.ui.renderVersionPanel = renderVersionPanel;
})(window.CatGame);
