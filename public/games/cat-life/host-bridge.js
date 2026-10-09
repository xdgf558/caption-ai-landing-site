(function () {
  var params = new URLSearchParams(window.location.search);
  var id = params.get("sc_launch_id"), origin = window.location.origin, protocol = "station-cat-game/v1";
  if (window.parent === window || !window.parent || params.getAll("sc_launch_id").length !== 1 ||
    params.getAll("sc_entry").length !== 1 || params.get("sc_entry") !== "1" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id || "")) return;
  var stopped = false, ready = false;
  function send(type) { window.parent.postMessage({ protocol: protocol, type: type, game_id: "cat-life", launch_id: id }, origin); }
  window.CatGameHostBridge = {
    isStopped: function () { return stopped; },
    ready: function () { if (!stopped) { ready = true; send("ready"); } },
    localSaved: function () {
      if (!stopped && ready && window.crypto && typeof window.crypto.randomUUID === "function") {
        window.parent.postMessage({ protocol: protocol, type: "save_success", game_id: "cat-life", launch_id: id,
          save_kind: "local", save_operation_id: window.crypto.randomUUID() }, origin);
      }
    },
    recovery: function () { if (!stopped) send("recovery"); }
  };
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (stopped || event.origin !== origin || event.source !== window.parent || !data ||
      data.protocol !== protocol || data.type !== "exit" || data.game_id !== "cat-life" || data.launch_id !== id) return;
    stopped = true;
    try { window.dispatchEvent(new CustomEvent("catgame:host-exit")); }
    finally { send("stopped"); }
  });
  window.addEventListener("error", function (event) {
    if (!stopped && !ready && (event.error || event.target && event.target.tagName === "SCRIPT")) send("failed");
  }, true);
  window.addEventListener("DOMContentLoaded", function () {
    document.body.setAttribute("data-station-embedded", "true");
    document.querySelectorAll(".station-site-brand, .station-site-links, .station-site-language").forEach(function (node) { node.hidden = true; });
    // The existing account page keeps its own framing protection. A gesture on
    // its original login link leaves the game host rather than nesting login.
    document.querySelectorAll("[data-cat-member-login]").forEach(function (node) { node.target = "_top"; });
  });
})();
