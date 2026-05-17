export const captionAiJa = {
  seo: {
    title: 'SnapCopy | 写真に合うSNSキャプションをすぐに',
    description:
      '朝食、カフェ、散歩、ペット、旅行、コーデ、日常の写真から、SNSに使いやすいキャプションを作成します。'
  },
  hero: {
    eyebrow: 'SnapCopy',
    productName: 'SnapCopy',
    title: '写真にぴったりの言葉を、すぐに。',
    subtitle:
      '朝食、カフェ、散歩、ペット、旅行、日常の写真から、SNSに使いやすいキャプションを作成します。写真の雰囲気を読み取り、あなたの好みに合わせた言葉を提案することを目指しています。',
    primaryCta: 'iOSの順番待ちに登録',
    secondaryCta: 'プライバシーを見る'
  },
  visual: {
    alt: 'SnapCopy のスマートフォン画面。カフェの写真と複数のキャプション案を表示しています',
    detected: '検出シーン：カフェ · 朝 · 落ち着いた雰囲気',
    captions: [
      '一日がにぎやかになる前の、静かなコーヒー時間。',
      '小さなテーブルとやわらかい光で、少し気分が整う。',
      '今日はコーヒーと少しの余裕から。'
    ],
    chips: ['朝食', 'カフェ', '散歩', 'ペット', '旅行']
  },
  howItWorks: {
    title: 'SnapCopy の使い方',
    steps: [
      { title: '写真を選ぶ', description: '朝食、カフェ、散歩、ペット、旅行など、日常の写真を選びます。' },
      { title: 'シーンを理解する', description: '写真の内容を分析し、キャプション作成に使いやすいシーン情報に整理します。' },
      { title: 'キャプションを作成する', description: '利用できる環境では Apple のオンデバイス AI を優先し、写真やトーンに合う案を作成します。' },
      { title: 'コピー、共有、評価する', description: '気に入った案をコピーまたは共有し、評価することで好みに近づけていきます。' }
    ]
  },
  features: {
    kicker: 'Built for everyday sharing',
    title: '日常のシェアのために',
    items: [
      { title: '写真からキャプション作成', description: '空白の入力欄からではなく、写真のシーンをもとに言葉を作ります。' },
      { title: '日常シーンに対応', description: '朝食、カフェ、散歩、ペット、旅行、コーデ、食事、日常の写真を想定しています。' },
      { title: 'オンデバイス AI 優先', description: '利用できる場合は Apple のオンデバイス AI を優先する設計です。' },
      { title: '好みに合わせた学習', description: '評価や選択をもとに、やさしい、短い、少し面白い、雰囲気のある表現へ近づけます。' },
      { title: '共有しやすい流れ', description: 'キャプションをコピーしたり、写真と一緒にいつものアプリへ持っていきやすくします。' },
      { title: 'プライバシーに配慮', description: '最初の方向性として、ローカル処理とわかりやすい選択を重視しています。' }
    ]
  },
  focus: {
    kicker: 'Current focus',
    title: '現在の重点：写真理解の精度を上げること',
    description:
      'よいキャプションは、写真の内容をきちんと理解するところから始まります。現在は、写真に何が写っているかをより正確に捉え、文章生成前のコンテキストを整えることに重点を置いています。',
    roadmap: [
      { label: 'Now', text: '写真理解、シーン検出、キャプション用コンテキスト作成' },
      { label: 'Next', text: 'キャプションスタイル改善、評価に基づくパーソナライズ、共有フローの強化' },
      { label: 'Later', text: '画像補正、多言語キャプション、Android 版、任意のクラウド強化 AI' }
    ]
  },
  useCases: {
    kicker: 'Use cases',
    title: '投稿したいけれど、言葉が出てこないときに',
    items: [
      { title: '朝食', description: 'シンプルな朝食写真に、あたたかい朝の言葉を添えます。' },
      { title: 'カフェ', description: 'コーヒー、ブランチ、窓辺の光、静かな時間に合う表現を作ります。' },
      { title: '散歩', description: '街角、公園、夕焼け、散歩中に見つけた小さなものを残せます。' },
      { title: 'ペット', description: '猫や犬の写真に、かわいい、やさしい、少し面白い言葉を。' },
      { title: '旅行', description: '場所、食べ物、景色、旅先の小さな瞬間をすばやく投稿しやすくします。' },
      { title: 'コーデ', description: 'OOTD、ミラー写真、スタイルの細部に合うキャプションを作ります。' }
    ]
  },
  personalization: {
    kicker: 'Personal style',
    title: 'あなたらしい言葉に近づける',
    description:
      'SnapCopy は、評価、コピー、共有、保存などのシンプルなフィードバックを使い、好みの文体を理解することを目指しています。',
    likeLabel: 'よく選ぶのが',
    like: '短くて、あたたかく、少しユーモアのあるキャプションなら',
    resultLabel: 'より増やせる表現',
    result: '日常になじむ、かたすぎず、絵文字が多すぎないキャプション'
  },
  privacySection: {
    kicker: 'Privacy',
    title: 'プライバシーを意識した設計',
    description:
      'SnapCopy はオンデバイス AI 優先の方向で開発しています。可能な範囲で日常のキャプション生成を端末内に留めることを目指し、将来クラウド強化機能を追加する場合は、写真やプロンプトが端末外へ送信されるタイミングを明確に案内します。',
    items: ['オンデバイス AI 優先', '将来のクラウド機能は明確な選択', '自動投稿はしません', '製品専用のプライバシーページ'],
    cta: 'プライバシーポリシーを見る'
  },
  platform: {
    kicker: 'Availability',
    title: 'まずは iOS。ほかのプラットフォームはその後に。',
    description:
      'SnapCopy は iPhone 向けに先行開発しています。Android 版への関心は、iOS 版のテストと改善を進めながら順番待ちで受け付けています。',
    iosCta: 'iOSの順番待ちに登録',
    androidCta: 'Androidの順番待ちに登録'
  },
  waitlist: {
    title: 'iOS の順番待ちに登録',
    description: 'TestFlight、App Store 公開、新機能のお知らせを受け取れます。',
    button: '順番待ちに登録'
  },
  faqTitle: '公開前のよくある質問',
  finalCta: {
    kicker: 'iOS launch',
    title: '日常の写真を、もっと投稿しやすく。',
    description: 'iOS 公開に向けた進捗を受け取りながら、SnapCopy の開発を見守れます。',
    primary: 'iOSの順番待ちに登録',
    secondary: 'Station Cat をフォロー'
  },
  makerNote: 'Made by Station Cat, an independent creator studio.',
  scenes: [
    { title: 'カフェと朝の時間', description: 'コーヒーや朝ごはんの写真に、やさしく自然な言葉を添えられます。', image: '/images/scene-breakfast-placeholder.svg' },
    { title: '散歩と日常', description: 'なんでもない一枚にも、その日の空気感が伝わる表現を見つけます。', image: '/images/scene-walking-placeholder.svg' },
    { title: '旅行、コーデ、ペット', description: '場面や気分に合わせて、自分らしく投稿しやすい文案を選べます。', image: '/images/scene-cafe-placeholder.svg' }
  ],
  steps: ['写真を選ぶ', 'シーンを理解する', 'キャプションを作成する', 'コピー、共有、評価する'],
  audiences: ['写真からキャプション作成', '日常シーンに対応', 'オンデバイス AI 優先', '好みに合わせた学習', '共有しやすい流れ', 'プライバシーに配慮'],
  privacy:
    'SnapCopy はオンデバイス AI 優先の方向で開発しています。将来クラウド強化機能を追加する場合は、写真やプロンプトが端末外へ送信されるタイミングを明確に案内します。'
};
