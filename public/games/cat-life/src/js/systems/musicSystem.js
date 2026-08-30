(function (game) {
  var audioContext = null;
  var masterGain = null;
  var loopTimerId = null;
  var currentTrackKey = null;
  var unlocked = false;
  var customAudio = null;
  var customAudioSource = null;

  var noteMap = {
    C3: 130.81,
    D3: 146.83,
    E3: 164.81,
    F3: 174.61,
    G3: 196.0,
    A3: 220.0,
    B3: 246.94,
    C4: 261.63,
    D4: 293.66,
    E4: 329.63,
    F4: 349.23,
    G4: 392.0,
    A4: 440.0,
    B4: 493.88,
    C5: 523.25,
    D5: 587.33,
    E5: 659.25,
    F5: 698.46,
    G5: 783.99,
    A5: 880.0,
    B5: 987.77,
    C6: 1046.5,
  };

  var tracks = {
    home: {
      labelKey: "music_track_home",
      bpm: 132,
      stepBeats: 0.5,
      voices: [
        { type: "square", gain: 0.03, pattern: ["C5", "E5", "G5", "A5", "G5", "E5", "D5", "E5", "G5", "A5", "G5", "E5", "D5", "C5", "E5", "G5"] },
        { type: "triangle", gain: 0.04, pattern: ["C3", null, "G3", null, "A3", null, "G3", null, "F3", null, "G3", null, "E3", null, "G3", null] },
      ],
    },
    work: {
      labelKey: "music_track_work",
      bpm: 146,
      stepBeats: 0.5,
      voices: [
        { type: "square", gain: 0.028, pattern: ["E5", "G5", "A5", "B5", "A5", "G5", "E5", "D5", "E5", "G5", "A5", "C6", "B5", "A5", "G5", "E5"] },
        { type: "sawtooth", gain: 0.018, pattern: ["E3", null, "E3", null, "A3", null, "B3", null, "C4", null, "B3", null, "A3", null, "G3", null] },
      ],
    },
    cats: {
      labelKey: "music_track_cats",
      bpm: 118,
      stepBeats: 0.5,
      voices: [
        { type: "triangle", gain: 0.03, pattern: ["G5", "E5", "D5", "E5", "G5", "A5", "G5", "E5", "D5", "E5", "G5", "A5", "B5", "A5", "G5", "E5"] },
        { type: "sine", gain: 0.026, pattern: ["C4", null, "G3", null, "A3", null, "F3", null, "C4", null, "G3", null, "A3", null, "F3", null] },
      ],
    },
    arcade: {
      labelKey: "music_track_arcade",
      bpm: 154,
      stepBeats: 0.5,
      voices: [
        { type: "square", gain: 0.034, pattern: ["C6", "G5", "E5", "G5", "D6", "A5", "F5", "A5", "E6", "B5", "G5", "B5", "G5", "E5", "C5", "E5"] },
        { type: "triangle", gain: 0.03, pattern: ["C4", null, "C4", null, "D4", null, "D4", null, "E4", null, "E4", null, "G3", null, "G3", null] },
      ],
    },
  };

  function getSettings() {
    return (game.state && game.state.game && game.state.game.settings) || {};
  }

  function hasCustomMusic() {
    var settings = getSettings();
    return !!(settings.customMusicEnabled && settings.customMusicData);
  }

  function getAudioContext() {
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      return null;
    }
    if (!audioContext) {
      audioContext = new AudioCtor();
    }
    if (!masterGain && audioContext) {
      masterGain = audioContext.createGain();
      masterGain.gain.value = 0;
      masterGain.connect(audioContext.destination);
    }
    return audioContext;
  }

  function ensureCustomAudio() {
    if (!customAudio) {
      customAudio = new Audio();
      customAudio.loop = true;
      customAudio.preload = "auto";
    }
    return customAudio;
  }

  function getVolumeLevel() {
    var settings = getSettings();
    if (!settings || settings.bgmEnabled === false) {
      return 0;
    }
    return Math.max(0, Math.min(1, (settings.bgmVolume || 0) / 100));
  }

  function stopLoop() {
    if (loopTimerId) {
      window.clearTimeout(loopTimerId);
      loopTimerId = null;
    }
  }

  function stopCustomAudio() {
    if (!customAudio) {
      return;
    }
    customAudio.pause();
    customAudio.currentTime = 0;
  }

  function applyVolume() {
    var volume = getVolumeLevel();

    if (masterGain && audioContext) {
      masterGain.gain.cancelScheduledValues(audioContext.currentTime);
      masterGain.gain.linearRampToValueAtTime(volume * 0.18, audioContext.currentTime + 0.12);
    }

    if (customAudio) {
      customAudio.volume = volume;
    }
  }

  function scheduleNote(frequency, startTime, duration, type, gainAmount) {
    var ctx = audioContext;
    var oscillator;
    var gainNode;

    if (!ctx || !masterGain || !frequency) {
      return;
    }

    oscillator = ctx.createOscillator();
    gainNode = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.linearRampToValueAtTime(gainAmount, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(gainNode);
    gainNode.connect(masterGain);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.05);
  }

  function scheduleTrack(trackKey, startTime) {
    var ctx = audioContext;
    var track = tracks[trackKey];
    var stepDuration;
    var loopDuration;

    if (!ctx || !track) {
      return 0;
    }

    stepDuration = (60 / track.bpm) * track.stepBeats;
    loopDuration = stepDuration * track.voices[0].pattern.length;

    track.voices.forEach(function (voice) {
      voice.pattern.forEach(function (noteName, index) {
        if (!noteName || !noteMap[noteName]) {
          return;
        }
        scheduleNote(noteMap[noteName], startTime + index * stepDuration, stepDuration * 0.9, voice.type, voice.gain);
      });
    });

    return loopDuration;
  }

  function queueLoop(trackKey) {
    var ctx = audioContext;
    var loopDuration;

    stopLoop();
    if (!ctx || !tracks[trackKey] || getVolumeLevel() <= 0) {
      return;
    }

    loopDuration = scheduleTrack(trackKey, ctx.currentTime + 0.05);
    loopTimerId = window.setTimeout(function () {
      if (currentTrackKey === trackKey) {
        queueLoop(trackKey);
      }
    }, Math.max(500, loopDuration * 1000 - 120));
  }

  function getRecommendedTrack(page) {
    if (page === "arcade") {
      return "arcade";
    }
    if (page === "work" || (game.state.game && game.state.game.player && game.state.game.player.activeWork && page !== "cats")) {
      return "work";
    }
    if (page === "cats") {
      return "cats";
    }
    return "home";
  }

  function playCustomTrack() {
    var settings = getSettings();
    var audio = ensureCustomAudio();

    stopLoop();
    currentTrackKey = null;
    applyVolume();

    if (!unlocked || !settings.customMusicData || getVolumeLevel() <= 0) {
      stopCustomAudio();
      return;
    }

    if (customAudioSource !== settings.customMusicData) {
      customAudioSource = settings.customMusicData;
      audio.src = settings.customMusicData;
    }

    audio.play().catch(function () {
    });
  }

  function clearCustomMusic() {
    var settings = getSettings();

    if (settings) {
      settings.customMusicEnabled = false;
      settings.customMusicData = "";
      settings.customMusicName = "";
    }

    customAudioSource = null;
    if (customAudio) {
      customAudio.pause();
      customAudio.removeAttribute("src");
      customAudio.load();
    }
  }

  function syncForState(page) {
    var ctx = getAudioContext();
    var trackKey = getRecommendedTrack(page || game.state.currentPage);

    if (!ctx || !unlocked) {
      return;
    }

    if (ctx.state === "suspended") {
      ctx.resume();
    }

    applyVolume();

    if (hasCustomMusic()) {
      playCustomTrack();
      return;
    }

    stopCustomAudio();

    if (getVolumeLevel() <= 0) {
      stopLoop();
      currentTrackKey = null;
      return;
    }

    if (currentTrackKey !== trackKey) {
      currentTrackKey = trackKey;
      queueLoop(trackKey);
    }
  }

  function unlock() {
    var ctx = getAudioContext();
    if (!ctx) {
      return;
    }
    if (ctx.state === "suspended") {
      ctx.resume();
    }
    unlocked = true;
    applyVolume();
    syncForState(game.state.currentPage);
  }

  function getCurrentTrackLabel() {
    var settings = getSettings();

    if (hasCustomMusic()) {
      return settings.customMusicName || game.utils.i18n.t("custom_music_source_custom");
    }

    return currentTrackKey ? game.utils.i18n.t(tracks[currentTrackKey].labelKey) : game.utils.i18n.t("music_waiting");
  }

  function init() {
    getAudioContext();
    ensureCustomAudio();
    applyVolume();
  }

  game.systems.musicSystem = {
    init: init,
    unlock: unlock,
    syncForState: syncForState,
    applyVolume: applyVolume,
    getCurrentTrackLabel: getCurrentTrackLabel,
    hasCustomMusic: hasCustomMusic,
    clearCustomMusic: clearCustomMusic,
  };
})(window.CatGame);
