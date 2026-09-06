(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;
  var dom = {};
  var liveTickId = null;
  var arcadeSpinTimerId = null;
  var lotteryCelebrationTimerId = null;
  var toastTimerId = null;
  var activeToastId = null;
  var catReactionTimerId = null;
  var roomResizeObserver = null;
  var careJourneyDate = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getSelectedCat() {
    var current = game.state.game.cats.find(function (cat) {
      return cat.id === game.state.selectedCatId;
    });

    if (current) {
      return current;
    }

    current = game.state.game.cats.find(function (cat) {
      return cat.unlocked;
    });

    game.state.selectedCatId = current ? current.id : null;
    return current;
  }

  function pushNotice(text) {
    if (!text) {
      return;
    }

    game.state.notifications.push({
      id: Date.now() + Math.random(),
      text: text,
      time: format.formatGameTime(game.state.game.player),
    });

    renderToast();
  }

  function renderToast() {
    var notice;
    if (!dom.toast) {
      return;
    }

    if (activeToastId !== null) {
      return;
    }

    notice = game.state.notifications[0];
    if (!notice) {
      dom.toast.innerHTML = "";
      dom.toast.hidden = true;
      return;
    }

    dom.toast.hidden = false;
    dom.toast.innerHTML = '<div class="news-toast"><span>' + t("toast_kicker") + '</span><p>' +
      format.escapeHtml(notice.text) + '</p></div>';

    activeToastId = notice.id;
    if (toastTimerId) {
      window.clearTimeout(toastTimerId);
    }
    toastTimerId = window.setTimeout(function () {
      game.state.notifications = game.state.notifications.filter(function (queuedNotice) {
        return queuedNotice.id !== notice.id;
      });
      if (dom.toast) {
        dom.toast.hidden = true;
        dom.toast.innerHTML = "";
      }
      activeToastId = null;
      toastTimerId = null;
      renderToast();
    }, 3200);
  }

  function persistGame(force) {
    if (force) {
      game.state.saveSystem.saveGame(game.state.game);
      return;
    }
    game.state.saveSystem.autoSave();
  }

  function updateShellText() {
    document.title = t("appTitle");
    document.documentElement.lang = game.utils.i18n.getLanguage();
    if (dom.navigation) {
      dom.navigation.setAttribute("aria-label", t("main_navigation"));
    }
    if (dom.mobileNavigation) {
      dom.mobileNavigation.setAttribute("aria-label", t("mobile_navigation"));
    }
  }

  function handleActionResult(result) {
    var journeyFocused = document.activeElement && document.activeElement.closest("[data-care-journey]");
    if (!result) {
      return;
    }

    if (result.messages && result.messages.length) {
      result.messages.forEach(pushNotice);
    } else if (result.message) {
      pushNotice(result.message);
    }

    game.systems.homeSystem.recalculateComfort();
    game.systems.workSystem.refreshJobUnlocks();
    game.systems.taskSystem.refreshAllTasks();
    persistGame(Boolean(result.forceSave));
    render();
    if (journeyFocused) {
      var nextHeading = document.querySelector("[data-care-journey] h3");
      if (nextHeading) nextHeading.focus({ preventScroll: true });
    }
  }

  function showCatReaction(catId, action) {
    var poses = {
      feedBasic: "fish",
      feedPremium: "fish",
      clean: "surprised",
      play: "pounce",
      rest: "nap",
      catGrass: "joy",
      medicine: "heart",
    };
    var pose = poses[action];

    if (!catId || !pose) {
      return;
    }
    game.state.catReaction = { catId: catId, pose: pose, expiresAt: Date.now() + 2200 };
    if (catReactionTimerId) {
      window.clearTimeout(catReactionTimerId);
    }
    catReactionTimerId = window.setTimeout(function () {
      game.state.catReaction = null;
      catReactionTimerId = null;
      if (game.state.currentPage === "home" || game.state.currentPage === "cats") {
        render(true);
      }
    }, 2250);
  }

  function scheduleLotteryResolve(source) {
    if (!game.systems.lotterySystem) {
      return;
    }

    game.systems.lotterySystem.resolvePendingDraws(source).then(function (result) {
      var latestSummary;
      var celebrationKey;

      if (!result) {
        return;
      }

      if (result.messages && result.messages.length) {
        result.messages.forEach(pushNotice);
      }

      if (result.changed) {
        latestSummary = game.state.game.lottery.lastResultSummary;
        if (latestSummary && latestSummary.totalPayout > 0) {
          celebrationKey = [latestSummary.drawDate, latestSummary.winningNumber, latestSummary.totalPayout].join(":");
          game.state.lotteryCelebration = {
            key: celebrationKey,
            endsAt: Date.now() + 5200,
          };

          if (lotteryCelebrationTimerId) {
            window.clearTimeout(lotteryCelebrationTimerId);
          }
          lotteryCelebrationTimerId = window.setTimeout(function () {
            if (game.state.lotteryCelebration && game.state.lotteryCelebration.key === celebrationKey) {
              game.state.lotteryCelebration = null;
              if (game.state.currentPage === "arcade") {
                render(true);
              }
            }
          }, 5300);
        }

        persistGame(true);
        render(true);
      } else if (game.state.currentPage === "arcade") {
        render(true);
      }
    });
  }

  function refreshLiveBindings() {
    var activeWork = game.systems.workSystem.getActiveWork();
    var displayStats = game.systems.playerSystem.getDisplayStats();
    var activeSleep = game.systems.playerSystem.getActiveSleep();
    var sleepRecovery = game.systems.playerSystem.getSleepRecovery();
    var hungerCountdown = game.systems.playerSystem.getHungerCountdown();
    var hungerEta = game.systems.playerSystem.getHungerBlockEta();
    var moodStatus = game.systems.playerSystem.getMoodStatus(displayStats.mood);
    var remainingText = activeWork
      ? format.formatDuration(game.systems.workSystem.getRemainingMs(activeWork))
      : t("task_completed");
    var workProgress = 0;

    if (activeWork) {
      workProgress = format.toPercent(
        Date.now() - new Date(activeWork.startedAt).getTime(),
        new Date(activeWork.endsAt).getTime() - new Date(activeWork.startedAt).getTime()
      );
    }

    function refreshStat(valueSelector, barSelector, value, inverseTone) {
      var safeValue = Math.max(0, Math.min(100, Math.round(value || 0)));
      var isDanger = inverseTone ? safeValue >= 70 : safeValue <= 25;

      Array.prototype.forEach.call(document.querySelectorAll(valueSelector), function (node) {
        node.textContent = safeValue;
      });
      Array.prototype.forEach.call(document.querySelectorAll(barSelector), function (node) {
        node.style.width = safeValue + "%";
        node.setAttribute("aria-valuenow", safeValue);
        node.classList.toggle("is-danger", isDanger);
        node.classList.toggle("is-normal", !isDanger);
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll("[data-live-clock]"), function (node) {
      node.textContent = format.formatGameTime();
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-active-work-remaining]"), function (node) {
      node.textContent = remainingText;
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-active-work-progress]"), function (node) {
      node.style.width = workProgress + "%";
      node.setAttribute("aria-valuenow", workProgress);
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-work-live-status]"), function (node) {
      node.textContent = activeWork ? t("work_scene_active") : t("work_scene_ready");
    });

    refreshStat("[data-player-stamina-live]", "[data-player-stamina-bar]", displayStats.stamina, false);
    refreshStat("[data-player-mood-live]", "[data-player-mood-bar]", displayStats.mood, false);
    refreshStat("[data-player-hunger-live]", "[data-player-hunger-bar]", game.systems.playerSystem.getCurrentHunger(), true);

    Array.prototype.forEach.call(document.querySelectorAll("[data-player-condition-copy]"), function (node) {
      var hungerBlockThreshold = game.config.playerCondition.hungerBlockThreshold;
      node.textContent = displayStats.mood < 35
        ? t("work_low_mood_warning")
        : game.systems.playerSystem.getCurrentHunger() >= hungerBlockThreshold
        ? t("work_hunger_warning")
        : t("player_status_copy");
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-player-mood-status]"), function (node) {
      node.textContent = t(moodStatus.key);
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-player-hunger-countdown]"), function (node) {
      node.textContent = hungerCountdown === null ? t("stopped") : format.formatDuration(hungerCountdown);
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-player-hunger-eta]"), function (node) {
      node.textContent = hungerEta === null ? t("work_hunger_blocked") : format.formatDuration(hungerEta);
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-player-sleep-duration]"), function (node) {
      node.textContent = activeSleep ? format.formatDuration(sleepRecovery.elapsedMs) : t("sleep_not_active");
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-player-sleep-stamina]"), function (node) {
      node.textContent = activeSleep ? sleepRecovery.staminaGain : "0";
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-player-sleep-mood]"), function (node) {
      node.textContent = activeSleep ? sleepRecovery.moodGain : "0";
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-lottery-next-draw-countdown]"), function (node) {
      node.textContent = game.systems.lotterySystem
        ? format.formatDuration(game.systems.lotterySystem.getNextDrawInfo().countdownMs)
        : t("stopped");
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-cat-stat-countdown]"), function (node) {
      var cat = game.systems.catSystem.getCat(node.dataset.catId);
      var countdown = cat ? game.systems.catSystem.getStatCountdown(cat, node.dataset.catStat) : null;
      node.textContent = countdown === null ? t("stopped") : format.formatDuration(countdown);
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-cat-hunger-zero]"), function (node) {
      var cat = game.systems.catSystem.getCat(node.dataset.catId);
      var deathEta = cat ? game.systems.catSystem.getHungerDeathEta(cat) : null;
      node.textContent = deathEta === null ? t("stopped") : format.formatDuration(deathEta);
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-cat-disease-countdown]"), function (node) {
      var cat = game.systems.catSystem.getCat(node.dataset.catId);
      var countdown = cat ? game.systems.catSystem.getDiseaseProgressCountdown(cat) : null;
      node.textContent = countdown === null ? t("stopped") : format.formatDuration(countdown);
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-pregnancy-countdown]"), function (node) {
      var cat = game.systems.catSystem.getCat(node.dataset.catId);
      var countdown = cat ? game.systems.collectionSystem.getPregnancyCountdown(cat) : null;
      node.textContent = countdown === null ? t("stopped") : format.formatDuration(countdown);
    });
  }

  function syncRealtime(source) {
    var result = game.systems.timeSystem.syncRealtimeState(source);
    var today = game.systems.timeSystem.getNow().toISOString().slice(0, 10);
    var journeyDayChanged = careJourneyDate !== today;
    careJourneyDate = today;

    if (result.messages && result.messages.length) {
      result.messages.forEach(pushNotice);
    }

    if (result.changed) {
      game.systems.homeSystem.recalculateComfort();
      game.systems.workSystem.refreshJobUnlocks();
      game.systems.taskSystem.refreshAllTasks();
      persistGame(true);
      render(true);
    } else if (journeyDayChanged && (game.state.currentPage === "home" || game.state.currentPage === "cats")) {
      render(true);
    } else {
      refreshLiveBindings();
    }

    if (result.lotteryNeedsResolve || source === "init" || source === "focus" || source === "visibility") {
      scheduleLotteryResolve(source);
    }
  }

  function buildArcadeSpinColumns() {
    var symbolIcons = game.systems.arcadeSystem.symbols.map(function (symbol) {
      return symbol.icon;
    });

    return [0, 1, 2].map(function () {
      var column = [];
      var i;
      for (i = 0; i < 12; i += 1) {
        column.push(symbolIcons[Math.floor(Math.random() * symbolIcons.length)]);
      }
      return column;
    });
  }

  function startArcadeSpin(betValue) {
    var validation = game.systems.arcadeSystem.validateSpin(betValue);

    if (!validation.ok) {
      handleActionResult(validation);
      return;
    }

    if (game.state.arcadeSpin) {
      return;
    }

    game.state.arcadeSpin = {
      bet: Number(betValue),
      columns: buildArcadeSpinColumns(),
    };
    render();

    if (arcadeSpinTimerId) {
      window.clearTimeout(arcadeSpinTimerId);
    }

    arcadeSpinTimerId = window.setTimeout(function () {
      var result = game.systems.arcadeSystem.spinSlot(betValue);
      game.state.arcadeSpin = null;
      arcadeSpinTimerId = null;
      handleActionResult(result);
    }, 1300);
  }

  function render(preserveDrafts) {
    // Background updates must not discard text, amounts or selections being
    // edited. These drafts stay in memory only; explicit actions render afresh.
    var drafts = preserveDrafts === true ? Array.prototype.filter.call(
      dom.main.querySelectorAll('input[id]:not([type="file"]):not([type="hidden"]), textarea[id], select[id]'),
      function (node) { return !node.readOnly && !node.disabled; }
    ).map(function (node) {
      return { id: node.id, tag: node.tagName, type: node.type, value: node.value, checked: node.checked,
        focused: document.activeElement === node, start: node.selectionStart, end: node.selectionEnd,
        direction: node.selectionDirection };
    }) : [];
    var pageRenderers = {
      home: game.ui.renderHome,
      room: game.ui.renderCommunityPanel,
      community: game.ui.renderCommunityPanel,
      work: game.ui.renderWorkPanel,
      bank: game.ui.renderBankPanel,
      cats: game.ui.renderCatPanel,
      collection: game.ui.renderCollectionPanel,
      arcade: game.ui.renderArcadePanel,
      hospital: game.ui.renderHospitalPanel,
      shop: game.ui.renderShopPanel,
      inventory: game.ui.renderInventoryPanel,
      member_store: game.ui.renderMemberStorePanel,
      tasks: game.ui.renderTaskPanel,
      version: game.ui.renderVersionPanel,
      save: game.ui.renderSavePanel,
      settings: game.ui.renderSettingsPanel,
      more: game.ui.renderMorePanel,
    };
    var renderer = pageRenderers[game.state.currentPage] || game.ui.renderHome;

    dom.header.innerHTML = game.ui.renderHeader(game.state.game);
    dom.main.innerHTML = renderer(game.state.game);
    drafts.forEach(function (draft) {
      var node = document.getElementById(draft.id);
      if (!node || node.tagName !== draft.tag || node.type !== draft.type || node.disabled || node.readOnly) return;
      if (node.tagName === "SELECT" && !Array.prototype.some.call(node.options, function (option) { return option.value === draft.value; })) return;
      node.value = draft.value;
      if (node.type === "checkbox" || node.type === "radio") node.checked = draft.checked;
      if (draft.focused) node.focus({ preventScroll: true });
      if (typeof draft.start === "number") node.setSelectionRange(draft.start, draft.end, draft.direction);
    });
    dom.navigation.innerHTML = game.ui.renderDesktopNavigation(game.state.game);
    dom.mobileNavigation.innerHTML = game.ui.renderMobileNavigation(game.state.game);
    if (roomResizeObserver) roomResizeObserver.disconnect();
    arrangeRoomFurniture();
    var roomScene = dom.main.querySelector(".room-scene");
    if (roomResizeObserver && roomScene) roomResizeObserver.observe(roomScene);
    updateShellText();
    renderToast();
    if (game.systems.musicSystem) {
      game.systems.musicSystem.syncForState(game.state.currentPage);
    }

    Array.prototype.forEach.call(document.querySelectorAll(".nav-button[data-page-target]"), function (button) {
      button.classList.toggle("is-active", button.dataset.pageTarget === game.state.currentPage);
      if (button.dataset.pageTarget === game.state.currentPage) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
    Array.prototype.forEach.call(document.querySelectorAll(".mobile-nav-button[data-page-target]"), function (button) {
      var mainPages = ["home", "work", "cats", "community"];
      var isActive = button.dataset.pageTarget === game.state.currentPage ||
        (button.dataset.pageTarget === "more" && mainPages.indexOf(game.state.currentPage) === -1);
      button.classList.toggle("is-active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
  }

  function updateSetting(target) {
    var key = target.dataset.settingKey;
    if (!key) {
      return;
    }

    if (key === "customMusicEnabled" && !game.state.game.settings.customMusicData) {
      target.checked = false;
      pushNotice(t("custom_music_missing"));
      render();
      return;
    }

    if (target.type === "checkbox") {
      game.state.game.settings[key] = target.checked;
    } else if (target.type === "range") {
      game.state.game.settings[key] = Number(target.value);
    } else {
      game.state.game.settings[key] = target.value;
    }

    if (
      key === "language" &&
      window.CatGameIntegration &&
      typeof window.CatGameIntegration.useSavedLanguage === "function"
    ) {
      window.CatGameIntegration.useSavedLanguage(game.state.game.settings.language);
    }

    game.state.saveSystem.saveGame(game.state.game);
    if (game.systems.musicSystem) {
      game.systems.musicSystem.applyVolume();
      game.systems.musicSystem.syncForState(game.state.currentPage);
    }
    pushNotice(t("settings_updated"));
    render();
  }

  function importFromText(rawText) {
    var imported = game.state.saveSystem.importText(rawText);
    game.state.game = imported;
    game.systems.homeSystem.recalculateComfort();
    game.systems.workSystem.refreshJobUnlocks();
    game.systems.taskSystem.refreshAllTasks();
    syncRealtime("import");
    getSelectedCat();
    pushNotice(t("import_success"));
    render();
  }

  function replaceGameState(saveData, options) {
    var settings = options || {};
    var localSettings = game.state.game && game.state.game.settings || {};
    var imported = game.state.normalizeGameData(saveData);
    if (settings.preserveCustomMusic) {
      imported.settings.customMusicData = localSettings.customMusicData || "";
      imported.settings.customMusicName = localSettings.customMusicName || "";
      imported.settings.customMusicEnabled = Boolean(localSettings.customMusicEnabled && localSettings.customMusicData);
    }
    game.state.game = imported;
    game.systems.homeSystem.recalculateComfort();
    game.systems.workSystem.refreshJobUnlocks();
    game.systems.taskSystem.refreshAllTasks();
    syncRealtime(settings.reason || "cloud");
    getSelectedCat();
    if (settings.save !== false) game.state.saveSystem.saveGame(game.state.game);
    render();
    return game.state.game;
  }

  function applyCloudSave(saveData) {
    return replaceGameState(saveData, { preserveCustomMusic: true, reason: "cloud" });
  }

  function activateMemberStorage(accountId, options) {
    var settings = options || {};
    var storageKey = game.config.storageKey + ":member:" + String(accountId);
    game.state.saveSystem.setStorageKey(storageKey);

    var memberSave = game.state.saveSystem.loadGame();
    if (memberSave) {
      return { source: "member", game: replaceGameState(memberSave, { save: false, reason: "member" }) };
    }
    if (settings.allowGuestImport) {
      game.state.saveSystem.saveGame(game.state.game);
      return { source: "guest", game: game.state.game };
    }
    if (settings.remoteSave && settings.remoteSave.data) {
      return {
        source: "remote",
        game: replaceGameState(settings.remoteSave.data, { preserveCustomMusic: false, reason: "cloud" })
      };
    }

    return { source: "fresh", game: replaceGameState(game.state.createNewGame(), { reason: "member" }) };
  }

  window.CatGameApp = {
    activateMemberStorage: activateMemberStorage,
    applyCloudSave: applyCloudSave,
    render: render,
  };

  function handleClick(event) {
    var pageButton = event.target.closest("[data-page-target]");
    var catSelectButton = event.target.closest("[data-select-cat]");
    var jobButton = event.target.closest("[data-job-id]");
    var workSelectButton = event.target.closest("[data-select-work-job]");
    var workFilterButton = event.target.closest("[data-work-filter]");
    var catActionButton = event.target.closest("[data-cat-action]");
    var shopButton = event.target.closest("[data-store-item]");
    var taskButton = event.target.closest("[data-task-claim]");
    var exportButton = event.target.closest("[data-export-save]");
    var importButton = event.target.closest("[data-import-save]");
    var manualSaveButton = event.target.closest("[data-manual-save]");
    var resetButton = event.target.closest("[data-reset-save]");
    var renameButton = event.target.closest("[data-rename-player]");
    var renameCatButton = event.target.closest("[data-rename-cat]");
    var releaseNoteButton = event.target.closest("[data-dismiss-release-note]");
    var readoptButton = event.target.closest("[data-readopt-cat]");
    var rescueButton = event.target.closest("[data-rescue-cat]");
    var reliefMealButton = event.target.closest("[data-care-meal]");
    var learningMeetButton = event.target.closest("[data-learning-meet]");
    var learningSuppliesButton = event.target.closest("[data-learning-supplies]");
    var careBackupButton = event.target.closest("[data-export-care-backup]");
    var treatButton = event.target.closest("[data-treat-cat]");
    var sleepButton = event.target.closest("[data-player-sleep]");
    var usePlayerItemButton = event.target.closest("[data-use-player-item]");
    var bankActionButton = event.target.closest("[data-bank-action]");
    var lotteryActionButton = event.target.closest("[data-lottery-action]");
    var communityHomeButton = event.target.closest("[data-community-home]");
    var communityBackButton = event.target.closest("[data-community-back]");
    var communityNeighborButton = event.target.closest("[data-community-neighbor]");
    var communityVisitButton = event.target.closest("[data-community-visit]");
    var communityGiftButton = event.target.closest("[data-community-gift]");
    var communityExchangeButton = event.target.closest("[data-community-exchange]");
    var arcadeViewButton = event.target.closest("[data-arcade-view]");
    var arcadeDetailsButton = event.target.closest("[data-arcade-details]");
    var slotButton = event.target.closest("[data-slot-bet]");
    var slotSpinButton = event.target.closest("[data-slot-spin]");
    var breedButton = event.target.closest("[data-breed-cats]");
    var inspectCollectionButton = event.target.closest("[data-inspect-collection-cat]");
    var resetRoomLayoutButton = event.target.closest("[data-reset-room-layout]");
    var upgradeRoomButton = event.target.closest("[data-upgrade-room]");
    var clearCustomMusicButton = event.target.closest("[data-clear-custom-music]");
    var soundToggleButton = event.target.closest("[data-top-sound-toggle]");
    var shopCategoryButton = event.target.closest("[data-shop-category]");
    var roomModeButton = event.target.closest("[data-room-mode-target]");
    var roomOptionButton = event.target.closest("[data-room-option-key]");
    var catActionResult;

    if (roomModeButton) {
      game.state.roomMode = roomModeButton.dataset.roomModeTarget === "edit" ? "edit" : "life";
      render();
      return;
    }

    if (roomOptionButton) {
      var roomOptionKey = roomOptionButton.dataset.roomOptionKey;
      var roomOptionValue = roomOptionButton.dataset.roomOptionValue;
      if (!game.systems.homeSystem.isRoomSettingAllowed(roomOptionKey, roomOptionValue)) {
        pushNotice(t("premium_room_locked"));
        render();
        return;
      }
      game.state.game.home.roomScene[roomOptionKey] = roomOptionValue;
      if (roomOptionKey === "layout") {
        game.systems.homeSystem.resetFurnitureLayout();
      }
      persistGame(true);
      render();
      return;
    }

    if (soundToggleButton) {
      if (game.state.game.settings.bgmEnabled !== false && Number(game.state.game.settings.bgmVolume || 0) > 0) {
        game.state.game.settings.bgmEnabled = false;
      } else {
        game.state.game.settings.bgmEnabled = true;
        if (Number(game.state.game.settings.bgmVolume || 0) <= 0) {
          game.state.game.settings.bgmVolume = 60;
        }
      }
      game.state.saveSystem.saveGame(game.state.game);
      if (game.systems.musicSystem) {
        game.systems.musicSystem.applyVolume();
        game.systems.musicSystem.syncForState(game.state.currentPage);
      }
      render();
      return;
    }

    if (shopCategoryButton) {
      game.state.shopCategory = shopCategoryButton.dataset.shopCategory;
      render();
      shopCategoryButton = document.getElementById("shop-tab-" + game.state.shopCategory);
      if (shopCategoryButton) {
        shopCategoryButton.focus();
      }
      return;
    }

    if (game.systems.musicSystem) {
      game.systems.musicSystem.unlock();
    }

    if (pageButton) {
      if (pageButton.dataset.selectCat) {
        game.state.selectedCatId = pageButton.dataset.selectCat;
      }
      game.state.currentPage = pageButton.dataset.pageTarget;
      if (game.state.currentPage === "room") {
        game.state.currentPage = "community";
      }
      if (game.state.currentPage === "community") {
        game.state.communityView = "main";
        game.state.selectedCommunityNpcId = null;
      }
      render();
      window.scrollTo(0, 0);
      if (pageButton.dataset.pageTarget === "arcade") {
        scheduleLotteryResolve("arcade-page");
      }
      return;
    }

    if (arcadeViewButton) {
      game.state.arcadeView = arcadeViewButton.dataset.arcadeView === "lottery" ? "lottery" : "slot";
      render();
      return;
    }

    if (arcadeDetailsButton) {
      var arcadeDetails = document.querySelector(".arcade-details");
      var arcadeDetailsSummary = arcadeDetails ? arcadeDetails.querySelector("summary") : null;
      if (arcadeDetails) {
        arcadeDetails.open = true;
        if (arcadeDetailsSummary) {
          arcadeDetailsSummary.focus();
        }
        arcadeDetails.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    if (communityHomeButton) {
      game.state.currentPage = "community";
      game.state.communityView = "player_home";
      game.state.roomMode = "life";
      game.state.selectedCommunityNpcId = null;
      render();
      return;
    }

    if (communityBackButton) {
      game.state.currentPage = "community";
      game.state.communityView = "main";
      game.state.selectedCommunityNpcId = null;
      render();
      return;
    }

    if (communityNeighborButton) {
      game.state.currentPage = "community";
      game.state.communityView = "npc_home";
      game.state.selectedCommunityNpcId = communityNeighborButton.dataset.communityNeighbor;
      render();
      return;
    }

    if (communityVisitButton) {
      handleActionResult(game.systems.communitySystem.visitNpc(communityVisitButton.dataset.communityVisit));
      return;
    }

    if (communityGiftButton) {
      handleActionResult(
        game.systems.communitySystem.giveGift(
          communityGiftButton.dataset.communityNpc,
          communityGiftButton.dataset.communityGift
        )
      );
      return;
    }

    if (communityExchangeButton) {
      handleActionResult(game.systems.communitySystem.performExchange(communityExchangeButton.dataset.communityExchange));
      return;
    }

    if (catSelectButton) {
      game.state.selectedCatId = catSelectButton.dataset.selectCat;
      render();
      return;
    }

    if (workFilterButton && game.state.currentPage === "work") {
      game.state.workFilter = ["all", "unlocked", "locked"].indexOf(workFilterButton.dataset.workFilter) >= 0
        ? workFilterButton.dataset.workFilter
        : "all";
      render();
      return;
    }

    if (workSelectButton && game.state.currentPage === "work") {
      game.state.workJobId = workSelectButton.dataset.selectWorkJob;
      render();
      return;
    }

    if (inspectCollectionButton) {
      game.state.collectionInspectCatId = inspectCollectionButton.dataset.inspectCollectionCat;
      render();
      return;
    }

    if (jobButton) {
      handleActionResult(game.systems.workSystem.startJob(jobButton.dataset.jobId));
      return;
    }

    if (catActionButton) {
      if (catActionButton.dataset.catId) {
        game.state.selectedCatId = catActionButton.dataset.catId;
      }
      catActionResult = game.systems.catSystem.performAction(game.state.selectedCatId, catActionButton.dataset.catAction);
      if (catActionResult && catActionResult.ok) {
        showCatReaction(game.state.selectedCatId, catActionButton.dataset.catAction);
      }
      handleActionResult(catActionResult);
      return;
    }

    if (learningMeetButton) {
      var meetResult = game.systems.onboardingSystem.meetCat(learningMeetButton.dataset.learningMeet);
      if (meetResult.ok) game.state.selectedCatId = learningMeetButton.dataset.learningMeet;
      handleActionResult(meetResult);
      return;
    }

    if (learningSuppliesButton) {
      handleActionResult(game.systems.onboardingSystem.claimSupplies());
      return;
    }

    if (readoptButton) {
      handleActionResult(game.systems.catSystem.readoptCat(readoptButton.dataset.readoptCat));
      return;
    }

    if (rescueButton) {
      game.state.selectedCatId = rescueButton.dataset.rescueCat;
      handleActionResult(game.systems.careSystem.rescueCat(rescueButton.dataset.rescueCat));
      return;
    }

    if (reliefMealButton) {
      handleActionResult(game.systems.careSystem.getMeal());
      return;
    }

    if (careBackupButton) {
      game.state.saveSystem.downloadCareRecoveryBackup();
      return;
    }

    if (treatButton) {
      handleActionResult(game.systems.hospitalSystem.treatCat(treatButton.dataset.treatCat));
      return;
    }

    if (sleepButton) {
      handleActionResult(game.systems.playerSystem.sleep());
      return;
    }

    if (usePlayerItemButton) {
      handleActionResult(game.systems.playerSystem.consumeItem(usePlayerItemButton.dataset.usePlayerItem));
      return;
    }

    if (bankActionButton) {
      var inputId = bankActionButton.dataset.bankInput;
      var amountInput = inputId ? document.getElementById(inputId) : null;
      var presetAmount = bankActionButton.dataset.bankAmount;
      var rawValue = presetAmount !== undefined && presetAmount !== ""
        ? presetAmount
        : amountInput
        ? amountInput.value
        : "";
      var actionKey = bankActionButton.dataset.bankAction;
      var result = null;

      if (actionKey === "deposit") {
        result = game.systems.bankSystem.deposit(rawValue);
      } else if (actionKey === "withdraw") {
        result = game.systems.bankSystem.withdraw(rawValue);
      } else if (actionKey === "loan") {
        result = game.systems.bankSystem.takeLoan(rawValue);
      } else if (actionKey === "repay") {
        result = game.systems.bankSystem.repay(rawValue);
      } else if (actionKey === "repay-full") {
        result = game.systems.bankSystem.payOffLoan();
      }

      if (amountInput && presetAmount !== undefined && presetAmount !== "") {
        amountInput.value = presetAmount;
      }

      handleActionResult(result);
      return;
    }

    if (lotteryActionButton) {
      var lotteryAction = lotteryActionButton.dataset.lotteryAction;

      if (lotteryAction === "randomize") {
        game.systems.lotterySystem.randomizeDraft();
        render();
        return;
      }
      if (lotteryAction === "buy-current") {
        handleActionResult(game.systems.lotterySystem.purchaseTicket(game.systems.lotterySystem.getDraftNumber()));
        return;
      }
      if (lotteryAction === "buy-random") {
        handleActionResult(
          game.systems.lotterySystem.purchaseRandomTickets(
            Number(lotteryActionButton.dataset.lotteryCount || 1)
          )
        );
        return;
      }
      if (lotteryAction === "retry") {
        scheduleLotteryResolve("lottery-retry");
        return;
      }
    }

    if (slotButton) {
      game.state.arcadeBet = Number(slotButton.dataset.slotBet || game.config.slotBets[0]);
      render();
      return;
    }

    if (slotSpinButton) {
      startArcadeSpin(game.state.arcadeBet || game.config.slotBets[0]);
      return;
    }

    if (breedButton) {
      handleActionResult(
        game.systems.collectionSystem.breedCats(
          document.getElementById("breed-parent-a") ? document.getElementById("breed-parent-a").value : "",
          document.getElementById("breed-parent-b") ? document.getElementById("breed-parent-b").value : ""
        )
      );
      return;
    }

    if (resetRoomLayoutButton) {
      game.systems.homeSystem.resetFurnitureLayout();
      pushNotice(t("room_layout_reset_done"));
      persistGame(true);
      render();
      return;
    }

    if (upgradeRoomButton) {
      handleActionResult(game.systems.homeSystem.upgradeRoom());
      return;
    }

    if (shopButton) {
      handleActionResult(game.systems.shopSystem.purchase(shopButton.dataset.storeItem));
      return;
    }

    if (taskButton) {
      handleActionResult(
        game.systems.taskSystem.claimTask(taskButton.dataset.taskCategory, taskButton.dataset.taskClaim)
      );
      return;
    }

    if (exportButton) {
      game.state.saveSystem.downloadExport();
      pushNotice(t("export_success"));
      render();
      return;
    }

    if (manualSaveButton) {
      game.state.saveSystem.saveGame(game.state.game);
      pushNotice(t("manual_save_done"));
      render();
      return;
    }

    if (importButton) {
      var importField = document.getElementById("save-import-text");
      if (!importField || !importField.value.trim()) {
        handleActionResult({ ok: false, message: t("import_need_text") });
        return;
      }
      try {
        importFromText(importField.value.trim());
      } catch (error) {
        handleActionResult({ ok: false, message: t("import_invalid") });
      }
      return;
    }

    if (resetButton) {
      if (!window.confirm(t("reset_confirm"))) {
        return;
      }
      game.state.game = game.state.saveSystem.resetGame();
      game.systems.homeSystem.recalculateComfort();
      game.systems.workSystem.refreshJobUnlocks();
      game.systems.taskSystem.refreshAllTasks();
      game.state.selectedCatId = "cat_001";
      pushNotice(t("reset_success"));
      render();
      return;
    }

    if (renameButton) {
      var nameInput = document.getElementById("player-name-input");
      var nextName = nameInput ? nameInput.value.trim() : "";
      game.state.game.player.name = nextName || "玩家";
      game.state.saveSystem.saveGame(game.state.game);
      pushNotice(t("rename_success"));
      render();
      return;
    }

    if (renameCatButton) {
      var catNameInput = document.getElementById("cat-name-input");
      handleActionResult(
        game.systems.catSystem.renameCat(
          renameCatButton.dataset.renameCat,
          catNameInput ? catNameInput.value : ""
        )
      );
      return;
    }

    if (clearCustomMusicButton) {
      game.systems.musicSystem.clearCustomMusic();
      game.state.saveSystem.saveGame(game.state.game);
      pushNotice(t("custom_music_cleared"));
      render();
      return;
    }

    if (releaseNoteButton) {
      game.state.game.meta.lastSeenVersion = game.config.version;
      persistGame(true);
      pushNotice(t("release_noted"));
      render();
    }
  }

  function handleKeyDown(event) {
    var shopTab = event.target.closest("[data-shop-category]");
    var categories = ["cat", "player", "furniture", "sale"];
    var currentIndex;
    var nextIndex;
    var nextTab;

    if (!shopTab || game.state.currentPage !== "shop") {
      return;
    }
    currentIndex = categories.indexOf(shopTab.dataset.shopCategory);
    if (currentIndex === -1) {
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % categories.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + categories.length) % categories.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = categories.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    game.state.shopCategory = categories[nextIndex];
    render();
    nextTab = document.getElementById("shop-tab-" + game.state.shopCategory);
    if (nextTab) {
      nextTab.focus();
    }
  }

  function handleChange(event) {
    var target = event.target;

    if (target.matches("[data-setting-key]")) {
      updateSetting(target);
      return;
    }

    if (target.matches("[data-room-setting]")) {
      if (!game.systems.homeSystem.isRoomSettingAllowed(target.dataset.roomSetting, target.value)) {
        pushNotice(t("premium_room_locked"));
        render();
        return;
      }
      game.state.game.home.roomScene[target.dataset.roomSetting] = target.value;
      if (target.dataset.roomSetting === "layout") {
        game.systems.homeSystem.resetFurnitureLayout();
      }
      game.state.saveSystem.saveGame(game.state.game);
      render();
      return;
    }

    if (target.matches("[data-lottery-digit-index]")) {
      game.systems.lotterySystem.setDraftDigit(target.dataset.lotteryDigitIndex, target.value);
      render();
      return;
    }

    if (target.matches("[data-lottery-history-draw]")) {
      game.state.lotteryHistoryDrawDate = target.value || null;
      render();
      return;
    }

    if (target.id === "save-import-file" && target.files && target.files[0]) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          importFromText(String(reader.result || ""));
        } catch (error) {
          handleActionResult({ ok: false, message: t("import_file_invalid") });
        }
      };
      reader.readAsText(target.files[0], "utf-8");
      return;
    }

    if (target.id === "custom-music-file" && target.files && target.files[0]) {
      var musicFile = target.files[0];
      var musicReader;
      var maxBytes = game.config.customMusicMaxBytes || (2 * 1024 * 1024);

      if (musicFile.size > maxBytes) {
        pushNotice(t("custom_music_size_error", { size: (maxBytes / (1024 * 1024)).toFixed(0) }));
        target.value = "";
        render();
        return;
      }

      musicReader = new FileReader();
      musicReader.onload = function () {
        try {
          game.state.game.settings.customMusicData = String(musicReader.result || "");
          game.state.game.settings.customMusicName = musicFile.name;
          game.state.game.settings.customMusicEnabled = true;
          game.state.saveSystem.saveGame(game.state.game);
          pushNotice(t("custom_music_imported", { name: musicFile.name }));
          if (game.systems.musicSystem) {
            game.systems.musicSystem.syncForState(game.state.currentPage);
          }
          render();
        } catch (error) {
          pushNotice(t("custom_music_size_error", { size: (maxBytes / (1024 * 1024)).toFixed(0) }));
        }
      };
      musicReader.readAsDataURL(musicFile);
      target.value = "";
    }
  }

  function roomRect(element, scene) {
    var rect = element.getBoundingClientRect();
    var origin = scene.getBoundingClientRect();
    var left = rect.left - origin.left - scene.clientLeft;
    var top = rect.top - origin.top - scene.clientTop;
    return { left: left, top: top, right: left + rect.width, bottom: top + rect.height,
      width: rect.width, height: rect.height };
  }

  function arrangeRoomFurniture() {
    if (game.state.roomDrag) return;
    var scene = dom.main.querySelector(".room-scene");
    var bench = scene && scene.querySelector(".room-theme-fixture--station-bench");
    if (!bench || !scene.clientWidth) return;
    var obstacles = [roomRect(bench, scene)];
    Array.prototype.forEach.call(scene.querySelectorAll(".room-furniture"), function (element, index) {
      var saved = game.systems.homeSystem.getFurniturePosition(element.dataset.furnitureId, index);
      var desired = { x: parseFloat(saved.left) * scene.clientWidth / 100,
        y: parseFloat(saved.top) * scene.clientHeight / 100 };
      var size = roomRect(element, scene);
      var spot = game.systems.homeSystem.resolveFurnitureSpot(desired, size,
        { width: scene.clientWidth, height: scene.clientHeight }, obstacles);
      if (spot) {
        element.style.left = spot.x / scene.clientWidth * 100 + "%";
        element.style.top = spot.y / scene.clientHeight * 100 + "%";
        obstacles.push({ left: spot.x - size.width / 2, right: spot.x + size.width / 2,
          top: spot.y - size.height / 2, bottom: spot.y + size.height / 2 });
      } else {
        obstacles.push(size);
      }
    });
  }

  function updateDraggedFurniture(clientX, clientY) {
    var drag = game.state.roomDrag;
    var xPercent;
    var yPercent;

    if (!drag || !drag.sceneRect) {
      return;
    }

    xPercent = clamp(((clientX - drag.sceneRect.left) / drag.sceneRect.width) * 100, 8, 92);
    yPercent = clamp(((clientY - drag.sceneRect.top) / drag.sceneRect.height) * 100, 34, 82);

    var scene = drag.element.closest(".room-scene");
    var bench = scene.querySelector(".room-theme-fixture--station-bench");
    if (bench) {
      var obstacles = [roomRect(bench, scene)];
      Array.prototype.forEach.call(scene.querySelectorAll(".room-furniture"), function (element) {
        if (element !== drag.element) obstacles.push(roomRect(element, scene));
      });
      var spot = game.systems.homeSystem.resolveFurnitureSpot(
        { x: xPercent * scene.clientWidth / 100, y: yPercent * scene.clientHeight / 100 },
        roomRect(drag.element, scene), { width: scene.clientWidth, height: scene.clientHeight }, obstacles);
      if (!spot) return;
      xPercent = spot.x / scene.clientWidth * 100;
      yPercent = spot.y / scene.clientHeight * 100;
    }

    game.systems.homeSystem.setFurniturePosition(drag.furnitureId, xPercent.toFixed(2) + "%", yPercent.toFixed(2) + "%");

    if (drag.element) {
      drag.element.style.left = xPercent.toFixed(2) + "%";
      drag.element.style.top = yPercent.toFixed(2) + "%";
    }
  }

  function handlePointerDown(event) {
    var furniture = event.target.closest(".room-furniture[data-furniture-id]");
    var scene;

    if (
      !furniture ||
      game.state.roomMode !== "edit" ||
      (game.state.currentPage !== "room" &&
        !(game.state.currentPage === "community" && game.state.communityView === "player_home"))
    ) {
      return;
    }

    scene = furniture.closest(".room-scene");
    if (!scene) {
      return;
    }

    game.state.roomDrag = {
      furnitureId: furniture.dataset.furnitureId,
      element: furniture,
      sceneRect: scene.getBoundingClientRect(),
      pointerId: event.pointerId,
    };

    furniture.classList.add("is-dragging");
    if (furniture.setPointerCapture) {
      furniture.setPointerCapture(event.pointerId);
    }
    updateDraggedFurniture(event.clientX, event.clientY);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!game.state.roomDrag || game.state.roomDrag.pointerId !== event.pointerId) {
      return;
    }

    updateDraggedFurniture(event.clientX, event.clientY);
    event.preventDefault();
  }

  function finishRoomDrag(event) {
    var drag = game.state.roomDrag;

    if (!drag || (event && drag.pointerId !== event.pointerId)) {
      return;
    }

    if (drag.element) {
      drag.element.classList.remove("is-dragging");
      if (event && drag.element.releasePointerCapture) {
        try {
          drag.element.releasePointerCapture(event.pointerId);
        } catch (error) {
        }
      }
    }

    game.state.roomDrag = null;
    persistGame(true);
  }

  function init() {
    dom.header = document.getElementById("app-header");
    dom.main = document.getElementById("app-main");
    dom.navigation = document.getElementById("app-navigation");
    dom.mobileNavigation = document.getElementById("app-mobile-navigation");
    dom.toast = document.getElementById("app-toast");
    if (window.ResizeObserver) roomResizeObserver = new ResizeObserver(arrangeRoomFurniture);

    game.state.game = game.state.saveSystem.loadOrCreateGame();
    if (window.CatGameIntegration && typeof window.CatGameIntegration.applySavedLanguage === "function") {
      window.CatGameIntegration.applySavedLanguage(game.utils.i18n.getLanguage());
    }

    if (typeof game.state.game.tasks._dailySpendOffset !== "number") {
      game.state.game.tasks._dailySpendOffset = 0;
    }

    game.systems.homeSystem.recalculateComfort();
    game.systems.workSystem.refreshJobUnlocks();
    game.systems.taskSystem.refreshAllTasks();
    if (game.systems.musicSystem) {
      game.systems.musicSystem.init();
    }
    getSelectedCat();

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("change", handleChange);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", finishRoomDrag);
    document.addEventListener("pointercancel", finishRoomDrag);
    window.addEventListener("focus", function () {
      syncRealtime("focus");
      if (game.systems.musicSystem) {
        game.systems.musicSystem.syncForState(game.state.currentPage);
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        syncRealtime("visibility");
        if (game.systems.musicSystem) {
          game.systems.musicSystem.syncForState(game.state.currentPage);
        }
      }
    });
    window.addEventListener("beforeunload", function () {
      game.state.saveSystem.saveGame(game.state.game);
    });
    window.addEventListener("pagehide", function () {
      game.state.saveSystem.saveGame(game.state.game);
    });

    syncRealtime("init");
    // The learning card already confirms a successful load. Keep its first
    // action unobscured; action and safety notices still appear normally.
    if (!game.systems.onboardingSystem.active(game.state.game)) {
      pushNotice(t("storage_loaded"));
    }
    render();
    if (window.CatGameCloud && typeof window.CatGameCloud.init === "function") {
      window.CatGameCloud.init(game.state.game);
    }
    if (window.CatGameCommerce && typeof window.CatGameCommerce.init === "function") {
      window.CatGameCommerce.init();
    }
    scheduleLotteryResolve("init");
    game.state.saveSystem.saveGame(game.state.game);

    if (liveTickId) {
      window.clearInterval(liveTickId);
    }
    liveTickId = window.setInterval(function () {
      syncRealtime("timer");
    }, 1000);
  }

  window.addEventListener("DOMContentLoaded", init);
})(window.CatGame);
