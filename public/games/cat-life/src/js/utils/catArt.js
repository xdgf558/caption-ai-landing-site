(function (game) {
  var spriteFiles = {
    orange_tabby: "orange-tabby.png",
    cow_cat: "cow-cat.png",
    blue_cat: "blue-cat.png",
  };
  var walkFiles = {
    orange_tabby: "orange-tabby-walk.png",
    cow_cat: "cow-cat-walk.png",
    blue_cat: "blue-cat-walk.png",
  };
  var poseFiles = {
    angry: "angry.png",
    celebrate: "celebrate.png",
    cry: "cry.png",
    fish: "fish.png",
    happy: "happy.png",
    heart: "heart.png",
    joy: "joy.png",
    nap: "nap.png",
    pounce: "pounce.png",
    question: "question.png",
    shy: "shy.png",
    sleep: "sleep.png",
    surprised: "surprised.png",
    wave: "wave.png",
  };

  function escapeSvg(text) {
    return encodeURIComponent(String(text || ""))
      .replace(/'/g, "%27")
      .replace(/"/g, "%22");
  }

  function getPatternMarkup(traits) {
    var pattern = traits.pattern || "tabby";
    var color = traits.patchColor || "#fff3cf";

    if (pattern === "mask") {
      return '<ellipse cx="72" cy="66" rx="24" ry="16" fill="' + color + '" />' +
        '<ellipse cx="48" cy="54" rx="10" ry="12" fill="' + color + '" />' +
        '<ellipse cx="96" cy="54" rx="10" ry="12" fill="' + color + '" />';
    }
    if (pattern === "fluffy") {
      return '<circle cx="48" cy="82" r="12" fill="' + color + '" />' +
        '<circle cx="100" cy="84" r="12" fill="' + color + '" />' +
        '<ellipse cx="76" cy="58" rx="20" ry="10" fill="' + color + '" />';
    }
    return '<path d="M48 36c10 6 14 14 14 20 0 8-6 14-14 14" stroke="' + color + '" stroke-width="6" stroke-linecap="round" fill="none" />' +
      '<path d="M104 36c-10 6-14 14-14 20 0 8 6 14 14 14" stroke="' + color + '" stroke-width="6" stroke-linecap="round" fill="none" />' +
      '<path d="M76 28v56" stroke="' + color + '" stroke-width="7" stroke-linecap="round" />';
  }

  function getAccessoryMarkup(traits) {
    var accessory = traits.accessory || "bell";
    if (accessory === "flower") {
      return '<circle cx="34" cy="42" r="6" fill="#ffd56a" />' +
        '<circle cx="27" cy="42" r="4" fill="#ff8fa8" />' +
        '<circle cx="41" cy="42" r="4" fill="#ff8fa8" />' +
        '<circle cx="34" cy="35" r="4" fill="#ff8fa8" />' +
        '<circle cx="34" cy="49" r="4" fill="#ff8fa8" />';
    }
    if (accessory === "scarf") {
      return '<path d="M44 88c10 8 24 12 38 12 16 0 28-4 40-12" fill="none" stroke="#ff7b64" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M54 92c2 12-4 20-10 28" fill="none" stroke="#ff7b64" stroke-width="6" stroke-linecap="round"/>';
    }
    return '<path d="M44 88c8 6 20 10 32 10 12 0 24-4 34-10" fill="none" stroke="#4da0ff" stroke-width="6" stroke-linecap="round"/>' +
      '<circle cx="76" cy="98" r="6" fill="#ffd45f" stroke="#d28a1f" stroke-width="2"/>';
  }

  function inferArtKeyFromTraits(traits) {
    var fur = traits && traits.furColor ? String(traits.furColor).toLowerCase() : "";
    var patch = traits && traits.patchColor ? String(traits.patchColor).toLowerCase() : "";

    if (traits && traits.artKey && spriteFiles[traits.artKey]) {
      return traits.artKey;
    }
    if (fur === "#2c3647" || patch === "#f8f8f8") {
      return "cow_cat";
    }
    if (fur === "#8a8fc2" || fur === "#86a4c4" || fur === "#6f8398" || fur === "#f4f2f7") {
      return "blue_cat";
    }
    return "orange_tabby";
  }

  function getCatSpriteUrl(cat) {
    var memberSprite = window.CatGameCommerce && typeof window.CatGameCommerce.getCatSprite === "function"
      ? window.CatGameCommerce.getCatSprite(cat)
      : "";
    if (memberSprite) {
      return memberSprite;
    }
    var artKey = inferArtKeyFromTraits((cat && cat.traits) || {});
    var fileName = spriteFiles[artKey];

    if (!fileName) {
      return null;
    }

    return new URL("src/assets/cats/" + fileName, document.baseURI).href;
  }

  function getCatWalkUrl(cat) {
    var memberSprite = window.CatGameCommerce && typeof window.CatGameCommerce.getCatWalkSprite === "function"
      ? window.CatGameCommerce.getCatWalkSprite(cat)
      : "";
    if (memberSprite) {
      return memberSprite;
    }
    var artKey = inferArtKeyFromTraits((cat && cat.traits) || {});
    var fileName = walkFiles[artKey] || walkFiles.orange_tabby;
    return new URL("src/assets/cats/" + fileName, document.baseURI).href;
  }

  function getCatPose(cat) {
    if (cat.careStatus === "sheltered") return "nap";
    var activeReaction = getCatReaction(cat);
    var disease = game.systems.catSystem && game.systems.catSystem.getCatDisease(cat);

    if (activeReaction) {
      return activeReaction;
    }
    if (disease) {
      return "cry";
    }
    if (cat.hunger <= 30) {
      return "question";
    }
    if (cat.clean <= 30) {
      return "shy";
    }
    if (cat.energy <= 35) {
      return "nap";
    }
    if (cat.mood >= 85) {
      return "celebrate";
    }
    if (cat.mood <= 35) {
      return "angry";
    }
    return "happy";
  }

  function getCatReaction(cat) {
    var reaction = game.state.catReaction;

    if (reaction && cat && reaction.catId === cat.id && reaction.expiresAt > Date.now() && poseFiles[reaction.pose]) {
      return reaction.pose;
    }
    return "";
  }

  function getCatReactionCue(cat) {
    var cues = {
      fish: "🐟",
      surprised: "✦",
      pounce: "✦",
      nap: "Zz",
      joy: "♪",
      heart: "♥",
    };
    return cues[getCatReaction(cat)] || "";
  }

  function getCatStageUrl(cat) {
    var memberSprite = window.CatGameCommerce && typeof window.CatGameCommerce.getCatSprite === "function"
      ? window.CatGameCommerce.getCatSprite(cat)
      : "";
    var artKey = inferArtKeyFromTraits((cat && cat.traits) || {});
    var pose = getCatPose(cat);

    if (memberSprite) {
      return memberSprite;
    }
    if (artKey !== "orange_tabby" || !poseFiles[pose]) {
      return getCatSpriteUrl(cat);
    }
    return new URL("src/assets/poses/" + poseFiles[pose], document.baseURI).href;
  }

  function buildCatSvg(cat, size) {
    var traits = (cat && cat.traits) || {};
    var fur = traits.furColor || "#f3a64a";
    var eyes = traits.eyeColor || "#4b9ed2";
    var spriteUrl = getCatSpriteUrl(cat);
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 152 152">' +
      '<rect width="152" height="152" rx="28" fill="#f7fbff"/>' +
      '<ellipse cx="76" cy="106" rx="44" ry="20" fill="rgba(36,68,114,0.08)"/>' +
      '<path d="M46 36L32 16l26 8z" fill="' + fur + '"/>' +
      '<path d="M106 36l14-20-26 8z" fill="' + fur + '"/>' +
      '<circle cx="76" cy="64" r="38" fill="' + fur + '"/>' +
      getPatternMarkup(traits) +
      '<circle cx="60" cy="62" r="6" fill="' + eyes + '"/>' +
      '<circle cx="92" cy="62" r="6" fill="' + eyes + '"/>' +
      '<circle cx="60" cy="62" r="2" fill="#fff"/>' +
      '<circle cx="92" cy="62" r="2" fill="#fff"/>' +
      '<path d="M71 74l5 5 5-5" fill="#ff9a9a"/>' +
      '<path d="M66 86c8 6 14 8 20 0" fill="none" stroke="#6e5d58" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M44 74H24" stroke="#7d8ca5" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M108 74h20" stroke="#7d8ca5" stroke-width="3" stroke-linecap="round"/>' +
      getAccessoryMarkup(traits) +
      "</svg>";

    return spriteUrl || ("data:image/svg+xml;charset=utf-8," + escapeSvg(svg));
  }

  game.utils.catArt = {
    buildCatSvg: buildCatSvg,
    inferArtKeyFromTraits: inferArtKeyFromTraits,
    getCatSpriteUrl: getCatSpriteUrl,
    getCatWalkUrl: getCatWalkUrl,
    getCatStageUrl: getCatStageUrl,
    getCatPose: getCatPose,
    getCatReaction: getCatReaction,
    getCatReactionCue: getCatReactionCue,
  };
})(window.CatGame);
