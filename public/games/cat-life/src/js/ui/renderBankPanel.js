(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var quickAmounts = game.config.bank.quickAmounts;

  function copy(key, vars) {
    return format.escapeHtml(t(key, vars));
  }

  function amount(value) {
    return format.escapeHtml(format.formatNumber(value));
  }

  function renderQuickButtons(action, inputId, maxAmount) {
    var buttons = quickAmounts
      .map(function (value) {
        var disabled = value > maxAmount;
        return (
          '<button class="chip-button bank-quick-chip" type="button" data-bank-action="' +
          action +
          '" data-bank-input="' +
          inputId +
          '" data-bank-amount="' +
          value +
          '"' +
          (disabled ? " disabled" : "") +
          ">" +
          amount(value) +
          "</button>"
        );
      })
      .join("");

    if (maxAmount > 0) {
      buttons +=
        '<button class="chip-button bank-quick-chip bank-quick-chip-max" type="button" data-bank-action="' +
        action +
        '" data-bank-input="' +
        inputId +
        '" data-bank-amount="' +
        maxAmount +
        '">' +
        copy("bank_max_button") +
        "</button>";
    }

    return buttons;
  }

  function renderStat(label, value, meta, tone) {
    return (
      '<div class="bank-financial-stat ' +
      tone +
      '"><span class="bank-financial-label">' +
      label +
      '</span><strong class="bank-financial-value">' +
      value +
      '</strong><span class="bank-financial-meta">' +
      meta +
      "</span></div>"
    );
  }

  function renderPreviewValue(preview, activeKey, emptyKey) {
    return preview.active
      ? copy(activeKey, { amount: format.formatNumber(preview.amount) })
      : copy(emptyKey);
  }

  function renderPreviewCard(title, preview, activeKey, emptyKey, tone) {
    return (
      '<article class="bank-settlement-card ' +
      tone +
      '"><div class="bank-settlement-card-head"><span class="bank-settlement-dot" aria-hidden="true"></span><p class="section-eyebrow">' +
      title +
      '</p></div><strong class="bank-settlement-value">' +
      renderPreviewValue(preview, activeKey, emptyKey) +
      '</strong><p class="helper-text">' +
      copy("bank_next_settlement_time", {
        day: preview.day,
        clock: preview.clock,
        hours: preview.hoursUntil,
      }) +
      "</p></article>"
    );
  }

  function renderAmountField(inputId, maxAmount, hint) {
    return (
      '<div class="bank-amount-field"><label class="bank-amount-label" for="' +
      inputId +
      '">' +
      copy("bank_action_amount") +
      '</label><span class="bank-amount-hint">' +
      hint +
      '</span><input id="' +
      inputId +
      '" class="text-field bank-amount-input" type="number" min="1" step="1" inputmode="numeric" max="' +
      maxAmount +
      '" placeholder="' +
      copy("bank_amount_placeholder") +
      '" aria-describedby="' +
      inputId +
      '-hint" /><span id="' +
      inputId +
      '-hint" class="sr-only">' +
      hint +
      "</span></div>"
    );
  }

  function renderLaneAction(action, inputId, label, className, disabled) {
    return (
      '<button class="' +
      className +
      ' bank-lane-action" type="button" data-bank-action="' +
      action +
      '" data-bank-input="' +
      inputId +
      '"' +
      (disabled ? " disabled" : "") +
      ">" +
      label +
      "</button>"
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
    var hasLoan = bank.totalDebt > 0;
    var loanCanBeStarted = !hasLoan && loanLimit >= game.config.bank.minLoanAmount;
    var clerkUrl = new URL("src/assets/bank/bank-counter-clerk.webp", document.baseURI).href;
    var day = Math.floor(state.player.currentDay || 1);
    var goldUnit = copy("gold_unit");

    return (
      '<div class="bank-page">' +
      '<section class="bank-overview" aria-labelledby="bank-page-title">' +
      '<div class="bank-overview-copy"><p class="section-eyebrow">' +
      copy("page_bank") +
      '</p><h2 id="bank-page-title" class="page-title">' +
      copy("bank_panel_title") +
      '</h2><p class="page-copy">' +
      copy("bank_panel_copy") +
      '</p><div class="bank-overview-status"><span class="status-pill ' +
      format.escapeHtml(loanStatusTone) +
      '">' +
      copy(loanStatusKey) +
      '</span><span class="status-pill ' +
      format.escapeHtml(creditStatusTone) +
      '">' +
      copy(creditStatusKey) +
      '</span><span class="pill">' +
      copy("bank_interest_daily_rate", {
        rate: Math.round(game.config.bank.dailyInterestRate * 100),
      }) +
      '</span><span class="pill">' +
      copy("bank_savings_daily_rate", {
        rate: Math.round(game.config.bank.savingsDailyRate * 100),
      }) +
      '</span></div><p class="helper-text bank-overview-note">' +
      copy("bank_auto_repay_notice", {
        rate: Math.round(game.config.bank.autoRepayRatio * 100),
      }) +
      '</p></div><div class="bank-clerk-figure"><img src="' +
      format.escapeHtml(clerkUrl) +
      '" alt="' +
      copy("bank_clerk_alt") +
      '" width="520" height="360" decoding="async" /></div></section>' +
      '<section class="bank-financial-strip" aria-label="' +
      copy("bank_overview_label") +
      '">' +
      renderStat(
        copy("bank_available_cash"),
        amount(state.player.gold) + " " + goldUnit,
        copy("bank_cash_meta"),
        "is-cash"
      ) +
      renderStat(
        copy("bank_balance"),
        amount(bank.balance) + " " + goldUnit,
        copy("bank_savings_meta", {
          rate: Math.round(game.config.bank.savingsDailyRate * 100),
        }),
        "is-savings"
      ) +
      renderStat(
        copy("bank_total_debt"),
        amount(bank.totalDebt) + " " + goldUnit,
        copy(bank.totalDebt > 0 ? "bank_debt_meta_active" : "bank_debt_meta_clear"),
        "is-debt"
      ) +
      renderStat(
        copy("bank_credit_rating"),
        copy(creditStatusKey),
        copy("bank_credit_meta", {
          good: bank.goodRepaymentCount || 0,
          late: bank.lateRepaymentCount || 0,
        }),
        "is-credit"
      ) +
      renderStat(
        copy("bank_loan_limit"),
        amount(loanLimit) + " " + goldUnit,
        copy("bank_loan_limit_now", { amount: format.formatNumber(loanLimit) }),
        "is-limit"
      ) +
      '</section><section class="bank-counter-shell" aria-labelledby="bank-counter-title"><div class="bank-counter-heading"><div><span class="bank-counter-tab">' +
      copy("bank_counter_label") +
      '</span><h3 id="bank-counter-title" class="panel-title">' +
      copy("bank_counter_title") +
      '</h3></div><p class="bank-day-stamp">' +
      copy("bank_day_summary", { day: day }) +
      '</p></div><div class="bank-lanes">' +
      '<section class="bank-lane bank-lane-savings" data-bank-lane="savings" aria-labelledby="bank-savings-lane-title"><div class="bank-lane-heading"><div class="bank-lane-heading-main"><span class="bank-lane-number" aria-hidden="true">1</span><div><p class="section-eyebrow">' +
      copy("bank_counter_savings_label") +
      '</p><h4 id="bank-savings-lane-title" class="panel-title">' +
      copy("bank_counter_savings_title") +
      '</h4><p class="page-copy">' +
      copy("bank_counter_savings_copy") +
      '</p></div></div><span class="status-pill is-success">' +
      copy("bank_savings_safe") +
      '</span></div><div class="bank-lane-actions" role="group" aria-label="' +
      copy("bank_counter_savings_title") +
      '">' +
      renderLaneAction(
        "deposit",
        "bank-deposit-input",
        copy("bank_deposit_action_short"),
        "secondary-button",
        maxDeposit <= 0
      ) +
      renderLaneAction(
        "withdraw",
        "bank-deposit-input",
        copy("bank_withdraw_action_short"),
        "ghost-button",
        maxWithdraw <= 0
      ) +
      '</div><div class="bank-lane-divider"></div>' +
      renderAmountField(
        "bank-deposit-input",
        Math.max(maxDeposit, maxWithdraw),
        copy("bank_savings_input_hint", {
          cash: format.formatNumber(maxDeposit),
          savings: format.formatNumber(maxWithdraw),
        })
      ) +
      '<div class="bank-quick-actions" aria-label="' +
      copy("bank_quick_amounts") +
      '">' +
      renderQuickButtons("deposit", "bank-deposit-input", maxDeposit) +
      '</div><p class="bank-lane-hint">' +
      copy("bank_savings_hint") +
      '</p><div class="bank-lane-footer"><span>' +
      copy("bank_available_savings_amount", { amount: format.formatNumber(maxWithdraw) }) +
      '</span><span>' +
      copy("bank_savings_daily_rate", {
        rate: Math.round(game.config.bank.savingsDailyRate * 100),
      }) +
      "</span></div></section>" +
      '<section class="bank-lane bank-lane-loan" data-bank-lane="loan" aria-labelledby="bank-loan-lane-title"><div class="bank-lane-heading"><div class="bank-lane-heading-main"><span class="bank-lane-number" aria-hidden="true">2</span><div><p class="section-eyebrow">' +
      copy("bank_counter_loan_label") +
      '</p><h4 id="bank-loan-lane-title" class="panel-title">' +
      copy("bank_counter_loan_title") +
      '</h4><p class="page-copy">' +
      copy("bank_counter_loan_copy") +
      '</p></div></div><span class="status-pill ' +
      format.escapeHtml(loanStatusTone) +
      '">' +
      copy(loanStatusKey) +
      '</span></div><div class="bank-lane-actions" role="group" aria-label="' +
      copy("bank_counter_loan_title") +
      '">' +
      renderLaneAction(
        "loan",
        "bank-loan-input",
        copy("bank_loan_take_action_short"),
        "primary-button",
        !loanCanBeStarted
      ) +
      renderLaneAction(
        "repay",
        "bank-loan-input",
        copy("bank_repay_action_short"),
        "ghost-button",
        maxRepay <= 0
      ) +
      '</div><div class="bank-lane-divider"></div>' +
      renderAmountField(
        "bank-loan-input",
        Math.max(loanLimit, maxRepay),
        hasLoan
          ? copy("bank_current_debt_amount", { amount: format.formatNumber(bank.totalDebt) })
          : copy("bank_loan_room", { amount: format.formatNumber(loanLimit) })
      ) +
      '<div class="bank-quick-actions" aria-label="' +
      copy("bank_quick_amounts") +
      '">' +
      renderQuickButtons("loan", "bank-loan-input", loanCanBeStarted ? loanLimit : 0) +
      '</div><p class="bank-lane-hint bank-loan-note">' +
      copy(hasLoan ? "bank_active_loan_copy" : "bank_no_loan_copy") +
      '</p><div class="bank-loan-facts"><div><span>' +
      copy("bank_loan_principal") +
      '</span><strong>' +
      amount(bank.principal) +
      " " +
      goldUnit +
      '</strong></div><div><span>' +
      copy("bank_loan_interest") +
      '</span><strong>' +
      amount(bank.accruedInterest) +
      " " +
      goldUnit +
      '</strong></div><div><span>' +
      copy("bank_interest_daily_rate", {
        rate: Math.round(game.config.bank.dailyInterestRate * 100),
      }) +
      '</span><strong>' +
      copy("bank_loan_limit_now", { amount: format.formatNumber(loanLimit) }) +
      '</strong></div></div><div class="bank-payoff-row"><div><p class="section-eyebrow">' +
      copy("bank_repay_full_title") +
      '</p><p class="helper-text">' +
      copy("bank_repay_full_copy", {
        fee: format.formatNumber(payoffQuote.feeAmount),
        rate: payoffQuote.feePercent,
        total: format.formatNumber(payoffQuote.totalAmount),
      }) +
      '</p></div><button class="secondary-button bank-payoff-button" type="button" data-bank-action="repay-full"' +
      (!hasLoan ? " disabled" : "") +
      ">" +
      copy("bank_repay_full_action", {
        amount: format.formatNumber(payoffQuote.totalAmount),
      }) +
      "</button></div></section>" +
      '</div></section><section class="bank-settlement" aria-labelledby="bank-settlement-title"><div class="bank-settlement-heading"><div><p class="section-eyebrow">' +
      copy("bank_settlement_label") +
      '</p><h3 id="bank-settlement-title" class="panel-title">' +
      copy("bank_settlement_title") +
      '</h3></div><p class="helper-text">' +
      copy("bank_settlement_copy") +
      '</p></div><div class="bank-settlement-grid">' +
      renderPreviewCard(
        copy("bank_next_savings_interest"),
        savingsPreview,
        "bank_preview_gain",
        "bank_preview_none",
        "is-savings"
      ) +
      renderPreviewCard(
        copy("bank_next_loan_interest"),
        loanPreview,
        "bank_preview_cost",
        "bank_preview_no_loan",
        "is-loan"
      ) +
      '<article class="bank-history-card"><div class="bank-settlement-card-head"><span class="bank-settlement-dot" aria-hidden="true"></span><p class="section-eyebrow">' +
      copy("bank_history_label") +
      '</p></div><strong class="bank-settlement-value">' +
      copy(creditStatusKey) +
      '</strong><p class="helper-text">' +
      copy("bank_credit_history", {
        good: bank.goodRepaymentCount || 0,
        late: bank.lateRepaymentCount || 0,
      }) +
      '</p><p class="helper-text bank-history-note">' +
      copy("bank_repay_full_fee_status", {
        days: payoffQuote.ageDays,
        freeDay: game.config.bank.fullPayoffFeeFreeDay,
        fee: format.formatNumber(payoffQuote.feeAmount),
        rate: payoffQuote.feePercent,
      }) +
      "</p></article></div></section>" +
      '</div>'
    );
  }

  game.ui.renderBankPanel = renderBankPanel;
})(window.CatGame);
