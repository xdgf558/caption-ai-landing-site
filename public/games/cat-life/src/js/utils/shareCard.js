(function (game) {
  "use strict";
  var WIDTH = 1080;
  var HEIGHT = 1440;
  var assetRoot = new URL("./src/assets/share/", document.baseURI).href;
  var ink = "#432d18";
  var serif = 'Georgia, "Songti SC", "Noto Serif CJK SC", serif';
  var sans = '"PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif';
  var qrLoading = null;

  // Only public release configuration enters the card. Never pass game/save,
  // account, player name, location.href or returnTo into the export payload.
  function getModel() {
    var language = game.utils.i18n.getLanguage();
    var requested = new URL(document.baseURI).searchParams.get("lang");
    var locale = requested === "zh-Hant" && language === "zh-CN" ? "zh-Hant" : language;
    if (["zh-Hant", "zh-CN", "en", "ja"].indexOf(locale) === -1) locale = "zh-CN";
    var url = new URL("https://wwwstationcat.org/games/cat-life/");
    url.searchParams.set("lang", locale);
    var notes = game.config.releaseNotes[language] || game.config.releaseNotes["zh-CN"] || [];
    var t = game.utils.i18n.t;
    return {
      language: language, version: String(game.config.version), url: url.href,
      title: t("share_game_title"), tagline: t("share_tagline"), latest: t("share_latest"),
      headline: t("share_headline"), brand: t("share_brand"), scan: t("share_scan"),
      free: t("share_free"), preview: t("share_preview_alt"),
      notes: notes.filter(function (note) { return typeof note === "string"; })
    };
  }

  function getShareText(model) {
    return model.title + " · v" + model.version + "\n" + model.tagline + "\n" +
      model.notes.join("\n") + "\nStation Cat｜" + model.brand + "\n" + model.url;
  }

  function xIntent(model) {
    var url = new URL("https://twitter.com/intent/tweet");
    // Keep the draft short enough for X. The PNG is saved/attached by the user;
    // a web intent does not upload it automatically.
    url.searchParams.set("text", model.title + " · v" + model.version + "\n" + model.tagline + "\nStation Cat｜" + model.brand);
    url.searchParams.set("url", model.url);
    return url.href;
  }

  function segments(value) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), function (part) { return part.segment; });
    }
    return Array.from(value);
  }

  function wrapText(ctx, text, width, limit) {
    var chars = segments(String(text).replace(/\s+/g, " ").trim());
    var lines = [], line = "", index = 0;
    while (index < chars.length) {
      var next = line + chars[index];
      if (line && ctx.measureText(next).width > width) {
        var space = line.lastIndexOf(" ");
        if (space > line.length * 0.4) {
          index -= segments(line.slice(space + 1)).length;
          line = line.slice(0, space);
        }
        lines.push(line.trim()); line = "";
        if (lines.length === limit) break;
      } else { line = next; index += 1; }
    }
    if (line && lines.length < limit) lines.push(line.trim());
    if (index < chars.length && lines.length) {
      var last = segments(lines[lines.length - 1]);
      while (last.length && ctx.measureText(last.join("") + "…").width > width) last.pop();
      lines[lines.length - 1] = last.join("") + "…";
    }
    return lines;
  }

  function bounded(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("share-timeout")); }, ms);
      promise.then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      var timer = setTimeout(function () { finish(new Error("share-image-timeout")); }, 10000);
      function finish(error) {
        clearTimeout(timer); image.onload = null; image.onerror = null;
        if (error) { image.src = ""; reject(error); } else resolve(image);
      }
      image.onload = function () { finish(image.naturalWidth ? null : new Error("share-empty-image")); };
      image.onerror = function () { finish(new Error("share-image-failed")); };
      image.src = url;
    });
  }

  function loadQR() {
    if (window.qrcode) return Promise.resolve();
    if (qrLoading) return qrLoading;
    qrLoading = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      var timer = setTimeout(function () { finish(new Error("share-qr-timeout")); }, 10000);
      function finish(error) {
        clearTimeout(timer); script.onload = null; script.onerror = null; script.remove();
        qrLoading = null;
        if (error) reject(error); else resolve();
      }
      script.src = new URL("./src/js/vendor/qrcode.js", document.baseURI).href;
      script.onload = function () { finish(window.qrcode ? null : new Error("share-qr-missing")); };
      script.onerror = function () { finish(new Error("share-qr-failed")); };
      document.head.appendChild(script);
    });
    return qrLoading;
  }

  function loadTitleFont() {
    if (!window.FontFace || !document.fonts) return Promise.reject(new Error("share-font-unsupported"));
    if (document.fonts.check('900 20px "Station Letter Title"', "打工养猫日记")) {
      // fonts.check also returns true for a nonexistent face; check membership.
      var found = false;
      document.fonts.forEach(function (font) { if (font.family === "Station Letter Title" && font.status === "loaded") found = true; });
      if (found) return Promise.resolve();
    }
    var face = new FontFace("Station Letter Title", 'url("' + assetRoot + 'letter-title.ttf")', { weight: "900" });
    return bounded(face.load(), 10000).then(function (loaded) { document.fonts.add(loaded); });
  }

  function drawFitted(ctx, text, x, y, width, size, family, weight, minSize) {
    do { ctx.font = (weight || "400") + " " + size + "px " + family; size -= 1; }
    while (size >= (minSize || 18) && ctx.measureText(text).width > width);
    ctx.fillText(wrapText(ctx, text, width, 1)[0] || "", x, y);
  }

  function drawQR(ctx, value, x, y, size) {
    var qr = window.qrcode(0, "M");
    qr.addData(value, "Byte"); qr.make();
    var count = qr.getModuleCount();
    var cell = Math.floor(size / (count + 8));
    var offsetX = x + Math.floor((size - (count + 8) * cell) / 2);
    var offsetY = y + Math.floor((size - (count + 8) * cell) / 2);
    ctx.fillStyle = "#fff"; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "#000";
    // Integer modules and an uninterrupted four-module quiet zone. No logo
    // overlay, rounding or decorative marks inside this real QR code.
    for (var row = 0; row < count; row += 1) for (var col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) ctx.fillRect(offsetX + (col + 4) * cell, offsetY + (row + 4) * cell, cell, cell);
    }
  }

  function paint(model, background, logo) {
    var canvas = document.createElement("canvas"); canvas.width = WIDTH; canvas.height = HEIGHT;
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("share-canvas-unsupported");
    ctx.drawImage(background, 0, 0, WIDTH, HEIGHT);
    ctx.drawImage(logo, 72, 38, 64, 64);
    ctx.fillStyle = ink;
    drawFitted(ctx, "Station Cat", 153, 83, 193, 35, serif, "700");
    ctx.textAlign = "center";
    drawFitted(ctx, model.title, 540, 244, 952, 138, '"Station Letter Title", ' + serif, "900", 55);
    drawFitted(ctx, model.tagline, 540, 331, 480, 42, serif, "600", 24);
    ctx.textAlign = "left";
    ctx.strokeStyle = "#946938"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(60, 1012); ctx.lineTo(668, 1012); ctx.stroke();
    ctx.fillStyle = "#dd7b3d";
    drawFitted(ctx, "v" + model.version, 64, 1056, 240, 32, serif, "700");
    ctx.fillStyle = "#758b4d";
    drawFitted(ctx, model.latest, 285, 1056, 375, 30, sans, "700");
    ctx.fillStyle = ink;
    drawFitted(ctx, model.headline, 64, 1101, 602, 36, serif, "700", 24);
    ctx.font = (model.language === "zh-CN" ? "27px " : "23px ") + sans;
    var y = 1135;
    model.notes.slice(0, 3).forEach(function (note) {
      var lines = wrapText(ctx, note, 596, 2);
      lines.forEach(function (line) { ctx.fillText(line, 64, y); y += 27; });
      y += 4;
    });
    ctx.strokeStyle = "#df8c58"; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(60, 1290); ctx.lineTo(656, 1290); ctx.stroke(); ctx.setLineDash([]);
    ctx.drawImage(logo, 65, 1305, 64, 64);
    ctx.fillStyle = ink; drawFitted(ctx, "Station Cat", 149, 1337, 505, 43, serif, "700");
    drawFitted(ctx, model.brand, 149, 1370, 516, 23, sans, "400", 17);
    drawFitted(ctx, model.free, 65, 1411, 310, 24, sans, "400");
    drawFitted(ctx, "wwwstationcat.org", 401, 1411, 276, 26, serif, "700");
    ctx.beginPath(); ctx.roundRect(714, 1017, 312, 405, 25); ctx.fillStyle = "#fffdf8"; ctx.fill();
    ctx.strokeStyle = "#8b9e59"; ctx.lineWidth = 2.5; ctx.stroke();
    drawQR(ctx, model.url, 722, 1025, 296);
    ctx.fillStyle = ink; ctx.textAlign = "center";
    drawFitted(ctx, model.scan, 870, 1360, 272, 32, serif, "700", 20);
    drawFitted(ctx, "STATION CAT", 870, 1398, 260, 17, serif, "400");
    return canvas;
  }

  function create(model) {
    return Promise.all([
      loadImage(assetRoot + "station-letter.webp"),
      loadImage(new URL("/images/optimized/station-cat-logo-1668c2e5-320.webp", document.baseURI).href),
      loadQR(), loadTitleFont()
    ]).then(function (assets) {
      var canvas = paint(model, assets[0], assets[1]);
      return bounded(new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error("share-export-failed")); }, "image/png");
      }), 10000);
    });
  }

  game.utils.shareCard = { getModel: getModel, getShareText: getShareText, xIntent: xIntent, wrapText: wrapText, create: create };
})(window.CatGame);
