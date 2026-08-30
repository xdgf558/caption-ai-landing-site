(function () {
  var params = new URLSearchParams(window.location.search);
  var requestedLanguage = params.get("lang");
  var supportedLanguages = ["zh-Hant", "zh-CN", "en", "ja"];
  var locale = supportedLanguages.indexOf(requestedLanguage) >= 0 ? requestedLanguage : "";
  var siteLocale = locale || "zh-Hant";
  var gameLanguage = siteLocale === "zh-Hant" ? "zh-CN" : siteLocale;
  var copyByLocale = {
    "zh-Hant": {
      gameInfo: "遊戲介紹",
      apps: "Apps",
      member: "會員中心",
      languageNote: "遊戲介面目前為簡中",
      homeLabel: "Station Cat 首頁",
      paths: { home: "/", gameInfo: "/zh-hant/apps/cat-life-game/", apps: "/zh-hant/apps/", member: "/zh-hant/library/" }
    },
    "zh-CN": {
      gameInfo: "游戏介绍",
      apps: "Apps",
      member: "会员中心",
      languageNote: "",
      homeLabel: "Station Cat 首页",
      paths: { home: "/zh-hans/", gameInfo: "/zh-hans/apps/cat-life-game/", apps: "/zh-hans/apps/", member: "/zh-hans/library/" }
    },
    en: {
      gameInfo: "Game info",
      apps: "Apps",
      member: "Member center",
      languageNote: "",
      homeLabel: "Station Cat home",
      paths: { home: "/en/", gameInfo: "/en/apps/cat-life-game/", apps: "/en/apps/", member: "/en/library/" }
    },
    ja: {
      gameInfo: "ゲーム紹介",
      apps: "Apps",
      member: "会員センター",
      languageNote: "",
      homeLabel: "Station Cat ホーム",
      paths: { home: "/ja/", gameInfo: "/ja/apps/cat-life-game/", apps: "/ja/apps/", member: "/ja/library/" }
    }
  };

  var select = document.querySelector("[data-station-language]");
  var languageNote = document.querySelector("[data-station-language-note]");
  function renderLocale(nextLocale) {
    var copy = copyByLocale[nextLocale] || copyByLocale["zh-Hant"];
    siteLocale = nextLocale;
    if (window.CatGameIntegration) {
      window.CatGameIntegration.siteLocale = siteLocale;
    }
    document.documentElement.lang = siteLocale === "zh-CN" ? "zh-Hans" : siteLocale;
    document.querySelectorAll("[data-station-link]").forEach(function (link) {
      var key = link.getAttribute("data-station-link");
      if (!key || !copy.paths[key]) return;
      link.href = copy.paths[key];
      if (key === "home") {
        link.setAttribute("aria-label", copy.homeLabel);
      } else {
        link.textContent = copy[key];
      }
    });
    if (select) {
      select.value = siteLocale;
    }
    if (languageNote) {
      languageNote.textContent = copy.languageNote;
      languageNote.hidden = !copy.languageNote;
    }
    if (typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") {
      window.dispatchEvent(new window.CustomEvent("catgame:site-locale", { detail: { locale: siteLocale } }));
    }
  }

  renderLocale(siteLocale);
  if (select) {
    select.addEventListener("change", function () {
      var nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("lang", select.value);
      window.location.href = nextUrl.toString();
    });
  }

  window.CatGameIntegration = {
    sessionLanguage: locale ? gameLanguage : "",
    siteLocale: siteLocale,
    applySavedLanguage: function (language) {
      if (!locale && ["zh-CN", "en", "ja"].indexOf(language) >= 0) {
        renderLocale(language);
      }
    },
    useSavedLanguage: function (language) {
      locale = "";
      this.sessionLanguage = "";
      var nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("lang");
      window.history.replaceState(null, "", nextUrl.toString());
      if (["zh-CN", "en", "ja"].indexOf(language) >= 0) {
        renderLocale(language);
      }
    }
  };
})();
