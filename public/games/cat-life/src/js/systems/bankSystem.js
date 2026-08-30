(function (game) {
  var t = game.utils.i18n.t;

  function getPlayer() {
    return game.state.game.player;
  }

  function getBank() {
    return getPlayer().bank;
  }

  function getConfig() {
    return game.config.bank;
  }

  function getCurrentDay() {
    return Math.floor(getPlayer().currentDay || 1);
  }

  function getCurrentHour() {
    return Number(getPlayer().currentHour || 0);
  }

  function normalizeAmount(amount) {
    return Math.floor(Number(amount || 0));
  }

  function clampCreditTier(value) {
    return Math.max(getConfig().minCreditTier, Math.min(getConfig().maxCreditTier, value));
  }

  function getLoanLimitForTier(creditTier) {
    var config = getConfig();
    return Math.max(
      config.minLoanAmount,
      config.maxLoanAmount + clampCreditTier(creditTier) * config.loanLimitStep
    );
  }

  function getLoanLimit() {
    return getLoanLimitForTier(getBank().creditTier || 0);
  }

  function clearLoanState() {
    var bank = getBank();

    bank.hasActiveLoan = false;
    bank.totalDebt = 0;
    bank.loanStartDay = null;
    bank.lastInterestAccrualDay = null;
    bank.currentLoanInterestDays = 0;
  }

  function updateTotalDebt() {
    var bank = getBank();

    bank.principal = Math.max(0, Number(bank.principal || 0));
    bank.accruedInterest = Math.max(0, Number(bank.accruedInterest || 0));
    bank.totalDebt = bank.principal + bank.accruedInterest;

    if (bank.principal <= 0 && bank.accruedInterest <= 0) {
      bank.hasActiveLoan = false;
      bank.totalDebt = 0;
      return true;
    }

    bank.hasActiveLoan = true;
    return false;
  }

  function getSettlementPreview() {
    var currentHour = getCurrentHour();

    return {
      day: getCurrentDay() + 1,
      hoursUntil: Math.max(1, Math.ceil(24 - currentHour)),
      clock: "00:00",
    };
  }

  function getSavingsPreview() {
    var bank = getBank();
    var preview = getSettlementPreview();
    var amount = bank.balance > 0 ? Math.max(1, Math.round(bank.balance * getConfig().savingsDailyRate)) : 0;

    return {
      day: preview.day,
      hoursUntil: preview.hoursUntil,
      clock: preview.clock,
      amount: amount,
      active: bank.balance > 0,
    };
  }

  function getLoanInterestPreview() {
    var bank = getBank();
    var preview = getSettlementPreview();
    var amount =
      bank.hasActiveLoan && bank.principal > 0
        ? Math.max(1, Math.round(bank.principal * getConfig().dailyInterestRate))
        : 0;

    return {
      day: preview.day,
      hoursUntil: preview.hoursUntil,
      clock: preview.clock,
      amount: amount,
      active: bank.hasActiveLoan && bank.principal > 0,
    };
  }

  function getCreditStatusKey() {
    var creditTier = Number(getBank().creditTier || 0);

    if (creditTier >= 2) {
      return "bank_credit_excellent";
    }
    if (creditTier >= 0) {
      return "bank_credit_stable";
    }
    return "bank_credit_restricted";
  }

  function getCreditStatusTone() {
    var creditTier = Number(getBank().creditTier || 0);

    if (creditTier >= 2) {
      return "is-success";
    }
    if (creditTier >= 0) {
      return "is-warning";
    }
    return "is-danger";
  }

  function getLoanAgeDays() {
    var bank = getBank();
    var startDay = bank.loanStartDay === null ? getCurrentDay() : Math.floor(bank.loanStartDay);
    return Math.max(0, getCurrentDay() - startDay);
  }

  function getFullPayoffFeeQuote() {
    var bank = getBank();
    var config = getConfig();
    var ageDays = getLoanAgeDays();
    var remainingDays = Math.max(0, config.fullPayoffFeeFreeDay - ageDays);
    var ratio = config.fullPayoffFeeFreeDay > 0 ? remainingDays / config.fullPayoffFeeFreeDay : 0;
    var feeRate = bank.hasActiveLoan ? config.fullPayoffFeeRate * ratio : 0;
    var feeAmount =
      bank.hasActiveLoan && bank.principal > 0
        ? Math.ceil(bank.principal * feeRate)
        : 0;

    return {
      ageDays: ageDays,
      remainingDays: remainingDays,
      feeRate: feeRate,
      feePercent: Math.round(feeRate * 100),
      feeAmount: feeAmount,
      debtAmount: Math.ceil(Number(bank.totalDebt || 0)),
      totalAmount: Math.ceil(Number(bank.totalDebt || 0)) + feeAmount,
      isFeeFree: feeAmount <= 0,
    };
  }

  function finalizeLoanClosure() {
    var bank = getBank();
    var interestDays = Math.max(0, Number(bank.currentLoanInterestDays || 0));
    var previousTier = Number(bank.creditTier || 0);
    var nextTier = previousTier;
    var messages = [];

    if (interestDays <= getConfig().strongRepayInterestDays) {
      bank.goodRepaymentCount += 1;
      nextTier = clampCreditTier(previousTier + 1);
      if (nextTier > previousTier) {
        messages.push(
          t("bank_credit_up", {
            max: getLoanLimitForTier(nextTier),
          })
        );
      }
    } else if (interestDays >= getConfig().highRiskInterestDays) {
      bank.lateRepaymentCount += 1;
      nextTier = clampCreditTier(previousTier - 1);
      if (nextTier < previousTier) {
        messages.push(
          t("bank_credit_down", {
            max: getLoanLimitForTier(nextTier),
          })
        );
      }
    }

    bank.creditTier = nextTier;
    clearLoanState();

    return {
      creditTier: nextTier,
      creditChanged: nextTier - previousTier,
      messages: messages,
    };
  }

  function getLoanStatusKey() {
    var bank = getBank();

    if (!bank.hasActiveLoan || bank.totalDebt <= 0) {
      return "bank_loan_none";
    }
    if (bank.totalDebt >= getConfig().warningDebt) {
      return "bank_loan_pressure";
    }
    return "bank_loan_control";
  }

  function getLoanStatusTone() {
    var bank = getBank();

    if (!bank.hasActiveLoan || bank.totalDebt <= 0) {
      return "is-success";
    }
    if (bank.totalDebt >= getConfig().warningDebt) {
      return "is-danger";
    }
    return "is-warning";
  }

  function validatePositiveAmount(amount) {
    var safeAmount = normalizeAmount(amount);

    if (!safeAmount || safeAmount <= 0) {
      return {
        ok: false,
        amount: 0,
        message: t("bank_amount_invalid"),
      };
    }

    return {
      ok: true,
      amount: safeAmount,
    };
  }

  function deposit(amount) {
    var player = getPlayer();
    var bank = getBank();
    var validation = validatePositiveAmount(amount);

    if (!validation.ok) {
      return validation;
    }
    if (validation.amount > player.gold) {
      return { ok: false, message: t("bank_deposit_too_much") };
    }

    player.gold -= validation.amount;
    bank.balance += validation.amount;

    return {
      ok: true,
      forceSave: true,
      message: t("bank_deposit_success", { amount: validation.amount }),
    };
  }

  function withdraw(amount) {
    var player = getPlayer();
    var bank = getBank();
    var validation = validatePositiveAmount(amount);

    if (!validation.ok) {
      return validation;
    }
    if (validation.amount > bank.balance) {
      return { ok: false, message: t("bank_withdraw_too_much") };
    }

    bank.balance -= validation.amount;
    player.gold += validation.amount;

    return {
      ok: true,
      forceSave: true,
      message: t("bank_withdraw_success", { amount: validation.amount }),
    };
  }

  function takeLoan(amount) {
    var player = getPlayer();
    var bank = getBank();
    var validation = validatePositiveAmount(amount);
    var loanLimit = getLoanLimit();

    if (!validation.ok) {
      return validation;
    }
    if (bank.hasActiveLoan) {
      return { ok: false, message: t("bank_loan_active_exists") };
    }
    if (
      validation.amount < getConfig().minLoanAmount ||
      validation.amount > loanLimit
    ) {
      return {
        ok: false,
        message: t("bank_loan_amount_range", {
          min: getConfig().minLoanAmount,
          max: loanLimit,
        }),
      };
    }

    player.gold += validation.amount;
    bank.totalBorrowed = Math.max(0, Number(bank.totalBorrowed || 0)) + validation.amount;
    bank.hasActiveLoan = true;
    bank.principal = validation.amount;
    bank.accruedInterest = 0;
    bank.totalDebt = validation.amount;
    bank.loanStartDay = Math.floor(player.currentDay || 1);
    bank.lastInterestAccrualDay = Math.floor(player.currentDay || 1);
    bank.currentLoanInterestDays = 0;

    return {
      ok: true,
      forceSave: true,
      messages: [
        t("bank_loan_success", { amount: validation.amount }),
        t("bank_interest_notice", {
          rate: Math.round(getConfig().dailyInterestRate * 100),
        }),
      ],
    };
  }

  function applyRepayment(paymentAmount) {
    var bank = getBank();
    var paidInterest = 0;
    var paidPrincipal = 0;
    var remaining = Math.max(0, Number(paymentAmount || 0));
    var loanCleared;
    var closureResult = null;

    if (!bank.hasActiveLoan || remaining <= 0) {
      return {
        paid: 0,
        paidInterest: 0,
        paidPrincipal: 0,
        loanCleared: false,
        messages: [],
      };
    }

    if (bank.accruedInterest > 0) {
      paidInterest = Math.min(bank.accruedInterest, remaining);
      bank.accruedInterest -= paidInterest;
      remaining -= paidInterest;
    }

    if (remaining > 0 && bank.principal > 0) {
      paidPrincipal = Math.min(bank.principal, remaining);
      bank.principal -= paidPrincipal;
      remaining -= paidPrincipal;
    }

    loanCleared = updateTotalDebt();
    if (loanCleared) {
      closureResult = finalizeLoanClosure();
    }

    return {
      paid: paidInterest + paidPrincipal,
      paidInterest: paidInterest,
      paidPrincipal: paidPrincipal,
      loanCleared: loanCleared,
      messages: closureResult ? closureResult.messages : [],
    };
  }

  function repay(amount) {
    var player = getPlayer();
    var bank = getBank();
    var validation = validatePositiveAmount(amount);
    var actualPayment;
    var repayment;
    var messages;

    if (!validation.ok) {
      return validation;
    }
    if (!bank.hasActiveLoan) {
      return { ok: false, message: t("bank_repay_no_loan") };
    }
    if (validation.amount > player.gold) {
      return { ok: false, message: t("bank_repay_too_much_cash") };
    }

    actualPayment = Math.min(validation.amount, Math.ceil(bank.totalDebt || 0));
    player.gold -= actualPayment;
    repayment = applyRepayment(actualPayment);
    messages = [t("bank_repay_success", { amount: repayment.paid })];

    if (repayment.loanCleared) {
      messages.push(t("bank_loan_cleared"));
    }
    if (repayment.messages && repayment.messages.length) {
      messages = messages.concat(repayment.messages);
    }

    return {
      ok: true,
      forceSave: true,
      messages: messages,
    };
  }

  function payOffLoan() {
    var player = getPlayer();
    var bank = getBank();
    var feeQuote = getFullPayoffFeeQuote();
    var totalDebt = feeQuote.debtAmount;
    var totalPayment = feeQuote.totalAmount;
    var repayment;
    var messages;

    if (!bank.hasActiveLoan || totalDebt <= 0) {
      return { ok: false, message: t("bank_repay_no_loan") };
    }
    if (player.gold < totalPayment) {
      return {
        ok: false,
        message: t("bank_repay_full_not_enough", { amount: totalPayment }),
      };
    }

    player.gold -= totalPayment;
    repayment = applyRepayment(totalDebt);
    messages = [
      t("bank_repay_full_success", {
        amount: repayment.paid,
        fee: feeQuote.feeAmount,
        total: totalPayment,
      }),
    ];

    if (repayment.loanCleared) {
      messages.push(t("bank_loan_cleared"));
    }
    if (feeQuote.feeAmount > 0) {
      messages.push(
        t("bank_repay_full_fee_paid", {
          fee: feeQuote.feeAmount,
          rate: feeQuote.feePercent,
        })
      );
    }
    if (repayment.messages && repayment.messages.length) {
      messages = messages.concat(repayment.messages);
    }

    return {
      ok: true,
      forceSave: true,
      messages: messages,
    };
  }

  function syncLoanInterestForDayChange(previousDay, nextDay) {
    var bank = getBank();
    var currentDay = Math.floor(nextDay);
    var savingsLastDay;
    var savingsDaysPassed;
    var savingsInterestPerDay;
    var savingsInterestAdded = 0;
    var lastDay;
    var daysPassed;
    var interestPerDay;
    var interestAdded = 0;
    var messages = [];
    var changed = false;

    savingsLastDay =
      bank.lastSavingsInterestDay === null ? Math.floor(previousDay) : Math.floor(bank.lastSavingsInterestDay);
    savingsDaysPassed = Math.max(0, currentDay - savingsLastDay);

    if (savingsDaysPassed > 0) {
      savingsInterestPerDay =
        bank.balance > 0 ? Math.max(1, Math.round(bank.balance * getConfig().savingsDailyRate)) : 0;
      savingsInterestAdded = savingsInterestPerDay * savingsDaysPassed;

      if (savingsInterestAdded > 0) {
        bank.balance += savingsInterestAdded;
        changed = true;
        messages.push(
          t("bank_savings_interest_paid", {
            days: savingsDaysPassed,
            amount: savingsInterestAdded,
          })
        );
      }

      bank.lastSavingsInterestDay = currentDay;
    }

    if (!bank.hasActiveLoan) {
      return {
        changed: changed,
        messages: messages,
        daysPassed: savingsDaysPassed,
      };
    }

    lastDay = bank.lastInterestAccrualDay === null ? previousDay : bank.lastInterestAccrualDay;
    daysPassed = Math.max(0, currentDay - Math.floor(lastDay));

    if (daysPassed <= 0) {
      return {
        changed: changed,
        messages: messages,
        daysPassed: savingsDaysPassed,
      };
    }

    interestPerDay = Math.max(1, Math.round(bank.principal * getConfig().dailyInterestRate));
    interestAdded = interestPerDay * daysPassed;
    bank.accruedInterest += interestAdded;
    bank.lastInterestAccrualDay = currentDay;
    bank.currentLoanInterestDays += daysPassed;
    updateTotalDebt();

    return {
      changed: changed || interestAdded > 0,
      daysPassed: Math.max(daysPassed, savingsDaysPassed),
      messages: messages.concat(
        interestAdded > 0
          ? [
              t("bank_interest_accrued", {
                days: daysPassed,
                amount: interestAdded,
              }),
            ]
          : []
      ),
    };
  }

  function autoRepayFromWork(grossIncome) {
    var bank = getBank();
    var autoAmount;
    var repayment;

    if (!bank.hasActiveLoan || grossIncome <= 0) {
      return {
        deducted: 0,
        netIncome: grossIncome,
        loanCleared: false,
      };
    }

    autoAmount = Math.min(
      Math.max(1, Math.floor(grossIncome * getConfig().autoRepayRatio)),
      bank.totalDebt
    );
    repayment = applyRepayment(autoAmount);

    return {
      deducted: repayment.paid,
      netIncome: grossIncome - repayment.paid,
      loanCleared: repayment.loanCleared,
      paidInterest: repayment.paidInterest,
      paidPrincipal: repayment.paidPrincipal,
      messages: repayment.messages || [],
    };
  }

  game.systems.bankSystem = {
    getBank: getBank,
    getLoanLimit: getLoanLimit,
    getLoanStatusKey: getLoanStatusKey,
    getLoanStatusTone: getLoanStatusTone,
    getCreditStatusKey: getCreditStatusKey,
    getCreditStatusTone: getCreditStatusTone,
    getFullPayoffFeeQuote: getFullPayoffFeeQuote,
    getSavingsPreview: getSavingsPreview,
    getLoanInterestPreview: getLoanInterestPreview,
    deposit: deposit,
    withdraw: withdraw,
    takeLoan: takeLoan,
    repay: repay,
    payOffLoan: payOffLoan,
    applyRepayment: applyRepayment,
    autoRepayFromWork: autoRepayFromWork,
    syncLoanInterestForDayChange: syncLoanInterestForDayChange,
  };
})(window.CatGame);
