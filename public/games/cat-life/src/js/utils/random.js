(function (game) {
  function pick(list) {
    if (!Array.isArray(list) || !list.length) {
      return null;
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  function chance(probability) {
    return Math.random() < probability;
  }

  game.utils.random = {
    pick: pick,
    chance: chance,
  };
})(window.CatGame);
