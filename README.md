# Station Cat Landing Site

這是 Station Cat 的官方靜態網站專案，使用 Astro 建置，部署到 Cloudflare Workers。網站目前承載個人品牌首頁、多產品入口、SnapCopy 產品頁、StationCat Radar 下載頁、作品集、開發博客、管理後台，以及 TestFlight / Android 測試名單相關頁面。

目前正式網域：

```text
https://wwwstationcat.org/
```

## 專案狀態

- 預設語言：繁體中文
- 主要品牌：Station Cat
- 主要產品：SnapCopy
- Mac 產品：StationCat Radar
- 部署平台：Cloudflare Workers
- 表單與測試名單：Cloudflare Workers + D1
- Mac 檔案下載：Cloudflare R2
- 管理後台：GitHub Contents API 寫入 Markdown 內容

## 重要路徑

### 品牌首頁

```text
/
/zh-hant/
/zh-hans/
/en/
/ja/
```

### Apps

```text
/apps/
/zh-hant/apps/
/zh-hans/apps/
/en/apps/
/ja/apps/
```

### SnapCopy

```text
/apps/caption-ai/
/apps/caption-ai/download/
/apps/caption-ai/android/
/apps/caption-ai/privacy/
/apps/caption-ai/support/
/apps/caption-ai/terms/

/zh-hant/apps/caption-ai/
/zh-hant/apps/caption-ai/download/
/zh-hant/apps/caption-ai/android/
/zh-hant/apps/caption-ai/privacy/
/zh-hant/apps/caption-ai/support/
/zh-hant/apps/caption-ai/terms/

/zh-hans/apps/caption-ai/
/ja/apps/caption-ai/
```

> 注意：路由仍保留 `caption-ai`，這是為了避免舊連結失效；頁面品牌名稱已更新為 SnapCopy。

### StationCat Radar

```text
/apps/stationcat-radar/
/apps/stationcat-radar/download/
/zh-hant/apps/stationcat-radar/
/zh-hant/apps/stationcat-radar/download/
/zh-hans/apps/stationcat-radar/
/ja/apps/stationcat-radar/
```

### 作品集與開發博客

```text
/works/
/zh-hant/works/
/zh-hans/works/
/ja/works/

/devlog/
/en/devlog/
/zh-hans/devlog/
/ja/devlog/
```

### 管理後台

```text
/admin/
/admin/waitlist/
```

正式環境中的 `/admin/` 應透過 Cloudflare Access 限制，只允許指定管理員 Email 驗證後進入。

## 本地開發

進入專案資料夾：

```bash
cd /Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site
```

安裝依賴：

```bash
npm install
```

啟動開發伺服器：

```bash
npm run dev
```

開啟：

```text
http://localhost:4321/
```

## 建置檢查

每次部署前建議先執行：

```bash
npm run build
```

成功後會產生 `dist/`，Cloudflare Workers 會讀取這個目錄中的靜態資產。

## 部署

目前使用 Wrangler 部署到 Cloudflare Workers：

```bash
npx --yes wrangler@latest deploy
```

部署成功後會更新：

```text
https://wwwstationcat.org/
```

## 內容管理

### Devlog

開發博客內容存放於：

```text
src/content/devlog/
```

### X Works

作品集內容存放於：

```text
src/content/xworks/
```

已發布內容需要：

```yaml
status: "published"
```

首頁精選需要：

```yaml
featured: true
```

## Cloudflare 資源

目前專案會使用這些 Cloudflare binding：

```text
WAITLIST_DB        D1 Database
DOWNLOADS_BUCKET   R2 Bucket
ASSETS             Static assets
```

相關設定在：

```text
wrangler.toml
migrations/
src/worker.js
```

## GitHub 分支保護建議

`main` 分支應至少啟用：

- 禁止刪除分支
- 禁止 force push
- 不強制 Pull Request
- 暫時不強制 status checks

未來若加入 GitHub Actions，可再啟用 `Require status checks to pass before merging`，並要求 `npm run build` 通過後才能合併。

## 授權狀態

這個 GitHub repository 目前是 **Public**，代表任何人都可以瀏覽程式碼。

但目前專案沒有 `LICENSE` 文件，因此嚴格來說它還不是一個已授權的開源專案。沒有授權條款時，其他人通常不能合法複製、修改、重新散布或商業使用這份程式碼。

如果之後希望它成為真正的開源專案，可以新增 MIT、Apache-2.0、GPL 等授權文件；如果只是想讓網站程式碼公開可見，但不希望別人拿去使用，可以暫時維持沒有 LICENSE。

## 隱私與法務提醒

目前網站中的隱私政策與服務條款是實務草案。若 App 正式上架、加入付費功能、分析工具、Email 行銷、雲端 AI 處理或第三方 SDK，應依照實際資料流程重新檢查。
