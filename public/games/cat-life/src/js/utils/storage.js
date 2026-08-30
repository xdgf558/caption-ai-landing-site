(function (game) {
  function saveJSON(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function loadJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn("读取本地存档失败：", error);
      return null;
    }
  }

  function remove(key) {
    localStorage.removeItem(key);
  }

  game.utils.storage = {
    saveJSON: saveJSON,
    loadJSON: loadJSON,
    remove: remove,
  };
})(window.CatGame);
