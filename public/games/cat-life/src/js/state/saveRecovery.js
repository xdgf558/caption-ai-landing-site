(function (window) {
  "use strict";
  var copy = {
    "zh-Hant": { title: "先保留你的遊戲進度", checking: "正在核對帳號與這個瀏覽器的存檔…", corrupt: "存檔內容無法辨識。原始資料仍保留，遊戲已暫停寫入。", unsupported: "存檔來自不支援的版本。請使用相容版本，或先匯出原始檔案。", unavailable: "目前無法讀取或寫入存儲。請檢查瀏覽器設定，再重新核對。", changed: "存檔已在另一個分頁變更。請重新核對，避免覆蓋另一份進度。", identity: "暫時無法核對登入狀態。請恢復連線後重試。", export: "匯出原始存檔", retry: "重新核對", import: "選擇相容存檔並恢復", confirm: "恢復前會先保留原始存檔副本。確定使用所選檔案？", error: "操作未完成，請檢查檔案與存儲空間。原始副本會保留。", back: "返回網站", note: "只在你明確選擇恢復後才替換本機存檔。這裡不修改雲端存檔。" },
    "zh-CN": { title: "先保留你的游戏进度", checking: "正在核对账号与这个浏览器的存档…", corrupt: "存档内容无法识别。原始数据仍保留，游戏已暂停写入。", unsupported: "存档来自不支持的版本。请使用兼容版本，或先导出原始文件。", unavailable: "目前无法读取或写入存储。请检查浏览器设置，再重新核对。", changed: "存档已在另一个标签页变更。请重新核对，避免覆盖另一份进度。", identity: "暂时无法核对登录状态。请恢复连接后重试。", export: "导出原始存档", retry: "重新核对", import: "选择兼容存档并恢复", confirm: "恢复前会先保留原始存档副本。确定使用所选文件？", error: "操作未完成，请检查文件与存储空间。原始副本会保留。", back: "返回网站", note: "只在你明确选择恢复后才替换本机存档。这里不修改云端存档。" },
    en: { title: "Keep your progress safe", checking: "Checking your account and this browser’s save…", corrupt: "This save could not be recognised. Its original data is retained and game writes are paused.", unsupported: "This save needs a compatible game version. Export the original file before proceeding.", unavailable: "Browser storage cannot be read or written. Check browser settings and retry.", changed: "Another tab changed this save. Check again to avoid overwriting progress.", identity: "Your session could not be checked. Reconnect and retry.", export: "Export original save", retry: "Check again", import: "Choose a compatible save to restore", confirm: "The original save will be backed up first. Restore the selected file?", error: "Could not complete this action. Check the file and storage space. Original backups are retained.", back: "Back to the website", note: "A local save is replaced only after your explicit restore choice. Cloud saves are not changed here." },
    ja: { title: "進行データを保護しています", checking: "アカウントとこのブラウザーのセーブを確認中…", corrupt: "セーブを認識できません。元のデータを保持し、書き込みを停止しました。", unsupported: "対応するゲームバージョンが必要です。先に元のファイルを書き出してください。", unavailable: "保存領域を読み書きできません。ブラウザー設定を確認して再試行してください。", changed: "別のタブでセーブが変更されました。上書きを防ぐため再確認してください。", identity: "ログイン状態を確認できません。接続を確認して再試行してください。", export: "元のセーブを書き出す", retry: "再確認", import: "対応するセーブを選んで復元", confirm: "元のデータを先にバックアップします。選択したファイルで復元しますか？", error: "操作を完了できませんでした。ファイルと空き容量を確認してください。バックアップは保持されます。", back: "サイトへ戻る", note: "明示的に復元を選んだ場合のみ端末のデータを置き換えます。ここではクラウドを変更しません。" }
  };
  function language() { return window.CatGameIntegration && window.CatGameIntegration.siteLocale || "zh-CN"; }
  async function selectSlot() {
    var identity = await window.CatGameSaveStatus.session(window.fetch.bind(window));
    return window.CatGameSaveStatus.select(window.localStorage, identity);
  }
  function show(status, identity) {
    if (document.body) document.body.setAttribute("data-save-blocked", status);
    var text = copy[language()] || copy.en, system = window.CatGame.state.saveSystem;
    var labels = { "zh-Hant": ["已登入", "遊客模式", "帳號待確認", "存檔寫入暫停"], "zh-CN": ["已登录", "游客模式", "账号待确认", "存档写入暂停"], en: ["Signed in", "Guest", "Session unchecked", "Save writes paused"], ja: ["ログイン済み", "ゲスト", "確認待ち", "保存を停止中"] }[language()] || ["Signed in", "Guest", "Session unchecked", "Save writes paused"];
    var name = document.querySelector("[data-cat-member-name]"), cloudStatus = document.querySelector("[data-cat-cloud-status]"), login = document.querySelector("[data-cat-member-login]");
    if (name) name.textContent = identity ? labels[identity.member ? 0 : 1] : labels[2];
    if (cloudStatus) cloudStatus.textContent = status === "checking" ? "…" : labels[3];
    if (login) login.hidden = Boolean(identity && identity.member);
    var main = document.getElementById("app-main");
    ["app-header", "app-navigation", "app-mobile-navigation", "app-toast"].forEach(function (id) { var node = document.getElementById(id); if (node) node.hidden = true; });
    if (!main) return;
    main.replaceChildren();
    var section = document.createElement("section"); section.className = "save-safety"; section.setAttribute("data-save-safety", status);
    var title = document.createElement("h1"); title.textContent = text.title; title.tabIndex = -1;
    var message = document.createElement("p"); message.textContent = text[status] || text.unavailable;
    section.append(title, message);
    function button(label, action) { var node = document.createElement("button"); node.type = "button"; node.textContent = label; node.className = "secondary-button"; node.addEventListener("click", action); section.append(node); return node; }
    var feedback = document.createElement("p"); feedback.setAttribute("role", "status");
    if (status !== "checking") {
      var slot = system.inspect();
      if (identity && typeof slot.raw === "string") button(text.export, function () { system.downloadRaw(system.inspect().raw, "cat-original-save-"); });
      button(text.retry, function () { window.location.reload(); });
      if (identity && slot.status !== "unavailable") {
        var label = document.createElement("label"); label.className = "save-safety-file"; label.textContent = text.import;
        var input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json";
        label.append(input); section.append(label);
        input.addEventListener("change", async function () {
          try {
            var file = input.files && input.files[0]; if (!file || file.size > 32 * 1024 * 1024) throw new Error("INVALID_FILE");
            var raw = await file.text();
            var current = await selectSlot();
            if (current.key !== identity.key || current.accountKey !== (identity.accountKey || identity.key) || current.member !== identity.member || system.getStorageKey() !== identity.key) throw new Error("SESSION_CHANGED");
            if (!window.confirm(text.confirm)) return;
            system.importText(raw); window.location.reload();
          } catch (error) { feedback.textContent = text.error; }
        });
      }
      var note = document.createElement("p"); note.textContent = text.note; section.append(note);
      var back = document.createElement("a"); back.href = { "zh-Hant": "/", "zh-CN": "/zh-hans/", en: "/en/", ja: "/ja/" }[language()] || "/"; back.textContent = text.back; section.append(back);
    }
    section.append(feedback); main.append(section); title.focus();
  }
  window.CatGameSaveRecovery = { selectSlot: selectSlot, show: show };
})(window);
