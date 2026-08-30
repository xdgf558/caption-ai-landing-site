(function (game) {
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function getCommunity() {
    return game.state.game.community;
  }

  function getCurrentDay() {
    return Math.max(1, Math.floor(Number(game.state.game.player.currentDay || 1)));
  }

  function clampFriendship(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
  }

  function getNeighbors() {
    return game.data.community.neighbors.slice();
  }

  function getNeighbor(npcId) {
    return game.data.neighborMap[npcId] || null;
  }

  function getDefaultRelationship() {
    return {
      friendship: 0,
      lastVisitedDay: null,
      lastGiftDay: null,
      lastExchangeDay: null,
      giftsGivenToday: 0,
      exchangesToday: 0,
      lastDialogue: "",
    };
  }

  function getRelationship(npcId) {
    var community = getCommunity();

    if (!community.relationships[npcId]) {
      community.relationships[npcId] = getDefaultRelationship();
    }

    syncDailyCounters(npcId);
    return community.relationships[npcId];
  }

  function getRelationshipLevel(friendshipValue) {
    var friendship = clampFriendship(friendshipValue);
    if (friendship >= 80) {
      return 5;
    }
    if (friendship >= 60) {
      return 4;
    }
    if (friendship >= 40) {
      return 3;
    }
    if (friendship >= 20) {
      return 2;
    }
    return 1;
  }

  function addFriendship(npcId, amount) {
    var relationship = getRelationship(npcId);
    var before = relationship.friendship;
    relationship.friendship = clampFriendship(relationship.friendship + Number(amount || 0));
    return relationship.friendship - before;
  }

  function syncDailyCounters(npcId) {
    var relationship = getCommunity().relationships[npcId];
    var day = getCurrentDay();

    if (!relationship) {
      return;
    }

    if (relationship.lastGiftDay !== day) {
      relationship.giftsGivenToday = 0;
    }
    if (relationship.lastExchangeDay !== day) {
      relationship.exchangesToday = 0;
    }
  }

  function syncDailyState() {
    var community = getCommunity();
    var day = getCurrentDay();
    var changed = false;

    if (community.lastResetDay === day) {
      return { changed: false, messages: [] };
    }

    Object.keys(community.relationships).forEach(function (npcId) {
      var relationship = community.relationships[npcId];
      if (relationship.giftsGivenToday || relationship.exchangesToday) {
        changed = true;
      }
      relationship.giftsGivenToday = 0;
      relationship.exchangesToday = 0;
    });
    community.lastResetDay = day;

    return {
      changed: changed,
      messages: [],
    };
  }

  function getLevelDialogueBucket(level) {
    if (level >= 4) {
      return "level3";
    }
    if (level >= 2) {
      return "level2";
    }
    return "level1";
  }

  function pickDialogue(npc, type, relationship) {
    var dialogues = npc.dialogues || {};
    var list = [];

    if (type === "visit") {
      list = dialogues.visit && dialogues.visit[getLevelDialogueBucket(getRelationshipLevel(relationship.friendship))];
    } else {
      list = dialogues[type];
    }

    return game.utils.random.pick(list || []) || "";
  }

  function addInventoryItem(itemId, count) {
    var item = game.data.itemMap[itemId];
    var amount = Math.max(0, Number(count || 0));

    if (!item || !item.inventoryField || amount <= 0) {
      return false;
    }

    if (typeof game.state.game.inventory[item.inventoryField] !== "number") {
      game.state.game.inventory[item.inventoryField] = 0;
    }

    game.state.game.inventory[item.inventoryField] += amount;
    return true;
  }

  function removeInventoryItem(itemId, count) {
    var item = game.data.itemMap[itemId];
    var amount = Math.max(0, Number(count || 0));
    var current;

    if (!item || !item.inventoryField || amount <= 0) {
      return false;
    }

    current = Number(game.state.game.inventory[item.inventoryField] || 0);
    if (current < amount) {
      return false;
    }

    game.state.game.inventory[item.inventoryField] = current - amount;
    return true;
  }

  function getInventoryCount(itemId) {
    var item = game.data.itemMap[itemId];
    if (!item || !item.inventoryField) {
      return 0;
    }
    return Number(game.state.game.inventory[item.inventoryField] || 0);
  }

  function getGiftCategory(item) {
    return item.giftCategory || item.category || "neutral";
  }

  function getGiftableItems() {
    return game.data.items.filter(function (item) {
      return item.inventoryField && item.giftCategory && item.type !== "furniture";
    });
  }

  function getGiftScore(npc, item) {
    var category = getGiftCategory(item);

    if ((npc.favoriteGiftTypes || []).indexOf(category) !== -1) {
      return {
        type: "giftFavorite",
        friendship: 8,
        key: "community_gift_favorite",
      };
    }

    if (["cat_snack", "toy", "drink", "meal", "flower", "decoration", "rare_item", "tool", "dessert", "cat_supplies"].indexOf(category) !== -1) {
      return {
        type: "giftNeutral",
        friendship: 3,
        key: "community_gift_neutral",
      };
    }

    return {
      type: "giftUnwanted",
      friendship: 1,
      key: "community_gift_unwanted",
    };
  }

  function visitNpc(npcId) {
    var npc = getNeighbor(npcId);
    var relationship;
    var day = getCurrentDay();
    var messages = [];
    var dialogue;
    var rewardRoll;
    var rewardItem;

    if (!npc) {
      return { ok: false, message: t("community_npc_missing") };
    }

    relationship = getRelationship(npcId);
    dialogue = pickDialogue(npc, "visit", relationship);
    relationship.lastDialogue = dialogue;

    if (relationship.lastVisitedDay !== day) {
      relationship.lastVisitedDay = day;
      addFriendship(npcId, 2);
      messages.push(t("community_visit_success", { name: getText(npc, "name"), points: 2 }));

      if (game.utils.random.chance(0.2)) {
        rewardRoll = game.utils.random.pick([
          { itemId: "cat_snack", count: 1 },
          { itemId: "toy_material", count: 1 },
          { itemId: "cat_supply", count: 1 },
          { money: 20 },
        ]);
        if (rewardRoll.money) {
          game.state.game.player.gold += rewardRoll.money;
          game.state.game.player.totalIncome += rewardRoll.money;
          messages.push(t("community_visit_reward_money", { amount: rewardRoll.money }));
        } else if (addInventoryItem(rewardRoll.itemId, rewardRoll.count)) {
          rewardItem = game.data.itemMap[rewardRoll.itemId];
          messages.push(t("community_visit_reward_item", {
            name: getText(rewardItem, "name"),
            count: rewardRoll.count,
          }));
        }
      }
    } else {
      messages.push(t("community_visit_repeat", { name: getText(npc, "name") }));
    }

    if (dialogue) {
      messages.push(getText(npc, "name") + "：" + dialogue);
    }

    getCommunity().visitHistory.unshift({
      npcId: npcId,
      day: day,
      at: game.systems.timeSystem.getNow().toISOString(),
    });
    getCommunity().visitHistory = getCommunity().visitHistory.slice(0, 30);

    return {
      ok: true,
      forceSave: true,
      messages: messages,
    };
  }

  function giveGift(npcId, itemId) {
    var npc = getNeighbor(npcId);
    var item = game.data.itemMap[itemId];
    var relationship;
    var score;
    var dialogue;
    var day = getCurrentDay();

    if (!npc) {
      return { ok: false, message: t("community_npc_missing") };
    }
    if (!item || !item.inventoryField) {
      return { ok: false, message: t("community_gift_invalid") };
    }

    relationship = getRelationship(npcId);
    if (relationship.giftsGivenToday >= game.config.community.maxGiftsPerNpcPerDay) {
      return { ok: false, message: t("community_gift_limit") };
    }
    if (getInventoryCount(itemId) <= 0) {
      return { ok: false, message: t("community_item_missing", { name: getText(item, "name") }) };
    }

    score = getGiftScore(npc, item);
    removeInventoryItem(itemId, 1);
    relationship.lastGiftDay = day;
    relationship.giftsGivenToday += 1;
    addFriendship(npcId, score.friendship);
    dialogue = pickDialogue(npc, score.type, relationship);
    relationship.lastDialogue = dialogue;

    return {
      ok: true,
      forceSave: true,
      messages: [
        t(score.key, {
          name: getText(npc, "name"),
          item: getText(item, "name"),
          points: score.friendship,
        }),
        dialogue ? getText(npc, "name") + "：" + dialogue : "",
      ].filter(Boolean),
    };
  }

  function getExchangesForNpc(npcId) {
    return game.data.community.exchanges.filter(function (exchange) {
      return exchange.npcId === npcId;
    });
  }

  function canExchange(exchangeId) {
    var exchange = game.data.communityExchangeMap[exchangeId];
    var relationship;
    var level;
    var day = getCurrentDay();
    var player = game.state.game.player;

    if (!exchange) {
      return { ok: false, key: "community_exchange_missing" };
    }

    relationship = getRelationship(exchange.npcId);
    level = getRelationshipLevel(relationship.friendship);

    if (level < exchange.requiredRelationshipLevel) {
      return {
        ok: false,
        key: "community_exchange_level_locked",
        vars: { level: exchange.requiredRelationshipLevel },
      };
    }

    if (relationship.lastExchangeDay === day && relationship.exchangesToday >= game.config.community.maxExchangesPerNpcPerDay) {
      return { ok: false, key: "community_exchange_limit" };
    }

    if (player.gold < Number(exchange.payMoney || 0)) {
      return { ok: false, key: "not_enough_gold" };
    }

    if ((exchange.give || []).some(function (entry) {
      return getInventoryCount(entry.itemId) < entry.count;
    })) {
      return { ok: false, key: "community_exchange_missing_items" };
    }

    return { ok: true };
  }

  function performExchange(exchangeId) {
    var exchange = game.data.communityExchangeMap[exchangeId];
    var validation = canExchange(exchangeId);
    var npc;
    var relationship;
    var dialogue;
    var day = getCurrentDay();

    if (!validation.ok) {
      return { ok: false, message: t(validation.key, validation.vars || {}) };
    }

    npc = getNeighbor(exchange.npcId);
    relationship = getRelationship(exchange.npcId);

    (exchange.give || []).forEach(function (entry) {
      removeInventoryItem(entry.itemId, entry.count);
    });
    (exchange.receive || []).forEach(function (entry) {
      addInventoryItem(entry.itemId, entry.count);
    });

    if (exchange.payMoney) {
      game.state.game.player.gold -= exchange.payMoney;
      game.state.game.player.totalSpend += exchange.payMoney;
    }
    if (exchange.receiveMoney) {
      game.state.game.player.gold += exchange.receiveMoney;
      game.state.game.player.totalIncome += exchange.receiveMoney;
    }

    relationship.lastExchangeDay = day;
    relationship.exchangesToday += 1;
    addFriendship(exchange.npcId, 2);
    dialogue = pickDialogue(npc, "exchangeSuccess", relationship);
    relationship.lastDialogue = dialogue;
    getCommunity().exchangeHistory.unshift({
      exchangeId: exchangeId,
      npcId: exchange.npcId,
      day: day,
      at: game.systems.timeSystem.getNow().toISOString(),
    });
    getCommunity().exchangeHistory = getCommunity().exchangeHistory.slice(0, 30);

    return {
      ok: true,
      forceSave: true,
      messages: [
        t("community_exchange_success", { name: getText(npc, "name"), label: getText(exchange, "label") }),
        dialogue ? getText(npc, "name") + "：" + dialogue : "",
      ].filter(Boolean),
    };
  }

  game.systems.communitySystem = {
    getNeighbors: getNeighbors,
    getNeighbor: getNeighbor,
    getRelationship: getRelationship,
    getRelationshipLevel: getRelationshipLevel,
    getGiftableItems: getGiftableItems,
    getGiftCategory: getGiftCategory,
    getInventoryCount: getInventoryCount,
    getExchangesForNpc: getExchangesForNpc,
    canExchange: canExchange,
    visitNpc: visitNpc,
    giveGift: giveGift,
    performExchange: performExchange,
    syncDailyState: syncDailyState,
  };
})(window.CatGame);
