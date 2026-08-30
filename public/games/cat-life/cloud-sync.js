(function () {
  var apiPath = "/api/readers/game-saves/cat-life";
  var markerKey = "catGameCloudSyncV1";
  var backupKeyPrefix = "catGameLocalBackupV1:";
  var guestClaimKey = "catGameGuestSaveClaimV1";
  var memberAccountKey = "catGameMemberAccountV1";
  var syncDelayMs = 5000;
  var maxSaveBytes = Number(window.CatGame && window.CatGame.config.cloudSaveMaxBytes || 750000);
  var account = null;
  var cloudSave = null;
  var conflict = null;
  var initialized = false;
  var authenticated = false;
  var applyingRemote = false;
  var syncInFlight = false;
  var pendingAfterSync = false;
  var latestLocalSave = null;
  var syncTimer = null;

  function publishMemberSession(accountId) {
    var value = accountId ? String(accountId) : "guest";
    try {
      localStorage.setItem(memberAccountKey, value);
    } catch (error) {
    }
    window.dispatchEvent(new CustomEvent("catgame:member-session", {
      detail: { accountId: accountId ? String(accountId) : "" }
    }));
  }

  var copyByLocale = {
    "zh-Hant": {
      guest: "遊客模式",
      localOnly: "本地存檔",
      login: "登入",
      loading: "正在連接雲端存檔",
      syncing: "正在同步",
      synced: "雲端存檔已同步",
      offline: "雲端暫時無法連線",
      conflict: "需要選擇存檔",
      resolve: "處理衝突",
      title: "選擇要保留的進度",
      conflictCopy: "這個瀏覽器和雲端都有進度。請選擇一份繼續，不會靜默覆蓋任何存檔。",
      localLabel: "這台裝置",
      remoteLabel: "雲端存檔",
      useLocal: "使用這台裝置",
      useRemote: "使用雲端存檔",
      later: "稍後處理",
      recovery: "恢復記錄",
      recoveryTitle: "雲端存檔恢復",
      recoveryCopy: "可從最近五個雲端版本恢復進度。恢復前會先保留目前版本。",
      recoveryLoading: "正在讀取恢復記錄",
      recoveryEmpty: "目前沒有可恢復的雲端版本。",
      recoveryLog: "最近恢復",
      recoveryEvent: "已從版本 {source} 恢復為版本 {restored}",
      revision: "雲端版本 {revision}",
      restore: "恢復這個版本",
      restoreConfirm: "確定恢復這個雲端版本？目前版本會先被保留。",
      recovering: "正在恢復",
      recovered: "已恢復雲端存檔",
      close: "關閉",
      tooLarge: "存檔超過 750KB，已保留在本機，不會上傳。",
      failed: "同步失敗，本地進度仍已保存。"
    },
    "zh-CN": {
      guest: "游客模式",
      localOnly: "本地存档",
      login: "登录",
      loading: "正在连接云存档",
      syncing: "正在同步",
      synced: "云存档已同步",
      offline: "云存档暂时无法连接",
      conflict: "需要选择存档",
      resolve: "处理冲突",
      title: "选择要保留的进度",
      conflictCopy: "这个浏览器和云端都有进度。请选择一份继续，不会静默覆盖任何存档。",
      localLabel: "这台设备",
      remoteLabel: "云端存档",
      useLocal: "使用这台设备",
      useRemote: "使用云端存档",
      later: "稍后处理",
      recovery: "恢复记录",
      recoveryTitle: "云存档恢复",
      recoveryCopy: "可从最近五个云端版本恢复进度。恢复前会先保留当前版本。",
      recoveryLoading: "正在读取恢复记录",
      recoveryEmpty: "目前没有可恢复的云端版本。",
      recoveryLog: "最近恢复",
      recoveryEvent: "已从版本 {source} 恢复为版本 {restored}",
      revision: "云端版本 {revision}",
      restore: "恢复这个版本",
      restoreConfirm: "确定恢复这个云端版本？当前版本会先被保留。",
      recovering: "正在恢复",
      recovered: "已恢复云存档",
      close: "关闭",
      tooLarge: "存档超过 750KB，已保留在本机，不会上传。",
      failed: "同步失败，本地进度仍已保存。"
    },
    en: {
      guest: "Guest mode",
      localOnly: "Local save",
      login: "Sign in",
      loading: "Connecting cloud save",
      syncing: "Syncing",
      synced: "Cloud save synced",
      offline: "Cloud save unavailable",
      conflict: "Choose a save",
      resolve: "Resolve",
      title: "Choose the progress to keep",
      conflictCopy: "This browser and the cloud both have progress. Choose one to continue; neither save is overwritten silently.",
      localLabel: "This device",
      remoteLabel: "Cloud save",
      useLocal: "Use this device",
      useRemote: "Use cloud save",
      later: "Decide later",
      recovery: "Recovery history",
      recoveryTitle: "Cloud save recovery",
      recoveryCopy: "Restore one of the five most recent cloud versions. The current version is backed up first.",
      recoveryLoading: "Loading recovery history",
      recoveryEmpty: "No cloud versions are available for recovery yet.",
      recoveryLog: "Recent recoveries",
      recoveryEvent: "Restored version {source} as version {restored}",
      revision: "Cloud revision {revision}",
      restore: "Restore this version",
      restoreConfirm: "Restore this cloud version? The current version will be backed up first.",
      recovering: "Restoring",
      recovered: "Cloud save restored",
      close: "Close",
      tooLarge: "This save exceeds 750KB. It remains local and was not uploaded.",
      failed: "Sync failed. Your local progress is still saved."
    },
    ja: {
      guest: "ゲストモード",
      localOnly: "ローカルセーブ",
      login: "ログイン",
      loading: "クラウドセーブに接続中",
      syncing: "同期中",
      synced: "クラウドセーブ同期済み",
      offline: "クラウドセーブに接続できません",
      conflict: "セーブを選択",
      resolve: "選択する",
      title: "残す進行データを選択",
      conflictCopy: "このブラウザとクラウドの両方に進行データがあります。自動で上書きせず、使う方を選べます。",
      localLabel: "このデバイス",
      remoteLabel: "クラウドセーブ",
      useLocal: "このデバイスを使う",
      useRemote: "クラウドを使う",
      later: "後で決める",
      recovery: "復元履歴",
      recoveryTitle: "クラウドセーブの復元",
      recoveryCopy: "最近の5件のクラウド版から復元できます。現在の版は先にバックアップされます。",
      recoveryLoading: "復元履歴を読み込み中",
      recoveryEmpty: "復元できるクラウド版はまだありません。",
      recoveryLog: "最近の復元",
      recoveryEvent: "版 {source} を版 {restored} として復元しました",
      revision: "クラウド版 {revision}",
      restore: "この版を復元",
      restoreConfirm: "このクラウド版を復元しますか？現在の版は先に保存されます。",
      recovering: "復元中",
      recovered: "クラウドセーブを復元しました",
      close: "閉じる",
      tooLarge: "セーブが 750KB を超えたため、ローカルに保持し、アップロードしません。",
      failed: "同期に失敗しました。ローカルの進行データは保存されています。"
    }
  };

  var elements = {
    avatar: document.querySelector("[data-cat-member-avatar]"),
    name: document.querySelector("[data-cat-member-name]"),
    status: document.querySelector("[data-cat-cloud-status]"),
    login: document.querySelector("[data-cat-member-login]"),
    action: document.querySelector("[data-cat-cloud-action]"),
    recoveryAction: document.querySelector("[data-cat-recovery-action]"),
    dialog: document.querySelector("[data-cat-cloud-dialog]"),
    dialogTitle: document.querySelector("[data-cat-cloud-dialog-title]"),
    dialogCopy: document.querySelector("[data-cat-cloud-dialog-copy]"),
    localLabel: document.querySelector("[data-cat-cloud-local-label]"),
    localTime: document.querySelector("[data-cat-cloud-local-time]"),
    remoteLabel: document.querySelector("[data-cat-cloud-remote-label]"),
    remoteTime: document.querySelector("[data-cat-cloud-remote-time]"),
    useLocal: document.querySelector("[data-cat-cloud-use-local]"),
    useRemote: document.querySelector("[data-cat-cloud-use-remote]"),
    later: document.querySelector("[data-cat-cloud-later]"),
    dialogStatus: document.querySelector("[data-cat-cloud-dialog-status]"),
    recoveryDialog: document.querySelector("[data-cat-recovery-dialog]"),
    recoveryTitle: document.querySelector("[data-cat-recovery-title]"),
    recoveryCopy: document.querySelector("[data-cat-recovery-copy]"),
    recoveryStatus: document.querySelector("[data-cat-recovery-status]"),
    recoveryList: document.querySelector("[data-cat-recovery-list]"),
    recoveryLogSection: document.querySelector("[data-cat-recovery-log-section]"),
    recoveryLogTitle: document.querySelector("[data-cat-recovery-log-title]"),
    recoveryLog: document.querySelector("[data-cat-recovery-log]"),
    recoveryClose: document.querySelector("[data-cat-recovery-close]")
  };

  function getLocale() {
    var locale = window.CatGameIntegration && window.CatGameIntegration.siteLocale;
    return copyByLocale[locale] ? locale : "zh-Hant";
  }

  function getCopy() {
    return copyByLocale[getLocale()];
  }

  function getLibraryPath() {
    var locale = getLocale();
    if (locale === "en") return "/en/library/";
    if (locale === "ja") return "/ja/library/";
    if (locale === "zh-CN") return "/zh-hans/library/";
    return "/zh-hant/library/";
  }

  function updateLoginHref() {
    if (!elements.login) return;
    var returnPath = window.location.pathname + window.location.search;
    elements.login.href = getLibraryPath() + "?returnTo=" + encodeURIComponent(returnPath);
  }

  function initials(value) {
    var text = String(value || "SC").trim();
    return (text.slice(0, 2) || "SC").toUpperCase();
  }

  function setStatus(message) {
    if (elements.status) elements.status.textContent = message;
  }

  function renderMember() {
    var copy = getCopy();
    updateLoginHref();
    if (!authenticated || !account) {
      if (elements.name) elements.name.textContent = copy.guest;
      if (elements.avatar) elements.avatar.textContent = "SC";
      if (elements.login) {
        elements.login.hidden = false;
        elements.login.textContent = copy.login;
      }
      if (elements.action) elements.action.hidden = true;
      if (elements.recoveryAction) elements.recoveryAction.hidden = true;
      setStatus(copy.localOnly);
      return;
    }

    var displayName = account.displayName || account.username || account.email;
    if (elements.name) elements.name.textContent = displayName;
    if (elements.avatar) elements.avatar.textContent = initials(displayName);
    if (elements.login) elements.login.hidden = true;
    if (elements.action) {
      elements.action.textContent = copy.resolve;
      elements.action.hidden = !conflict;
    }
    if (elements.recoveryAction) {
      elements.recoveryAction.textContent = copy.recovery;
      elements.recoveryAction.hidden = false;
    }
  }

  function formatCopy(template, values) {
    return Object.keys(values || {}).reduce(function (text, key) {
      return text.replace(new RegExp("\\{" + key + "\\}", "g"), String(values[key]));
    }, String(template || ""));
  }

  function normalizeSave(saveData) {
    if (!saveData || typeof saveData !== "object") return null;
    var cloned;
    try {
      cloned = JSON.parse(JSON.stringify(saveData));
    } catch (error) {
      return null;
    }
    if (!cloned.meta || !cloned.player || !Array.isArray(cloned.cats) || !cloned.inventory || !cloned.settings) {
      return null;
    }
    delete cloned.meta.lastSavedAt;
    delete cloned.meta.lastSyncAt;
    cloned.settings.customMusicData = "";
    cloned.settings.customMusicName = "";
    cloned.settings.customMusicEnabled = false;
    return cloned;
  }

  async function digestSave(saveData) {
    var normalized = normalizeSave(saveData);
    if (!normalized) return "";
    var bytes = new TextEncoder().encode(JSON.stringify(normalized));
    var digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.prototype.map.call(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function readMarkers() {
    try {
      return JSON.parse(localStorage.getItem(markerKey) || "{}") || {};
    } catch (error) {
      return {};
    }
  }

  function readMarker() {
    if (!account) return null;
    return readMarkers()[String(account.id)] || null;
  }

  function writeMarker(save, localDigest) {
    if (!account || !save) return false;
    try {
      var markers = readMarkers();
      markers[String(account.id)] = {
        localDigest: localDigest || "",
        cloudDigest: save.digest || "",
        revision: Number(save.revision || 0),
        syncedAt: new Date().toISOString()
      };
      localStorage.setItem(markerKey, JSON.stringify(markers));
      return true;
    } catch (error) {
      return false;
    }
  }

  function readGuestClaim() {
    try {
      return String(localStorage.getItem(guestClaimKey) || "");
    } catch (error) {
      return "";
    }
  }

  function claimGuestSave() {
    if (!account) return;
    try {
      localStorage.setItem(guestClaimKey, String(account.id));
    } catch (error) {
    }
  }

  function formatTime(value) {
    var date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return "-";
    try {
      return new Intl.DateTimeFormat(getLocale() === "zh-CN" ? "zh-CN" : getLocale(), {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
    } catch (error) {
      return date.toLocaleString();
    }
  }

  function closeRecoveryDialog() {
    if (!elements.recoveryDialog) return;
    if (typeof elements.recoveryDialog.close === "function") {
      elements.recoveryDialog.close();
    } else {
      elements.recoveryDialog.removeAttribute("open");
    }
  }

  function renderRecoveryHistory(result) {
    var copy = getCopy();
    var backups = Array.isArray(result.backups) ? result.backups : [];
    var events = Array.isArray(result.recoveryEvents) ? result.recoveryEvents : [];
    elements.recoveryList.replaceChildren();
    if (!backups.length) {
      var empty = document.createElement("p");
      empty.textContent = copy.recoveryEmpty;
      elements.recoveryList.appendChild(empty);
    }

    backups.forEach(function (backup) {
      var item = document.createElement("article");
      var title = document.createElement("strong");
      var time = document.createElement("span");
      var button = document.createElement("button");
      item.className = "cat-recovery-item";
      title.textContent = formatCopy(copy.revision, { revision: backup.revision });
      time.textContent = formatTime(backup.clientUpdatedAt || backup.createdAt);
      button.className = "secondary-button";
      button.type = "button";
      button.textContent = copy.restore;
      button.addEventListener("click", function () {
        restoreBackup(backup).catch(handleAsyncError);
      });
      item.append(title, time, button);
      elements.recoveryList.appendChild(item);
    });

    elements.recoveryLog.replaceChildren();
    events.forEach(function (event) {
      var entry = document.createElement("p");
      entry.className = "cat-recovery-event";
      entry.textContent = formatCopy(copy.recoveryEvent, {
        source: event.sourceRevision,
        restored: event.restoredRevision
      }) + " · " + formatTime(event.createdAt);
      elements.recoveryLog.appendChild(entry);
    });
    elements.recoveryLogTitle.textContent = copy.recoveryLog;
    elements.recoveryLogSection.hidden = events.length === 0;
  }

  async function loadRecoveryHistory() {
    var copy = getCopy();
    elements.recoveryStatus.textContent = copy.recoveryLoading;
    var result = await requestJson(apiPath + "/recovery");
    renderRecoveryHistory(result);
    elements.recoveryStatus.textContent = "";
  }

  async function showRecoveryDialog() {
    if (!authenticated || !elements.recoveryDialog) return;
    var copy = getCopy();
    elements.recoveryTitle.textContent = copy.recoveryTitle;
    elements.recoveryCopy.textContent = copy.recoveryCopy;
    elements.recoveryClose.textContent = copy.close;
    if (typeof elements.recoveryDialog.showModal === "function") {
      if (!elements.recoveryDialog.open) elements.recoveryDialog.showModal();
    } else {
      elements.recoveryDialog.setAttribute("open", "");
    }
    try {
      await loadRecoveryHistory();
    } catch (error) {
      elements.recoveryStatus.textContent = copy.failed;
    }
  }

  async function restoreBackup(backup) {
    var copy = getCopy();
    if (!cloudSave || !window.confirm(copy.restoreConfirm)) return;
    elements.recoveryStatus.textContent = copy.recovering;
    try {
      var result = await requestJson(apiPath + "/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseRevision: Number(cloudSave.revision || 0),
          sourceRevision: Number(backup.revision || 0)
        })
      });
      await applyRemoteSave(result.save);
      setStatus(copy.recovered);
      elements.recoveryStatus.textContent = copy.recovered;
      await loadRecoveryHistory();
    } catch (error) {
      if (error.status === 409 && error.data && error.data.save) {
        cloudSave = error.data.save;
        closeRecoveryDialog();
        enterConflict(latestLocalSave, cloudSave);
        return;
      }
      elements.recoveryStatus.textContent = copy.failed;
    }
  }

  function closeConflictDialog() {
    if (!elements.dialog) return;
    if (typeof elements.dialog.close === "function") {
      elements.dialog.close();
    } else {
      elements.dialog.removeAttribute("open");
    }
  }

  function showConflictDialog() {
    if (!conflict || !elements.dialog) return;
    var copy = getCopy();
    elements.dialogTitle.textContent = copy.title;
    elements.dialogCopy.textContent = copy.conflictCopy;
    elements.localLabel.textContent = copy.localLabel;
    elements.remoteLabel.textContent = copy.remoteLabel;
    elements.useLocal.textContent = copy.useLocal;
    elements.useRemote.textContent = copy.useRemote;
    elements.later.textContent = copy.later;
    elements.localTime.textContent = formatTime(conflict.local && conflict.local.meta && conflict.local.meta.lastSavedAt);
    elements.remoteTime.textContent = formatTime(conflict.remote && conflict.remote.clientUpdatedAt);
    elements.dialogStatus.textContent = "";
    if (typeof elements.dialog.showModal === "function") {
      if (!elements.dialog.open) elements.dialog.showModal();
    } else {
      elements.dialog.setAttribute("open", "");
    }
  }

  function enterConflict(localSave, remoteSave) {
    conflict = { local: localSave, remote: remoteSave };
    setStatus(getCopy().conflict);
    renderMember();
    showConflictDialog();
  }

  async function requestJson(path, options) {
    var response = await fetch(path, options);
    var data = await response.json();
    if (!response.ok || !data.ok) {
      var error = new Error(data.message || "Request failed");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function uploadSave(saveData, baseRevision) {
    var normalized = normalizeSave(saveData);
    if (!normalized || !authenticated || conflict) return false;
    if (syncInFlight) {
      pendingAfterSync = true;
      return false;
    }

    syncInFlight = true;
    setStatus(getCopy().syncing);
    try {
      var saveBytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength;
      if (!saveBytes || saveBytes > maxSaveBytes) {
        setStatus(getCopy().tooLarge);
        return false;
      }
      var localDigest = await digestSave(normalized);
      var result = await requestJson(apiPath, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseRevision: Number(baseRevision || 0),
          clientUpdatedAt: saveData.meta && saveData.meta.lastSavedAt || new Date().toISOString(),
          saveData: normalized
        })
      });
      cloudSave = result.save;
      writeMarker(cloudSave, localDigest);
      setStatus(getCopy().synced);
      return true;
    } catch (error) {
      if (error.status === 409 && error.data && error.data.save) {
        cloudSave = error.data.save;
        enterConflict(latestLocalSave, cloudSave);
      } else if (error.status === 401) {
        authenticated = false;
        account = null;
        publishMemberSession(null);
        renderMember();
      } else {
        setStatus(getCopy().failed);
      }
      return false;
    } finally {
      syncInFlight = false;
      if (pendingAfterSync && !conflict) {
        pendingAfterSync = false;
        scheduleSync();
      }
    }
  }

  function scheduleSync() {
    if (!initialized || !authenticated || conflict || applyingRemote || !latestLocalSave) return;
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(function () {
      syncTimer = null;
      uploadSave(latestLocalSave, cloudSave ? cloudSave.revision : 0);
    }, syncDelayMs);
  }

  function onLocalSave(saveData) {
    latestLocalSave = saveData;
    if (!applyingRemote) scheduleSync();
  }

  async function applyRemoteSave(remoteSave) {
    if (!remoteSave || !remoteSave.data || !window.CatGameApp) return;
    if (account && latestLocalSave) {
      try {
        localStorage.setItem(
          backupKeyPrefix + String(account.id),
          JSON.stringify({ createdAt: new Date().toISOString(), saveData: normalizeSave(latestLocalSave) })
        );
      } catch (error) {
      }
    }
    applyingRemote = true;
    try {
      window.CatGameApp.applyCloudSave(remoteSave.data);
      latestLocalSave = window.CatGame && window.CatGame.state.game;
      cloudSave = remoteSave;
      writeMarker(remoteSave, await digestSave(latestLocalSave));
      conflict = null;
      initialized = true;
      closeConflictDialog();
      setStatus(getCopy().synced);
      renderMember();
    } finally {
      applyingRemote = false;
    }
  }

  async function useLocalSave() {
    if (!conflict) return;
    elements.dialogStatus.textContent = getCopy().syncing;
    var localSave = conflict.local;
    var remoteRevision = conflict.remote ? conflict.remote.revision : 0;
    conflict = null;
    initialized = true;
    var saved = await uploadSave(localSave, remoteRevision);
    if (saved && !conflict) {
      closeConflictDialog();
      renderMember();
    } else if (!conflict) {
      conflict = { local: localSave, remote: cloudSave };
      elements.dialogStatus.textContent = getCopy().failed;
      renderMember();
    }
  }

  async function initialize(localSave) {
    latestLocalSave = localSave;
    renderMember();
    setStatus(getCopy().loading);
    try {
      var session = await requestJson("/api/readers/session");
      authenticated = Boolean(session.authenticated);
      account = session.account || null;
      if (!authenticated) {
        publishMemberSession(null);
        initialized = true;
        renderMember();
        return;
      }

      publishMemberSession(account.id);
      renderMember();
      var result = await requestJson(apiPath);
      cloudSave = result.save || null;
      var claimedAccountId = readGuestClaim();
      var activation = null;
      if (window.CatGameApp && typeof window.CatGameApp.activateMemberStorage === "function") {
        activation = window.CatGameApp.activateMemberStorage(account.id, {
          allowGuestImport: !claimedAccountId || claimedAccountId === String(account.id),
          remoteSave: cloudSave
        });
        latestLocalSave = activation && activation.game || latestLocalSave;
        if (activation && activation.source === "guest") claimGuestSave();
        if (activation && activation.source === "remote") {
          initialized = true;
          writeMarker(cloudSave, await digestSave(latestLocalSave));
          setStatus(getCopy().synced);
          return;
        }
      }
      initialized = true;
      var localDigest = await digestSave(latestLocalSave);
      var marker = readMarker();
      var action = window.CatGameCloudPolicy
        ? window.CatGameCloudPolicy.resolveInitialAction(localDigest, cloudSave, marker)
        : cloudSave ? "conflict" : "upload";
      if (action === "synced") {
        writeMarker(cloudSave, localDigest);
        setStatus(getCopy().synced);
        return;
      }
      if (action === "remote") {
        await applyRemoteSave(cloudSave);
        return;
      }
      if (action === "upload") {
        await uploadSave(latestLocalSave, cloudSave ? cloudSave.revision : 0);
        return;
      }

      enterConflict(latestLocalSave, cloudSave);
    } catch (error) {
      initialized = true;
      if (error.status === 401) {
        authenticated = false;
        account = null;
        publishMemberSession(null);
        renderMember();
      } else {
        setStatus(getCopy().offline);
      }
    }
  }

  function handleAsyncError() {
    setStatus(getCopy().failed);
    if (elements.dialogStatus) elements.dialogStatus.textContent = getCopy().failed;
  }

  if (elements.action) elements.action.addEventListener("click", showConflictDialog);
  if (elements.recoveryAction) elements.recoveryAction.addEventListener("click", function () {
    showRecoveryDialog().catch(handleAsyncError);
  });
  if (elements.recoveryClose) elements.recoveryClose.addEventListener("click", closeRecoveryDialog);
  if (elements.useLocal) elements.useLocal.addEventListener("click", function () {
    useLocalSave().catch(handleAsyncError);
  });
  if (elements.useRemote) elements.useRemote.addEventListener("click", function () {
    if (conflict) applyRemoteSave(conflict.remote).catch(handleAsyncError);
  });
  if (elements.later) elements.later.addEventListener("click", closeConflictDialog);
  window.addEventListener("catgame:site-locale", function () {
    renderMember();
    if (conflict && elements.dialog && elements.dialog.open) showConflictDialog();
    if (elements.recoveryDialog && elements.recoveryDialog.open) {
      showRecoveryDialog().catch(handleAsyncError);
    }
  });

  window.CatGameCloud = {
    init: initialize,
    onLocalSave: onLocalSave,
    isApplyingRemote: function () { return applyingRemote; }
  };
})();
