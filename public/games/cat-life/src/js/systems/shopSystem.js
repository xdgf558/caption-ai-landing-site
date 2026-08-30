(function (game) {
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function useEnglishFallback() {
    return game.utils.i18n.getLanguage() !== "zh-CN";
  }

  function getShopState() {
    return game.state.game.shop;
  }

  function getConfig() {
    return game.config.shop;
  }

  function isDiscountWindow(nowDate) {
    var now = nowDate || game.systems.timeSystem.getNow();
    var hour = now.getHours();
    return hour >= getConfig().discountStartHour && hour < getConfig().discountEndHour;
  }

  function shuffle(list) {
    var copy = (list || []).slice();
    var index;
    var swapIndex;
    var temp;

    for (index = copy.length - 1; index > 0; index -= 1) {
      swapIndex = Math.floor(Math.random() * (index + 1));
      temp = copy[index];
      copy[index] = copy[swapIndex];
      copy[swapIndex] = temp;
    }

    return copy;
  }

  function randomRange(range) {
    var min = Number(range[0] || 0);
    var max = Number(range[1] || min);
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function buildOffer(item) {
    var discountRate = game.utils.random.pick(getConfig().discountRates) || 0.2;
    var totalStock = item.type === "furniture"
      ? randomRange(getConfig().furnitureStockRange)
      : randomRange(getConfig().consumableStockRange);

    return {
      itemId: item.id,
      discountRate: discountRate,
      discountedPrice: Math.max(1, Math.floor(item.price * (1 - discountRate))),
      remainingStock: totalStock,
      totalStock: totalStock,
    };
  }

  function createDailyOffers() {
    var state = game.state.game;
    var candidates = game.data.items.filter(function (item) {
      return item.price > 0 && (item.type !== "furniture" || state.inventory.furnitureOwned.indexOf(item.id) === -1);
    });

    return shuffle(candidates)
      .slice(0, Math.min(getConfig().dailyOfferCount, candidates.length))
      .map(buildOffer);
  }

  function syncDailyDiscount(nowDate, source) {
    var now = nowDate || game.systems.timeSystem.getNow();
    var shop = getShopState();
    var todayKey = game.utils.format.formatDateKey(now);

    if (!isDiscountWindow(now)) {
      return {
        changed: false,
        messages: [],
      };
    }

    if (shop.flashSaleDateKey === todayKey && Array.isArray(shop.offers) && shop.offers.length) {
      return {
        changed: false,
        messages: [],
      };
    }

    shop.flashSaleDateKey = todayKey;
    shop.offers = createDailyOffers();

    return {
      changed: true,
      messages:
        source !== "timer"
          ? [
              t("shop_discount_started", {
                start: getConfig().discountStartHour + ":00",
                end: getConfig().discountEndHour + ":00",
              }),
            ]
          : [],
    };
  }

  function getActiveOffer(itemId, nowDate) {
    var now = nowDate || game.systems.timeSystem.getNow();
    var shop = getShopState();
    var todayKey = game.utils.format.formatDateKey(now);

    if (!isDiscountWindow(now) || shop.flashSaleDateKey !== todayKey) {
      return null;
    }

    return (shop.offers || []).find(function (offer) {
      return offer.itemId === itemId && offer.remainingStock > 0;
    }) || null;
  }

  function getPriceState(itemId, nowDate) {
    var item = game.data.itemMap[itemId];
    var offer = getActiveOffer(itemId, nowDate);
    var basePrice = item ? item.price : 0;

    return {
      price: offer ? offer.discountedPrice : basePrice,
      basePrice: basePrice,
      isDiscount: Boolean(offer),
      offer: offer,
      discountPercent: offer ? Math.round(offer.discountRate * 100) : 0,
      remainingStock: offer ? offer.remainingStock : 0,
      totalStock: offer ? offer.totalStock : 0,
    };
  }

  function getActiveOffers(nowDate) {
    var now = nowDate || game.systems.timeSystem.getNow();
    return (getShopState().offers || [])
      .filter(function (offer) {
        return getActiveOffer(offer.itemId, now) && game.data.itemMap[offer.itemId];
      })
      .map(function (offer) {
        return {
          item: game.data.itemMap[offer.itemId],
          offer: offer,
          priceState: getPriceState(offer.itemId, now),
        };
      });
  }

  function purchase(itemId) {
    var state = game.state.game;
    var now = game.systems.timeSystem.getNow();
    var syncResult = syncDailyDiscount(now, "action");
    var item = game.data.itemMap[itemId];
    var priceState = getPriceState(itemId, now);
    var messages = [];
    var placedFurnitureIds;

    if (syncResult.messages && syncResult.messages.length) {
      messages = messages.concat(syncResult.messages);
    }

    if (!item) {
      return { ok: false, message: useEnglishFallback() ? "That item does not exist in the shop." : "商店里没有这个物品。" };
    }
    if (state.player.gold < priceState.price) {
      return {
        ok: false,
        message:
          useEnglishFallback()
            ? "Not enough gold. You need " + (priceState.price - state.player.gold) + " more."
            : "金币不足，还差 " + (priceState.price - state.player.gold) + " 金币。",
      };
    }
    if (item.type === "furniture" && state.inventory.furnitureOwned.indexOf(item.id) !== -1) {
      return { ok: false, message: useEnglishFallback() ? "You already own this furniture." : "这件家具已经买过了。" };
    }

    state.player.gold -= priceState.price;
    state.player.totalSpend += priceState.price;

    if (item.type === "furniture") {
      state.inventory.furnitureOwned.push(item.id);
      state.player.furniturePurchaseCount += 1;
      if (game.systems.homeSystem) {
        game.systems.homeSystem.recalculateComfort();
        placedFurnitureIds = game.state.game.home.placedFurniture;
      }
      messages.push(
        placedFurnitureIds && placedFurnitureIds.indexOf(item.id) !== -1
          ? game.utils.i18n.t("room_auto_place_added", { name: getText(item, "name") })
          : game.utils.i18n.t("room_auto_place_full", { name: getText(item, "name") })
      );
    } else {
      if (typeof state.inventory[item.inventoryField] !== "number") {
        state.inventory[item.inventoryField] = 0;
      }
      if (item.inventoryField === "toys" && item.usesPerPurchase) {
        state.inventory[item.inventoryField] += item.usesPerPurchase;
      } else {
        state.inventory[item.inventoryField] += 1;
      }
      messages.push(
        useEnglishFallback()
          ? "Purchased " + getText(item, "name") + ". It was added to your inventory."
          : "购买成功：「" + getText(item, "name") + "」已放入背包。"
      );
      if (item.inventoryField === "toys" && item.usesPerPurchase) {
        messages.push(game.utils.i18n.t("toy_purchase_uses", { count: item.usesPerPurchase }));
      }
    }

    if (priceState.isDiscount && priceState.offer) {
      priceState.offer.remainingStock = Math.max(0, priceState.offer.remainingStock - 1);
      messages.unshift(
        t("shop_discount_purchase", {
          name: getText(item, "name"),
          price: priceState.price,
          base: priceState.basePrice,
        })
      );
      if (priceState.offer.remainingStock <= 0) {
        messages.push(t("shop_discount_sold_out_restore", { name: getText(item, "name") }));
      }
    }

    if (game.systems.taskSystem) {
      game.systems.taskSystem.refreshAllTasks();
    }

    return {
      ok: true,
      messages: messages,
      forceSave: true,
    };
  }

  game.systems.shopSystem = {
    getShopState: getShopState,
    syncDailyDiscount: syncDailyDiscount,
    isDiscountWindow: isDiscountWindow,
    getActiveOffers: getActiveOffers,
    getPriceState: getPriceState,
    purchase: purchase,
  };
})(window.CatGame);
