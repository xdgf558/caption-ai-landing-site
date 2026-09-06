(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;

  function escape(value) {
    return format.escapeHtml(String(value === undefined || value === null ? "" : value));
  }

  function number(value) {
    return format.formatNumber(Number(value || 0));
  }

  function getArcadeAssetUrl(path) {
    return new URL(path, document.baseURI).href;
  }

  function getActiveView() {
    return game.state.arcadeView === "lottery" ? "lottery" : "slot";
  }

  function getActiveBet() {
    var configuredBets = game.config.slotBets || [20];
    var savedBet = Number(game.state.arcadeBet || configuredBets[0]);
    return configuredBets.indexOf(savedBet) >= 0 ? savedBet : configuredBets[0];
  }

  function renderPaytable() {
    return game.systems.arcadeSystem.symbols
      .map(function (symbol) {
        return (
          '<div class="arcade-rule-row"><span class="arcade-rule-symbol" aria-hidden="true">' +
          escape(symbol.icon) +
          '</span><div><strong>' +
          t(symbol.nameKey) +
          '</strong><p>' +
          t("slot_three_match", { value: symbol.multiplier }) +
          "</p></div></div>"
        );
      })
      .join("");
  }

  function renderWinningDigits(numbers) {
    return String(numbers || "")
      .split("")
      .map(function (digit) {
        return '<span class="lottery-winning-digit">' + escape(digit) + "</span>";
      })
      .join("");
  }

  function renderDraftDigits(draftDigits) {
    return draftDigits
      .map(function (digit) {
        return '<span class="arcade-draft-digit">' + escape(digit) + "</span>";
      })
      .join("");
  }

  function renderSlotSymbol(icon) {
    return '<span class="slot-symbol" aria-hidden="true">' + escape(icon) + "</span>";
  }

  function renderSlotReel(index, lastSpin, activeSpin) {
    var symbols = game.systems.arcadeSystem.symbols;
    var fallbackIcon = symbols[index % symbols.length].icon;
    var displayIcon = lastSpin && lastSpin.reels && lastSpin.reels[index]
      ? lastSpin.reels[index]
      : fallbackIcon;
    var spinColumn = activeSpin && activeSpin.columns ? activeSpin.columns[index] : null;

    if (spinColumn) {
      return '<div class="slot-window is-animated" aria-label="' + escape(t("slot_spinning")) + '"><div class="slot-reel-viewport"><div class="slot-reel-strip">' +
        spinColumn.map(renderSlotSymbol).join("") +
        "</div></div></div>";
    }

    return '<div class="slot-window" aria-label="' + escape(t("slot_reel_result", {
      reel1: index === 0 ? displayIcon : "",
      reel2: index === 1 ? displayIcon : "",
      reel3: index === 2 ? displayIcon : "",
    })) + '">' + renderSlotSymbol(displayIcon) + "</div>";
  }

  function renderBetSelector(activeSpin) {
    var activeBet = getActiveBet();
    return '<div class="arcade-bet-selector" role="group" aria-label="' + escape(t("arcade_current_bet")) + '">' +
      (game.config.slotBets || [])
        .map(function (bet) {
          var selected = Number(bet) === activeBet;
          return '<button class="arcade-bet-button' + (selected ? " is-selected" : "") + '" data-slot-bet="' +
            bet + '" aria-pressed="' + (selected ? "true" : "false") + '"' + (activeSpin ? " disabled" : "") + '>' +
            '<span>' + number(bet) + '</span><small>' + t("gold_unit") + "</small></button>";
        })
        .join("") +
      "</div>";
  }

  function renderLotteryDigits(draftDigits) {
    return draftDigits
      .map(function (digit, index) {
        var options = Array.apply(null, { length: 10 })
          .map(function (_, value) {
            return '<option value="' + value + '" ' +
              (String(value) === String(digit) ? "selected" : "") + ">" + value + "</option>";
          })
          .join("");

        return '<label class="lottery-digit-control"><span class="sr-only">' +
          escape(t("lottery_digit_label", { position: index + 1 })) +
          '</span><select id="lottery-digit-' + index + '" class="field lottery-digit-select" data-lottery-digit-index="' + index +
          '" aria-label="' + escape(t("lottery_digit_label", { position: index + 1 })) + '">' + options + "</select></label>";
      })
      .join("");
  }

  function renderMetric(label, value, meta, tone) {
    return '<div class="arcade-metric"><span>' + label + '</span><strong' +
      (tone ? ' class="' + tone + '"' : "") + '>' + value + "</strong>" +
      (meta ? '<small>' + meta + "</small>" : "") + "</div>";
  }

  function renderArcadeStats(state, currentTickets) {
    var player = state.player || {};
    var netProfit = Number(player.arcadeTotalWon || 0) - Number(player.arcadeTotalSpent || 0);
    var profitTone = netProfit > 0 ? "is-positive" : netProfit < 0 ? "is-negative" : "";
    return '<div class="arcade-stats-grid">' +
      renderMetric(t("arcade_spins"), number(player.arcadeSpins), t("arcade_recent_activity")) +
      renderMetric(t("arcade_jackpots"), number(player.arcadeJackpots), t("slot_symbol_seven")) +
      renderMetric(t("arcade_best_win"), number(player.arcadeBestWin), t("gold_unit")) +
      renderMetric(t("arcade_profit"), (netProfit > 0 ? "+" : "") + number(netProfit), t("gold_unit"), profitTone) +
      renderMetric(t("lottery_current_tickets"), number(currentTickets.length), t("lottery_current_draw")) +
      "</div>";
  }

  function renderArcadeSwitcher(activeView) {
    return '<div class="arcade-switcher-wrap"><span class="arcade-switcher-label">' + t("arcade_tab_label") +
      '</span><div class="arcade-switcher" role="tablist" aria-label="' + escape(t("arcade_tab_label")) + '">' +
      '<button id="arcade-tab-slot" class="arcade-tab' + (activeView === "slot" ? " is-active" : "") +
      '" data-arcade-view="slot" role="tab" aria-selected="' + (activeView === "slot" ? "true" : "false") +
      '" aria-controls="arcade-panel-slot"><strong>' + t("slot_machine") + '</strong><small>' + t("arcade_slot_tab_meta") + "</small></button>" +
      '<button id="arcade-tab-lottery" class="arcade-tab' + (activeView === "lottery" ? " is-active" : "") +
      '" data-arcade-view="lottery" role="tab" aria-selected="' + (activeView === "lottery" ? "true" : "false") +
      '" aria-controls="arcade-panel-lottery"><strong>' + t("lottery_title") + '</strong><small>' + t("arcade_lottery_tab_meta") + "</small></button>" +
      '</div><p class="arcade-switcher-hint">' + t("arcade_switcher_hint") + "</p></div>";
  }

  function renderLotterySnapshot(data) {
    return '<section class="arcade-rail-card arcade-lottery-snapshot">' +
      '<div class="arcade-card-heading"><div><span class="arcade-card-label">' + t("lottery_title") +
      '</span><h3>' + t("lottery_panel_title") + '</h3></div><button class="arcade-link-button" data-arcade-view="lottery">' +
      t("arcade_view_all") + "</button></div>" +
      '<p class="arcade-card-copy">' + t("arcade_lottery_snapshot_copy") + "</p>" +
      '<div class="arcade-jackpot-figure"><span>' + t("lottery_jackpot_pool") + '</span><strong>' +
      number(data.lottery.jackpotPool) + '</strong><small>' + t("gold_unit") + "</small></div>" +
      '<div class="arcade-draw-row"><div><span>' + t("lottery_next_draw") + '</span><strong>' +
      escape(data.nextDrawInfo.nextDrawDate) + ' UTC</strong></div><strong data-lottery-next-draw-countdown>' +
      format.formatDuration(data.nextDrawInfo.countdownMs) + "</strong></div>" +
      '<div class="arcade-draft-preview"><span>' + t("lottery_select_numbers") + '</span><div class="arcade-draft-digits">' +
      renderDraftDigits(data.draftDigits) + "</div></div>" +
      '<button class="primary-button arcade-rail-cta" data-arcade-view="lottery">' + t("arcade_switch_to_lottery") +
      '<span>' + game.config.lottery.ticketPrice + " " + t("gold_unit") + " / " + t("lottery_ticket_price") + "</span></button>" +
      '</section>';
  }

  function renderEmptyRecords() {
    var catAsset = game.utils.catArt && game.utils.catArt.getCatSpriteUrl
      ? game.utils.catArt.getCatSpriteUrl({ traits: { artKey: "orange_tabby" } })
      : getArcadeAssetUrl("src/assets/cats/orange-tabby.png");

    return '<div class="arcade-empty-records"><img src="' + catAsset + '" alt="' + escape(t("slot_symbol_cat")) +
      '"><strong>' + t("arcade_no_records_title") + '</strong><p>' + t("arcade_no_records_copy") + "</p></div>";
  }

  function renderRecordsRail(state, currentTickets, recentHistory, lastSpin) {
    var hasRecords = Boolean(Number(state.player.arcadeSpins || 0) || currentTickets.length || recentHistory.length || lastSpin);
    var lastSpinReels = lastSpin && Array.isArray(lastSpin.reels) ? lastSpin.reels : [];
    return '<section class="arcade-rail-card arcade-records-card"><div class="arcade-card-heading"><div><span class="arcade-card-label">' +
      t("arcade_recent_activity") + '</span><h3>' + t("arcade_my_records") + '</h3></div><button class="arcade-link-button" data-arcade-details>' +
      t("arcade_view_all") + "</button></div>" +
      (hasRecords
        ? '<div class="arcade-record-list">' +
          (lastSpin
            ? '<div class="arcade-record-row"><span>' + t("slot_machine") + '</span><strong>' +
              lastSpinReels.map(escape).join(" ") + '</strong><small>' +
              t(lastSpin.resultKey, { payout: number(lastSpin.payout), bet: number(lastSpin.bet) }) + "</small></div>"
            : "") +
          '<div class="arcade-record-row"><span>' + t("lottery_current_tickets") + '</span><strong>' +
          currentTickets.length + "</strong><small>" + t("lottery_current_draw") + "</small></div>" +
          (recentHistory[0]
            ? '<div class="arcade-record-row"><span>' + t("arcade_latest_result") + '</span><strong>' +
              escape(recentHistory[0].winningNumber) + '</strong><small>' + escape(recentHistory[0].drawDate) + " UTC</small></div>"
            : "") +
          "</div>"
        : renderEmptyRecords()) +
      renderArcadeStats(state, currentTickets) +
      "</section>";
  }

  function renderLatestResultCard(lastSummary, isCelebrating) {
    return '<section class="arcade-rail-card arcade-latest-result' + (isCelebrating ? " is-celebrating" : "") + '"><div class="arcade-card-heading"><div><span class="arcade-card-label">' +
      t("arcade_latest_result") + '</span><h3>' + t("lottery_latest_result_title") + '</h3></div>' +
      (isCelebrating ? '<span class="status-pill is-warning">' + t("lottery_win_flash") + "</span>" : "") +
      "</div>" +
      (lastSummary
        ? '<p class="arcade-result-date">' + t("lottery_latest_result_draw", { date: lastSummary.drawDate }) +
          '</p><div class="lottery-winning-number">' + renderWinningDigits(lastSummary.winningNumber) +
          '</div><p class="arcade-result-payout">' + t("lottery_payout_total", { amount: number(lastSummary.totalPayout) }) + "</p>"
        : '<div class="arcade-empty-result"><span aria-hidden="true">—</span><p>' + t("lottery_latest_result_empty") + "</p></div>") +
      "</section>";
  }

  function renderSlotWorkspace(data) {
    var activeSpin = data.activeSpin;
    var statusCopy = activeSpin
      ? t("slot_spinning")
      : data.lastSpin
      ? t(data.lastSpin.resultKey, { payout: number(data.lastSpin.payout), bet: number(data.lastSpin.bet) })
      : t("arcade_spin_status_copy");
    var statusLabel = activeSpin ? t("slot_spinning") : t("arcade_spin_status_ready");

    return '<div class="arcade-floor-grid"><section id="arcade-panel-slot" class="arcade-play-card arcade-slot-stage" role="tabpanel" aria-labelledby="arcade-tab-slot">' +
      '<div class="arcade-play-heading"><div><span class="arcade-card-label">' + t("slot_machine") +
      '</span><h3>' + t("slot_machine_title") + '</h3></div><span class="arcade-play-meta">' + t("slot_special_bonus") + "</span></div>" +
      '<div class="slot-machine-scene' + (activeSpin ? " is-spinning" : "") + '"><img class="slot-machine-art" src="' +
      getArcadeAssetUrl("src/assets/arcade/slot-machine-cabinet.webp") + '" alt="" width="1000" height="637" decoding="async"><div class="slot-reels">' +
      [0, 1, 2].map(function (index) { return renderSlotReel(index, data.lastSpin, activeSpin); }).join("") +
      '</div><div class="slot-machine-status" aria-live="polite"><span class="slot-status-dot"></span><span><strong>' + statusLabel +
      '</strong> ' + statusCopy + "</span></div></div>" +
      '<div class="arcade-control-deck"><div class="arcade-control-info"><span class="field-label">' + t("arcade_current_bet") +
      '</span><strong>' + number(data.activeBet) + ' ' + t("gold_unit") + '</strong><small>' + t("arcade_each_spin", { amount: number(data.activeBet) }) +
      '</small>' + renderBetSelector(activeSpin) + '</div><button class="primary-button arcade-spin-button" data-slot-spin' +
      (activeSpin ? " disabled" : "") + '><strong>' + t("arcade_spin_action") + '</strong><span>' + t("slot_spin_bet", { amount: number(data.activeBet) }) +
      '</span></button></div><p class="arcade-under-note">' + t("slot_intro") + '</p></section><aside class="arcade-rail">' +
      renderLotterySnapshot(data) + renderRecordsRail(data.state, data.currentTickets, data.recentHistory, data.lastSpin) +
      '</aside></div>';
  }

  function renderLotteryWorkspace(data) {
    return '<div class="arcade-floor-grid"><section id="arcade-panel-lottery" class="arcade-play-card arcade-lottery-workspace" role="tabpanel" aria-labelledby="arcade-tab-lottery">' +
      '<div class="arcade-play-heading"><div><span class="arcade-card-label">' + t("lottery_title") +
      '</span><h3>' + t("lottery_panel_title") + '</h3></div><span class="arcade-play-meta">' + t("lottery_ticket_price") + ": " +
      data.ticketPrice + " " + t("gold_unit") + '</span></div><p class="arcade-card-copy">' + t("lottery_panel_copy") + "</p>" +
      '<div class="lottery-live-summary"><div><span>' + t("lottery_current_draw") + '</span><strong>' + escape(data.lottery.currentDrawDate) +
      ' UTC</strong></div><div><span>' + t("lottery_next_draw") + '</span><strong data-lottery-next-draw-countdown>' +
      format.formatDuration(data.nextDrawInfo.countdownMs) + '</strong><small>' + escape(data.nextDrawInfo.nextDrawDate) + " UTC</small></div><div><span>" +
      t("lottery_jackpot_pool") + '</span><strong>' + number(data.lottery.jackpotPool) + "</strong><small>" + t("gold_unit") + "</small></div></div>" +
      '<div class="lottery-picker-block"><div class="arcade-play-heading"><div><span class="arcade-card-label">' + t("lottery_select_numbers") +
      '</span><h4>' + t("lottery_number_picker_title") + '</h4></div><span class="arcade-play-meta">' + t("lottery_digits_rule_copy") +
      '</span></div><div class="lottery-digit-row">' + renderLotteryDigits(data.draftDigits) + '</div><p class="helper-text">' +
      t("lottery_draft_preview", { numbers: data.draftDigits.join("") }) + '</p><div class="button-cloud lottery-action-row"><button class="primary-button" data-lottery-action="buy-current">' +
      t("lottery_buy_current", { amount: data.ticketPrice }) + '</button><button class="secondary-button" data-lottery-action="randomize">' +
      t("lottery_random_button") + '</button><button class="ghost-button" data-lottery-action="buy-random" data-lottery-count="1">' +
      t("lottery_buy_random_one") + '</button><button class="ghost-button" data-lottery-action="buy-random" data-lottery-count="5">' +
      t("lottery_buy_random_five") + "</button></div></div>" +
      '<div class="arcade-inline-list"><div class="arcade-section-heading"><div><span class="arcade-card-label">' + t("lottery_current_tickets") +
      '</span><h4>' + t("lottery_ticket_list_title") + '</h4></div><span>' + data.currentTickets.length + "</span></div>" +
      renderTicketList(data.currentTickets, true) + '</div></section><aside class="arcade-rail">' +
      renderLatestResultCard(data.lastSummary, data.isCelebrating) + renderRecordsRail(data.state, data.currentTickets, data.recentHistory, data.lastSpin) +
      '</aside></div>';
  }

  function renderTicketList(tickets, includeTime) {
    if (!tickets.length) {
      return '<div class="arcade-empty-inline">' + t("lottery_no_tickets") + "</div>";
    }

    return '<div class="arcade-ticket-list">' + tickets.map(function (ticket) {
      return '<div class="arcade-ticket-row"><strong>' + escape(ticket.numbers) + '</strong><span class="status-pill' +
        (ticket.resolved && ticket.payout > 0 ? " is-success" : "") + '">' +
        t(ticket.resolved ? "lottery_" + ticket.status : "lottery_history_status_pending") + '</span>' +
        (includeTime ? '<small>' + t("lottery_ticket_time", { time: format.formatRealDateTime(ticket.purchaseUtcTime) }) + "</small>" : "") +
        (ticket.resolved ? '<small>' + t("lottery_history_ticket_payout", { amount: number(ticket.payout) }) + "</small>" : "") +
        "</div>";
    }).join("") + "</div>";
  }

  function renderPendingList(pendingDrawDates) {
    if (!pendingDrawDates.length) {
      return '<div class="arcade-empty-inline">' + t("lottery_no_pending_draws") + "</div>";
    }

    return '<div class="arcade-ticket-list">' + pendingDrawDates.map(function (drawDate) {
      return '<div class="arcade-ticket-row"><strong>' + escape(drawDate) + ' UTC</strong><small>' +
        t("lottery_pending_draw_card") + "</small></div>";
    }).join("") + "</div>";
  }

  function renderHistoryList(recentHistory) {
    if (!recentHistory.length) {
      return '<div class="arcade-empty-inline">' + t("lottery_no_history") + "</div>";
    }

    return '<div class="arcade-ticket-list">' + recentHistory.map(function (entry) {
      return '<div class="arcade-ticket-row"><strong>' + escape(entry.drawDate) + ' UTC · ' + escape(entry.winningNumber) +
        '</strong><small>' + t(entry.jackpotWasHit ? "lottery_history_hit" : "lottery_history_rollover", {
          amount: number(entry.jackpotPayoutPerTicket || 0),
          count: entry.firstPrizeWinners || 0,
        }) + '</small><small>' + t("lottery_history_block", {
          hash: escape(String(entry.sourceBlockHash || "").slice(0, 18)),
          height: entry.sourceBlockHeight === null ? "?" : entry.sourceBlockHeight,
        }) + "</small></div>";
    }).join("") + "</div>";
  }

  function renderTicketHistory(data) {
    var ticketHistoryOptions = data.ticketHistoryDrawDates.map(function (drawDate) {
      return '<option value="' + escape(drawDate) + '" ' + (drawDate === data.selectedHistoryDrawDate ? "selected" : "") +
        '>' + escape(drawDate) + " UTC</option>";
    }).join("");
    var details = data.historyDetails;

    return '<section class="arcade-detail-section"><div class="arcade-section-heading"><div><span class="arcade-card-label">' +
      t("lottery_ticket_history") + '</span><h4>' + t("lottery_ticket_history_title") + '</h4></div></div><p class="helper-text">' +
      t("lottery_ticket_history_copy") + "</p>" +
      (data.ticketHistoryDrawDates.length
        ? '<label class="field-label arcade-history-label" for="lottery-history-draw">' + t("lottery_history_select_label") + '</label><select id="lottery-history-draw" class="field" data-lottery-history-draw>' +
          ticketHistoryOptions + '</select><div class="arcade-history-meta"><span>' + escape(details.drawDate) + ' UTC</span><span>' +
          t(details.isCurrentDraw ? "lottery_history_status_current" : details.historyEntry ? "lottery_history_status_resolved" : "lottery_history_status_pending") +
          '</span></div>' + renderTicketList(details.tickets, true)
        : '<div class="arcade-empty-inline">' + t("lottery_history_query_empty") + "</div>") +
      "</section>";
  }

  function renderArcadeDetails(data) {
    var lastSummary = data.lastSummary;
    return '<details class="arcade-details"><summary><span>' + t("arcade_rule_history") + '</span><span class="arcade-summary-mark" aria-hidden="true">＋</span></summary><div class="arcade-details-body">' +
      '<div class="arcade-details-grid"><section class="arcade-detail-section"><div class="arcade-section-heading"><div><span class="arcade-card-label">' +
      t("slot_paytable") + '</span><h4>' + t("slot_rules_title") + '</h4></div></div><div class="arcade-rule-list">' + renderPaytable() +
      '</div><div class="arcade-special-rule"><strong>' + t("slot_special_bonus") + '</strong><p>' + t("slot_special_bonus_copy") +
      '</p></div></section><section class="arcade-detail-section"><div class="arcade-section-heading"><div><span class="arcade-card-label">' +
      t("lottery_prize_rules") + '</span><h4>' + t("lottery_prize_title") + '</h4></div></div><div class="arcade-prize-list">' +
      data.prizeRules.map(function (rule) {
        return '<div><strong>' + t("lottery_" + rule.key) + '</strong><span>' + t("lottery_rule_line", {
          matches: rule.matches,
          reward: rule.reward === "jackpot" ? t("lottery_jackpot_label") : number(rule.reward) + " " + t("gold_unit"),
        }) + "</span></div>";
      }).join("") +
      '</div><div class="arcade-special-rule"><strong>' + t("lottery_hash_rule_title") + '</strong><p>' + t("lottery_hash_rule_copy") +
      "</p></div></section></div>" +
      '<div class="arcade-details-grid arcade-history-grid"><section class="arcade-detail-section"><div class="arcade-section-heading"><div><span class="arcade-card-label">' +
      t("lottery_pending_title") + '</span><h4>' + t("lottery_pending_panel_title") + '</h4></div><button class="secondary-button" data-lottery-action="retry">' +
      t("lottery_retry_button") + '</button></div>' + renderPendingList(data.pendingDrawDates) + '</section><section class="arcade-detail-section"><div class="arcade-section-heading"><div><span class="arcade-card-label">' +
      t("lottery_recent_history") + '</span><h4>' + t("lottery_history_title") + '</h4></div></div>' + renderHistoryList(data.recentHistory) + "</section></div>" +
      '<div class="arcade-details-grid"><section class="arcade-detail-section"><div class="arcade-section-heading"><div><span class="arcade-card-label">' +
      t("lottery_current_tickets") + '</span><h4>' + t("lottery_ticket_list_title") + '</h4></div></div>' + renderTicketList(data.currentTickets, true) +
      '</section><section class="arcade-detail-section"><div class="arcade-section-heading"><div><span class="arcade-card-label">' +
      t("lottery_result_summary_title") + '</span><h4>' + t("lottery_result_summary_title") + '</h4></div></div>' +
      (lastSummary
          ? '<div class="arcade-summary-copy"><strong>' + escape(lastSummary.drawDate) + ' UTC · ' + escape(lastSummary.winningNumber) + '</strong><p>' +
          t("lottery_payout_total", { amount: number(lastSummary.totalPayout) }) + '</p><p>' + (lastSummary.jackpotWasHit
            ? t("lottery_jackpot_hit_summary", { count: lastSummary.prizeCounts && lastSummary.prizeCounts.first_prize || 0, amount: number(lastSummary.totalPayout) })
            : t("lottery_jackpot_rollover_summary", { amount: number(lastSummary.currentJackpotPool) })) + "</p></div>"
        : '<div class="arcade-empty-inline">' + t("lottery_no_summary") + "</div>") +
      '</section></div>' + renderTicketHistory(data) +
      '</div></details>';
  }

  function renderArcadePanel(state) {
    var activeView = getActiveView();
    var lastSpin = state.home.arcadeLastSpin;
    var activeSpin = game.state.arcadeSpin;
    var lottery = game.systems.lotterySystem.getLottery();
    var nextDrawInfo = game.systems.lotterySystem.getNextDrawInfo();
    var draftDigits = game.systems.lotterySystem.getDraftDigits();
    var currentTickets = game.systems.lotterySystem.getCurrentDrawTickets();
    var pendingDrawDates = game.systems.lotterySystem.getPendingPastDrawDates();
    var recentHistory = game.systems.lotterySystem.getRecentHistory();
    var ticketHistoryDrawDates = game.systems.lotterySystem.getTicketHistoryDrawDates();
    var prizeRules = game.systems.lotterySystem.getPrizeRules();
    var selectedHistoryDrawDate = ticketHistoryDrawDates.indexOf(game.state.lotteryHistoryDrawDate) >= 0
      ? game.state.lotteryHistoryDrawDate
      : (ticketHistoryDrawDates[0] || "");
    var historyDetails = selectedHistoryDrawDate
      ? game.systems.lotterySystem.getTicketHistoryDetails(selectedHistoryDrawDate)
      : { drawDate: "", tickets: [], historyEntry: null, isCurrentDraw: false };
    var lastSummary = lottery.lastResultSummary;
    var latestWinningKey = lastSummary
      ? [lastSummary.drawDate, lastSummary.winningNumber, lastSummary.totalPayout].join(":")
      : "";
    var isCelebrating = Boolean(
      lastSummary &&
      game.state.lotteryCelebration &&
      game.state.lotteryCelebration.key === latestWinningKey &&
      game.state.lotteryCelebration.endsAt > Date.now()
    );
    var data = {
      state: state,
      lastSpin: lastSpin,
      activeSpin: activeSpin,
      activeBet: getActiveBet(),
      lottery: lottery,
      nextDrawInfo: nextDrawInfo,
      draftDigits: draftDigits,
      currentTickets: currentTickets,
      pendingDrawDates: pendingDrawDates,
      recentHistory: recentHistory,
      ticketHistoryDrawDates: ticketHistoryDrawDates,
      selectedHistoryDrawDate: selectedHistoryDrawDate,
      historyDetails: historyDetails,
      prizeRules: prizeRules,
      lastSummary: lastSummary,
      isCelebrating: isCelebrating,
      ticketPrice: game.config.lottery.ticketPrice,
    };

    return '<section class="arcade-page"><header class="arcade-page-header"><div><p class="section-eyebrow">' + t("page_arcade") +
      '</p><h2 class="page-title">' + t("arcade_panel_title") + '</h2><p class="page-copy">' + t("arcade_panel_copy") +
      '</p></div><div class="arcade-wallet"><span>' + t("gold") + '</span><strong>' + number(state.player.gold) + '</strong><small>' +
      t("gold_unit") + "</small></div></header>" + renderArcadeSwitcher(activeView) +
      (activeView === "lottery" ? renderLotteryWorkspace(data) : renderSlotWorkspace(data)) +
      renderArcadeDetails(data) +
      '</section>';
  }

  game.ui.renderArcadePanel = renderArcadePanel;
})(window.CatGame);
