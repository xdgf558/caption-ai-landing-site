(function (window) {
  "use strict";
  var baseKey = "catGameSaveV1";
  function plain(value) { return value && typeof value === "object" && !Array.isArray(value); }
  function inspectRaw(raw, supported) {
    if (raw === null) return { status: "missing" };
    if (typeof raw !== "string" || !raw || raw.length > 32 * 1024 * 1024) return { status: "corrupt" };
    try {
      var data = JSON.parse(raw);
      if (!plain(data)) return { status: "corrupt" };
      var version = data.schemaVersion === undefined ? 0 : data.schemaVersion;
      if (!Number.isInteger(version) || version < 0 || version > (supported === undefined ? 3 : supported)) return { status: "unsupported" };
      // Older schemas repaired empty cat lists without discarding currency/settings.
      // Missing lists or empty current-schema lists still indicate damaged data.
      var gold = data.player && (version === 0 && data.player.gold === undefined ? data.player.coins : data.player.gold);
      if (!plain(data.meta) || !plain(data.player) || !plain(data.inventory) || !plain(data.settings) ||
          typeof gold !== "number" || !Number.isFinite(gold) || !Array.isArray(data.cats) || (version >= 3 && !data.cats.length) ||
          data.cats.some(function (cat) { return !plain(cat) || typeof cat.id !== "string" || !cat.id; })) return { status: "corrupt" };
      if (["tasks", "home", "shop", "lottery", "community", "flags"].some(function (key) { return data[key] !== undefined && !plain(data[key]); })) return { status: "corrupt" };
      if (data.jobs !== undefined && (!Array.isArray(data.jobs) || data.jobs.some(function (job) { return !plain(job) || typeof job.id !== "string"; }))) return { status: "corrupt" };
      var lists = [[data.tasks, "tutorial"], [data.tasks, "daily"], [data.tasks, "achievements"], [data.inventory, "furnitureOwned"], [data.home, "placedFurniture"]];
      if (lists.some(function (entry) { return entry[0] && entry[0][entry[1]] !== undefined && !Array.isArray(entry[0][entry[1]]); })) return { status: "corrupt" };
      return { status: "valid", schemaVersion: version, data: data };
    } catch (error) { return { status: "corrupt" }; }
  }
  function inspect(storage, key, supported) {
    try {
      var raw = storage.getItem(key);
      var result = inspectRaw(raw, supported);
      result.raw = raw;
      return result;
    } catch (error) { return { status: "unavailable" }; }
  }
  function memberKey(id) {
    var text = typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? String(id) : typeof id === "string" ? id : "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(text)) throw new Error("INVALID_ACCOUNT");
    return baseKey + ":member:" + text;
  }
  async function session(fetcher) {
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 8000);
    try {
      var response = await fetcher("/api/readers/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("SESSION_UNAVAILABLE");
      var body = await response.json();
      if (body.ok !== true || typeof body.authenticated !== "boolean") throw new Error("SESSION_UNAVAILABLE");
      return body.authenticated ? { key: memberKey(body.account && body.account.id), member: true, id: String(body.account.id) } : { key: baseKey, member: false, id: null };
    } finally { clearTimeout(timer); }
  }
  function select(storage, identity) {
    var result = { key: identity.key, accountKey: identity.key, member: identity.member, id: identity.id };
    if (identity.member && inspect(storage, identity.key).status === "missing") {
      var guest = inspect(storage, baseKey), claim;
      try { claim = storage.getItem("catGameGuestSaveClaimV1"); } catch (error) { return result; }
      if (guest.status === "valid" && (!claim || claim === identity.id)) result.key = baseKey;
    }
    return result;
  }
  window.CatGameSaveStatus = Object.freeze({ select: select, inspectRaw: inspectRaw, inspect: inspect, memberKey: memberKey, session: session, baseKey: baseKey });
})(window);
