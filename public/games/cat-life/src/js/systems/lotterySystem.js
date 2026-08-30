(function (game) {
  var t = game.utils.i18n.t;
  var resolving = false;
  var lastResolveAttemptAt = 0;

  function getLottery() {
    return game.state.game.lottery;
  }

  function getPlayer() {
    return game.state.game.player;
  }

  function getConfig() {
    return game.config.lottery;
  }

  function getNow() {
    return game.systems.timeSystem.getNow();
  }

  function formatUtcDateKey(dateValue) {
    var date = dateValue ? new Date(dateValue) : new Date();
    var year = date.getUTCFullYear();
    var month = String(date.getUTCMonth() + 1).padStart(2, "0");
    var day = String(date.getUTCDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function addUtcDays(dateKey, amount) {
    var date = new Date(dateKey + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + amount);
    return formatUtcDateKey(date);
  }

  function getCurrentUtcDrawDate(nowDate) {
    return formatUtcDateKey(nowDate || getNow());
  }

  function getCurrentUtcTimestamp() {
    return new Date().toISOString();
  }

  function getNextDrawInfo(nowDate) {
    var now = nowDate || getNow();
    var nextUtcMidnight = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0
    ));

    return {
      currentDrawDate: getCurrentUtcDrawDate(now),
      nextDrawDate: formatUtcDateKey(nextUtcMidnight),
      countdownMs: Math.max(0, nextUtcMidnight.getTime() - now.getTime()),
    };
  }

  function ensureDraftLength() {
    if (!Array.isArray(game.state.lotteryDraftDigits)) {
      game.state.lotteryDraftDigits = [];
    }
    while (game.state.lotteryDraftDigits.length < getConfig().drawDigits) {
      game.state.lotteryDraftDigits.push("0");
    }
    game.state.lotteryDraftDigits = game.state.lotteryDraftDigits.slice(0, getConfig().drawDigits);
  }

  function getDraftDigits() {
    ensureDraftLength();
    return game.state.lotteryDraftDigits.slice();
  }

  function getDraftNumber() {
    return getDraftDigits().join("");
  }

  function setDraftDigit(index, value) {
    ensureDraftLength();
    var safeIndex = Math.max(0, Math.min(getConfig().drawDigits - 1, Number(index || 0)));
    var safeValue = String(value || "0").replace(/\D/g, "").slice(-1) || "0";
    game.state.lotteryDraftDigits[safeIndex] = safeValue;
  }

  function randomDigits() {
    var digits = [];
    var index;
    for (index = 0; index < getConfig().drawDigits; index += 1) {
      digits.push(String(Math.floor(Math.random() * 10)));
    }
    return digits;
  }

  function randomizeDraft() {
    game.state.lotteryDraftDigits = randomDigits();
    return {
      ok: true,
      message: t("lottery_randomized", { numbers: getDraftNumber() }),
    };
  }

  function validateNumbers(numbers) {
    var normalized = String(numbers || "").replace(/\D/g, "");

    if (normalized.length !== getConfig().drawDigits) {
      return {
        ok: false,
        message: t("lottery_invalid_numbers", { count: getConfig().drawDigits }),
      };
    }

    return {
      ok: true,
      numbers: normalized,
    };
  }

  function getDrawStatesSorted() {
    return getLottery().drawStates.sort(function (left, right) {
      return left.drawDate.localeCompare(right.drawDate);
    });
  }

  function getDrawState(drawDate) {
    return getLottery().drawStates.find(function (drawState) {
      return drawState.drawDate === drawDate;
    }) || null;
  }

  function getKnownDrawDates() {
    var lottery = getLottery();
    var dates = {};

    lottery.drawStates.forEach(function (drawState) {
      dates[drawState.drawDate] = true;
    });
    lottery.tickets.forEach(function (ticket) {
      dates[ticket.drawDate] = true;
    });
    lottery.drawHistory.forEach(function (entry) {
      dates[entry.drawDate] = true;
    });
    lottery.unresolvedDrawDates.forEach(function (dateValue) {
      dates[dateValue] = true;
    });
    dates[lottery.currentDrawDate] = true;

    return Object.keys(dates).sort();
  }

  function computeJackpotForDraw(drawState) {
    return Math.max(getConfig().jackpotBase, Number(drawState.openingJackpot || 0)) +
      Math.max(0, Number(drawState.ticketSales || 0));
  }

  function computeNextOpeningJackpot(drawState) {
    if (drawState.resolved && drawState.jackpotWasHit) {
      return getConfig().jackpotBase;
    }
    return computeJackpotForDraw(drawState);
  }

  function ensureDrawState(drawDate) {
    var lottery = getLottery();
    var existing = getDrawState(drawDate);

    if (existing) {
      return existing;
    }

    existing = {
      drawDate: drawDate,
      openingJackpot: getConfig().jackpotBase,
      ticketSales: 0,
      resolved: false,
      jackpotWasHit: false,
    };
    lottery.drawStates.push(existing);
    return existing;
  }

  function normalizeDrawStateChain() {
    var lottery = getLottery();
    var dates = getKnownDrawDates();
    var previousState = null;

    dates.forEach(function (drawDate, index) {
      var drawState = ensureDrawState(drawDate);
      if (index === 0) {
        drawState.openingJackpot = Math.max(getConfig().jackpotBase, Number(drawState.openingJackpot || getConfig().jackpotBase));
      } else if (previousState) {
        drawState.openingJackpot = computeNextOpeningJackpot(previousState);
      }
      drawState.ticketSales = Math.max(0, Number(drawState.ticketSales || 0));
      previousState = drawState;
    });

    lottery.drawStates = dates.map(function (drawDate) {
      return getDrawState(drawDate);
    });

    lottery.jackpotPool = computeJackpotForDraw(ensureDrawState(lottery.currentDrawDate));
  }

  function getTicketsForDraw(drawDate) {
    return getLottery().tickets.filter(function (ticket) {
      return ticket.drawDate === drawDate;
    });
  }

  function addUnresolvedDrawDate(drawDate) {
    var lottery = getLottery();
    if (lottery.unresolvedDrawDates.indexOf(drawDate) === -1) {
      lottery.unresolvedDrawDates.push(drawDate);
      lottery.unresolvedDrawDates.sort();
    }
  }

  function removeUnresolvedDrawDate(drawDate) {
    getLottery().unresolvedDrawDates = getLottery().unresolvedDrawDates.filter(function (dateValue) {
      return dateValue !== drawDate;
    });
  }

  function syncCurrentDrawDate(nowDate, source) {
    var lottery = getLottery();
    var todayUtc = getCurrentUtcDrawDate(nowDate);
    var changed = false;
    var needsResolve = false;
    var messages = [];

    if (!lottery.currentDrawDate) {
      lottery.currentDrawDate = todayUtc;
    }

    ensureDrawState(lottery.currentDrawDate);

    while (lottery.currentDrawDate < todayUtc) {
      var previousDrawDate = lottery.currentDrawDate;
      if (getTicketsForDraw(previousDrawDate).some(function (ticket) { return !ticket.resolved; })) {
        addUnresolvedDrawDate(previousDrawDate);
        needsResolve = true;
      }
      lottery.currentDrawDate = addUtcDays(previousDrawDate, 1);
      ensureDrawState(lottery.currentDrawDate);
      changed = true;
    }

    normalizeDrawStateChain();

    if (changed && source !== "timer") {
      messages.push(t("lottery_new_draw_opened", { date: lottery.currentDrawDate }));
    }

    if (lottery.unresolvedDrawDates.some(function (drawDate) { return drawDate < lottery.currentDrawDate; })) {
      needsResolve = true;
    }

    return {
      changed: changed,
      needsResolve: needsResolve,
      messages: messages,
    };
  }

  function getPrizeStatus(matchCount) {
    if (matchCount >= 6) {
      return "first_prize";
    }
    if (matchCount === 5) {
      return "second_prize";
    }
    if (matchCount === 4) {
      return "third_prize";
    }
    if (matchCount === 3) {
      return "fourth_prize";
    }
    if (matchCount === 2) {
      return "fifth_prize";
    }
    return "lost";
  }

  function getFixedPrizeReward(status) {
    return Number(getConfig().prizeRewards[status] || 0);
  }

  function countExactMatches(ticketNumbers, winningNumber) {
    var matches = 0;
    var index;

    for (index = 0; index < getConfig().drawDigits; index += 1) {
      if (ticketNumbers.charAt(index) === winningNumber.charAt(index)) {
        matches += 1;
      }
    }

    return matches;
  }

  function getHistoryEntry(drawDate) {
    return getLottery().drawHistory.find(function (entry) {
      return entry.drawDate === drawDate;
    }) || null;
  }

  function convertHashToWinningNumber(hash) {
    var tail = String(hash || "").toLowerCase().slice(-6);
    var map = { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" };

    return tail
      .split("")
      .map(function (char) {
        return /[0-9]/.test(char) ? char : map[char] || "0";
      })
      .join("")
      .padStart(6, "0")
      .slice(0, 6);
  }

  function buildTicketId() {
    return "lottery_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function purchaseTicket(numbers) {
    var player = getPlayer();
    var lottery = getLottery();
    var validation = validateNumbers(numbers);
    var ticketPrice = getConfig().ticketPrice;
    var drawState;
    var ticket;

    syncCurrentDrawDate(getNow(), "action");

    if (!validation.ok) {
      return validation;
    }
    if (player.gold < ticketPrice) {
      return { ok: false, message: t("lottery_not_enough_gold", { amount: ticketPrice }) };
    }

    drawState = ensureDrawState(lottery.currentDrawDate);
    ticket = {
      id: buildTicketId(),
      drawDate: lottery.currentDrawDate,
      numbers: validation.numbers,
      purchaseUtcTime: getCurrentUtcTimestamp(),
      status: "pending",
      payout: 0,
      resolved: false,
    };

    player.gold -= ticketPrice;
    player.totalSpend += ticketPrice;
    lottery.tickets.push(ticket);
    drawState.ticketSales += ticketPrice;
    addUnresolvedDrawDate(lottery.currentDrawDate);
    normalizeDrawStateChain();

    return {
      ok: true,
      forceSave: true,
      messages: [
        t("lottery_ticket_bought", {
          numbers: validation.numbers,
          date: lottery.currentDrawDate,
          price: ticketPrice,
        }),
        t("lottery_jackpot_added", { amount: ticketPrice }),
      ],
    };
  }

  function purchaseRandomTickets(count) {
    var total = Math.max(1, Number(count || 1));
    var totalCost = total * getConfig().ticketPrice;
    var purchased = [];
    var result;
    var index;

    if (getPlayer().gold < totalCost) {
      return { ok: false, message: t("lottery_not_enough_gold", { amount: totalCost }) };
    }

    for (index = 0; index < total; index += 1) {
      game.state.lotteryDraftDigits = randomDigits();
      result = purchaseTicket(getDraftNumber());
      if (!result.ok) {
        return result;
      }
      purchased.push(getDraftNumber());
    }

    return {
      ok: true,
      forceSave: true,
      messages: [
        t("lottery_random_bulk_bought", {
          count: total,
          amount: totalCost,
        }),
      ],
    };
  }

  function getCurrentDrawTickets() {
    return getTicketsForDraw(getLottery().currentDrawDate)
      .slice()
      .sort(function (left, right) {
        return right.purchaseUtcTime.localeCompare(left.purchaseUtcTime);
      });
  }

  function getPendingPastDrawDates() {
    return getLottery().unresolvedDrawDates.filter(function (drawDate) {
      return drawDate < getLottery().currentDrawDate;
    });
  }

  function getRecentHistory() {
    return getLottery().drawHistory
      .slice()
      .sort(function (left, right) {
        return right.drawDate.localeCompare(left.drawDate);
      })
      .slice(0, 6);
  }

  function getTicketHistoryDrawDates() {
    var seen = {};

    return getLottery().tickets
      .map(function (ticket) {
        return String(ticket.drawDate || "");
      })
      .filter(function (drawDate) {
        if (!drawDate || seen[drawDate]) {
          return false;
        }
        seen[drawDate] = true;
        return true;
      })
      .sort(function (left, right) {
        return right.localeCompare(left);
      });
  }

  function getTicketHistoryDetails(drawDate) {
    var safeDrawDate = drawDate || "";
    var historyEntry = getHistoryEntry(safeDrawDate);
    var currentDrawDate = getLottery().currentDrawDate;

    return {
      drawDate: safeDrawDate,
      tickets: getTicketsForDraw(safeDrawDate)
        .slice()
        .sort(function (left, right) {
          return right.purchaseUtcTime.localeCompare(left.purchaseUtcTime);
        }),
      historyEntry: historyEntry,
      isCurrentDraw: safeDrawDate === currentDrawDate,
      isPending: !historyEntry && safeDrawDate !== currentDrawDate,
      winningNumber: historyEntry ? historyEntry.winningNumber : "",
      sourceBlockHash: historyEntry ? historyEntry.sourceBlockHash : "",
      sourceBlockHeight: historyEntry ? historyEntry.sourceBlockHeight : null,
    };
  }

  function getPrizeRules() {
    return [
      { key: "first_prize", matches: 6, reward: "jackpot" },
      { key: "second_prize", matches: 5, reward: getFixedPrizeReward("second_prize") },
      { key: "third_prize", matches: 4, reward: getFixedPrizeReward("third_prize") },
      { key: "fourth_prize", matches: 3, reward: getFixedPrizeReward("fourth_prize") },
      { key: "fifth_prize", matches: 2, reward: getFixedPrizeReward("fifth_prize") },
    ];
  }

  function resolveWinningSource(drawDate) {
    var existing = getHistoryEntry(drawDate);

    if (existing && existing.winningNumber && existing.sourceBlockHash) {
      return Promise.resolve({
        drawDate: drawDate,
        winningNumber: existing.winningNumber,
        sourceBlockHash: existing.sourceBlockHash,
        sourceBlockHeight: existing.sourceBlockHeight,
      });
    }

    return game.utils.bitcoinApi.findFirstBlockAtOrAfter(drawDate).then(function (block) {
      if (!block || !block.hash) {
        throw new Error("Malformed block data");
      }

      return {
        drawDate: drawDate,
        winningNumber: convertHashToWinningNumber(block.hash),
        sourceBlockHash: block.hash,
        sourceBlockHeight: block.height === undefined ? null : block.height,
      };
    });
  }

  function summarizePrizeCounts(counts) {
    return ["first_prize", "second_prize", "third_prize", "fourth_prize", "fifth_prize"]
      .filter(function (status) {
        return counts[status] > 0;
      })
      .map(function (status) {
        return t("lottery_prize_count_line", {
          prize: t("lottery_" + status),
          count: counts[status],
        });
      });
  }

  function resolveDraw(drawDate) {
    var lottery = getLottery();
    var drawState = ensureDrawState(drawDate);
    var historyEntry = getHistoryEntry(drawDate);
    var tickets = getTicketsForDraw(drawDate).filter(function (ticket) {
      return !ticket.resolved;
    });

    if (historyEntry || !tickets.length) {
      removeUnresolvedDrawDate(drawDate);
      return Promise.resolve({ changed: false, messages: [] });
    }

    return resolveWinningSource(drawDate).then(function (source) {
      var jackpotPoolForDraw = computeJackpotForDraw(drawState);
      var firstPrizeTickets = [];
      var prizeCounts = {};
      var totalPayout = 0;
      var jackpotPayoutPerTicket = 0;

      tickets.forEach(function (ticket) {
        var matchCount = countExactMatches(ticket.numbers, source.winningNumber);
        var status = getPrizeStatus(matchCount);
        prizeCounts[status] = (prizeCounts[status] || 0) + 1;

        if (status === "first_prize") {
          firstPrizeTickets.push(ticket);
          return;
        }

        ticket.status = status;
        ticket.payout = getFixedPrizeReward(status);
        ticket.resolved = true;
        if (ticket.payout > 0) {
          totalPayout += ticket.payout;
        }
      });

      if (firstPrizeTickets.length > 0) {
        jackpotPayoutPerTicket = Math.floor(jackpotPoolForDraw / firstPrizeTickets.length);
        firstPrizeTickets.forEach(function (ticket) {
          ticket.status = "first_prize";
          ticket.payout = jackpotPayoutPerTicket;
          ticket.resolved = true;
          totalPayout += jackpotPayoutPerTicket;
        });
      }

      drawState.resolved = true;
      drawState.jackpotWasHit = firstPrizeTickets.length > 0;

      lottery.drawHistory.push({
        drawDate: drawDate,
        winningNumber: source.winningNumber,
        sourceBlockHash: source.sourceBlockHash,
        sourceBlockHeight: source.sourceBlockHeight,
        resolvedAtUtc: getCurrentUtcTimestamp(),
        firstPrizeWinners: firstPrizeTickets.length,
        jackpotPayoutPerTicket: jackpotPayoutPerTicket,
        jackpotWasHit: firstPrizeTickets.length > 0,
      });

      if (totalPayout > 0) {
        getPlayer().gold += totalPayout;
        getPlayer().totalIncome += totalPayout;
      }

      removeUnresolvedDrawDate(drawDate);
      normalizeDrawStateChain();

      lottery.lastResultSummary = {
        drawDate: drawDate,
        winningNumber: source.winningNumber,
        sourceBlockHash: source.sourceBlockHash,
        sourceBlockHeight: source.sourceBlockHeight,
        ticketsPurchased: tickets.length,
        totalPayout: totalPayout,
        jackpotWasHit: firstPrizeTickets.length > 0,
        currentJackpotPool: lottery.jackpotPool,
        prizeCounts: prizeCounts,
      };

      var messages = [
        t("lottery_draw_resolved", { date: drawDate }),
        t("lottery_winning_number", { numbers: source.winningNumber }),
        t("lottery_ticket_count", { count: tickets.length }),
      ].concat(summarizePrizeCounts(prizeCounts));

      messages.push(
        t("lottery_payout_total", { amount: totalPayout })
      );
      messages.push(
        firstPrizeTickets.length > 0
          ? t("lottery_jackpot_hit_summary", {
              count: firstPrizeTickets.length,
              amount: jackpotPayoutPerTicket,
            })
          : t("lottery_jackpot_rollover_summary", {
              amount: lottery.jackpotPool,
            })
      );

      return {
        changed: true,
        messages: messages,
      };
    }).catch(function (error) {
      addUnresolvedDrawDate(drawDate);
      return {
        changed: false,
        messages: [
          t("lottery_pending_draw_notice", { date: drawDate }),
        ],
      };
    });
  }

  function resolvePendingDraws(source) {
    var lottery = getLottery();
    var nowMs = Date.now();
    var drawDates;
    var results = { changed: false, messages: [] };

    syncCurrentDrawDate(getNow(), source);
    normalizeDrawStateChain();

    if (resolving) {
      return Promise.resolve({ changed: false, messages: [] });
    }
    if (nowMs - lastResolveAttemptAt < getConfig().retryCooldownMs && source === "timer") {
      return Promise.resolve({ changed: false, messages: [] });
    }

    drawDates = lottery.unresolvedDrawDates.filter(function (drawDate) {
      return drawDate < lottery.currentDrawDate;
    });

    if (!drawDates.length) {
      return Promise.resolve({ changed: false, messages: [] });
    }

    resolving = true;
    lastResolveAttemptAt = nowMs;

    return drawDates.reduce(function (chain, drawDate) {
      return chain.then(function () {
        return resolveDraw(drawDate).then(function (result) {
          results.changed = results.changed || result.changed;
          results.messages = results.messages.concat(result.messages || []);
        });
      });
    }, Promise.resolve()).then(function () {
      resolving = false;
      return results;
    }).catch(function (error) {
      resolving = false;
      return {
        changed: false,
        messages: [t("lottery_resolve_failed")],
      };
    });
  }

  game.systems.lotterySystem = {
    getLottery: getLottery,
    getDraftDigits: getDraftDigits,
    getDraftNumber: getDraftNumber,
    setDraftDigit: setDraftDigit,
    randomizeDraft: randomizeDraft,
    getCurrentUtcDrawDate: getCurrentUtcDrawDate,
    getNextDrawInfo: getNextDrawInfo,
    syncCurrentDrawDate: syncCurrentDrawDate,
    getCurrentDrawTickets: getCurrentDrawTickets,
    getPendingPastDrawDates: getPendingPastDrawDates,
    getRecentHistory: getRecentHistory,
    getTicketHistoryDrawDates: getTicketHistoryDrawDates,
    getTicketHistoryDetails: getTicketHistoryDetails,
    getPrizeRules: getPrizeRules,
    purchaseTicket: purchaseTicket,
    purchaseRandomTickets: purchaseRandomTickets,
    resolvePendingDraws: resolvePendingDraws,
  };
})(window.CatGame);
