(function (game) {
  var keys = ["met", "feed", "play", "treat", "welcome", "rescue", "bond_25", "bond_50", "bond_75", "bond_100"];
  var thresholds = [25, 50, 75, 100];

  function normalize(journal, cat) {
    // Preserve a future journal verbatim; older clients must not rewrite it.
    if (journal && Number.isInteger(journal.version) && journal.version > 1) {
      return JSON.parse(JSON.stringify(journal));
    }
    var entries = [];
    if (journal && journal.version === 1 && Array.isArray(journal.entries)) {
      journal.entries.forEach(function (entry) {
        if (!entry || keys.indexOf(entry.key) === -1) return;
        var time = typeof entry.at === "string" ? Date.parse(entry.at) : NaN;
        var at = Number.isFinite(time) ? new Date(time).toISOString() : null;
        if (!at && thresholds.every(function (value) { return entry.key !== "bond_" + value; })) return;
        var clean = { key: entry.key, at: at, order: Number.isSafeInteger(entry.order) && entry.order > 0 && entry.order < 1e12 ? entry.order : 0 };
        var existing = entries.findIndex(function (value) { return value.key === clean.key; });
        if (existing === -1) entries.push(clean);
        else if (!entries[existing].at && at) entries[existing] = clean;
      });
    } else if (cat && cat.unlocked) {
      // Current bond is evidence, aggregate feeding counters are not dates.
      thresholds.forEach(function (value) {
        if (cat.intimacy >= value) entries.push({ key: "bond_" + value, at: null, order: 0 });
      });
    }
    return { version: 1, entries: entries };
  }

  game.state.catMemory = { normalize: normalize, thresholds: thresholds };
})(window.CatGame);
