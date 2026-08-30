(function (game) {
  var clamp = game.utils.format.clamp;
  var t = game.utils.i18n.t;

  var symbols = [
    { id: "coin", icon: "🪙", weight: 6, multiplier: 2, nameKey: "slot_symbol_coin" },
    { id: "berry", icon: "🍒", weight: 5, multiplier: 3, nameKey: "slot_symbol_berry" },
    { id: "bell", icon: "🔔", weight: 4, multiplier: 5, nameKey: "slot_symbol_bell" },
    { id: "star", icon: "⭐", weight: 3, multiplier: 8, nameKey: "slot_symbol_star" },
    { id: "cat", icon: "🐱", weight: 2, multiplier: 12, nameKey: "slot_symbol_cat" },
    { id: "seven", icon: "7️⃣", weight: 1, multiplier: 25, nameKey: "slot_symbol_seven" },
  ];

  function getWeightedPool() {
    return symbols.reduce(function (pool, symbol) {
      var i;
      for (i = 0; i < symbol.weight; i += 1) {
        pool.push(symbol);
      }
      return pool;
    }, []);
  }

  function getSpinSymbols() {
    var pool = getWeightedPool();
    return [game.utils.random.pick(pool), game.utils.random.pick(pool), game.utils.random.pick(pool)];
  }

  function evaluateSpin(reels, bet) {
    var ids = reels.map(function (symbol) {
      return symbol.id;
    });
    var allSame = ids[0] === ids[1] && ids[1] === ids[2];
    var catCount = ids.filter(function (id) {
      return id === "cat";
    }).length;
    var sevenCount = ids.filter(function (id) {
      return id === "seven";
    }).length;
    var payout = 0;
    var resultKey = "slot_result_miss";

    if (allSame) {
      payout = bet * reels[0].multiplier;
      resultKey = reels[0].id === "seven" ? "slot_result_jackpot" : "slot_result_match";
    } else if (catCount >= 2) {
      payout = bet * 4;
      resultKey = "slot_result_cat_pair";
    } else if (sevenCount >= 2) {
      payout = bet * 6;
      resultKey = "slot_result_lucky";
    }

    return {
      payout: payout,
      resultKey: resultKey,
    };
  }

  function spinSlot(bet) {
    var state = game.state.game;
    var amount = Number(bet || 0);
    var reels;
    var outcome;
    var lastSpin;
    var messages = [];

    var validation = validateSpin(amount);
    if (!validation.ok) {
      return validation;
    }

    reels = getSpinSymbols();
    outcome = evaluateSpin(reels, amount);

    state.player.gold -= amount;
    state.player.totalSpend += amount;
    state.player.arcadeSpins += 1;
    state.player.arcadeTotalSpent += amount;
    state.player.mood = clamp(state.player.mood + 1, 0, 100);

    if (outcome.payout > 0) {
      state.player.gold += outcome.payout;
      state.player.totalIncome += outcome.payout;
      state.player.arcadeTotalWon += outcome.payout;
      state.player.arcadeBestWin = Math.max(state.player.arcadeBestWin, outcome.payout);
      state.player.mood = clamp(state.player.mood + Math.min(8, Math.floor(outcome.payout / 40)), 0, 100);
      if (outcome.resultKey === "slot_result_jackpot") {
        state.player.arcadeJackpots += 1;
      }
    }

    lastSpin = {
      reels: reels.map(function (symbol) {
        return symbol.icon;
      }),
      bet: amount,
      payout: outcome.payout,
      resultKey: outcome.resultKey,
      playedAt: game.systems.timeSystem.getNow().toISOString(),
    };
    state.home.arcadeLastSpin = lastSpin;

    messages.push(t(outcome.resultKey, { payout: outcome.payout, bet: amount }));
    messages.push(
      t("slot_reel_result", {
        reel1: reels[0].icon,
        reel2: reels[1].icon,
        reel3: reels[2].icon,
      })
    );

    return {
      ok: true,
      forceSave: true,
      messages: messages,
    };
  }

  function validateSpin(bet) {
    var state = game.state.game;
    var amount = Number(bet || 0);

    if (game.config.slotBets.indexOf(amount) === -1) {
      return { ok: false, message: t("slot_invalid_bet") };
    }

    if (state.player.gold < amount) {
      return { ok: false, message: t("slot_not_enough_gold", { amount: amount }) };
    }

    return { ok: true };
  }

  game.systems.arcadeSystem = {
    symbols: symbols,
    validateSpin: validateSpin,
    spinSlot: spinSlot,
  };
})(window.CatGame);
