(function (game) {
  "use strict";
  var dialog = null, epoch = 0, objectURL = "", file = null, model = null;
  var openerId = "", busy = false;
  var t = game.utils.i18n.t;
  var safe = game.utils.format.escapeHtml;
  var card = game.utils.shareCard;

  function releaseImage() {
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = ""; file = null;
  }

  function status(key, error) {
    var node = dialog.querySelector("[data-share-status]");
    node.textContent = t(key); node.classList.toggle("is-error", Boolean(error));
  }

  function close() {
    epoch += 1; busy = false; releaseImage();
    if (!dialog) return;
    var old = dialog; dialog = null; old.remove(); model = null;
    // The originating version button may have been replaced by a timer render.
    var opener = document.getElementById(openerId);
    if (opener && !opener.disabled && opener.getClientRects().length) opener.focus({ preventScroll: true });
  }

  function canShareFile(value) {
    try { return Boolean(value && navigator.share && navigator.canShare && navigator.canShare({ files: [value] })); }
    catch (_) { return false; }
  }

  function previewData(blob) {
    // Production permits img-src data: but not blob:. Keep the site's CSP
    // intact; the separate object URL is used only for the PNG download.
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      var timer = setTimeout(function () { reader.abort(); reject(new Error("share-preview-timeout")); }, 10000);
      reader.onload = function () { clearTimeout(timer); resolve(reader.result); };
      reader.onerror = function () { clearTimeout(timer); reject(new Error("share-preview-failed")); };
      reader.readAsDataURL(blob);
    });
  }

  function generate() {
    var generation = ++epoch;
    var target = dialog;
    releaseImage();
    var preview = target.querySelector("[data-share-image]");
    preview.hidden = true; preview.removeAttribute("src");
    target.querySelector("[data-share-placeholder]").hidden = false;
    target.querySelector("[data-share-save]").disabled = true;
    target.querySelector("[data-share-native]").hidden = true;
    target.querySelector("[data-share-retry]").hidden = true;
    target.querySelector("[data-share-placeholder]").textContent = t("share_loading");
    target.querySelector(".game-share-preview").setAttribute("aria-busy", "true");
    status("share_loading");
    card.create(model).then(function (blob) {
      if (generation !== epoch || dialog !== target || !target.open) return null;
      return previewData(blob).then(function (src) { return { blob: blob, src: src }; });
    }).then(function (result) {
      if (!result) return;
      if (generation !== epoch || dialog !== target || !target.open) return;
      var blob = result.blob;
      objectURL = URL.createObjectURL(blob);
      var filename = "station-cat-v" + model.version.replace(/[^0-9A-Za-z.-]/g, "") + "-" + model.language + ".png";
      if (typeof File === "function") file = new File([blob], filename, { type: "image/png" });
      target.dataset.filename = filename;
      preview.src = result.src; preview.hidden = false;
      target.querySelector("[data-share-placeholder]").hidden = true;
      target.querySelector("[data-share-save]").disabled = false;
      target.querySelector("[data-share-native]").hidden = !canShareFile(file);
      status("share_ready");
    }).catch(function () {
      if (generation !== epoch || dialog !== target) return;
      target.querySelector("[data-share-placeholder]").textContent = t("share_failed");
      target.querySelector("[data-share-retry]").hidden = false;
      status("share_failed", true);
    }).finally(function () {
      if (generation === epoch && dialog === target) target.querySelector(".game-share-preview").setAttribute("aria-busy", "false");
    });
  }

  function copy(value) {
    var target = dialog, generation = epoch;
    function fallback() {
      if (dialog !== target || epoch !== generation) return;
      var textarea = target.querySelector("[data-share-copy-value]");
      textarea.value = value; textarea.focus(); textarea.select();
      status("share_copy_manual");
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) { fallback(); return; }
    navigator.clipboard.writeText(value).then(function () {
      if (dialog === target && epoch === generation) status("share_copied");
    }).catch(fallback);
  }

  function click(event) {
    if (event.target.closest("[data-share-close]")) { dialog.close(); return; }
    if (event.target.closest("[data-share-retry]")) { generate(); return; }
    if (event.target.closest("[data-share-copy-text]")) { copy(card.getShareText(model)); return; }
    if (event.target.closest("[data-share-copy-link]")) { copy(model.url); return; }
    if (event.target.closest("[data-share-save]") && objectURL) {
      var anchor = document.createElement("a"); anchor.href = objectURL; anchor.download = dialog.dataset.filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); status("share_saved");
      return;
    }
    if (event.target.closest("[data-share-native]") && canShareFile(file) && !busy) {
      var target = dialog, generation = epoch;
      var button = target.querySelector("[data-share-native]");
      busy = true; button.disabled = true;
      // Invoke synchronously in the user gesture; generation already finished.
      var sharing;
      try { sharing = navigator.share({ files: [file], title: model.title }); }
      catch (error) { sharing = Promise.reject(error); }
      Promise.resolve(sharing).then(function () {
        if (dialog === target && generation === epoch) status("share_sent");
      }).catch(function (error) {
        if (dialog !== target || generation !== epoch) return;
        status(error.name === "AbortError" ? "share_cancelled" : "share_native_failed", error.name !== "AbortError");
      }).finally(function () {
        if (dialog === target && generation === epoch) { busy = false; button.disabled = false; }
      });
    }
  }

  function open(opener) {
    if (dialog) return;
    openerId = opener.id;
    model = card.getModel();
    dialog = document.createElement("dialog");
    dialog.className = "game-share-dialog";
    dialog.setAttribute("aria-labelledby", "game-share-title");
    dialog.innerHTML = '<header class="game-share-heading"><div><p>STATION CAT · LETTERS</p><h2 id="game-share-title">' + safe(t("share_dialog_title")) +
      '</h2></div><button type="button" class="ghost-button game-share-close" data-share-close autofocus>' + safe(t("share_close")) + '</button></header>' +
      '<div class="game-share-body"><figure class="game-share-preview" aria-busy="true"><img data-share-image width="1080" height="1440" alt="' + safe(model.preview) + '" hidden>' +
      '<div class="game-share-placeholder" data-share-placeholder></div><figcaption>' + safe(t("share_dimensions")) + '</figcaption></figure>' +
      '<section class="game-share-controls" aria-labelledby="game-share-copy-title"><p class="section-eyebrow">v' + safe(model.version) + ' · ' + safe(model.latest) + '</p>' +
      '<h3 id="game-share-copy-title">' + safe(t("share_dialog_copy")) + '</h3><p>' + safe(t("share_how")) + '</p>' +
      '<label for="game-share-copy">' + safe(t("share_copy_label")) + '</label><textarea id="game-share-copy" data-share-copy-value readonly spellcheck="false">' + safe(card.getShareText(model)) + '</textarea>' +
      '<div class="game-share-actions"><button type="button" class="primary-button" data-share-save disabled>' + safe(t("share_save")) + '</button>' +
      '<button type="button" class="secondary-button" data-share-copy-text>' + safe(t("share_copy_text")) + '</button><a class="secondary-button" data-share-x href="' + safe(card.xIntent(model)) + '" target="_blank" rel="noopener noreferrer">' + safe(t("share_x")) + '</a>' +
      '<button type="button" class="ghost-button" data-share-copy-link>' + safe(t("share_copy_link")) + '</button><button type="button" class="secondary-button" data-share-native hidden>' + safe(t("share_native")) + '</button>' +
      '<button type="button" class="secondary-button" data-share-retry hidden>' + safe(t("share_retry")) + '</button></div>' +
      '<p class="game-share-status" data-share-status role="status" aria-live="polite" aria-atomic="true"></p><p class="game-share-privacy">' + safe(t("share_privacy")) + '</p></section></div>';
    dialog.addEventListener("click", click);
    dialog.addEventListener("close", close);
    document.body.appendChild(dialog);
    dialog.showModal(); generate();
  }

  game.ui.shareDialog = {
    open: open,
    dismiss: function () { if (dialog) dialog.close(); }
  };
})(window.CatGame);
