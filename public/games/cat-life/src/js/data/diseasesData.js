(function (game) {
  var diseases = [
    {
      id: "cold",
      name: "猫感冒",
      nameEn: "Cat Cold",
      icon: "🤧",
      contagious: true,
      minAgeYears: 0.2,
      treatmentCost: 120,
      progressIntervalMs: 12 * 60 * 1000,
      healthDecay: 4,
      moodDecay: 3,
      baseChance: 0.08,
      description: "换季时比较容易出现，情绪低落时也更容易中招。",
      descriptionEn: "Common during weather changes and more likely when mood is low.",
    },
    {
      id: "stomachache",
      name: "肠胃不适",
      nameEn: "Stomachache",
      icon: "🤢",
      contagious: false,
      minAgeYears: 0,
      treatmentCost: 180,
      progressIntervalMs: 10 * 60 * 1000,
      healthDecay: 5,
      moodDecay: 2,
      baseChance: 0.06,
      description: "饱腹和心情长期偏低时更容易发生。",
      descriptionEn: "More likely when hunger and mood stay low for a long time.",
    },
    {
      id: "skin_fungus",
      name: "皮肤真菌",
      nameEn: "Skin Fungus",
      icon: "🧫",
      contagious: true,
      minAgeYears: 0.4,
      treatmentCost: 260,
      progressIntervalMs: 14 * 60 * 1000,
      healthDecay: 4,
      moodDecay: 4,
      baseChance: 0.05,
      description: "清洁状态太差时容易出现，还会在多猫家庭里传播。",
      descriptionEn: "Poor cleanliness raises the risk, and it can spread among multiple cats.",
    },
    {
      id: "kidney_stress",
      name: "肾脏压力",
      nameEn: "Kidney Stress",
      icon: "🩺",
      contagious: false,
      minAgeYears: 1,
      treatmentCost: 420,
      progressIntervalMs: 8 * 60 * 1000,
      healthDecay: 7,
      moodDecay: 3,
      baseChance: 0.035,
      description: "年纪较大的猫更容易患上，拖延治疗会快速恶化。",
      descriptionEn: "Older cats are more vulnerable, and delaying treatment makes it worsen fast.",
    },
  ];

  game.data.diseases = diseases;
  game.data.diseaseMap = diseases.reduce(function (map, disease) {
    map[disease.id] = disease;
    return map;
  }, {});
})(window.CatGame);
