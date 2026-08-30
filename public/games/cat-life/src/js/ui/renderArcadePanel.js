(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;

  function renderPaytable() {
    return game.systems.arcadeSystem.symbols
      .map(function (symbol) {
        return (
          '<div class="notice-item"><p><strong>' +
          symbol.icon +
          " " +
          t(symbol.nameKey) +
          '</strong></p><p>' +
          t("slot_three_match", { value: symbol.multiplier }) +
          "</p></div>"
        );
      })
      .join("");
  }

  function renderWinningDigits(numbers) {
    return String(numbers || "")
      .split("")
      .map(function (digit) {
        return '<span class="lottery-winning-digit">' + format.escapeHtml(digit) + "</span>";
      })
      .join("");
  }

  function renderArcadePanel(state) {
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
    var lastSummary = lottery.lastResultSummary;
    var selectedHistoryDrawDate = ticketHistoryDrawDates.indexOf(game.state.lotteryHistoryDrawDate) >= 0
      ? game.state.lotteryHistoryDrawDate
      : (ticketHistoryDrawDates[0] || "");
    var historyDetails = selectedHistoryDrawDate
      ? game.systems.lotterySystem.getTicketHistoryDetails(selectedHistoryDrawDate)
      : null;
    var hasPendingHistory = pendingDrawDates.length > 0;
    var latestWinningKey = lastSummary
      ? [lastSummary.drawDate, lastSummary.winningNumber, lastSummary.totalPayout].join(":")
      : "";
    var isCelebrating = Boolean(
      lastSummary &&
      game.state.lotteryCelebration &&
      game.state.lotteryCelebration.key === latestWinningKey &&
      game.state.lotteryCelebration.endsAt > Date.now()
    );
    var bets = game.config.slotBets
      .map(function (bet) {
        return (
          '<button class="primary-button" data-slot-bet="' +
          bet +
          '" ' +
          (activeSpin ? "disabled" : "") +
          ">" +
          t("slot_spin_bet", { amount: bet }) +
          "</button>"
        );
      })
      .join("");
    var lotteryDigits = draftDigits
      .map(function (digit, index) {
        var options = Array.apply(null, { length: 10 })
          .map(function (_, number) {
            return (
              '<option value="' +
              number +
              '" ' +
              (String(number) === String(digit) ? "selected" : "") +
              ">" +
              number +
              "</option>"
            );
          })
          .join("");

        return (
          '<select class="field lottery-digit-select" data-lottery-digit-index="' +
          index +
          '">' +
          options +
          "</select>"
        );
      })
      .join("");
    var ticketList = currentTickets.length
      ? currentTickets
          .map(function (ticket) {
            return (
              '<div class="notice-item"><p><strong>' +
              format.escapeHtml(ticket.numbers) +
              '</strong></p><p>' +
              t("lottery_ticket_time", { time: format.formatRealDateTime(ticket.purchaseUtcTime) }) +
              "</p></div>"
            );
          })
          .join("")
      : '<div class="empty-state">' + t("lottery_no_tickets") + "</div>";
    var pendingList = pendingDrawDates.length
      ? pendingDrawDates
          .map(function (drawDate) {
            return '<div class="notice-item"><p><strong>' + format.escapeHtml(drawDate) + " UTC</strong></p><p>" + t("lottery_pending_draw_card") + "</p></div>";
          })
          .join("")
      : '<div class="empty-state">' + t("lottery_no_pending_draws") + "</div>";
    var historyList = recentHistory.length
      ? recentHistory
          .map(function (entry) {
            return (
              '<div class="notice-item"><p><strong>' +
              format.escapeHtml(entry.drawDate) +
              " UTC · " +
              format.escapeHtml(entry.winningNumber) +
              '</strong></p><p>' +
              t(entry.jackpotWasHit ? "lottery_history_hit" : "lottery_history_rollover", {
                amount: entry.jackpotPayoutPerTicket || 0,
                count: entry.firstPrizeWinners || 0,
              }) +
              '</p><p class="helper-text" style="margin-top: 6px;">' +
              t("lottery_history_block", {
                hash: format.escapeHtml(String(entry.sourceBlockHash || "").slice(0, 18)),
                height: entry.sourceBlockHeight === null ? "?" : entry.sourceBlockHeight,
              }) +
              "</p></div>"
            );
          })
          .join("")
      : '<div class="empty-state">' + t("lottery_no_history") + "</div>";
    var ticketHistoryOptions = ticketHistoryDrawDates.length
      ? ticketHistoryDrawDates
          .map(function (drawDate) {
            return (
              '<option value="' +
              format.escapeHtml(drawDate) +
              '" ' +
              (drawDate === selectedHistoryDrawDate ? "selected" : "") +
              ">" +
              format.escapeHtml(drawDate) +
              " UTC</option>"
            );
          })
          .join("")
      : "";
    var ticketHistoryList = historyDetails && historyDetails.tickets.length
      ? historyDetails.tickets
          .map(function (ticket) {
            var statusKey = ticket.resolved
              ? ("lottery_" + ticket.status)
              : "lottery_history_status_pending";

            return (
              '<div class="notice-item"><p><strong>' +
              format.escapeHtml(ticket.numbers) +
              '</strong></p><p>' +
              t("lottery_ticket_time", { time: format.formatRealDateTime(ticket.purchaseUtcTime) }) +
              '</p><p class="helper-text" style="margin-top: 6px;">' +
              t("lottery_history_ticket_status", { status: t(statusKey) }) +
              '</p>' +
              (ticket.resolved
                ? '<p class="helper-text" style="margin-top: 4px;">' +
                  t("lottery_history_ticket_payout", { amount: ticket.payout || 0 }) +
                  "</p>"
                : '<p class="helper-text" style="margin-top: 4px;">' +
                  t("lottery_history_ticket_pending") +
                  "</p>") +
              "</div>"
            );
          })
          .join("")
      : '<div class="empty-state">' + t(historyDetails ? "lottery_history_ticket_empty" : "lottery_history_query_empty") + "</div>";
    var ticketHistoryMeta = historyDetails
      ? '<div class="notice-list" style="margin-top: 16px;">' +
        '<div class="notice-item"><p><strong>' + t("lottery_current_draw") + '</strong></p><p>' +
        format.escapeHtml(historyDetails.drawDate) + " UTC</p></div>" +
        '<div class="notice-item"><p><strong>' + t("lottery_result_summary_title") + '</strong></p><p>' +
        t(
          historyDetails.isCurrentDraw
            ? "lottery_history_status_current"
            : historyDetails.historyEntry
            ? "lottery_history_status_resolved"
            : "lottery_history_status_pending"
        ) +
        "</p></div>" +
        (historyDetails.historyEntry
          ? '<div class="notice-item"><p><strong>' + t("lottery_winning_number", { numbers: historyDetails.winningNumber }) + '</strong></p><p>' +
            t("lottery_history_block", {
              hash: format.escapeHtml(String(historyDetails.sourceBlockHash || "").slice(0, 18)),
              height: historyDetails.sourceBlockHeight === null ? "?" : historyDetails.sourceBlockHeight,
            }) +
            "</p></div>"
          : "") +
        "</div>"
      : "";
    var prizeRuleList = prizeRules
      .map(function (rule) {
        return (
          '<div class="notice-item"><p><strong>' +
          t("lottery_" + rule.key) +
          "</strong></p><p>" +
          t("lottery_rule_line", {
            matches: rule.matches,
            reward:
              rule.reward === "jackpot"
                ? t("lottery_jackpot_label")
                : format.formatNumber(rule.reward) + " " + t("gold_unit"),
          }) +
          "</p></div>"
        );
      })
      .join("");

    return (
      '<section class="page-header">' +
      '<div class="page-card arcade-hero-card">' +
      '<p class="section-eyebrow">' + t("page_arcade") + "</p>" +
      '<h2 class="page-title">' + t("arcade_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("arcade_panel_copy") + "</p>" +
      '<div class="inline-row" style="margin-top:18px; flex-wrap: wrap;">' +
      bets +
      "</div></div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("arcade_stats") + "</p>" +
      '<div class="notice-list" style="margin-top: 12px;">' +
      '<div class="notice-item"><p><strong>' + t("arcade_spins") + "</strong></p><p>" + state.player.arcadeSpins + "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("arcade_jackpots") + "</strong></p><p>" + state.player.arcadeJackpots + "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("arcade_best_win") + "</strong></p><p>" + state.player.arcadeBestWin + " " + t("gold_unit") + "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("arcade_profit") + "</strong></p><p>" +
      (state.player.arcadeTotalWon - state.player.arcadeTotalSpent) +
      " " +
      t("gold_unit") +
      "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("lottery_jackpot_pool") + "</strong></p><p>" +
      format.formatNumber(lottery.jackpotPool) +
      " " +
      t("gold_unit") +
      "</p></div></div></div></section>" +
      '<section class="home-grid">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("slot_machine") + '</p><h3 class="panel-title">' + t("slot_machine_title") + "</h3>" +
      '<div class="slot-machine' +
      (activeSpin ? " is-spinning" : "") +
      '" style="margin-top: 16px;">' +
      [0, 1, 2]
        .map(function (index) {
          var displayIcon = lastSpin ? lastSpin.reels[index] : index === 0 ? "⭐" : index === 1 ? "🐱" : "7️⃣";
          var spinColumn = activeSpin && activeSpin.columns ? activeSpin.columns[index] : null;

          if (spinColumn) {
            return '<div class="slot-window is-animated"><div class="slot-reel-viewport"><div class="slot-reel-strip">' +
              spinColumn
                .map(function (icon) {
                  return '<span class="slot-symbol">' + icon + "</span>";
                })
                .join("") +
              "</div></div></div>";
          }

          return '<div class="slot-window"><span class="slot-symbol">' + displayIcon + "</span></div>";
        })
        .join("") +
      "</div>" +
      '<p class="helper-text" style="margin-top: 14px;">' +
      (activeSpin
        ? t("slot_spinning")
        : lastSpin
        ? t(lastSpin.resultKey, { payout: lastSpin.payout, bet: lastSpin.bet })
        : t("slot_intro")) +
      "</p>" +
      (lastSpin
        ? '<p class="helper-text" style="margin-top: 8px;">' + t("last_played_at", { time: format.formatRealDateTime(lastSpin.playedAt) }) + "</p>"
        : "") +
      '<div class="inline-row" style="margin-top: 16px; flex-wrap: wrap;">' + bets + "</div></div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("lottery_title") + '</p><h3 class="panel-title">' + t("lottery_panel_title") + "</h3>" +
      '<p class="page-copy">' + t("lottery_panel_copy") + "</p>" +
      '<div class="lottery-latest-card' + (isCelebrating ? " is-celebrating" : "") + '" style="margin-top: 16px;">' +
      '<div class="inline-row" style="justify-content: space-between; align-items: flex-start; gap: 12px;">' +
      '<div><p class="section-eyebrow">' + t("lottery_latest_result_title") + '</p><h4 class="panel-title">' +
      (lastSummary
        ? t("lottery_latest_result_draw", { date: lastSummary.drawDate })
        : t("lottery_latest_result_title")) +
      '</h4></div>' +
      (isCelebrating
        ? '<span class="status-pill is-warning">' + t("lottery_win_flash") + "</span>"
        : "") +
      "</div>" +
      (lastSummary
        ? '<div class="lottery-winning-number">' +
          renderWinningDigits(lastSummary.winningNumber) +
          '</div><p class="helper-text" style="margin-top: 10px;">' +
          t("lottery_latest_result_copy") +
          '</p><p class="helper-text" style="margin-top: 8px;">' +
          t("lottery_history_block", {
            hash: format.escapeHtml(String(lastSummary.sourceBlockHash || "").slice(0, 18)),
            height: lastSummary.sourceBlockHeight === null ? "?" : lastSummary.sourceBlockHeight,
          }) +
          "</p>"
        : '<div class="empty-state" style="margin-top: 12px;">' +
          t(hasPendingHistory ? "lottery_latest_result_pending" : "lottery_latest_result_empty") +
          "</div>") +
      "</div>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      '<div class="notice-item"><p><strong>' + t("lottery_current_draw") + '</strong></p><p>' + format.escapeHtml(lottery.currentDrawDate) + " UTC</p></div>" +
      '<div class="notice-item"><p><strong>' + t("lottery_next_draw") + '</strong></p><p>' + format.escapeHtml(nextDrawInfo.nextDrawDate) + ' UTC · <span data-lottery-next-draw-countdown>' + format.formatDuration(nextDrawInfo.countdownMs) + "</span></p></div>" +
      '<div class="notice-item"><p><strong>' + t("lottery_ticket_price") + '</strong></p><p>' + game.config.lottery.ticketPrice + " " + t("gold_unit") + "</p></div>" +
      '<div class="notice-item"><p><strong>' + t("lottery_local_pool") + '</strong></p><p>' + t("lottery_local_pool_copy") + "</p></div>" +
      "</div></div></section>" +
      '<section class="home-grid">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("lottery_select_numbers") + '</p><h3 class="panel-title">' + t("lottery_number_picker_title") + "</h3>" +
      '<div class="lottery-digit-row" style="margin-top: 16px;">' +
      lotteryDigits +
      "</div>" +
      '<p class="helper-text" style="margin-top: 12px;">' + t("lottery_digits_rule_copy") + "</p>" +
      '<div class="button-cloud" style="margin-top: 16px;">' +
      '<button class="secondary-button" data-lottery-action="randomize">' + t("lottery_random_button") + "</button>" +
      '<button class="primary-button" data-lottery-action="buy-current">' + t("lottery_buy_current", { amount: game.config.lottery.ticketPrice }) + "</button>" +
      '<button class="ghost-button" data-lottery-action="buy-random" data-lottery-count="1">' + t("lottery_buy_random_one") + "</button>" +
      '<button class="ghost-button" data-lottery-action="buy-random" data-lottery-count="5">' + t("lottery_buy_random_five") + "</button>" +
      "</div>" +
      '<p class="helper-text" style="margin-top: 12px;">' + t("lottery_draft_preview", { numbers: game.systems.lotterySystem.getDraftNumber() }) + "</p>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("lottery_prize_rules") + '</p><h3 class="panel-title">' + t("lottery_prize_title") + "</h3>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      prizeRuleList +
      '<div class="notice-item"><p><strong>' + t("lottery_hash_rule_title") + '</strong></p><p>' + t("lottery_hash_rule_copy") + "</p></div>" +
      "</div></div></section>" +
      '<section class="home-grid">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("lottery_current_tickets") + '</p><h3 class="panel-title">' + t("lottery_ticket_list_title") + "</h3>" +
      '<div class="notice-list" style="margin-top: 16px;">' + ticketList + "</div>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("lottery_pending_title") + '</p><h3 class="panel-title">' + t("lottery_pending_panel_title") + "</h3>" +
      '<div class="notice-list" style="margin-top: 16px;">' + pendingList + "</div>" +
      '<div class="inline-row" style="margin-top: 16px;"><button class="secondary-button" data-lottery-action="retry">' + t("lottery_retry_button") + "</button></div>" +
      "</div></section>" +
      '<section class="home-grid">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("lottery_recent_history") + '</p><h3 class="panel-title">' + t("lottery_history_title") + "</h3>" +
      '<div class="notice-list" style="margin-top: 16px;">' + historyList + "</div>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("lottery_result_summary_title") + '</p><h3 class="panel-title">' + t("lottery_result_summary_title") + "</h3>" +
      (lastSummary
        ? '<div class="notice-list' + (isCelebrating ? " lottery-summary-celebrate" : "") + '" style="margin-top: 16px;">' +
          '<div class="notice-item"><p><strong>' + format.escapeHtml(lastSummary.drawDate) + ' UTC</strong></p><p>' +
          t("lottery_winning_number", { numbers: lastSummary.winningNumber }) +
          '</p><p style="margin-top: 6px;">' + t("lottery_payout_total", { amount: lastSummary.totalPayout }) + "</p></div>" +
          '<div class="notice-item"><p><strong>' + t("lottery_history_block", {
            hash: format.escapeHtml(String(lastSummary.sourceBlockHash || "").slice(0, 18)),
            height: lastSummary.sourceBlockHeight === null ? "?" : lastSummary.sourceBlockHeight,
          }) + '</strong></p><p>' +
          (lastSummary.jackpotWasHit
            ? t("lottery_jackpot_hit_summary", {
                count: lastSummary.prizeCounts.first_prize || 0,
                amount: lastSummary.totalPayout,
              })
            : t("lottery_jackpot_rollover_summary", {
                amount: lastSummary.currentJackpotPool,
              })) +
          "</p></div></div>"
        : '<div class="empty-state" style="margin-top: 16px;">' + t("lottery_no_summary") + "</div>") +
      "</div></section>" +
      '<section class="home-grid">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("lottery_ticket_history") + '</p><h3 class="panel-title">' + t("lottery_ticket_history_title") + "</h3>" +
      '<p class="page-copy">' + t("lottery_ticket_history_copy") + "</p>" +
      (ticketHistoryDrawDates.length
        ? '<label class="field-label" style="margin-top: 16px; display: block;">' + t("lottery_history_select_label") + '</label>' +
          '<select class="field" data-lottery-history-draw style="margin-top: 8px;">' + ticketHistoryOptions + "</select>" +
          ticketHistoryMeta
        : '<div class="empty-state" style="margin-top: 16px;">' + t("lottery_history_query_empty") + "</div>") +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("lottery_ticket_history") + '</p><h3 class="panel-title">' + t("lottery_ticket_list_title") + "</h3>" +
      '<div class="notice-list" style="margin-top: 16px;">' + ticketHistoryList + "</div>" +
      "</div></section>" +
      '<section class="page-card">' +
      '<p class="section-eyebrow">' + t("slot_paytable") + '</p><h3 class="panel-title">' + t("slot_rules_title") + "</h3>" +
      '<div class="notice-list" style="margin-top: 16px;">' +
      renderPaytable() +
      '<div class="notice-item"><p><strong>' + t("slot_special_bonus") + '</strong></p><p>' + t("slot_special_bonus_copy") + "</p></div>" +
      "</div></section>"
    );
  }

  game.ui.renderArcadePanel = renderArcadePanel;
})(window.CatGame);
