(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;

  function renderSettingsPanel(state) {
    return (
      '<section class="page-header">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("page_settings") + "</p>" +
      '<h2 class="page-title">' + t("settings_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("settings_panel_copy") + "</p>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("version_info") + "</p>" +
      '<p class="page-copy">' + t("storage_key_info") + "</p>" +
      '<p class="helper-text" style="margin-top: 8px;">' +
      t("current_version", { version: game.config.version }) +
      "</p>" +
      '<p class="helper-text" style="margin-top: 8px;">' +
      t("last_saved", { time: format.escapeHtml(state.meta.lastSavedAt || t("saved_text_unavailable")) }) +
      "</p></div></section>" +
      '<section class="settings-grid">' +
      '<div class="settings-card">' +
      '<p class="section-eyebrow">' + t("basic_settings") + "</p>" +
      '<div class="setting-row"><label for="player-name-input">' + t("player_name") + "</label></div>" +
      '<input id="player-name-input" class="field" type="text" maxlength="12" value="' +
      format.escapeHtml(state.player.name) +
      '" />' +
      '<div class="inline-row" style="margin-top: 14px;"><button class="primary-button" data-rename-player>' + t("save_name") + '</button>' +
      '<span class="task-meta">' + t("rename_hint") + "</span></div>" +
      '<div class="setting-row" style="margin-top: 18px;"><label for="setting-language">' + t("language") + '</label><select id="setting-language" class="field" data-setting-key="language"><option value="zh-CN" ' +
      (state.settings.language === "zh-CN" ? "selected" : "") +
      '>中文</option><option value="en" ' +
      (state.settings.language === "en" ? "selected" : "") +
      '>English</option><option value="ja" ' +
      (state.settings.language === "ja" ? "selected" : "") +
      '>日本語</option></select></div>' +
      '<div class="setting-row" style="margin-top: 18px;"><label for="setting-auto-save">' + t("auto_save") + '</label>' +
      '<input id="setting-auto-save" class="toggle-field" type="checkbox" data-setting-key="autoSave" ' +
      (state.settings.autoSave ? "checked" : "") +
      " /></div>" +
      '<div class="setting-row" style="margin-top: 18px;"><label for="setting-bgm-enabled">' + t("bgm_enabled") + '</label>' +
      '<input id="setting-bgm-enabled" class="toggle-field" type="checkbox" data-setting-key="bgmEnabled" ' +
      (state.settings.bgmEnabled ? "checked" : "") +
      " /></div>" +
      '<div class="setting-row"><label for="setting-bgm">' + t("bgm_volume") + "</label><span>" +
      state.settings.bgmVolume +
      "</span></div>" +
      '<input id="setting-bgm" class="range-field" type="range" min="0" max="100" value="' +
      state.settings.bgmVolume +
      '" data-setting-key="bgmVolume" />' +
      '<p class="helper-text" style="margin-top: 10px;">' +
      t("music_hint") +
      "<br />" +
      t("music_now") +
      "：" +
      format.escapeHtml(game.systems.musicSystem.getCurrentTrackLabel()) +
      "</p>" +
      '<div class="setting-row" style="margin-top: 16px;"><label for="setting-sfx">' + t("sfx_volume") + "</label><span>" +
      state.settings.sfxVolume +
      "</span></div>" +
      '<input id="setting-sfx" class="range-field" type="range" min="0" max="100" value="' +
      state.settings.sfxVolume +
      '" data-setting-key="sfxVolume" />' +
      "</div>" +
      '<div class="settings-card">' +
      '<p class="section-eyebrow">' + t("custom_music_title") + "</p>" +
      '<p class="page-copy">' + t("custom_music_copy") + "</p>" +
      '<div class="setting-row" style="margin-top: 18px;"><label for="setting-custom-music-enabled">' + t("custom_music_enabled") + '</label>' +
      '<input id="setting-custom-music-enabled" class="toggle-field" type="checkbox" data-setting-key="customMusicEnabled" ' +
      ((state.settings.customMusicEnabled && state.settings.customMusicData) ? "checked" : "") +
      " " +
      (state.settings.customMusicData ? "" : "disabled") +
      " /></div>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      '<div class="notice-item"><p><strong>' + t("custom_music_file_label") + "</strong></p><p>" +
      format.escapeHtml(state.settings.customMusicName || t("custom_music_none")) +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("custom_music_active") + "</strong></p><p>" +
      (state.settings.customMusicEnabled && state.settings.customMusicData
        ? t("custom_music_source_custom")
        : t("custom_music_source_synth")) +
      "</p></div></div>" +
      '<div class="inline-row" style="margin-top: 14px; flex-wrap: wrap;">' +
      '<label class="secondary-button" for="custom-music-file">' + t("custom_music_import") + "</label>" +
      '<button class="ghost-button" data-clear-custom-music ' +
      (state.settings.customMusicData ? "" : "disabled") +
      '>' + t("custom_music_clear") + "</button>" +
      '<input id="custom-music-file" type="file" accept="audio/*" style="display:none;" />' +
      "</div></div>" +
      '<div class="settings-card">' +
      '<p class="section-eyebrow">' + t("export_save") + "</p>" +
      '<button class="primary-button" data-export-save>' + t("export_json") + "</button>" +
      '<p class="helper-text" style="margin-top: 12px;">' + t("export_copy_hint") + "</p>" +
      '<textarea class="textarea-field" readonly>' +
      format.escapeHtml(game.state.saveSystem.exportText()) +
      "</textarea></div>" +
      "</section>" +
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

  game.ui.renderSettingsPanel = renderSettingsPanel;
})(window.CatGame);
