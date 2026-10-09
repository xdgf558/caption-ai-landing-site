(function (game) {
  var activeStorageKey = game.config.storageKey;
  var observed;
  var blocked = false;
  function getStorageKey() { return activeStorageKey; }
  function setStorageKey(storageKey) {
    activeStorageKey = String(storageKey || "").trim() || game.config.storageKey;
    observed = undefined;
    blocked = false;
    return activeStorageKey;
  }
  function inspect() {
    try { return window.CatGameSaveStatus.inspect(localStorage, activeStorageKey, game.config.saveSchemaVersion); }
    catch (error) { return { status: "unavailable" }; }
  }
  function fail(status) {
    blocked = true;
    var error = new Error("SAVE_BLOCKED: " + status);
    error.code = status === "unsupported" ? "SAVE_SCHEMA_UNSUPPORTED" : "SAVE_BLOCKED";
    error.saveStatus = status;
    if (typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent("catgame:save-blocked", { detail: { status: status } }));
    throw error;
  }
  function writable() {
    var slot = inspect();
    if (blocked) return fail(slot.status === "valid" || slot.status === "missing" ? "changed" : slot.status);
    if (slot.status !== "valid" && slot.status !== "missing") { if (observed === undefined) observed = slot.raw; return fail(slot.status); }
    if (observed !== undefined && observed !== slot.raw) return fail("changed");
    return slot;
  }
  function saveGame(saveData) {
    var slot = writable(), nextData = saveData || game.state.game;
    if (!nextData || window.CatGameSaveStatus.inspectRaw(JSON.stringify(nextData), game.config.saveSchemaVersion).status !== "valid") return fail("corrupt");
    var previous = nextData.meta.lastSavedAt;
    nextData.meta.lastSavedAt = new Date().toISOString();
    nextData.meta.lastPlayedDate = game.utils.format.formatDateKey(new Date());
    var raw = JSON.stringify(nextData);
    try {
      if (localStorage.getItem(activeStorageKey) !== slot.raw) return fail("changed");
      localStorage.setItem(activeStorageKey, raw);
      if (localStorage.getItem(activeStorageKey) !== raw) return fail("unavailable");
    } catch (error) {
      nextData.meta.lastSavedAt = previous;
      if (error.saveStatus) throw error;
      return fail("unavailable");
    }
    observed = raw;
    // Telemetry follows the read-back confirmation. It never controls the write,
    // serializes a save, or claims that a queued cloud upload has succeeded.
    try { window.CatGameHostBridge?.localSaved?.(); } catch (error) {}
    if (window.CatGameCloud && typeof window.CatGameCloud.onLocalSave === "function") window.CatGameCloud.onLocalSave(nextData);
    return nextData;
  }
  function backupBeforeCareRecovery() {
    writable();
    var key = activeStorageKey + ":before-care-recovery";
    if (!game.utils.storage.loadJSON(key)) game.utils.storage.saveJSON(key, game.state.game);
  }
  function getCareRecoveryBackup() { return game.utils.storage.loadJSON(activeStorageKey + ":before-care-recovery"); }
  function downloadCareRecoveryBackup() {
    var backup = getCareRecoveryBackup();
    if (backup) downloadExport(backup, "cat-care-before-recovery-");
  }
  function loadGame() {
    var slot = inspect();
    observed = slot.raw;
    if (slot.status !== "missing" && slot.status !== "valid") return fail(slot.status);
    if (slot.status === "missing") return null;
    try { return game.state.normalizeGameData(slot.data); }
    catch (error) { return fail(error.code === "SAVE_SCHEMA_UNSUPPORTED" ? "unsupported" : "corrupt"); }
  }
  function createAndSaveGame() { var fresh = game.state.createNewGame(); saveGame(fresh); return fresh; }
  function loadOrCreateGame() { return loadGame() || createAndSaveGame(); }
  function autoSave() { if (game.state.game && game.state.game.settings.autoSave) saveGame(game.state.game); }
  function exportText() { return JSON.stringify(game.state.game, null, 2); }
  function downloadRaw(raw, filePrefix) {
    if (typeof raw !== "string") throw new Error("NO_READABLE_SAVE");
    var blob = new Blob([raw], { type: "application/json" }), url = URL.createObjectURL(blob);
    var anchor = document.createElement("a"); anchor.href = url;
    anchor.download = (filePrefix || "cat-game-save-") + game.utils.format.formatDateKey(new Date()) + ".json";
    document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }
  function downloadExport(saveData, filePrefix) { downloadRaw(saveData ? JSON.stringify(saveData, null, 2) : exportText(), filePrefix); }
  // Explicit recovery preserves exact original bytes before replacing a slot.
  // Failure to back up, a concurrent edit or unreadable storage never grants a write.
  function importText(rawText) {
    var incoming = window.CatGameSaveStatus.inspectRaw(rawText, game.config.saveSchemaVersion);
    if (incoming.status !== "valid") {
      var error = new Error("INVALID_IMPORT"); error.code = incoming.status === "unsupported" ? "SAVE_SCHEMA_UNSUPPORTED" : "INVALID_IMPORT"; throw error;
    }
    var normalized = game.state.normalizeGameData(incoming.data), slot = inspect();
    if (slot.status === "unavailable") return fail("unavailable");
    if (observed !== undefined && observed !== slot.raw) return fail("changed");
    var backupKey = null;
    try {
      if (slot.raw !== null) {
        backupKey = activeStorageKey + ":recovery:" + Date.now() + ":" + Math.random().toString(36).slice(2);
        if (localStorage.getItem(backupKey) !== null) return fail("changed");
        localStorage.setItem(backupKey, slot.raw);
        if (localStorage.getItem(backupKey) !== slot.raw) return fail("unavailable");
      }
      if (localStorage.getItem(activeStorageKey) !== slot.raw) return fail("changed");
      var serialized = JSON.stringify(normalized);
      localStorage.setItem(activeStorageKey, serialized);
      if (localStorage.getItem(activeStorageKey) !== serialized) return fail("unavailable");
      observed = serialized; blocked = false;
      try { window.CatGameHostBridge?.localSaved?.(); } catch (error) {}
      game.state.game = normalized;
      if (window.CatGameCloud && typeof window.CatGameCloud.onLocalSave === "function") window.CatGameCloud.onLocalSave(normalized);
      return normalized;
    } catch (error) { if (error.saveStatus) throw error; return fail("unavailable"); }
  }
  function resetGame() { return importText(JSON.stringify(game.state.createNewGame())); }
  game.state.saveSystem = { getStorageKey: getStorageKey, setStorageKey: setStorageKey, inspect: inspect, assertUnchanged: writable,
    backupBeforeCareRecovery: backupBeforeCareRecovery, getCareRecoveryBackup: getCareRecoveryBackup,
    downloadCareRecoveryBackup: downloadCareRecoveryBackup, saveGame: saveGame, loadGame: loadGame,
    createAndSaveGame: createAndSaveGame, loadOrCreateGame: loadOrCreateGame, autoSave: autoSave,
    exportText: exportText, downloadRaw: downloadRaw, downloadExport: downloadExport, importText: importText, resetGame: resetGame };
})(window.CatGame);
