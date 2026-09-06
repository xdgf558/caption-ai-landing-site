(function (game) {
  var safe = game.utils.format.escapeHtml;
  var t = game.utils.i18n.t;
  function copy(key, args) { return safe(t(key, args)); }
  function date(entry) {
    if (!entry.at) return '<span class="memory-date">' + copy("memory_undated") + '</span>';
    var label = new Date(entry.at).toLocaleString(game.utils.i18n.getLanguage(), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return '<time class="memory-date" datetime="' + safe(entry.at) + '">' + safe(label) + '</time>';
  }
  function row(entry) {
    return '<li class="cat-memory-entry" data-memory-key="' + safe(entry.key) + '">' + date(entry) +
      '<h4>' + copy("memory_" + entry.key) + '</h4><p>' + copy("memory_" + entry.key + "_copy") + '</p></li>';
  }
  game.ui.renderMemoryBond = function (cat) {
    var value = Math.max(0, Math.min(100, Number(cat.intimacy) || 0));
    var next = game.state.catMemory.thresholds.find(function (level) { return value < level; });
    var stage = value >= 100 ? 4 : value >= 75 ? 3 : value >= 50 ? 2 : value >= 25 ? 1 : 0;
    return '<p class="memory-bond-stage">' + copy("memory_stage_" + stage) + '</p><p class="helper-text">' +
      copy(next ? "memory_next" : "memory_bond_complete", { amount: next - value }) + '</p>';
  };
  game.ui.renderCatMemories = function (cat) {
    if (!cat.unlocked) return "";
    var entries = game.systems.memorySystem.list(cat);
    var future = game.systems.memorySystem.journal(cat).version !== 1;
    var expanded = game.state.memoryExpandedCatId === cat.id;
    return '<section class="cat-memories" aria-labelledby="cat-memories-title"><header><p class="section-eyebrow">' + copy("memory_label") +
      '</p><h3 id="cat-memories-title" class="panel-title" tabindex="-1">' + copy("memory_title") + '</h3><p class="helper-text">' + copy("memory_intro") +
      '</p></header>' + (!entries.length ? '<p class="memory-empty">' + copy(future ? "memory_future" : "memory_empty") + '</p>' :
      '<ol id="cat-memory-entries" class="cat-memory-list">' + (expanded ? entries : entries.slice(0, 3)).map(row).join("") + '</ol>') +
      (entries.length > 3 ? '<button type="button" class="ghost-button memory-toggle" data-memory-toggle="' + safe(cat.id) +
        '" aria-controls="cat-memory-entries" aria-expanded="' + expanded + '">' + copy(expanded ? "memory_collapse" : "memory_expand", { count: entries.length }) + '</button>' : "") + '</section>';
  };
  game.ui.renderLatestMemory = function (state) {
    var latest = game.systems.memorySystem.latest(state);
    if (!latest) return "";
    return '<section class="home-latest-memory" aria-labelledby="home-memory-title"><div><p class="section-eyebrow">' + copy("memory_latest") +
      ' · ' + safe(game.utils.i18n.getDataText(latest.cat, "name")) + '</p><h3 id="home-memory-title">' + copy("memory_" + latest.entry.key) +
      '</h3>' + date(latest.entry) + '</div><button type="button" class="ghost-button" data-page-target="cats" data-select-cat="' + safe(latest.cat.id) +
      '" data-open-memories>' + copy("memory_open") + '</button></section>';
  };
})(window.CatGame);
