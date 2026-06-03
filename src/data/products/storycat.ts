export const STORYCAT_TESTFLIGHT_URL = 'https://testflight.apple.com/join/VF222edq';

export const isStoryCatTestFlightReady =
  STORYCAT_TESTFLIGHT_URL.startsWith('https://testflight.apple.com/join/') &&
  !STORYCAT_TESTFLIGHT_URL.includes('REPLACE_WITH_REAL_CODE');

export const storyCatProduct = {
  id: 'storycat',
  slug: 'storycat',
  name: 'StoryCat',
  displayName: 'StoryCat / 故事猫',
  status: 'ios-testing-soon',
  platform: 'iOS',
  testFlightUrl: STORYCAT_TESTFLIGHT_URL,
  productPath: '/apps/storycat/',
  zhHantProductPath: '/zh-hant/apps/storycat/',
  zhHansProductPath: '/zh-hans/apps/storycat/',
  jaProductPath: '/ja/apps/storycat/',
  testFlightAnchor: '#testflight',
  assets: {
    preview: '/images/storycat-preview.svg'
  }
} as const;

type StoryCatLocale = 'zh-Hant' | 'zh-Hans' | 'en' | 'ja';

export const storyCatCopy: Record<StoryCatLocale, {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  headline: string;
  intro: string;
  primaryCta: string;
  secondaryCta: string;
  notReadyCta: string;
  betaNote: string;
  generatedNote: string;
  previewLabel: string;
  previewTitle: string;
  previewBody: string;
  previewChoices: string[];
  howTitle: string;
  howIntro: string;
  steps: { title: string; text: string }[];
  whyTitle: string;
  whyItems: { title: string; text: string }[];
  templatesTitle: string;
  templatesIntro: string;
  templates: { title: string; text: string }[];
  testTitle: string;
  testIntro: string;
  testNotes: string[];
  privacyTitle: string;
  privacyIntro: string;
  privacyPoints: string[];
  faqTitle: string;
  faq: { question: string; answer: string }[];
}> = {
  'zh-Hant': {
    metaTitle: 'StoryCat 故事貓｜AI 互動故事測試｜Station Cat',
    metaDescription: 'StoryCat 是 Station Cat 正在測試的 AI 互動故事 App，讓你建立主角、選擇模板，進入一部會回應你的可玩小說。',
    eyebrow: 'iOS TestFlight',
    title: 'StoryCat / 故事貓',
    headline: '把一個想法，玩成一段會長大的故事。',
    intro: 'StoryCat 是一款 AI 互動故事測試 App。你可以建立主角、選一個故事模板，然後在每個章節做選擇，讓故事跟著你的決定往前走。',
    primaryCta: '參與 iOS 測試',
    secondaryCta: '看看玩法',
    notReadyCta: '測試連結準備中',
    betaNote: '目前是早期測試版本，故事品質、節奏和模板還會持續調整。',
    generatedNote: '頁面中的故事示例為展示用 AI 生成內容。',
    previewLabel: 'Chapter 01',
    previewTitle: '雨夜的小站',
    previewBody: '雨停在最後一班車抵達前。你抱著一本空白筆記，站在亮著暖燈的月台上。站牌寫著一個陌生名字：StoryCat。',
    previewChoices: ['跟著貓走進候車室', '打開筆記，寫下第一句話', '等下一班不在時刻表上的車'],
    howTitle: '玩法很輕，故事會慢慢展開。',
    howIntro: '這不是要你一次寫完整本小說，而是把故事拆成可以玩的幾步。',
    steps: [
      { title: '建立主角', text: '寫下名字、性格、背景，先讓故事有一個可以陪你走的人。' },
      { title: '選擇模板', text: '從奇幻、校園、懸疑、療癒或冒險類型開始，不需要從空白頁硬想。' },
      { title: '閱讀章節', text: '每一段故事會根據你的設定和前一次選擇繼續生成。' },
      { title: '做出選擇', text: '選一條路，或者輸入自己的想法，讓下一章更靠近你。' }
    ],
    whyTitle: '它不是普通閱讀器。',
    whyItems: [
      { title: '可玩小說', text: '故事不是固定頁面，你的選擇會改變下一段走向。' },
      { title: '角色先行', text: '主角設定會影響語氣、遭遇和故事中的關係。' },
      { title: '短章節節奏', text: '適合通勤、睡前或碎片時間，一次讀一小段也能接上。' },
      { title: '仍在打磨', text: '目前重點測試故事連貫性、選項有趣程度和模板穩定性。' }
    ],
    templatesTitle: '目前會先測這些故事模板。',
    templatesIntro: '模板不是限制，而是讓你更快進入故事的入口。',
    templates: [
      { title: '奇幻冒險', text: '從一座陌生城鎮、一封邀請信或一隻會說話的貓開始。' },
      { title: '校園日常', text: '把社團、午休、雨天走廊和小秘密寫成可選擇的故事。' },
      { title: '懸疑小案', text: '追一個不太可怕、但很想知道答案的謎。' },
      { title: '療癒生活', text: '慢一點的故事，適合咖啡、晚風和整理心情。' },
      { title: '異世界開局', text: '醒來時發現規則變了，你需要先活過第一章。' },
      { title: '創作者腦洞', text: '把一句奇怪想法變成可以繼續玩的設定。' }
    ],
    testTitle: '第一輪 iOS 測試準備中。',
    testIntro: '等 TestFlight public link 準備好後，這裡會變成正式參與測試入口。',
    testNotes: [
      '適合願意試玩早期版本、回報故事問題和體驗感受的使用者。',
      '測試重點包含角色建立、模板選擇、章節生成、選項回應和故事連貫性。',
      '早期版本可能會有重複、斷句、節奏不穩或內容不夠聰明的情況。'
    ],
    privacyTitle: '隱私和 AI 提醒。',
    privacyIntro: 'StoryCat 目前以測試玩法為主，不在這個頁面收集帳號或付款資料。',
    privacyPoints: [
      '請不要在測試內容中輸入真實身份證件、密碼、私密地址或敏感個人資料。',
      'AI 生成故事可能不完美，也可能需要你重新整理或調整設定。',
      '正式上架前，隱私政策會依照實際資料流程再更新。'
    ],
    faqTitle: '常見問題',
    faq: [
      { question: '現在可以下載嗎？', answer: '目前先保留 TestFlight 入口位置。等公開測試連結確認後，按鈕會改成可以直接參與 iOS 測試。' },
      { question: 'StoryCat 是遊戲還是小說？', answer: '更接近可玩的互動小說。它有閱讀，也有選擇和角色設定。' },
      { question: '需要登入嗎？', answer: '這一版網站頁面不新增登入、資料庫或後端功能。App 內的實際資料流程會以後續版本為準。' },
      { question: 'Android 會有嗎？', answer: '目前先測 iOS。Android 版本會看測試結果和開發排期再決定。' }
    ]
  },
  'zh-Hans': {
    metaTitle: 'StoryCat 故事猫｜AI 互动故事测试｜Station Cat',
    metaDescription: 'StoryCat 是 Station Cat 正在测试的 AI 互动故事 App，让你创建主角、选择模板，进入一部会回应你的可玩小说。',
    eyebrow: 'iOS TestFlight',
    title: 'StoryCat / 故事猫',
    headline: '把一个想法，玩成一段会长大的故事。',
    intro: 'StoryCat 是一款 AI 互动故事测试 App。你可以创建主角、选一个故事模板，然后在每个章节做选择，让故事跟着你的决定往前走。',
    primaryCta: '参与 iOS 测试',
    secondaryCta: '看看玩法',
    notReadyCta: '测试链接准备中',
    betaNote: '目前是早期测试版本，故事质量、节奏和模板还会持续调整。',
    generatedNote: '页面中的故事示例为展示用 AI 生成内容。',
    previewLabel: 'Chapter 01',
    previewTitle: '雨夜的小站',
    previewBody: '雨停在最后一班车抵达前。你抱着一本空白笔记，站在亮着暖灯的月台上。站牌写着一个陌生名字：StoryCat。',
    previewChoices: ['跟着猫走进候车室', '打开笔记，写下第一句话', '等下一班不在时刻表上的车'],
    howTitle: '玩法很轻，故事会慢慢展开。',
    howIntro: '这不是要你一次写完整本小说，而是把故事拆成可以玩的几步。',
    steps: [
      { title: '创建主角', text: '写下名字、性格、背景，先让故事有一个可以陪你走的人。' },
      { title: '选择模板', text: '从奇幻、校园、悬疑、疗愈或冒险类型开始，不需要从空白页硬想。' },
      { title: '阅读章节', text: '每一段故事会根据你的设定和前一次选择继续生成。' },
      { title: '做出选择', text: '选一条路，或者输入自己的想法，让下一章更靠近你。' }
    ],
    whyTitle: '它不是普通阅读器。',
    whyItems: [
      { title: '可玩小说', text: '故事不是固定页面，你的选择会改变下一段走向。' },
      { title: '角色先行', text: '主角设定会影响语气、遭遇和故事中的关系。' },
      { title: '短章节节奏', text: '适合通勤、睡前或碎片时间，一次读一小段也能接上。' },
      { title: '仍在打磨', text: '目前重点测试故事连贯性、选项有趣程度和模板稳定性。' }
    ],
    templatesTitle: '目前会先测这些故事模板。',
    templatesIntro: '模板不是限制，而是让你更快进入故事的入口。',
    templates: [
      { title: '奇幻冒险', text: '从一座陌生城镇、一封邀请信或一只会说话的猫开始。' },
      { title: '校园日常', text: '把社团、午休、雨天走廊和小秘密写成可选择的故事。' },
      { title: '悬疑小案', text: '追一个不太可怕、但很想知道答案的谜。' },
      { title: '疗愈生活', text: '慢一点的故事，适合咖啡、晚风和整理心情。' },
      { title: '异世界开局', text: '醒来时发现规则变了，你需要先活过第一章。' },
      { title: '创作者脑洞', text: '把一句奇怪想法变成可以继续玩的设定。' }
    ],
    testTitle: '第一轮 iOS 测试准备中。',
    testIntro: '等 TestFlight public link 准备好后，这里会变成正式参与测试入口。',
    testNotes: [
      '适合愿意试玩早期版本、回报故事问题和体验感受的用户。',
      '测试重点包含角色创建、模板选择、章节生成、选项回应和故事连贯性。',
      '早期版本可能会有重复、断句、节奏不稳或内容不够聪明的情况。'
    ],
    privacyTitle: '隐私和 AI 提醒。',
    privacyIntro: 'StoryCat 目前以测试玩法为主，不在这个页面收集账号或付款资料。',
    privacyPoints: [
      '请不要在测试内容中输入真实身份证件、密码、私密地址或敏感个人资料。',
      'AI 生成故事可能不完美，也可能需要你重新整理或调整设定。',
      '正式上架前，隐私政策会按照实际数据流程再更新。'
    ],
    faqTitle: '常见问题',
    faq: [
      { question: '现在可以下载吗？', answer: '目前先保留 TestFlight 入口位置。等公开测试链接确认后，按钮会改成可以直接参与 iOS 测试。' },
      { question: 'StoryCat 是游戏还是小说？', answer: '更接近可玩的互动小说。它有阅读，也有选择和角色设定。' },
      { question: '需要登录吗？', answer: '这一版网站页面不新增登录、数据库或后端功能。App 内的实际数据流程会以后续版本为准。' },
      { question: 'Android 会有吗？', answer: '目前先测 iOS。Android 版本会看测试结果和开发排期再决定。' }
    ]
  },
  en: {
    metaTitle: 'StoryCat: AI Playable Novel｜Station Cat',
    metaDescription: 'StoryCat is an AI interactive story app in testing by Station Cat. Create a protagonist, choose a template, and play through a story that responds to you.',
    eyebrow: 'iOS TestFlight',
    title: 'StoryCat',
    headline: 'Turn a small idea into a story that keeps growing.',
    intro: 'StoryCat is an early AI interactive story app. You create a protagonist, choose a story template, and make choices chapter by chapter as the story responds.',
    primaryCta: 'Join iOS TestFlight',
    secondaryCta: 'See how it works',
    notReadyCta: 'Test link preparing',
    betaNote: 'This is an early test build. Story quality, pacing, and templates will continue to change.',
    generatedNote: 'The story sample on this page is AI-generated demo content.',
    previewLabel: 'Chapter 01',
    previewTitle: 'The rainy station',
    previewBody: 'The rain stops just before the last train arrives. You hold a blank notebook under a warm platform light. The sign shows an unfamiliar name: StoryCat.',
    previewChoices: ['Follow the cat into the waiting room', 'Open the notebook and write the first line', 'Wait for a train that is not on the schedule'],
    howTitle: 'Light to play, slow to unfold.',
    howIntro: 'You do not need to write a whole novel at once. StoryCat breaks it into small playable steps.',
    steps: [
      { title: 'Create a protagonist', text: 'Name them, shape their personality, and give the story someone to follow.' },
      { title: 'Pick a template', text: 'Start from fantasy, school life, mystery, cozy life, or adventure without staring at a blank page.' },
      { title: 'Read a chapter', text: 'Each section continues from your setup and previous choices.' },
      { title: 'Choose the next move', text: 'Pick an option or add your own idea so the next chapter feels closer to you.' }
    ],
    whyTitle: 'Not just a reader.',
    whyItems: [
      { title: 'Playable fiction', text: 'The story is not fixed. Your choices shape what happens next.' },
      { title: 'Character first', text: 'Your protagonist affects tone, encounters, and relationships inside the story.' },
      { title: 'Short chapter rhythm', text: 'Built for a commute, bedtime, or a small break without losing the thread.' },
      { title: 'Still being tuned', text: 'The current test focuses on continuity, fun choices, and stable templates.' }
    ],
    templatesTitle: 'Templates planned for the first test.',
    templatesIntro: 'Templates are not limits. They are doorways into the story.',
    templates: [
      { title: 'Fantasy adventure', text: 'Start from a strange town, a letter, or a cat that can talk.' },
      { title: 'School days', text: 'Clubs, lunch breaks, rainy hallways, and small secrets.' },
      { title: 'Soft mystery', text: 'Follow a question that is not too scary but hard to leave alone.' },
      { title: 'Cozy life', text: 'Slower stories for coffee, evening wind, and clearing your mind.' },
      { title: 'Another world', text: 'Wake up where the rules have changed and survive chapter one.' },
      { title: 'Creator odd idea', text: 'Turn one strange sentence into a setting you can keep playing.' }
    ],
    testTitle: 'First iOS test is preparing.',
    testIntro: 'When the TestFlight public link is ready, this section will become the active test entry.',
    testNotes: [
      'Best for testers who are willing to try an early build and share what feels confusing or fun.',
      'The first test focuses on character setup, templates, chapter generation, choices, and continuity.',
      'Early builds may repeat themselves, break pacing, or generate lines that still need tuning.'
    ],
    privacyTitle: 'Privacy and AI note.',
    privacyIntro: 'This page does not add accounts, payments, databases, or backend collection for StoryCat.',
    privacyPoints: [
      'Do not enter real identity documents, passwords, private addresses, or sensitive personal information while testing.',
      'AI-generated stories may be imperfect and may need you to refresh or adjust the setup.',
      'Before a public release, the privacy policy will be updated around the real app data flow.'
    ],
    faqTitle: 'FAQ',
    faq: [
      { question: 'Can I download it now?', answer: 'The TestFlight entry is reserved for now. Once the public test link is confirmed, the button will open the iOS test directly.' },
      { question: 'Is StoryCat a game or a novel?', answer: 'It is closer to a playable interactive novel: part reading, part choices, part character setup.' },
      { question: 'Does it require login?', answer: 'This website update does not add login, database, or backend logic. The in-app data flow will follow later app versions.' },
      { question: 'Will there be Android?', answer: 'The first test is iOS. Android depends on test results and the later development schedule.' }
    ]
  },
  ja: {
    metaTitle: 'StoryCat｜AI インタラクティブストーリー｜Station Cat',
    metaDescription: 'StoryCat は Station Cat がテスト中の AI インタラクティブストーリーアプリです。主人公を作り、テンプレートを選び、反応する物語を遊べます。',
    eyebrow: 'iOS TestFlight',
    title: 'StoryCat',
    headline: '小さなアイデアを、少しずつ育つ物語に。',
    intro: 'StoryCat はテスト中の AI インタラクティブストーリーアプリです。主人公を作り、物語テンプレートを選び、章ごとの選択でストーリーを進めます。',
    primaryCta: 'iOS TestFlight に参加',
    secondaryCta: '遊び方を見る',
    notReadyCta: 'テストリンク準備中',
    betaNote: '現在は初期テスト版です。物語の品質、テンポ、テンプレートは今後も調整します。',
    generatedNote: 'このページの物語サンプルは表示用の AI 生成コンテンツです。',
    previewLabel: 'Chapter 01',
    previewTitle: '雨の夜の小さな駅',
    previewBody: '最終列車が着く少し前に、雨が止みました。あなたは白紙のノートを抱え、暖かい灯りのホームに立っています。駅名標には見知らぬ名前がありました。StoryCat。',
    previewChoices: ['猫について待合室へ行く', 'ノートを開いて最初の一文を書く', '時刻表にない次の列車を待つ'],
    howTitle: '軽く遊べて、物語は少しずつ広がります。',
    howIntro: '一度に長い小説を書く必要はありません。StoryCat は物語を小さなステップに分けます。',
    steps: [
      { title: '主人公を作る', text: '名前、性格、背景を決めて、物語に一緒に進む人を置きます。' },
      { title: 'テンプレートを選ぶ', text: 'ファンタジー、学園、ミステリー、癒やし、冒険から気軽に始められます。' },
      { title: '章を読む', text: '設定と前回の選択に合わせて、次の短い章が生成されます。' },
      { title: '次を選ぶ', text: '選択肢を選ぶか、自分の案を入力して次の章に進みます。' }
    ],
    whyTitle: '普通の読書アプリではありません。',
    whyItems: [
      { title: '遊べる物語', text: '固定されたページではなく、選択によって次の展開が変わります。' },
      { title: 'キャラクターから始まる', text: '主人公の設定が、語り口や出会い、関係性に影響します。' },
      { title: '短い章のリズム', text: '移動中、寝る前、少しの休憩でも続きに入りやすい形です。' },
      { title: 'まだ調整中', text: '現在は連続性、選択肢の面白さ、テンプレートの安定性を見ています。' }
    ],
    templatesTitle: '最初のテストで試す予定のテンプレート。',
    templatesIntro: 'テンプレートは制限ではなく、物語に入るための入口です。',
    templates: [
      { title: 'ファンタジー冒険', text: '知らない街、招待状、話せる猫から始まる物語。' },
      { title: '学園の日常', text: '部活、昼休み、雨の廊下、小さな秘密。' },
      { title: 'やさしい謎', text: '怖すぎないけれど、答えが気になる小さな事件。' },
      { title: '癒やし生活', text: 'コーヒー、夕方の風、気持ちを整える遅めの物語。' },
      { title: '異世界の始まり', text: '目を覚ますとルールが変わっていて、まず第一章を生き抜く。' },
      { title: 'クリエイターの変な案', text: '一つの不思議な一文を、続けて遊べる設定にします。' }
    ],
    testTitle: '最初の iOS テストを準備中です。',
    testIntro: 'TestFlight の公開リンクが準備できたら、この場所が正式な参加入口になります。',
    testNotes: [
      '初期版を試し、分かりにくいところや楽しいところを共有できる方向けです。',
      '主人公作成、テンプレート選択、章生成、選択肢、ストーリーの連続性を中心に見ます。',
      '初期版では繰り返し、テンポの乱れ、まだ調整が必要な文章が出る場合があります。'
    ],
    privacyTitle: 'プライバシーと AI について。',
    privacyIntro: 'このページでは StoryCat 用のアカウント、支払い、データベース、バックエンド収集は追加しません。',
    privacyPoints: [
      'テスト中に身分証、パスワード、住所、センシティブな個人情報を入力しないでください。',
      'AI 生成の物語は完璧ではなく、再生成や設定の調整が必要になる場合があります。',
      '正式公開前に、実際のデータフローに合わせてプライバシーポリシーを更新します。'
    ],
    faqTitle: 'FAQ',
    faq: [
      { question: '今すぐダウンロードできますか？', answer: '現在は TestFlight 入口だけを用意しています。公開テストリンクが確認できたら、ボタンから iOS テストに参加できます。' },
      { question: 'StoryCat はゲームですか、小説ですか？', answer: '読書、選択、キャラクター設定が混ざった、遊べるインタラクティブ小説に近いです。' },
      { question: 'ログインは必要ですか？', answer: '今回のサイト更新ではログイン、データベース、バックエンド機能は追加しません。アプリ内の実際のデータフローは今後のバージョンに合わせます。' },
      { question: 'Android 版はありますか？', answer: 'まずは iOS テストから始めます。Android はテスト結果と開発スケジュールを見て判断します。' }
    ]
  }
};

export type StoryCatProduct = typeof storyCatProduct;
