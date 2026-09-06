(function (game) {
  function journal(cat) { return game.state.catMemory.normalize(cat.memoryJournal, cat); }
  function list(cat) {
    var value = journal(cat);
    return value.version === 1 ? value.entries.sort(function (a, b) {
      return Number(Boolean(b.at)) - Number(Boolean(a.at)) || b.order - a.order ||
        (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) ||
        (Number(b.key.replace("bond_", "")) || 0) - (Number(a.key.replace("bond_", "")) || 0);
    }) : [];
  }
  function latest(state) {
    var records = [];
    (state.cats || []).filter(function (cat) { return cat.unlocked; }).forEach(function (cat) {
      list(cat).filter(function (entry) { return entry.at; }).forEach(function (entry) {
        records.push({ cat: cat, entry: entry });
      });
    });
    records.sort(function (a, b) { return b.entry.order - a.entry.order || Date.parse(b.entry.at) - Date.parse(a.entry.at); });
    return records[0] || null;
  }
  function record(cat, eventKeys, before) {
    if (!cat || !cat.unlocked || cat.isAlive === false || cat.careStatus === "sheltered") return false;
    var value = game.state.catMemory.normalize(cat.memoryJournal, before || cat);
    if (value.version !== 1) return false;
    var order = 0;
    (game.state.game.cats || []).forEach(function (entry) {
      list(entry).forEach(function (memory) { order = Math.max(order, memory.order); });
    });
    var changed = false;
    var now = game.systems.timeSystem.getNow().toISOString();
    eventKeys.forEach(function (key) {
      if (value.entries.some(function (entry) { return entry.key === key; })) return;
      value.entries.push({ key: key, at: now, order: ++order });
      changed = true;
    });
    if (changed) cat.memoryJournal = value;
    return changed;
  }
  function recordCare(cat, action, before) {
    var fields = { feedBasic: ["hunger"], feedPremium: ["hunger"], play: ["mood", "intimacy"],
      clean: ["clean"], rest: ["energy", "health", "mood"], medicine: ["health"], catGrass: ["mood", "intimacy"] };
    var meaningful = action === "treat" ? Boolean(before.diseaseId && !cat.diseaseId) :
      (fields[action] || []).some(function (key) { return cat[key] > before[key]; });
    // Even when already full, a premium meal can genuinely cross a bond threshold.
    var crossed = game.state.catMemory.thresholds.filter(function (value) { return before.intimacy < value && cat.intimacy >= value; });
    if (!meaningful && !crossed.length) return false;
    var events = ["met"];
    if (meaningful && (action === "feedBasic" || action === "feedPremium")) events.push("feed");
    if (meaningful && (action === "play" || action === "treat")) events.push(action);
    crossed.forEach(function (value) { events.push("bond_" + value); });
    return record(cat, events, before);
  }
  game.systems.memorySystem = {
    list: list, latest: latest, journal: journal, recordCare: recordCare,
    recordMeet: function (cat) { return record(cat, ["met"]); },
    recordRecovery: function (cat, reason) { return record(cat, [reason === "legacy" || reason === "sheltered" ? "welcome" : "rescue"]); },
  };
})(window.CatGame);
