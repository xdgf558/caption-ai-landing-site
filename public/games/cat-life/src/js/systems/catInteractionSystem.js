(function (game) {
  var stats = ["hunger", "clean", "mood", "health", "energy", "intimacy"];
  var stock = { feedBasic: "food", feedPremium: "premiumFood", clean: "litter", play: "toys", catGrass: "catGrass", medicine: "medicine" };
  var poses = { feedBasic: "fish", feedPremium: "fish", clean: "surprised", play: "pounce", rest: "nap", catGrass: "joy", medicine: "heart" };
  var last = null;

  // UI-only state belongs to this exact save object, never to the serialized cat.
  function current(cat) {
    return last && last.owner === game.state.game && cat && last.cat === cat && cat.unlocked && cat.isAlive && cat.careStatus !== "sheltered" ? last : null;
  }

  function perform(catId, action) {
    var state = game.state.game;
    var cat = state.cats.find(function (item) { return item.id === catId; });
    var previous = current(cat);
    if (previous && previous.action === action && Date.now() >= previous.startedAt && Date.now() - previous.startedAt < 650) return null;
    if (!Object.prototype.hasOwnProperty.call(poses, action)) return null;
    var before = {};
    stats.forEach(function (key) { before[key] = cat ? Number(cat[key]) || 0 : 0; });
    var field = stock[action];
    var count = Number(state.inventory[field]) || 0;
    var memories = cat ? game.systems.memorySystem.list(cat).map(function (entry) { return entry.key; }) : [];
    var result = game.systems.catSystem.performAction(catId, action);
    if (!result || !result.ok) { last = null; game.state.catReaction = null; return result; }
    last = {
      owner: state, cat: cat, action: action, startedAt: Date.now(),
      deltas: stats.map(function (key) { return { key: key, value: (Number(cat[key]) || 0) - before[key] }; }).filter(function (entry) { return entry.value !== 0; }),
      used: field ? count - state.inventory[field] : 0,
      memoryAdded: game.systems.memorySystem.list(cat).some(function (entry) { return memories.indexOf(entry.key) === -1; })
    };
    game.state.catReaction = { owner: state, cat: cat, catId: catId, pose: poses[action], startedAt: last.startedAt, expiresAt: last.startedAt + 2200 };
    return result;
  }

  game.systems.catInteractionSystem = { perform: perform, current: current };
})(window.CatGame);
