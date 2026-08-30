(function (game) {
  function saveGame(saveData) {
    var nextData = saveData || game.state.game;
    nextData.meta.lastSavedAt = new Date().toISOString();
    nextData.meta.lastPlayedDate = game.utils.format.formatDateKey(new Date());
    game.utils.storage.saveJSON(game.config.storageKey, nextData);
    return nextData;
  }

  function loadGame() {
    var saved = game.utils.storage.loadJSON(game.config.storageKey);
    if (!saved) {
      return null;
    }
    return game.state.normalizeGameData(saved);
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

  function downloadExport() {
    var blob = new Blob([exportText()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cat-game-save-" + game.utils.format.formatDateKey(new Date()) + ".json";
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
