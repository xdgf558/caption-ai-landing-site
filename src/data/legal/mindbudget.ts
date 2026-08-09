export interface MindBudgetLegalSection {
  heading: string;
  body: string;
}

export const mindBudgetPrivacyNotice = {
  en: 'Effective August 9, 2026. This policy describes the current MindBudget public TestFlight build.',
  'zh-Hans': '生效日期：2026 年 8 月 9 日。本政策适用于当前的花有数公开 TestFlight 测试版。',
  'zh-Hant': '生效日期：2026 年 8 月 9 日。本政策適用於目前的 MindBudget 公開 TestFlight 測試版。',
  ja: '施行日：2026年8月9日。本ポリシーは現在の MindBudget 公開 TestFlight 版に適用されます。'
} as const;

export const mindBudgetPrivacySections: Record<'en' | 'zh-Hans' | 'zh-Hant' | 'ja', MindBudgetLegalSection[]> = {
  en: [
    { heading: 'Data stays on your device', body: 'MindBudget stores expenses, income, budgets, wishlist items, cooling-off records, settings, and reflections inside the app container on your iPhone. The developer does not operate an account system or cloud sync service for this build.' },
    { heading: 'No collection or tracking', body: 'The developer collects no personal or financial data. MindBudget includes no advertising, third-party analytics, tracking, bank connection, or third-party SDK that receives your records.' },
    { heading: 'Optional on-device intelligence', body: 'On supported devices, optional Apple Intelligence wording enhancement uses Apple on-device Foundation Models. It receives only redacted aggregate facts. Raw notes, transaction rows, merchant lists, and raw questions are not sent into model context. All financial calculations and conclusions remain deterministic local code.' },
    { heading: 'Export and system integrations', body: 'CSV data leaves the app only when you explicitly open Export CSV and choose a destination in the iOS share sheet. Siri, Shortcuts, Spotlight, notifications, and Face ID are optional, separately controlled features and are off by default where permission or opt-in is required.' },
    { heading: 'Deletion and contact', body: 'Delete All uses two confirmations, removes local records, clears app-owned search entries and notifications, resets app preferences, and returns to onboarding after verification. For privacy questions, contact brodstem@protonmail.com.' }
  ],
  'zh-Hans': [
    { heading: '数据保存在你的设备上', body: '花有数会把支出、收入、预算、心愿单、冷静期记录、设置与复盘内容保存在 iPhone 的应用容器中。当前版本没有开发者账号系统，也不提供云同步。' },
    { heading: '不收集、不追踪', body: '开发者不会收集个人或财务数据。花有数不含广告、第三方分析、跨应用追踪、银行连接，也没有会接收账目记录的第三方 SDK。' },
    { heading: '可选的本机智能', body: '在支持的设备上，可选的 Apple Intelligence 文字增强使用 Apple 的设备端 Foundation Models，只接收经过删减的聚合事实。原始备注、逐笔交易、商户列表和原始提问不会进入模型上下文；所有金额计算与财务结论仍由确定性的本地代码完成。' },
    { heading: '导出与系统集成', body: '只有当你主动打开“导出 CSV”并在 iOS 分享面板中选择目的地时，账本数据才会离开应用。Siri、快捷指令、Spotlight、通知和 Face ID 都是可选且分别控制的功能；需要权限或开关的功能默认关闭。' },
    { heading: '删除与联系', body: '“删除全部”需要两次确认，会移除本地记录、清除应用拥有的搜索索引与通知、重置应用偏好，并在验证完成后返回初始引导。隐私问题请联系 brodstem@protonmail.com。' }
  ],
  'zh-Hant': [
    { heading: '資料保存在你的裝置上', body: 'MindBudget 會把支出、收入、預算、願望清單、冷靜期記錄、設定與回顧內容保存在 iPhone 的 App 容器中。目前版本沒有開發者帳號系統，也不提供雲端同步。' },
    { heading: '不收集、不追蹤', body: '開發者不會收集個人或財務資料。MindBudget 不含廣告、第三方分析、跨 App 追蹤、銀行連線，也沒有會接收帳目記錄的第三方 SDK。' },
    { heading: '可選的裝置端智慧', body: '在支援的裝置上，可選的 Apple Intelligence 文字增強使用 Apple 的裝置端 Foundation Models，只接收經過刪減的彙總事實。原始備註、逐筆交易、商戶清單和原始提問不會進入模型內容；所有金額計算與財務結論仍由確定性的本機程式碼完成。' },
    { heading: '匯出與系統整合', body: '只有當你主動開啟「匯出 CSV」並在 iOS 分享面板選擇目的地時，帳本資料才會離開 App。Siri、捷徑、Spotlight、通知和 Face ID 都是可選且分別控制的功能；需要權限或開關的功能預設關閉。' },
    { heading: '刪除與聯絡', body: '「刪除全部」需要兩次確認，會移除本機記錄、清除 App 擁有的搜尋索引與通知、重設 App 偏好，並在驗證完成後返回初始引導。隱私問題請聯絡 brodstem@protonmail.com。' }
  ],
  ja: [
    { heading: 'データは端末内に保存', body: 'MindBudget は支出、収入、予算、ウィッシュリスト、クーリングオフ記録、設定、振り返りを iPhone のアプリコンテナ内に保存します。現在の版に開発者アカウントやクラウド同期はありません。' },
    { heading: '収集・追跡なし', body: '開発者は個人情報や金融データを収集しません。広告、第三者分析、クロスアプリ追跡、銀行接続、記録を受け取る第三者 SDK は含まれていません。' },
    { heading: '任意のオンデバイス知能', body: '対応端末では、任意の Apple Intelligence 文章補助が Apple のオンデバイス Foundation Models を使用します。入力は編集済みの集計事実のみで、元のメモ、取引行、店舗一覧、質問文はモデル文脈へ渡しません。金額計算と判断は常に決定的なローカルコードが行います。' },
    { heading: '書き出しとシステム連携', body: 'CSV は、ユーザーが明示的に書き出しを開き、iOS の共有シートで送信先を選んだ場合だけアプリ外へ出ます。Siri、ショートカット、Spotlight、通知、Face ID は個別に管理される任意機能です。' },
    { heading: '削除と問い合わせ', body: '「すべて削除」は2段階の確認後、ローカル記録、アプリ所有の検索項目と通知、設定を消去し、検証後に初期画面へ戻ります。プライバシーに関する連絡先は brodstem@protonmail.com です。' }
  ]
};
