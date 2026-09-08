(function () {
  "use strict";
  var game = window.CatGame;
  var pending = null;
  var failed = false;
  var lastPreference = null;

  function eligible(cat) {
    if (!cat || !cat.unlocked || cat.isAlive === false || cat.careStatus === "sheltered" || cat.disease || cat.energy <= 35) return false;
    if (game.utils.catArt.inferArtKeyFromTraits(cat.traits) !== "orange_tabby") return false;
    var commerce = window.CatGameCommerce;
    if (commerce && ((commerce.getCatSprite && commerce.getCatSprite(cat)) || (commerce.getCatWalkSprite && commerce.getCatWalkSprite(cat)))) return false;
    var reaction = game.utils.catArt.getCatReaction(cat);
    return !reaction || reaction === "fish";
  }

  function sync() {
    lastPreference = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (game.utils.catMotionRuntime) { game.utils.catMotionRuntime.sync(); return; }
    // The static artwork is also the offline, reduced-motion and error fallback.
    if (failed || pending || !/^https?:$/.test(window.location.protocol) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var hasCat = Array.prototype.some.call(document.querySelectorAll("[data-cat-motion-id]"), function (node) {
      return eligible(game.state.game.cats.find(function (cat) { return cat.id === node.dataset.catMotionId; }));
    });
    if (!hasCat) return;
    pending = document.createElement("script");
    pending.src = new URL("src/vendor/cat-motion/runtime.js?v=1.28.0", document.baseURI).href;
    pending.onload = function () { pending = null; if (game.utils.catMotionRuntime) game.utils.catMotionRuntime.sync(); };
    pending.onerror = function () { failed = true; pending.remove(); pending = null; };
    document.head.appendChild(pending);
  }
  game.utils.catMotion = {
    eligible: eligible, sync: sync,
    beforeRender: function () { if (game.utils.catMotionRuntime) game.utils.catMotionRuntime.beforeRender(); },
    syncPreferences: function () {
      // WebViews can update the query without delivering a change event. Reuse
      // the existing live-binding tick; no new timer or recurring DOM rebuild.
      if (lastPreference !== window.matchMedia("(prefers-reduced-motion: reduce)").matches) sync();
    }
  };
})();
