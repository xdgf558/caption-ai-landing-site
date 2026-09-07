(function (game) {
  var audioContext = null;
  var masterGain = null;
  var buffer = null;
  var loading = null;
  var loadFailed = false;
  var source = null;
  var sourceGain = null;
  var startedAt = 0;
  var offset = 0;
  var unlocked = false;
  var hiddenByPage = false;
  var desiredMode = null;
  var revision = 0;
  var initialized = false;
  var customAudio = null;
  var customAudioSource = null;
  var customPending = false;
  // The score is exactly 40 bars at 96 BPM (3/4). Exclude AAC encoder tail padding.
  var loopDuration = 75;
  var trackURL = new URL("./src/assets/audio/moonlight-tiptoes-soft.m4a", document.baseURI).href;

  function getSettings() {
    return (game.state && game.state.game && game.state.game.settings) || {};
  }

  function hasCustomMusic() {
    var settings = getSettings();
    return !!(settings.customMusicEnabled && settings.customMusicData);
  }

  function getVolumeLevel() {
    var settings = getSettings();
    var volume = Number(settings.bgmVolume);
    return settings.bgmEnabled === false || !Number.isFinite(volume) ? 0 : Math.max(0, Math.min(1, volume / 100));
  }

  function getAudioContext() {
    if (audioContext) return audioContext;
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      audioContext = new AudioCtor();
      masterGain = audioContext.createGain();
      masterGain.gain.value = getVolumeLevel() * 0.5;
      masterGain.connect(audioContext.destination);
    } catch (error) {
      audioContext = null;
      masterGain = null;
    }
    return audioContext;
  }

  function applyVolume() {
    var volume = getVolumeLevel();
    if (masterGain && audioContext) {
      masterGain.gain.cancelScheduledValues(audioContext.currentTime);
      masterGain.gain.setTargetAtTime(volume * 0.5, audioContext.currentTime, 0.04);
    }
    if (customAudio) customAudio.volume = volume;
  }

  function stopDefault() {
    if (!source) return;
    offset = (offset + Math.max(0, audioContext.currentTime - startedAt)) % loopDuration;
    var oldSource = source;
    var oldGain = sourceGain;
    source = null;
    sourceGain = null;
    oldGain.gain.cancelScheduledValues(audioContext.currentTime);
    oldGain.gain.setValueAtTime(oldGain.gain.value, audioContext.currentTime);
    oldGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.025);
    oldSource.stop(audioContext.currentTime + 0.03);
    oldSource.onended = function () { oldSource.disconnect(); oldGain.disconnect(); };
  }

  function loadDefault() {
    if (buffer) return Promise.resolve(buffer);
    if (loading) return loading;
    if (loadFailed) return Promise.resolve(null);
    var ctx = getAudioContext();
    if (!ctx) { loadFailed = true; return Promise.resolve(null); }
    loading = window.fetch(trackURL, { credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error("Background music could not be loaded");
      return response.arrayBuffer();
    }).then(function (data) {
      return ctx.decodeAudioData(data);
    }).then(function (decoded) {
      if (!decoded || !Number.isFinite(decoded.duration) || decoded.duration < loopDuration) throw new Error("Invalid music buffer");
      buffer = decoded;
      return buffer;
    }).catch(function () {
      // Stay quiet on failure. Retry only on a later user gesture, never on every render.
      loadFailed = true;
      return null;
    }).then(function (result) {
      loading = null;
      return result;
    });
    return loading;
  }

  function startDefault(token) {
    loadDefault().then(function (decoded) {
      if (!decoded || token !== revision || desiredMode !== "default" || source || document.hidden || hiddenByPage || getVolumeLevel() <= 0) return;
      source = audioContext.createBufferSource();
      sourceGain = audioContext.createGain();
      source.buffer = decoded;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = loopDuration;
      sourceGain.gain.setValueAtTime(0, audioContext.currentTime);
      sourceGain.gain.linearRampToValueAtTime(1, audioContext.currentTime + 0.12);
      source.connect(sourceGain);
      sourceGain.connect(masterGain);
      startedAt = audioContext.currentTime;
      offset %= loopDuration;
      source.start(startedAt, offset);
    });
  }

  function pauseCustom() {
    if (customAudio) customAudio.pause();
    customPending = false;
  }

  function playCustom() {
    var settings = getSettings();
    if (!customAudio) {
      customAudio = new Audio();
      customAudio.loop = true;
      customAudio.preload = "none";
    }
    if (customAudioSource !== settings.customMusicData) {
      pauseCustom();
      revision += 1;
      customAudioSource = settings.customMusicData;
      customAudio.src = customAudioSource;
    }
    customAudio.volume = getVolumeLevel();
    if (!customAudio.paused || customPending) return;
    var token = revision;
    customPending = true;
    // pause() cancels a pending native play when settings change.
    Promise.resolve(customAudio.play()).catch(function () {}).then(function () {
      if (token === revision) customPending = false;
    });
  }

  function clearCustomMusic() {
    var settings = getSettings();
    settings.customMusicEnabled = false;
    settings.customMusicData = "";
    settings.customMusicName = "";
    revision += 1;
    pauseCustom();
    customAudioSource = null;
    if (customAudio) {
      customAudio.removeAttribute("src");
      customAudio.load();
    }
  }

  function syncForState() {
    var mode = !unlocked || document.hidden || hiddenByPage || getVolumeLevel() <= 0 ? null : hasCustomMusic() ? "custom" : "default";
    if (mode !== desiredMode) {
      desiredMode = mode;
      revision += 1;
    }
    applyVolume();
    if (mode !== "default") stopDefault();
    if (mode !== "custom") pauseCustom();
    if (mode === "custom") { playCustom(); return; }
    if (mode !== "default") return;
    var ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      Promise.resolve(ctx.resume()).catch(function () {});
    }
    if (!source) startDefault(revision);
  }

  function unlock() {
    unlocked = true;
    loadFailed = false;
    syncForState();
  }

  function getCurrentTrackLabel() {
    var settings = getSettings();
    if (hasCustomMusic()) return settings.customMusicName || game.utils.i18n.t("custom_music_source_custom");
    return game.utils.i18n.t(loadFailed ? "music_load_failed" : "music_track_moonlight");
  }

  function init() {
    if (initialized) return;
    initialized = true;
    // No context, download or playback until a user gesture. Keep BFCache restoration safe.
    window.addEventListener("pagehide", function () { hiddenByPage = true; syncForState(); });
    window.addEventListener("pageshow", function () { hiddenByPage = false; syncForState(); });
  }

  game.systems.musicSystem = {
    init: init, unlock: unlock, syncForState: syncForState, applyVolume: applyVolume,
    getCurrentTrackLabel: getCurrentTrackLabel, hasCustomMusic: hasCustomMusic, clearCustomMusic: clearCustomMusic
  };
})(window.CatGame);
