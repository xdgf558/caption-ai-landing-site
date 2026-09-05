(function (game) {
  var activeStorageKey = game.config.storageKey;

  function getStorageKey() {
    return activeStorageKey;
  }

  function setStorageKey(storageKey) {
    var nextKey = String(storageKey || "").trim();
    activeStorageKey = nextKey || game.config.storageKey;
    return activeStorageKey;
  }

  function saveGame(saveData) {
    var nextData = saveData || game.state.game;
    nextData.meta.lastSavedAt = new Date().toISOString();
    nextData.meta.lastPlayedDate = game.utils.format.formatDateKey(new Date());
    game.utils.storage.saveJSON(activeStorageKey, nextData);
    if (window.CatGameCloud && typeof window.CatGameCloud.onLocalSave === "function") {
      window.CatGameCloud.onLocalSave(nextData);
    }
    return nextData;
  }

  function backupBeforeCareRecovery() {
    var key = activeStorageKey + ":before-care-recovery";
    // Keep the first snapshot; later recoveries must not overwrite this safety net.
    if (!game.utils.storage.loadJSON(key)) game.utils.storage.saveJSON(key, game.state.game);
  }

  function getCareRecoveryBackup() {
    return game.utils.storage.loadJSON(activeStorageKey + ":before-care-recovery");
  }

  function downloadCareRecoveryBackup() {
    var backup = getCareRecoveryBackup();
    if (backup) downloadExport(backup, "cat-care-before-recovery-");
  }

  function loadGame() {
    var saved = game.utils.storage.loadJSON(activeStorageKey);
    if (!saved) {
      return null;
    }
    try {
      return game.state.normalizeGameData(saved);
    } catch (error) {
      if (!error || error.code !== "SAVE_SCHEMA_UNSUPPORTED") throw error;

      var sourceStorageKey = activeStorageKey;
      var compatibilityStorageKey = sourceStorageKey + ":compat-v" + String(game.config.saveSchemaVersion);
      var existingCompatibilitySave = game.utils.storage.loadJSON(compatibilityStorageKey);
      activeStorageKey = compatibilityStorageKey;
      console.warn("存档来自较新的游戏版本，已切换到独立兼容存档槽。", {
        compatibilityStorageKey: compatibilityStorageKey,
        sourceStorageKey: sourceStorageKey,
      });
      if (!existingCompatibilitySave) return null;
      return game.state.normalizeGameData(existingCompatibilitySave);
    }
  }

  function createAndSaveGame() {
    var fresh = game.state.createNewGame();
    saveGame(fresh);
    return fresh;
  }

  function loadOrCreateGame() {
    return loadGame() || createAndSaveGame();
  }

  function autoSave() {
    if (game.state.game && game.state.game.settings.autoSave) {
      saveGame(game.state.game);
    }
  }

  function exportText() {
    return JSON.stringify(game.state.game, null, 2);
  }

  function downloadExport(saveData, filePrefix) {
    var blob = new Blob([saveData ? JSON.stringify(saveData, null, 2) : exportText()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = (filePrefix || "cat-game-save-") + game.utils.format.formatDateKey(new Date()) + ".json";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
  }

  function importText(rawText) {
    var parsed = JSON.parse(rawText);
    var normalized = game.state.normalizeGameData(parsed);
    game.state.game = normalized;
    saveGame(normalized);
    return normalized;
  }

  function resetGame() {
    var fresh = game.state.createNewGame();
    game.state.game = fresh;
    saveGame(fresh);
    return fresh;
  }

  game.state.saveSystem = {
    getStorageKey: getStorageKey,
    backupBeforeCareRecovery: backupBeforeCareRecovery,
    getCareRecoveryBackup: getCareRecoveryBackup,
    downloadCareRecoveryBackup: downloadCareRecoveryBackup,
    setStorageKey: setStorageKey,
    saveGame: saveGame,
    loadGame: loadGame,
    createAndSaveGame: createAndSaveGame,
    loadOrCreateGame: loadOrCreateGame,
    autoSave: autoSave,
    exportText: exportText,
    downloadExport: downloadExport,
    importText: importText,
    resetGame: resetGame,
  };
})(window.CatGame);
