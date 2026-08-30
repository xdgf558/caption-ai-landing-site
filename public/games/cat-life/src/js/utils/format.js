(function (game) {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function formatRealDateTime(dateValue) {
    var date = dateValue ? new Date(dateValue) : new Date();
    return (
      date.getFullYear() +
      "-" +
      pad(date.getMonth() + 1) +
      "-" +
      pad(date.getDate()) +
      " " +
      pad(date.getHours()) +
      ":" +
      pad(date.getMinutes()) +
      ":" +
      pad(date.getSeconds())
    );
  }

  function formatGameTime() {
    return formatRealDateTime(new Date());
  }

  function formatDateKey(dateValue) {
    var date = dateValue ? new Date(dateValue) : new Date();
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function formatDuration(ms) {
    var totalSeconds = Math.max(0, Math.ceil((ms || 0) / 1000));
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var parts = [];
    var language = window.CatGame && window.CatGame.utils && window.CatGame.utils.i18n
      ? window.CatGame.utils.i18n.getLanguage()
      : "zh-CN";
    var labels = language === "en"
      ? { hour: "h", minute: "m", second: "s" }
      : language === "ja"
      ? { hour: "時間", minute: "分", second: "秒" }
      : { hour: "小时", minute: "分", second: "秒" };

    if (hours > 0) {
      parts.push(hours + labels.hour);
    }
    if (minutes > 0 || hours > 0) {
      parts.push(minutes + labels.minute);
    }
    parts.push(seconds + labels.second);
    return parts.join(" ");
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("zh-CN");
  }

  function formatAgeYears(value) {
    var amount = Math.max(0, Number(value || 0));
    var language = window.CatGame && window.CatGame.utils && window.CatGame.utils.i18n
      ? window.CatGame.utils.i18n.getLanguage()
      : "zh-CN";
    return amount.toFixed(2) + (language === "en" ? " y" : language === "ja" ? " 歳" : " 岁");
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getBarTone(value) {
    if (value <= 25) {
      return "is-danger";
    }
    if (value <= 55) {
      return "is-alert";
    }
    return "is-good";
  }

  function toPercent(current, total) {
    if (!total || total <= 0) {
      return 0;
    }
    return clamp(Math.round((current / total) * 100), 0, 100);
  }

  game.utils.format = {
    clamp: clamp,
    formatGameTime: formatGameTime,
    formatRealDateTime: formatRealDateTime,
    formatDateKey: formatDateKey,
    formatDuration: formatDuration,
    formatNumber: formatNumber,
    formatAgeYears: formatAgeYears,
    escapeHtml: escapeHtml,
    getBarTone: getBarTone,
    toPercent: toPercent,
  };
})(window.CatGame);
