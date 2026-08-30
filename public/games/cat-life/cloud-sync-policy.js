(function (window) {
  function markerDigest(marker, key) {
    if (!marker || typeof marker !== "object") return "";
    return String(marker[key] || marker.digest || "");
  }

  function resolveInitialAction(localDigest, cloudSave, marker) {
    if (!cloudSave) return "upload";

    var cloudDigest = String(cloudSave.digest || "");
    if (localDigest && localDigest === cloudDigest) return "synced";
    if (!marker) return "conflict";

    var localChanged = markerDigest(marker, "localDigest") !== localDigest;
    var cloudChanged = markerDigest(marker, "cloudDigest") !== cloudDigest;
    if (!localChanged && !cloudChanged) return "synced";
    if (!localChanged && cloudChanged) return "remote";
    if (localChanged && !cloudChanged) return "upload";
    return "conflict";
  }

  window.CatGameCloudPolicy = {
    resolveInitialAction: resolveInitialAction,
  };
})(window);
