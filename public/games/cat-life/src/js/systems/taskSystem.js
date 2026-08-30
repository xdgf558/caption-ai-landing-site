(function (game) {
  var clamp = game.utils.format.clamp;
  var t = game.utils.i18n.t;

  function useEnglishFallback() {
    return game.utils.i18n.getLanguage() !== "zh-CN";
  }

  function metricValue(metric) {
    var state = game.state.game;
    var maxIntimacy = state.cats.reduce(function (maxValue, cat) {
      return Math.max(maxValue, cat.intimacy || 0);
    }, 0);

    var metricMap = {
      workTimes: state.player.workTimes,
      feedTimes: state.player.feedTimes,
      furniturePurchaseCount: state.player.furniturePurchaseCount,
      workTimesToday: state.player.workTimesToday,
      playTimesToday: state.player.playTimesToday,
      spendGoldToday: state.player.totalSpend - (state.tasks._dailySpendOffset || 0),
      totalIncome: state.player.totalIncome,
      arcadeTotalWon: state.player.arcadeTotalWon,
      bankBalance: state.player.bank.balance,
      bankTotalBorrowed: state.player.bank.totalBorrowed,
      furnitureCount: state.inventory.furnitureOwned.length,
      maxIntimacy: maxIntimacy,
    };

    return metricMap[metric] || 0;
  }

  function refreshTaskList(list) {
    list.forEach(function (task) {
      if (task.claimed) {
        task.progress = task.target;
        return;
      }
      task.progress = clamp(metricValue(task.metric), 0, task.target);
    });
  }

  function refreshAllTasks() {
    var state = game.state.game;

    refreshTaskList(state.tasks.tutorial);
    refreshTaskList(state.tasks.daily);
    refreshTaskList(state.tasks.achievements);

    state.flags.tutorialFinished = state.tasks.tutorial.every(function (task) {
      return task.claimed;
    });
  }

  function resetDailyTasks(todayKey) {
    var state = game.state.game;
    state.player.workTimesToday = 0;
    state.player.feedTimesToday = 0;
    state.player.playTimesToday = 0;
    state.tasks.lastResetDay = state.player.currentDay;
    state.tasks.lastResetDate = todayKey || game.utils.format.formatDateKey(new Date());
    state.tasks._dailySpendOffset = state.player.totalSpend;

    state.tasks.daily.forEach(function (task) {
      task.progress = 0;
      task.claimed = false;
    });
  }

  function claimTask(category, taskId) {
    var taskList = game.state.game.tasks[category];
    var task = taskList && taskList.find(function (entry) {
      return entry.id === taskId;
    });
    var messages = [];

    if (!task) {
      return { ok: false, message: useEnglishFallback() ? "Task not found." : "没有找到这个任务。" };
    }
    if (task.claimed) {
      return { ok: false, message: useEnglishFallback() ? "This reward has already been claimed." : "这个任务奖励已经领取过了。" };
    }
    if (task.progress < task.target) {
      return { ok: false, message: useEnglishFallback() ? "This task is not complete yet." : "任务还没有完成，继续努力一下吧。" };
    }

    task.claimed = true;
    game.state.game.player.gold += task.reward.gold || 0;
    messages.push(
      useEnglishFallback()
        ? "Task reward claimed: " + (task.reward.gold || 0) + " gold."
        : "领取任务奖励：" + (task.reward.gold || 0) + " 金币。"
    );

    if (task.reward.exp) {
      messages = messages.concat(game.systems.workSystem.addExp(task.reward.exp));
      messages.push(
        useEnglishFallback()
          ? "Bonus EXP: " + task.reward.exp + "."
          : "额外获得经验 " + task.reward.exp + "。"
      );
    }

    refreshAllTasks();

    return {
      ok: true,
      messages: messages,
    };
  }

  game.systems.taskSystem = {
    refreshAllTasks: refreshAllTasks,
    resetDailyTasks: resetDailyTasks,
    claimTask: claimTask,
  };
})(window.CatGame);
