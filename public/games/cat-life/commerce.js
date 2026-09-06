(function () {
  var catalogPath = "/api/games/cat-life/catalog";
  var entitlementsPath = "/api/games/cat-life/entitlements";
  var redemptionPath = "/api/games/cat-life/redemptions";
  var cachePrefix = "catGameCommerceEntitlementsV1:";
  var preferencePrefix = "catGameCommercePreferencesV1:";
  var lastAccountKey = "catGameCommerceLastAccountV1";
  var memberAccountKey = "catGameMemberAccountV1";
  var initialized = false;
  var refreshRevision = 0;
  var pendingKeys = {};
  var state = {
    status: "idle",
    authenticated: false,
    offlineCache: false,
    account: null,
    balance: null,
    products: [],
    entitlements: [],
    message: "",
    messageTone: ""
  };

  var contentManifest = window.CatGameContentManifest || {
    productsById: {},
    getSkin: function () { return null; }
  };
  var manifests = contentManifest.productsById;

  var copyByLocale = {
    "zh-Hant": {
      kicker: "Station Points Store",
      title: "會員造型與房間主題",
      intro: "這裡使用 Station 積分，不使用遊戲金幣。價格、餘額與官方權益都由 Station Cat 伺服器確認。",
      loading: "正在讀取會員商品…",
      unavailable: "會員商城暫時無法連線；本機遊戲仍可繼續。",
      cached: "目前使用這個帳號最近一次同步的離線權益。離線時不能購買。",
      empty: "目前沒有已上架的會員商品，請稍後再看看。",
      guest: "遊客可以預覽商品；登入 Station Cat 後才能兌換與跨裝置使用。",
      signIn: "登入後兌換",
      balance: "可用餘額：{balance} Station Points",
      permanent: "永久 · 帳號綁定 · 不可轉讓",
      buy: "用 {price} 點兌換",
      owned: "已擁有",
      use: "套用造型",
      remove: "恢復原造型",
      roomReady: "已解鎖房間選項",
      paused: "暫停販售 · 已購權益保留",
      retired: "已下架 · 已購權益保留",
      insufficient: "積分不足",
      points: "購買 Station 積分",
      confirmTitle: "確認兌換",
      confirmCopy: "使用 {price} Station Points 永久解鎖「{name}」？兌換後不會自動續費。",
      confirmBalance: "兌換前餘額：{balance} 點",
      confirmAction: "確認兌換",
      cancel: "取消",
      redeeming: "正在安全兌換…",
      redeemed: "兌換完成，官方權益已加入帳號。",
      skinApplied: "月夜虎斑造型已套用。",
      skinRemoved: "已恢復原本造型。",
      descriptionSkin: "僅適用初始橘貓（預設名：小橘），改名後仍適用。不包含新貓或其他貓的造型；只改變外觀，不影響數值。",
      descriptionRoom: "包含綠牆、條紋地面、信號裝飾、候車布局四項主題：選綠牆顯示時鐘站牌，選信號裝飾顯示信號燈，選候車布局顯示長椅。",
      roomScope: "在「貓町 → 玩家小家 → 裝修」選用。三件裝飾不是背包家具，不能獨立拖動；不含桌子、花瓶、獨立地毯、擴容或數值加成。",
      roomPreview: "遊戲實景：四項主題全部選用。貓咪、貓窩與食盆是免費基礎內容，不屬於本套裝。",
      paymentNote: "商品點數不是首次付款金額。積分依當前套餐購買，最低付款額請查看積分價格；剩餘積分保留在帳號中。",
      correctionNote: "兌換問題請聯絡支援。經核准的兌換沖正會撤銷權益並退回原積分，不等於現金退款；付款退款依積分規則處理。",
      rules: "積分價格與退款規則",
      support: "兌換與付款協助",
      error_SIGN_IN_REQUIRED: "請先登入 Station Cat。",
      error_PRODUCT_NOT_AVAILABLE: "這件商品目前沒有開放兌換。",
      error_ALREADY_OWNED: "這個帳號已經擁有這件商品。",
      error_INSUFFICIENT_POINTS: "Station 積分不足，請先購買積分。",
      error_REDEMPTION_RATE_LIMITED: "操作太頻繁，請稍後再試。",
      error_COMMERCE_ROLLOUT_CLOSED: "會員商城正在分階段開放，這個帳號目前尚未開放兌換。",
      error_default: "暫時無法確認兌換結果。請刷新核對餘額與權益，或重試；仍有疑問請聯絡支援。"
    },
    "zh-CN": {
      kicker: "Station Points Store",
      title: "会员造型与房间主题",
      intro: "这里使用 Station 积分，不使用游戏金币。价格、余额与官方权益都由 Station Cat 服务器确认。",
      loading: "正在读取会员商品…",
      unavailable: "会员商城暂时无法连接；本地游戏仍可继续。",
      cached: "当前使用此账号最近同步的离线权益。离线时不能购买。",
      empty: "目前没有已上架的会员商品，请稍后再看看。",
      guest: "游客可以预览商品；登录 Station Cat 后才能兑换与跨设备使用。",
      signIn: "登录后兑换",
      balance: "可用余额：{balance} Station Points",
      permanent: "永久 · 账号绑定 · 不可转让",
      buy: "用 {price} 点兑换",
      owned: "已拥有",
      use: "应用造型",
      remove: "恢复原造型",
      roomReady: "已解锁房间选项",
      paused: "暂停销售 · 已购权益保留",
      retired: "已下架 · 已购权益保留",
      insufficient: "积分不足",
      points: "购买 Station 积分",
      confirmTitle: "确认兑换",
      confirmCopy: "使用 {price} Station Points 永久解锁“{name}”？兑换后不会自动续费。",
      confirmBalance: "兑换前余额：{balance} 点",
      confirmAction: "确认兑换",
      cancel: "取消",
      redeeming: "正在安全兑换…",
      redeemed: "兑换完成，官方权益已加入账号。",
      skinApplied: "月夜虎斑造型已应用。",
      skinRemoved: "已恢复原本造型。",
      descriptionSkin: "仅适用初始橘猫（默认名：小橘），改名后仍适用。不包含新猫或其他猫的造型；只改变外观，不影响数值。",
      descriptionRoom: "包含绿墙、条纹地面、信号装饰、候车布局四项主题：选绿墙显示时钟站牌，选信号装饰显示信号灯，选候车布局显示长椅。",
      roomScope: "在“猫町 → 玩家小家 → 装修”选用。三件装饰不是背包家具，不能独立拖动；不含桌子、花瓶、独立地毯、扩容或数值加成。",
      roomPreview: "游戏实景：四项主题全部选用。猫咪、猫窝与食盆是免费基础内容，不属于本套装。",
      paymentNote: "商品点数不是首次付款金额。积分按当前套餐购买，最低付款额请查看积分价格；剩余积分保留在账号中。",
      correctionNote: "兑换问题请联系支持。经批准的兑换冲正会撤销权益并退回原积分，不等于现金退款；付款退款按积分规则处理。",
      rules: "积分价格与退款规则",
      support: "兑换与付款协助",
      error_SIGN_IN_REQUIRED: "请先登录 Station Cat。",
      error_PRODUCT_NOT_AVAILABLE: "这件商品目前没有开放兑换。",
      error_ALREADY_OWNED: "这个账号已经拥有这件商品。",
      error_INSUFFICIENT_POINTS: "Station 积分不足，请先购买积分。",
      error_REDEMPTION_RATE_LIMITED: "操作太频繁，请稍后再试。",
      error_COMMERCE_ROLLOUT_CLOSED: "会员商城正在分阶段开放，这个账号目前尚未开放兑换。",
      error_default: "暂时无法确认兑换结果。请刷新核对余额与权益，或重试；仍有疑问请联系支持。"
    },
    en: {
      kicker: "Station Points Store",
      title: "Member cosmetics and room themes",
      intro: "This section uses Station Points, never game gold. Prices, balances, and official ownership come from the Station Cat server.",
      loading: "Loading member products…",
      unavailable: "The member store is temporarily unavailable. Local play still works.",
      cached: "Showing the latest offline entitlement cache for this account. Purchases require a connection.",
      empty: "No member products are on sale right now. Please check back later.",
      guest: "Guests can preview products. Sign in to redeem and use ownership across devices.",
      signIn: "Sign in to redeem",
      balance: "Available: {balance} Station Points",
      permanent: "Permanent · Account-bound · Non-transferable",
      buy: "Redeem for {price} points",
      owned: "Owned",
      use: "Use skin",
      remove: "Use original skin",
      roomReady: "Room options unlocked",
      paused: "Sales paused · Ownership retained",
      retired: "Retired · Ownership retained",
      insufficient: "Not enough points",
      points: "Buy Station Points",
      confirmTitle: "Confirm redemption",
      confirmCopy: "Spend {price} Station Points to permanently unlock “{name}”? This is not a subscription.",
      confirmBalance: "Balance before redemption: {balance} points",
      confirmAction: "Confirm redemption",
      cancel: "Cancel",
      redeeming: "Redeeming securely…",
      redeemed: "Redemption complete. The official entitlement is now on your account.",
      skinApplied: "Moonlit Tabby is now equipped.",
      skinRemoved: "The original skin is restored.",
      descriptionSkin: "Only for the starter orange cat (default name: Sunny), even after renaming. No new cat or skins for other cats. Cosmetic only; stats never change.",
      descriptionRoom: "Four theme options: green walls show the clock board, signal decor shows the lamp, and the waiting-room layout shows the bench, plus striped flooring.",
      roomScope: "Select them in Cat Town → Player Home → Edit. The three fixtures are not backpack furniture and cannot be dragged independently. No table, vase, separate rug, extra capacity, or stat bonuses.",
      roomPreview: "In-game view with all four options selected. The cat, bed, and food bowl are free base content, not part of this pack.",
      paymentNote: "The points price is not your first payment amount. Points are sold in current packs; see points pricing for the minimum payment. Unspent points stay on your account.",
      correctionNote: "Contact support about redemption issues. An approved redemption reversal revokes access and restores the original points, not cash. Payment refunds follow the points rules.",
      rules: "Points pricing and refund rules",
      support: "Redemption and payment support",
      error_SIGN_IN_REQUIRED: "Sign in to Station Cat first.",
      error_PRODUCT_NOT_AVAILABLE: "This product is not available for redemption.",
      error_ALREADY_OWNED: "This account already owns this product.",
      error_INSUFFICIENT_POINTS: "You need more Station Points before redeeming this product.",
      error_REDEMPTION_RATE_LIMITED: "Too many attempts. Please wait and try again.",
      error_COMMERCE_ROLLOUT_CLOSED: "The member store is opening in stages and redemption is not enabled for this account yet.",
      error_default: "We could not confirm the redemption result. Refresh to check your balance and ownership, or retry. Contact support if it remains unclear."
    },
    ja: {
      kicker: "Station Points Store",
      title: "会員用スキンとルームテーマ",
      intro: "ここではゲーム内コインではなく Station Points を使います。価格、残高、公式所有権は Station Cat サーバーが確認します。",
      loading: "会員商品を読み込み中…",
      unavailable: "会員ストアに接続できません。ローカルゲームは引き続き遊べます。",
      cached: "このアカウントで最後に同期したオフライン権利を表示しています。購入には接続が必要です。",
      empty: "現在販売中の会員商品はありません。しばらくしてからご確認ください。",
      guest: "ゲストは商品を確認できます。交換と端末間利用にはログインが必要です。",
      signIn: "ログインして交換",
      balance: "利用可能：{balance} Station Points",
      permanent: "永久 · アカウント専用 · 譲渡不可",
      buy: "{price}ポイントで交換",
      owned: "所有済み",
      use: "スキンを使う",
      remove: "元のスキンに戻す",
      roomReady: "ルーム項目を解放済み",
      paused: "販売一時停止 · 所有権は維持",
      retired: "販売終了 · 所有権は維持",
      insufficient: "ポイント不足",
      points: "Station Points を購入",
      confirmTitle: "交換の確認",
      confirmCopy: "{price} Station Points で「{name}」を永久解放しますか？サブスクリプションではありません。",
      confirmBalance: "交換前残高：{balance}ポイント",
      confirmAction: "交換する",
      cancel: "キャンセル",
      redeeming: "安全に交換中…",
      redeemed: "交換が完了し、公式権利がアカウントに追加されました。",
      skinApplied: "月夜のキジトラを適用しました。",
      skinRemoved: "元のスキンに戻しました。",
      descriptionSkin: "最初の茶トラ猫（初期名：チャトラ）専用です。名前を変えても使えます。新しい猫や他の猫のスキンは含まず、能力値も変わりません。",
      descriptionRoom: "緑の壁、ストライプ床、信号装飾、待合室配置の4項目です。緑の壁で時計付き案内板、信号装飾でランプ、待合室配置でベンチが表示されます。",
      roomScope: "「猫町 → 自分の家 → 編集」で選択します。3点の装飾はバッグの家具ではなく、個別にドラッグできません。テーブル、花瓶、単独のラグ、部屋の拡張、能力値アップは含みません。",
      roomPreview: "4項目を選択したゲーム画面です。猫、ベッド、食器は無料の基本コンテンツで、このセットには含まれません。",
      paymentNote: "商品のポイント数は初回の支払額ではありません。ポイントは現在のパック単位で購入します。最低支払額はポイント料金をご確認ください。残りはアカウントに保持されます。",
      correctionNote: "交換の問題はサポートへご連絡ください。承認された交換取消は権利を取り消して元のポイントを戻すもので、現金の返金ではありません。支払いの返金はポイント規則に従います。",
      rules: "ポイント料金と返金規則",
      support: "交換・支払いのサポート",
      error_SIGN_IN_REQUIRED: "先に Station Cat へログインしてください。",
      error_PRODUCT_NOT_AVAILABLE: "この商品は現在交換できません。",
      error_ALREADY_OWNED: "このアカウントはすでに所有しています。",
      error_INSUFFICIENT_POINTS: "Station Points が不足しています。",
      error_REDEMPTION_RATE_LIMITED: "操作が多すぎます。少し待ってから再試行してください。",
      error_COMMERCE_ROLLOUT_CLOSED: "会員ストアは段階的に公開中で、このアカウントではまだ交換できません。",
      error_default: "交換結果を確認できませんでした。更新して残高と所有権を確認するか、再試行してください。不明な場合はサポートへご連絡ください。"
    }
  };

  var dialog = {};

  function getLocale() {
    var locale = window.CatGameIntegration && window.CatGameIntegration.siteLocale;
    return copyByLocale[locale] ? locale : "zh-Hant";
  }

  function apiLocale() {
    var locale = getLocale();
    return locale === "zh-CN" ? "zh-Hans" : locale;
  }

  function getCopy() {
    return copyByLocale[getLocale()];
  }

  function formatCopy(template, values) {
    return Object.keys(values || {}).reduce(function (text, key) {
      return text.replace(new RegExp("\\{" + key + "\\}", "g"), String(values[key]));
    }, String(template || ""));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getLibraryPath() {
    var locale = getLocale();
    if (locale === "en") return "/en/library/";
    if (locale === "ja") return "/ja/library/";
    if (locale === "zh-CN") return "/zh-hans/library/";
    return "/zh-hant/library/";
  }

  function getPointsPath() {
    var locale = getLocale();
    if (locale === "en") return "/en/points/";
    if (locale === "ja") return "/ja/points/";
    if (locale === "zh-CN") return "/zh-hans/points/";
    return "/zh-hant/points/";
  }

  function getLoginHref() {
    var returnPath = window.location.pathname + window.location.search;
    return getLibraryPath() + "?returnTo=" + encodeURIComponent(returnPath);
  }

  function requestJson(path, options) {
    return fetch(path, Object.assign({ credentials: "same-origin" }, options || {})).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !data.ok) {
          var error = new Error(data.message || "Request failed");
          error.status = response.status;
          error.code = data.code || "";
          error.data = data;
          throw error;
        }
        return data;
      });
    });
  }

  function cacheKey(accountId) {
    return cachePrefix + String(accountId);
  }

  function preferenceKey(accountId) {
    return preferencePrefix + String(accountId);
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "") || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function writeEntitlementCache() {
    if (!state.authenticated || !state.account || !state.account.id) return;
    try {
      localStorage.setItem(lastAccountKey, String(state.account.id));
    } catch (error) {
    }
    writeJson(cacheKey(state.account.id), {
      account: state.account,
      entitlements: state.entitlements,
      cachedAt: new Date().toISOString()
    });
  }

  function useOfflineCache() {
    var accountId = "";
    try {
      var memberAccountId = String(localStorage.getItem(memberAccountKey) || "");
      if (memberAccountId === "guest") return false;
      accountId = memberAccountId || String(localStorage.getItem(lastAccountKey) || "");
    } catch (error) {
    }
    if (!accountId) return false;
    var cached = readJson(cacheKey(accountId), null);
    if (!cached || !cached.account || !Array.isArray(cached.entitlements)) return false;
    state.authenticated = false;
    state.offlineCache = true;
    state.account = cached.account;
    state.balance = null;
    state.products = [];
    state.entitlements = cached.entitlements;
    return true;
  }

  function hasEntitlement(entitlementKey) {
    return state.entitlements.some(function (entry) {
      return entry && entry.active !== false && entry.entitlementKey === entitlementKey;
    });
  }

  function getPreferences() {
    if (!state.account || !state.account.id) return {};
    return readJson(preferenceKey(state.account.id), {});
  }

  function updatePreferences(changes) {
    if (!state.account || !state.account.id) return false;
    return writeJson(preferenceKey(state.account.id), Object.assign({}, getPreferences(), changes));
  }

  function isMoonlitEquipped() {
    var manifest = manifests["cat-life.skin.moonlit-tabby"];
    return Boolean(manifest && hasEntitlement(manifest.entitlementKey))
      && getPreferences().equippedSkin === "cat-life.skin.moonlit-tabby";
  }

  function getCatSprite(cat) {
    if (!cat || !isMoonlitEquipped()) return "";
    var skin = contentManifest.getSkin("cat-life.skin.moonlit-tabby", cat.id);
    return skin ? new URL(skin.sprite, document.baseURI).href : "";
  }

  function getCatWalkSprite(cat) {
    if (!cat || !isMoonlitEquipped()) return "";
    var skin = contentManifest.getSkin("cat-life.skin.moonlit-tabby", cat.id);
    return skin && skin.walkSprite ? new URL(skin.walkSprite, document.baseURI).href : getCatSprite(cat);
  }

  function getProductDescription(productId) {
    var copy = getCopy();
    if (productId === "cat-life.skin.moonlit-tabby") return copy.descriptionSkin;
    if (productId === "cat-life.bundle.station-room") return copy.descriptionRoom;
    return "";
  }

  function renderSupportLinks() {
    var copy = getCopy();
    return '<a href="' + escapeHtml(getPointsPath()) + '">' + escapeHtml(copy.rules) +
      '</a><a href="mailto:brodstem@protonmail.com">' + escapeHtml(copy.support) + '</a>';
  }

  function productList() {
    var items = state.products.slice();
    state.entitlements.forEach(function (entitlement) {
      if (items.some(function (item) { return item.productId === entitlement.productId; })) return;
      items.push({
        productId: entitlement.productId,
        name: entitlement.productName || entitlement.productId,
        pointsPrice: null,
        lifecycleStatus: entitlement.lifecycleStatus || "retired",
        entitlementKey: entitlement.entitlementKey,
        owned: true,
        redeemable: false
      });
    });
    return items.filter(function (product) { return manifests[product.productId]; });
  }

  function statusCopy(product) {
    var copy = getCopy();
    if (product.lifecycleStatus === "paused") return copy.paused;
    if (product.lifecycleStatus === "retired") return copy.retired;
    if (product.owned || hasEntitlement(product.entitlementKey)) return copy.owned;
    return copy.permanent;
  }

  function renderProduct(product) {
    var copy = getCopy();
    var manifest = manifests[product.productId];
    var owned = Boolean(product.owned || hasEntitlement(product.entitlementKey || manifest.entitlementKey));
    var canAfford = state.balance !== null && Number(state.balance) >= Number(product.pointsPrice || 0);
    var action = "";
    if (owned && manifest.kind === "skin") {
      action = '<button class="store-button" type="button" data-cat-commerce-action="toggle-skin">' +
        escapeHtml(isMoonlitEquipped() ? copy.remove : copy.use) + "</button>";
    } else if (owned && manifest.kind === "room") {
      action = '<span class="status-pill is-success">' + escapeHtml(copy.roomReady) + "</span>";
    } else if (!state.authenticated) {
      action = '<a class="store-button" href="' + escapeHtml(getLoginHref()) + '">' + escapeHtml(copy.signIn) + "</a>";
    } else if (!product.redeemable) {
      action = '<button class="store-button" type="button" disabled>' + escapeHtml(statusCopy(product)) + "</button>";
    } else if (!canAfford) {
      action = '<a class="store-button" href="' + escapeHtml(getPointsPath()) + '">' + escapeHtml(copy.insufficient) + "</a>";
    } else {
      action = '<button class="store-button" type="button" data-cat-commerce-action="confirm" data-product-id="' +
        escapeHtml(product.productId) + '">' + escapeHtml(formatCopy(copy.buy, { price: product.pointsPrice })) + "</button>";
    }
    return (
      '<article class="shop-card station-commerce-card' + (owned ? " is-owned" : "") + '">' +
      '<div class="shop-art station-commerce-art"><img src="' + escapeHtml(manifest.image) + '" alt="' +
      escapeHtml(product.name) + '" width="' + manifest.imageSize.width + '" height="' + manifest.imageSize.height + '" loading="lazy" /></div>' +
      (manifest.kind === "room" ? '<p class="station-commerce-caption">' + escapeHtml(copy.roomPreview) + '</p>' : '') +
      '<div class="shop-row"><div><p class="section-eyebrow">' + escapeHtml(copy.kicker) + '</p><h3 class="panel-title">' +
      escapeHtml(product.name) + '</h3></div>' +
      (product.pointsPrice === null ? "" : '<span class="pill">' + escapeHtml(String(product.pointsPrice)) + " Station Points</span>") +
      '</div><p class="page-copy">' + escapeHtml(getProductDescription(product.productId)) + "</p>" +
      (manifest.kind === "room" ? '<p class="shop-meta">' + escapeHtml(copy.roomScope) + '</p>' : '') +
      '<p class="shop-meta">' + escapeHtml(copy.permanent) + "</p>" +
      '<div class="inline-row station-commerce-actions"><span class="status-pill ' + (owned ? "is-success" : "") + '">' +
      escapeHtml(statusCopy(product)) + "</span>" + action + "</div></article>"
    );
  }

  function renderShopSection() {
    var copy = getCopy();
    var products = productList();
    var summary = copy.loading;
    if (state.status === "ready") {
      summary = state.authenticated ? formatCopy(copy.balance, { balance: state.balance }) : copy.guest;
    } else if (state.status === "offline") {
      summary = state.offlineCache ? copy.cached : copy.unavailable;
    }
    var message = state.message
      ? '<p class="station-commerce-message ' + (state.messageTone ? "is-" + escapeHtml(state.messageTone) : "") + '" role="status">' + escapeHtml(state.message) + "</p>"
      : "";
    return (
      '<section class="page-card station-commerce" data-cat-commerce-section>' +
      '<div class="inline-row station-commerce-heading"><div><p class="section-eyebrow">' + escapeHtml(copy.kicker) +
      '</p><h3 class="panel-title">' + escapeHtml(copy.title) + '</h3></div>' +
      '<button class="secondary-button" type="button" data-cat-commerce-action="refresh" aria-label="Refresh">↻</button></div>' +
      '<p class="page-copy">' + escapeHtml(copy.intro) + '</p><p class="helper-text station-commerce-summary">' + escapeHtml(summary) + "</p>" + message +
      (state.status === "loading" || state.status === "idle"
        ? '<div class="empty-state">' + escapeHtml(copy.loading) + "</div>"
        : products.length
          ? '<div class="shop-grid station-commerce-grid">' + products.map(renderProduct).join("") + "</div>"
          : '<div class="empty-state">' + escapeHtml(copy.empty) + "</div>") +
      '<footer class="station-commerce-guidance"><p>' + escapeHtml(copy.paymentNote) + '</p><p>' +
      escapeHtml(copy.correctionNote) + '</p><div class="station-commerce-links">' + renderSupportLinks() + '</div></footer></section>'
    );
  }

  function refreshView() {
    if (window.CatGameApp && typeof window.CatGameApp.render === "function") {
      // Membership responses can arrive while another page is being edited.
      // Update entitlements immediately without treating it as a player action.
      window.CatGameApp.render(true);
    }
  }

  function refresh(options) {
    // Latest-started refresh owns all state/cache/render side effects. Requests
    // may finish out of order when locale or account data is refreshed again.
    var revision = ++refreshRevision;
    var settings = options || {};
    if (!settings.silent) {
      state.status = "loading";
      state.message = "";
      refreshView();
    }
    var locale = encodeURIComponent(apiLocale());
    return Promise.all([
      requestJson(catalogPath + "?locale=" + locale),
      requestJson(entitlementsPath + "?locale=" + locale)
    ]).then(function (responses) {
      if (revision !== refreshRevision) return state;
      var catalog = responses[0];
      var entitlementResult = responses[1];
      // A session can change between the two HTTP requests. Never assemble an
      // account, balance and ownership list from different identities.
      if (Boolean(catalog.authenticated) !== Boolean(entitlementResult.authenticated) ||
        (catalog.authenticated && (!catalog.account || !entitlementResult.account ||
          !catalog.account.id || String(catalog.account.id) !== String(entitlementResult.account.id)))) {
        throw new Error("Membership responses do not belong to the same account");
      }
      state.status = "ready";
      state.offlineCache = false;
      state.authenticated = Boolean(catalog.authenticated && entitlementResult.authenticated);
      state.account = catalog.account || entitlementResult.account || null;
      state.balance = state.authenticated ? Number(entitlementResult.balance == null ? catalog.balance || 0 : entitlementResult.balance) : null;
      state.products = Array.isArray(catalog.products) ? catalog.products : [];
      state.entitlements = Array.isArray(entitlementResult.entitlements) ? entitlementResult.entitlements : [];
      if (state.authenticated) writeEntitlementCache();
      refreshView();
      return state;
    }).catch(function () {
      if (revision !== refreshRevision) return state;
      state.status = "offline";
      if (!useOfflineCache()) {
        state.authenticated = false;
        state.account = null;
        state.balance = null;
        state.products = [];
        state.entitlements = [];
      }
      refreshView();
      return state;
    });
  }

  function findProduct(productId) {
    return productList().find(function (product) { return product.productId === productId; }) || null;
  }

  function closeDialog() {
    if (!dialog.root) return;
    if (typeof dialog.root.close === "function") dialog.root.close();
    else dialog.root.removeAttribute("open");
  }

  function showDialog(product) {
    var copy = getCopy();
    if (!dialog.root || !product) return;
    dialog.root.dataset.productId = product.productId;
    dialog.title.textContent = copy.confirmTitle;
    dialog.copy.textContent = formatCopy(copy.confirmCopy, { price: product.pointsPrice, name: product.name });
    dialog.scope.textContent = getProductDescription(product.productId) +
      (manifests[product.productId].kind === "room" ? " " + copy.roomScope : "");
    dialog.policy.textContent = copy.correctionNote;
    dialog.links.innerHTML = renderSupportLinks();
    dialog.balance.textContent = formatCopy(copy.confirmBalance, { balance: state.balance });
    dialog.status.textContent = "";
    dialog.confirm.textContent = copy.confirmAction;
    dialog.confirm.disabled = false;
    dialog.cancel.textContent = copy.cancel;
    if (typeof dialog.root.showModal === "function" && !dialog.root.open) dialog.root.showModal();
    else dialog.root.setAttribute("open", "");
  }

  function createIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return "clg_" + window.crypto.randomUUID();
    return "clg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
  }

  function errorCopy(error) {
    var copy = getCopy();
    return copy["error_" + String(error && error.code || "")] || copy.error_default;
  }

  function redeem(productId) {
    var product = findProduct(productId);
    var copy = getCopy();
    if (!product || !state.authenticated) return Promise.resolve(false);
    var idempotencyKey = pendingKeys[productId] || createIdempotencyKey();
    pendingKeys[productId] = idempotencyKey;
    dialog.confirm.disabled = true;
    dialog.status.textContent = copy.redeeming;
    return requestJson(redemptionPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId: productId, idempotencyKey: idempotencyKey })
    }).then(function (result) {
      delete pendingKeys[productId];
      state.balance = Number(result.balance || 0);
      state.message = copy.redeemed;
      state.messageTone = "success";
      closeDialog();
      return refresh({ silent: true }).then(function () { return true; });
    }).catch(function (error) {
      if (error.status && error.status < 500) delete pendingKeys[productId];
      dialog.confirm.disabled = false;
      dialog.status.textContent = errorCopy(error);
      return false;
    });
  }

  function toggleSkin() {
    var copy = getCopy();
    var next = isMoonlitEquipped() ? "" : "cat-life.skin.moonlit-tabby";
    var manifest = manifests["cat-life.skin.moonlit-tabby"];
    if (!manifest || !hasEntitlement(manifest.entitlementKey)) return;
    updatePreferences({ equippedSkin: next });
    state.message = next ? copy.skinApplied : copy.skinRemoved;
    state.messageTone = "success";
    refreshView();
  }

  function bindDialog() {
    dialog.root = document.querySelector("[data-cat-commerce-dialog]");
    if (!dialog.root) return;
    dialog.title = dialog.root.querySelector("[data-cat-commerce-title]");
    dialog.copy = dialog.root.querySelector("[data-cat-commerce-copy]");
    dialog.scope = dialog.root.querySelector("[data-cat-commerce-scope]");
    dialog.policy = dialog.root.querySelector("[data-cat-commerce-policy]");
    dialog.links = dialog.root.querySelector("[data-cat-commerce-links]");
    dialog.balance = dialog.root.querySelector("[data-cat-commerce-balance]");
    dialog.status = dialog.root.querySelector("[data-cat-commerce-status]");
    dialog.confirm = dialog.root.querySelector("[data-cat-commerce-confirm]");
    dialog.cancel = dialog.root.querySelector("[data-cat-commerce-cancel]");
    dialog.confirm.addEventListener("click", function () {
      redeem(dialog.root.dataset.productId).catch(function () {});
    });
    dialog.cancel.addEventListener("click", closeDialog);
  }

  function handleClick(event) {
    var target = event.target.closest("[data-cat-commerce-action]");
    if (!target) return;
    var action = target.dataset.catCommerceAction;
    if (action === "refresh") refresh();
    if (action === "confirm") showDialog(findProduct(target.dataset.productId));
    if (action === "toggle-skin") toggleSkin();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    bindDialog();
    document.addEventListener("click", handleClick);
    window.addEventListener("catgame:site-locale", function () { refresh(); });
    window.addEventListener("catgame:member-session", function () {
      if (state.status !== "offline") return;
      if (!useOfflineCache()) {
        state.authenticated = false;
        state.offlineCache = false;
        state.account = null;
        state.balance = null;
        state.products = [];
        state.entitlements = [];
      }
      refreshView();
    });
    refresh();
  }

  window.CatGameCommerce = {
    init: init,
    refresh: refresh,
    renderShopSection: renderShopSection,
    hasEntitlement: hasEntitlement,
    getCatSprite: getCatSprite,
    getCatWalkSprite: getCatWalkSprite,
    isMoonlitEquipped: isMoonlitEquipped,
    manifests: manifests,
    getSnapshot: function () {
      return JSON.parse(JSON.stringify(state));
    }
  };
})();
