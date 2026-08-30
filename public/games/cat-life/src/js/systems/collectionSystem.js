(function (game) {
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  var traitPools = {
    furColor: ["#f3a64a", "#2c3647", "#f4f2f7", "#ccb18b", "#8a8fc2", "#f7c3b2"],
    patchColor: ["#fff0be", "#f8f8f8", "#d3d8e5", "#f4d8a3", "#ffffff", "#ffe9f0"],
    pattern: ["tabby", "mask", "fluffy"],
    eyeColor: ["#3f9a4d", "#ffcc52", "#5aa6d8", "#7d64d8"],
    accessory: ["bell", "scarf", "flower"],
    artKey: ["orange_tabby", "cow_cat", "blue_cat"],
  };
  var pregnancyDurationMs = game.config.pregnancyDurationMs;

  function getUnlockedCats() {
    return game.state.game.cats.filter(function (cat) {
      return cat.unlocked;
    });
  }

  function getBreedableCats() {
    return getUnlockedCats().filter(function (cat) {
      return (
        cat.isAlive !== false &&
        game.systems.catSystem.getCatAgeYears(cat) >= 1 &&
        !(cat.gender === "female" && cat.isPregnant)
      );
    });
  }

  function getPregnantCats() {
    return getUnlockedCats().filter(function (cat) {
      return cat.isAlive !== false && cat.gender === "female" && cat.isPregnant;
    });
  }

  function mixTrait(key, parentA, parentB) {
    var pool = traitPools[key];
    var sourceTraits = [parentA.traits && parentA.traits[key], parentB.traits && parentB.traits[key]].filter(Boolean);
    if (sourceTraits.length && Math.random() < 0.75) {
      return sourceTraits[Math.floor(Math.random() * sourceTraits.length)];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function createKitten(parentA, parentB) {
    var nowIso = game.systems.timeSystem.getNow().toISOString();
    var kittenIndex = game.state.game.cats.filter(function (cat) {
      return String(cat.id || "").indexOf("kitten_") === 0;
    }).length + 1;
    var traits = {
      furColor: mixTrait("furColor", parentA, parentB),
      patchColor: mixTrait("patchColor", parentA, parentB),
      pattern: mixTrait("pattern", parentA, parentB),
      eyeColor: mixTrait("eyeColor", parentA, parentB),
      accessory: mixTrait("accessory", parentA, parentB),
      artKey: mixTrait("artKey", parentA, parentB),
    };

    return {
      id: "kitten_" + Date.now() + "_" + kittenIndex,
      name: "小猫" + kittenIndex,
      nameEn: "Kitten " + kittenIndex,
      nameJa: "こねこ " + kittenIndex,
      breed: "混色小猫",
      breedEn: "Mixed Kitten",
      breedJa: "ミックス子猫",
      rarity: "稀有",
      initialAgeYears: 0.08,
      gender: Math.random() < 0.5 ? "male" : "female",
      traits: traits,
      iconSet: {
        happy: "😺",
        calm: "🐾",
        sad: "😿",
        hungry: "🙀",
        sick: "🤒",
        dead: "🪦",
      },
      hunger: 82,
      clean: 76,
      mood: 88,
      health: 92,
      intimacy: 10,
      energy: 82,
      level: 1,
      unlocked: true,
      isAlive: true,
      diedAt: null,
      deathReason: null,
      ageYears: 0.08,
      ageUpdatedAt: nowIso,
      diseaseId: null,
      diseaseStartedAt: null,
      diseaseProgressAt: nowIso,
      diseaseCheckAt: nowIso,
      diseaseHistory: [],
      adoptionCount: 0,
      isPregnant: false,
      pregnancyStartedAt: null,
      pregnancyDueAt: null,
      pregnancyMateId: null,
      pregnancyLitterSize: 0,
      decayTracker: {
        hunger: nowIso,
        clean: nowIso,
        mood: nowIso,
        health: nowIso,
        energy: nowIso,
      },
      parents: [parentA.id, parentB.id],
    };
  }

  function getPregnancyCountdown(cat, nowDate) {
    var now = nowDate || game.systems.timeSystem.getNow();

    if (!cat || !cat.isPregnant || !cat.pregnancyDueAt) {
      return null;
    }

    return Math.max(0, new Date(cat.pregnancyDueAt).getTime() - now.getTime());
  }

  function getPairRoles(parentA, parentB) {
    if (parentA.gender === "female" && parentB.gender === "male") {
      return { mother: parentA, father: parentB };
    }
    if (parentA.gender === "male" && parentB.gender === "female") {
      return { mother: parentB, father: parentA };
    }
    return null;
  }

  function birthKittens(mother, father, birthIso, litterSize) {
    var kittens = [];
    var count = Math.max(1, litterSize || 1);
    var index;

    for (index = 0; index < count; index += 1) {
      kittens.push(createKitten(mother, father));
    }

    kittens.forEach(function (kitten) {
      kitten.bornAt = birthIso;
      game.state.game.cats.push(kitten);
      game.state.selectedCatId = kitten.id;
    });

    mother.isPregnant = false;
    mother.pregnancyStartedAt = null;
    mother.pregnancyDueAt = null;
    mother.pregnancyMateId = null;
    mother.pregnancyLitterSize = 0;

    return kittens;
  }

  function syncPregnancies(nowDate, source) {
    var messages = [];
    var changed = false;

    getPregnantCats().forEach(function (mother) {
      var father;
      var kittens;
      var dueAt;
      var kittenNames;

      if (!mother.pregnancyDueAt) {
        return;
      }

      dueAt = new Date(mother.pregnancyDueAt).getTime();
      if (dueAt > nowDate.getTime()) {
        return;
      }

      father = game.systems.catSystem.getCat(mother.pregnancyMateId);
      if (!father || father.isAlive === false) {
        mother.isPregnant = false;
        mother.pregnancyStartedAt = null;
        mother.pregnancyDueAt = null;
        mother.pregnancyMateId = null;
        mother.pregnancyLitterSize = 0;
        changed = true;
        return;
      }

      kittens = birthKittens(mother, father, nowDate.toISOString(), mother.pregnancyLitterSize);
      kittenNames = kittens
        .map(function (kitten) {
          return getText(kitten, "name");
        })
        .join("、");

      messages.push(
        t("pregnancy_birth", {
          mother: getText(mother, "name"),
          father: getText(father, "name"),
          kittens: kittenNames,
          count: kittens.length,
        })
      );
      changed = true;
    });

    return {
      changed: changed,
      messages: messages,
    };
  }

  function breedCats(parentAId, parentBId) {
    var parentA = game.systems.catSystem.getCat(parentAId);
    var parentB = game.systems.catSystem.getCat(parentBId);
    var roles;
    var now;
    var litterSize;

    if (!parentA || !parentB || parentA.id === parentB.id) {
      return { ok: false, message: t("breed_pick_two") };
    }

    if (parentA.isAlive === false || parentB.isAlive === false) {
      return { ok: false, message: t("breed_alive_only") };
    }

    if (game.systems.catSystem.getCatAgeYears(parentA) < 1 || game.systems.catSystem.getCatAgeYears(parentB) < 1) {
      return { ok: false, message: t("breed_need_adult") };
    }

    roles = getPairRoles(parentA, parentB);
    if (!roles) {
      return { ok: false, message: t("breed_need_opposite") };
    }
    if (roles.mother.isPregnant) {
      return { ok: false, message: t("breed_mother_busy", { name: getText(roles.mother, "name") }) };
    }

    now = game.systems.timeSystem.getNow();
    litterSize = Math.random() < 0.35 ? 2 : 1;
    roles.mother.isPregnant = true;
    roles.mother.pregnancyStartedAt = now.toISOString();
    roles.mother.pregnancyDueAt = new Date(now.getTime() + pregnancyDurationMs).toISOString();
    roles.mother.pregnancyMateId = roles.father.id;
    roles.mother.pregnancyLitterSize = litterSize;

    return {
      ok: true,
      forceSave: true,
      messages: [
        t("breed_success", {
          mother: getText(roles.mother, "name"),
          father: getText(roles.father, "name"),
          minutes: Math.round(pregnancyDurationMs / 60000),
        }),
      ],
    };
  }

  function getCollectionStats() {
    var cats = getUnlockedCats();
    var uniqueLooks = {};

    cats.forEach(function (cat) {
      var traits = cat.traits || {};
      uniqueLooks[(traits.artKey || traits.furColor || "") + "|" + (traits.pattern || "") + "|" + (traits.eyeColor || "")] = true;
    });

    return {
      totalCats: cats.length,
      uniqueLooks: Object.keys(uniqueLooks).length,
      kittens: cats.filter(function (cat) {
        return String(cat.id || "").indexOf("kitten_") === 0;
      }).length,
    };
  }

  game.systems.collectionSystem = {
    getUnlockedCats: getUnlockedCats,
    getBreedableCats: getBreedableCats,
    getPregnantCats: getPregnantCats,
    getPregnancyCountdown: getPregnancyCountdown,
    breedCats: breedCats,
    syncPregnancies: syncPregnancies,
    getCollectionStats: getCollectionStats,
  };
})(window.CatGame);
