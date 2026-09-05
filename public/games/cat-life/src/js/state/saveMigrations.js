(function (window) {
  var currentSchemaVersion = 3;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function migrationToVersion1(save) {
    save.player = save.player && typeof save.player === "object" ? save.player : {};
    if (typeof save.player.gold !== "number" && typeof save.player.coins === "number") {
      save.player.gold = save.player.coins;
    }
    delete save.player.coins;
    save.schemaVersion = 1;
    return save;
  }

  function migrationToVersion2(save) {
    save.settings = save.settings && typeof save.settings === "object" ? save.settings : {};
    if (typeof save.settings.musicVolume === "number") {
      if (typeof save.settings.bgmVolume !== "number") save.settings.bgmVolume = save.settings.musicVolume;
      if (typeof save.settings.sfxVolume !== "number") save.settings.sfxVolume = save.settings.musicVolume;
    }
    delete save.settings.musicVolume;
    save.schemaVersion = 2;
    return save;
  }

  function migrationToVersion3(save) {
    (save.cats || []).forEach(function (cat) {
      var meta = save.meta || {};
      // Global saves/age refreshes do not prove that this cat's decay was synced.
      var trackers = cat.decayTracker || {};
      var times = ["hunger", "clean", "mood", "health", "energy"]
        .map(function (key) { return Date.parse(trackers[key]); }).filter(Number.isFinite);
      if (cat.diseaseId && Number.isFinite(Date.parse(cat.diseaseProgressAt))) times.push(Date.parse(cat.diseaseProgressAt));
      if (!times.length) {
        times = [cat.ageUpdatedAt, cat.bornAt].map(Date.parse).filter(Number.isFinite);
      }
      if (!times.length) {
        times = [meta.lastSyncAt, meta.lastSavedAt, meta.createdAt].map(Date.parse).filter(Number.isFinite);
      }
      cat.careStatus = "home";
      cat.careLastSyncAt = times.length ? new Date(Math.max.apply(Math, times)).toISOString() : new Date().toISOString();
    });
    save.schemaVersion = 3;
    return save;
  }

  var migrations = {
    1: migrationToVersion1,
    2: migrationToVersion2,
    3: migrationToVersion3,
  };

  function migrate(saveData) {
    if (!saveData || typeof saveData !== "object" || Array.isArray(saveData)) {
      throw new TypeError("Save data must be an object.");
    }

    var save = clone(saveData);
    var fromVersion = Number(save.schemaVersion || 0);
    if (!Number.isInteger(fromVersion) || fromVersion < 0 || fromVersion > currentSchemaVersion) {
      var error = new Error("This save was created by an unsupported game version.");
      error.code = "SAVE_SCHEMA_UNSUPPORTED";
      throw error;
    }

    var applied = [];
    for (var nextVersion = fromVersion + 1; nextVersion <= currentSchemaVersion; nextVersion += 1) {
      save = migrations[nextVersion](save);
      applied.push(nextVersion);
    }

    save.schemaVersion = currentSchemaVersion;
    return {
      data: save,
      fromVersion: fromVersion,
      toVersion: currentSchemaVersion,
      applied: applied,
    };
  }

  window.CatGameSaveMigrations = {
    currentSchemaVersion: currentSchemaVersion,
    migrate: migrate,
  };
})(window);
