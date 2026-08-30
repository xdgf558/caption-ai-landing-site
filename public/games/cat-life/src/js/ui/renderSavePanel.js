(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;

  function renderSavePanel(state) {
    var lastSavedText = state.meta.lastSavedAt
      ? format.formatRealDateTime(state.meta.lastSavedAt)
      : t("saved_text_unavailable");

    return (
      '<section class="page-header">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("page_save") + "</p>" +
      '<h2 class="page-title">' + t("save_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("save_panel_copy") + "</p>" +
      '<div class="inline-row" style="margin-top:18px; flex-wrap: wrap;">' +
      '<button class="primary-button" data-manual-save>' + t("manual_save_action") + "</button>" +
      '<button class="secondary-button" data-export-save>' + t("export_json") + "</button>" +
      "</div>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("local_save_title") + "</p>" +
      '<p class="page-copy">' + t("local_save_copy") + "</p>" +
      "</div></section>" +
      '<section class="settings-grid">' +
      '<div class="settings-card">' +
      '<p class="section-eyebrow">' + t("save_status_title") + "</p>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      '<div class="notice-item"><p><strong>' + t("version") + "</strong></p><p>v" +
      format.escapeHtml(game.config.version) +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("last_saved_label") + "</strong></p><p>" +
      format.escapeHtml(lastSavedText) +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("save_storage_key") + "</strong></p><p>" +
      format.escapeHtml(game.config.storageKey) +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("auto_save") + "</strong></p><p>" +
      (state.settings.autoSave ? t("enabled_text") : t("disabled_text")) +
      "</p></div>" +
      "</div></div>" +
      '<div class="settings-card">' +
      '<p class="section-eyebrow">' + t("export_save") + "</p>" +
      '<button class="primary-button" data-export-save>' + t("export_json") + "</button>" +
      '<p class="helper-text" style="margin-top: 12px;">' + t("export_copy_hint") + "</p>" +
      '<textarea class="textarea-field" readonly>' +
      format.escapeHtml(game.state.saveSystem.exportText()) +
      "</textarea></div></section>" +
      '<section class="settings-grid" style="margin-top: 18px;">' +
      '<div class="settings-card">' +
      '<p class="section-eyebrow">' + t("import_save") + "</p>" +
      '<textarea id="save-import-text" class="textarea-field" placeholder="' + t("save_placeholder") + '"></textarea>' +
      '<div class="inline-row" style="margin-top: 14px; flex-wrap: wrap;">' +
      '<button class="secondary-button" data-import-save>' + t("import_text") + '</button>' +
      '<label class="ghost-button" for="save-import-file">' + t("choose_json") + "</label>" +
      '<input id="save-import-file" type="file" accept=".json,application/json" style="display:none;" />' +
      "</div></div>" +
      '<div class="settings-card">' +
      '<p class="section-eyebrow">' + t("danger_zone") + "</p>" +
      '<p class="page-copy">' + t("reset_warning") + "</p>" +
      '<button class="ghost-button" style="margin-top: 16px;" data-reset-save>' + t("reset_save") + "</button>" +
      "</div></section>"
    );
  }

  game.ui.renderSavePanel = renderSavePanel;
})(window.CatGame);
