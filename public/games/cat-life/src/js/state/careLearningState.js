(function (game) {
  function defaults(eligible) {
    return { version: 1, eligible: eligible !== false, metCat: false, fed: false, played: false, worked: false,
      careDates: [], supplyClaims: [], treatmentUsed: false, protectedUntil: null };
  }

  function normalize(saved, player, flags) {
    var known = saved && typeof saved === "object" && !Array.isArray(saved);
    // Additive player data survives the existing v3 client and Worker. Never
    // reinterpret a future learning format as a new set of free supplies.
    if (known && saved.version !== 1) return JSON.parse(JSON.stringify(saved));
    var mature = Boolean(flags && flags.tutorialFinished) || Number(player.level) > 1 || Number(player.workTimes) >= 3;
    var result = Object.assign(defaults(!mature), known ? saved : {});
    result.eligible = known ? saved.eligible === true : !mature;
    // Existing learning records are authoritative: a no-op feed still increases
    // the legacy counter, but must not complete a lesson after a reload.
    result.fed = result.fed === true || (!known && Number(player.feedTimes) > 0);
    result.played = result.played === true || (!known && Number(player.playTimes) > 0);
    result.worked = result.worked === true || (!known && Number(player.workTimes) > 0);
    result.metCat = result.metCat === true || result.fed || result.played || result.worked;
    result.careDates = Array.from(new Set((Array.isArray(result.careDates) ? result.careDates : []).filter(function (date) {
      return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
    }))).sort().slice(0, 3);
    result.supplyClaims = Array.from(new Set((Array.isArray(result.supplyClaims) ? result.supplyClaims : []).filter(function (lesson) {
      return Number.isInteger(lesson) && lesson >= 1 && lesson <= 3;
    }))).sort();
    result.treatmentUsed = result.treatmentUsed === true;
    result.protectedUntil = Number.isFinite(Date.parse(result.protectedUntil)) ? new Date(result.protectedUntil).toISOString() : null;
    return result;
  }

  game.state.createCareLearning = defaults;
  game.state.normalizeCareLearning = normalize;
})(window.CatGame);
