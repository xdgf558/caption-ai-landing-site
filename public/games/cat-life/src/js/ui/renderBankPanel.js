(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var quickAmounts = game.config.bank.quickAmounts;

  function renderQuickButtons(action, inputId, maxAmount) {
    var buttons = quickAmounts
      .map(function (amount) {
        return (
          '<button class="chip-button" data-bank-action="' +
          action +
          '" data-bank-input="' +
          inputId +
          '" data-bank-amount="' +
          amount +
          '">' +
          amount +
          "</button>"
        );
      })
      .join("");

    if (maxAmount > 0) {
      buttons +=
        '<button class="chip-button" data-bank-action="' +
        action +
        '" data-bank-input="' +
        inputId +
        '" data-bank-amount="' +
        maxAmount +
        '">' +
        t("bank_max_button") +
        "</button>";
    }

    return buttons;
  }

  function renderActionCard(title, copy, inputId, action, confirmText, maxAmount) {
    return (
      '<div class="settings-card">' +
      '<p class="section-eyebrow">' + title + "</p>" +
      '<p class="page-copy">' + copy + "</p>" +
      '<input id="' + inputId + '" class="text-field" type="number" min="1" step="1" placeholder="' + t("bank_amount_placeholder") + '" />' +
      '<div class="button-cloud" style="margin-top: 12px;">' +
      renderQuickButtons(action, inputId, maxAmount) +
      "</div>" +
      '<button class="primary-button" style="margin-top: 14px;" data-bank-action="' +
      action +
      '" data-bank-input="' +
      inputId +
      '">' +
      confirmText +
      "</button>" +
      "</div>"
    );
  }

  function renderPreviewCard(title, preview, activeKey, emptyKey) {
    return (
      '<div class="stat-card">' +
      '<p class="section-eyebrow">' + title + "</p>" +
      '<h3 class="panel-title">' +
      (preview.active
        ? t(activeKey, { amount: format.formatNumber(preview.amount) })
        : t(emptyKey)) +
      "</h3>" +
      '<p class="page-copy">' +
      t("bank_next_settlement_time", {
        day: preview.day,
        clock: preview.clock,
        hours: preview.hoursUntil,
      }) +
      "</p></div>"
    );
  }

  function renderBankPanel(state) {
    var bank = game.systems.bankSystem.getBank();
    var loanStatusKey = game.systems.bankSystem.getLoanStatusKey();
    var loanStatusTone = game.systems.bankSystem.getLoanStatusTone();
    var creditStatusKey = game.systems.bankSystem.getCreditStatusKey();
    var creditStatusTone = game.systems.bankSystem.getCreditStatusTone();
    var loanLimit = game.systems.bankSystem.getLoanLimit();
    var payoffQuote = game.systems.bankSystem.getFullPayoffFeeQuote();
    var savingsPreview = game.systems.bankSystem.getSavingsPreview();
    var loanPreview = game.systems.bankSystem.getLoanInterestPreview();
    var maxDeposit = Math.max(0, Math.floor(state.player.gold));
    var maxWithdraw = Math.max(0, Math.floor(bank.balance));
    var maxRepay = Math.max(0, Math.min(Math.floor(state.player.gold), Math.floor(bank.totalDebt)));

    return (
      '<section class="page-header">' +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("page_bank") + "</p>" +
      '<h2 class="page-title">' + t("bank_panel_title") + "</h2>" +
      '<p class="page-copy">' + t("bank_panel_copy") + "</p>" +
      "</div>" +
      '<div class="page-card">' +
      '<p class="section-eyebrow">' + t("bank_loan_status") + "</p>" +
      '<h3 class="panel-title">' + t(loanStatusKey) + "</h3>" +
      '<p class="page-copy">' + t("bank_day_summary", { day: Math.floor(state.player.currentDay || 1) }) + "</p>" +
      '<div class="inline-row" style="margin-top: 16px;">' +
      '<span class="status-pill ' + loanStatusTone + '">' + t(loanStatusKey) + "</span>" +
      '<span class="status-pill ' + creditStatusTone + '">' + t(creditStatusKey) + "</span>" +
      '<span class="pill">' + t("bank_interest_daily_rate", { rate: Math.round(game.config.bank.dailyInterestRate * 100) }) + "</span>" +
      '<span class="pill">' + t("bank_savings_daily_rate", { rate: Math.round(game.config.bank.savingsDailyRate * 100) }) + "</span>" +
      "</div>" +
      '<p class="helper-text" style="margin-top: 12px;">' + t("bank_auto_repay_notice", { rate: Math.round(game.config.bank.autoRepayRatio * 100) }) + "</p>" +
      '<p class="helper-text" style="margin-top: 8px;">' + t("bank_loan_limit_now", { amount: format.formatNumber(loanLimit) }) + "</p>" +
      "</div>" +
      "</section>" +
      '<section class="summary-grid">' +
      '<div class="stat-card"><p class="section-eyebrow">' + t("gold") + '</p><h3 class="panel-title">' +
      format.formatNumber(state.player.gold) +
      " " + t("gold_unit") + "</h3></div>" +
      '<div class="stat-card"><p class="section-eyebrow">' + t("bank_balance") + '</p><h3 class="panel-title">' +
      format.formatNumber(bank.balance) +
      " " + t("gold_unit") + "</h3></div>" +
      '<div class="stat-card"><p class="section-eyebrow">' + t("bank_loan_principal") + '</p><h3 class="panel-title">' +
      format.formatNumber(bank.principal) +
      " " + t("gold_unit") + "</h3></div>" +
      '<div class="stat-card"><p class="section-eyebrow">' + t("bank_loan_interest") + '</p><h3 class="panel-title">' +
      format.formatNumber(bank.accruedInterest) +
      " " + t("gold_unit") + "</h3></div>" +
      '<div class="stat-card"><p class="section-eyebrow">' + t("bank_total_debt") + '</p><h3 class="panel-title">' +
      format.formatNumber(bank.totalDebt) +
      " " + t("gold_unit") + "</h3></div>" +
      '<div class="stat-card"><p class="section-eyebrow">' + t("bank_loan_status") + '</p><h3 class="panel-title">' +
      t(loanStatusKey) +
      "</h3></div>" +
      renderPreviewCard(t("bank_next_savings_interest"), savingsPreview, "bank_preview_gain", "bank_preview_none") +
      renderPreviewCard(t("bank_next_loan_interest"), loanPreview, "bank_preview_cost", "bank_preview_no_loan") +
      '<div class="stat-card"><p class="section-eyebrow">' + t("bank_credit_rating") + '</p><h3 class="panel-title">' +
      t(creditStatusKey) +
      '</h3><p class="page-copy">' + t("bank_credit_history", {
        good: bank.goodRepaymentCount || 0,
        late: bank.lateRepaymentCount || 0,
      }) + "</p></div>" +
      '<div class="stat-card"><p class="section-eyebrow">' + t("bank_loan_limit") + '</p><h3 class="panel-title">' +
      format.formatNumber(loanLimit) +
      " " + t("gold_unit") + '</h3><p class="page-copy">' + t("bank_loan_limit_copy") + "</p></div>" +
      "</section>" +
      '<section class="settings-grid" style="margin-top: 18px;">' +
      renderActionCard(
        t("bank_deposit_title"),
        t("bank_deposit_copy"),
        "bank-deposit-input",
        "deposit",
        t("bank_deposit_action"),
        maxDeposit
      ) +
      renderActionCard(
        t("bank_withdraw_title"),
        t("bank_withdraw_copy"),
        "bank-withdraw-input",
        "withdraw",
        t("bank_withdraw_action"),
        maxWithdraw
      ) +
      "</section>" +
      '<section class="settings-grid" style="margin-top: 18px;">' +
      renderActionCard(
        t("bank_loan_take_title"),
        t("bank_loan_take_copy", {
          min: game.config.bank.minLoanAmount,
          max: loanLimit,
        }),
        "bank-loan-input",
        "loan",
        t("bank_loan_take_action"),
        loanLimit
      ) +
      renderActionCard(
        t("bank_repay_title"),
        t("bank_repay_copy"),
        "bank-repay-input",
        "repay",
        t("bank_repay_action"),
        maxRepay
      ) +
      "</section>"
      + '<section class="page-card" style="margin-top: 18px;">' +
      '<p class="section-eyebrow">' + t("bank_repay_full_title") + "</p>" +
      '<p class="page-copy">' + t("bank_repay_full_copy", {
        fee: format.formatNumber(payoffQuote.feeAmount),
        rate: payoffQuote.feePercent,
        total: format.formatNumber(payoffQuote.totalAmount),
      }) + "</p>" +
      '<p class="helper-text" style="margin-top: 8px;">' + t("bank_repay_full_fee_status", {
        days: payoffQuote.ageDays,
        freeDay: game.config.bank.fullPayoffFeeFreeDay,
        fee: format.formatNumber(payoffQuote.feeAmount),
        rate: payoffQuote.feePercent,
      }) + "</p>" +
      '<div class="button-cloud" style="margin-top: 14px;">' +
      '<button class="secondary-button" data-bank-action="repay-full">' +
      t("bank_repay_full_action", {
        amount: format.formatNumber(payoffQuote.totalAmount),
      }) +
      "</button></div></section>"
    );
  }

  game.ui.renderBankPanel = renderBankPanel;
})(window.CatGame);
