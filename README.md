# Station Cat Landing Site

這是 Station Cat 的官方網站專案，使用 Astro 建置，部署到 Cloudflare Workers。

網站承載 Station Cat 的個人品牌首頁、多產品入口、SnapCopy 產品頁、StationCat Radar 下載頁、連載小說、開發博客、管理後台，以及 TestFlight / Android 測試名單相關頁面。

正式網域：

```text
https://wwwstationcat.org/
```

## 專案概覽

- 預設語言：繁體中文
- 主要品牌：Station Cat
- 主要產品：SnapCopy
- Mac 產品：StationCat Radar
- 部署平台：Cloudflare Workers
- 表單與測試名單：Cloudflare Workers + D1
- Mac 檔案下載：Cloudflare R2
- 管理後台：GitHub Contents API 寫入 Markdown 內容

## 站點內容

- 品牌首頁：Station Cat 的個人創作入口，預設為繁體中文。
- Apps：展示目前正在開發和發布的產品。
- SnapCopy：AI 生活文案生成器。路由仍保留 `/apps/caption-ai/`，用來兼容早期連結。
- StationCat Radar：macOS 小工具下載頁。
- 連載小說：發布長篇小說、作品資料和章節正文，後續可接入打賞與付費閱讀。
- 開發博客：記錄產品進度、測試階段和版本更新。
- 管理後台：用 GitHub Contents API 管理 Markdown 內容；正式環境由 Cloudflare Access 保護。

## 本地開發

```bash
npm install
npm run dev
```

## 建置與部署

```bash
npm run build
npx --yes wrangler@latest deploy
```

Cloudflare Workers 會使用 `dist/` 中的靜態資產，並透過 `src/worker.js` 處理表單、下載和等待名單相關請求。

## 內容管理

- 開發博客：`src/content/devlog/`
- 連載小說資料：`src/content/serials/`
- 連載小說章節：`src/content/serialChapters/`
- 已發布內容使用 `status: "published"`
- 首頁精選內容使用 `featured: true`

## Cloudflare 資源

目前專案使用的主要 Cloudflare binding：

```text
WAITLIST_DB        D1 Database
DOWNLOADS_BUCKET   R2 Bucket
ASSETS             Static assets
```

相關配置位於 `wrangler.toml`、`migrations/` 和 `src/worker.js`。

## 授權

本專案的程式碼以 MIT License 開源，詳見 [LICENSE](./LICENSE)。

MIT 授權僅適用於本 repository 中的軟體程式碼與相關開發文件。

Station Cat 品牌名稱、Logo、圖片、截圖、文章、頁面文案、產品描述、社群作品、法律文本與其他內容資產不包含在 MIT 授權範圍內。未經書面同意，不得複製、修改、再發布或用於商業、品牌、行銷與二次創作用途。

## 隱私與法務提醒

目前網站中的隱私政策與服務條款是實務草案。若 App 正式上架、加入付費功能、分析工具、Email 行銷、雲端 AI 處理或第三方 SDK，應依照實際資料流程重新檢查。
