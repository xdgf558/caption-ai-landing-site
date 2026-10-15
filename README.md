# Station Cat · 音樂、遊戲與溫柔日常

一座深夜還亮著的小站。Station Cat 是分享原創音樂、遊戲與創作故事的個人品牌網站，使用 Astro 建置，運行於 Cloudflare Workers。

**[造訪網站](https://wwwstationcat.org/) · [音樂小站](https://wwwstationcat.org/music/) · [遊戲世界](https://wwwstationcat.org/games/)**

目前網站以歌曲展示、外部平台收聽、站內試聽與 MV，以及《打工養貓日記》為核心。預設語言為繁體中文，另支援簡體中文、英文與日文。倉庫名稱沿用早期的 `caption-ai-landing-site`。

本文依 2026-10-15 已合併的功能更新。

## 網站與創作後台

| 模組 | 內容 |
| --- | --- |
| 首頁 | 主推歌曲、遊戲與精選內容，由後台配置 |
| 音樂 | 歌曲目錄、封面、歌詞、創作故事、收藏與已核對的發行平台入口 |
| 試聽與影片 | 已配置並公開的獨立試聽、短影片與 MV；完整歌曲以外部平台收聽為主 |
| 遊戲 | 遊戲介紹、截圖、《打工養貓日記》及既有存檔服務 |
| 會員與站點服務 | 帳號、會員、Station Points、訂單與歷史權益 |
| 創作後台 | 作品、素材、發行平台、首頁配置、發布記錄及站點服務管理 |

新版入口為 [創作後台 /admin-v2/](https://wwwstationcat.org/admin-v2/)，由 Cloudflare Access 保護，寫入與發布另有管理員角色及服務端校驗。歌曲資料和素材主要存放於 D1、R2；早期以 GitHub Markdown 管理內容的說明不再代表新版音樂後台。

舊小說、開發日誌和早期產品的公開入口已退役；相關程式碼、歷史資料與相容服務仍保留。重新建置或更新文件不應重新開放這些入口。

## 常用操作

### 發布一首歌

在「作品内容」選擇「新建作品」中的歌曲，填寫歌名和藝名並保存草稿。作品地址由系統自動產生，無需另填。接著在同一歌曲編輯頁上傳封面，按需要添加歌詞、簡介與故事，確認素材可用於網站展示後點擊「发布歌曲」；已公開作品使用「更新歌曲」。

網站展示頁可以獨立發布，不必先經過舊音頻後台的完整音頻發布或技術核對。試聽與 MV 可稍後配置。

### 添加發行平台

從側欄「发行平台」選擇歌曲，填入真實作品網址、發行狀態和實際人工核對時間，再保存。已核對的有效「已上线」入口會按地區等公開條件提供收聽按鈕。

網易雲歌曲與專輯的 `/#/` 網址都可以直接貼上，保存時會保留作品類型與 ID，轉成直達網址，例如：

```text
https://music.163.com/#/album?id=398968221
→ https://music.163.com/album?id=398968221
```

「人工核对时间」記錄實際確認連結與上線狀態的時間；「外部发行时间」記錄作品在該平台發行的時間，可留空。後台時間欄使用新加坡時間（UTC+8）。

**「已公开」是本站作品狀態；「已上线」是外部平台發行狀態。** 發行平台列表顯示後者，保存成功後會重新讀取並更新。僅填入網址、尚未完成核對或保存失敗時，不會標成已上線。

### 更換首頁主推

打開「首页配置」，選擇已公開歌曲或遊戲，點擊「更新首页」即可生效。只改選項而未更新，訪客仍會看到原來的內容。精選歌曲與短影片放在更多設定中，按需要配置。

### 封面與預覽

封面支援 JPEG、PNG、WebP，檔案上限 **5 MiB**。後台優先使用已有縮圖；新上傳封面尚無縮圖時，會在管理員權限與素材校驗通過後自動產生預覽，無需逐首修改程式或重新部署。列表更新會保留未變動的圖片，查看原素材時才讀取原圖。

即時預覽的解碼上限為 **4,194,304 像素**，建議正方形封面控制在 **2048 × 2048 以內**。超過此範圍的圖片仍需先縮小，或使用發布流程產生的靜態縮圖。失敗的預覽可用「重新核对工作区」重試。此機制適用於後台預覽；公開頁面的封面另由受控素材接口與展示圖清單處理。

## 本地開發與預覽

需要 **Node.js 22.13 或以上版本**。從倉庫安裝鎖定的依賴：

```bash
npm ci
npm run dev
```

`npm run dev` 啟動 Astro 開發服務，預設為 `http://localhost:4321/`。它適合頁面與樣式開發，不會自動提供正式環境的 Worker、資料庫、Access 身份或歌曲資料。

若要操作新版後台，可使用合成資料與臨時 D1/R2 的本機環境：

```bash
npm run build:station:first-launch
node scripts/serve-station-admin-preview.mjs
```

開啟 `http://127.0.0.1:4224/admin-v2/`。資料只用於本機預覽，重啟後重置。首頁流程可改用 `node scripts/serve-station-admin-preview.mjs --home`（連接埠 4234），帳號與訂單介面可改用 `--services`（連接埠 4236）。

## 建置、檢查與部署

目前品牌與遊戲範圍的靜態候選包使用以下命令建置；命令名稱沿用首次上線階段：

```bash
npm run build:station:first-launch
```

產物位於 `.generated/station-first-launch-assets/`，檔案清單為 `.generated/station-first-launch-manifest.json`。建置會保留歷史付款與受保護內容的相容清單，並排除已退役的公開 HTML。公開歌曲與首頁配置由 Worker 讀取當前發布資料，不是建置時寫死的內容。

一般 `npm run build` 會建置完整歷史 Astro 路由並重新產生舊內容清單。缺少私人小說正文時，開發或 CI 可使用 `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build`，但這種空正文產物不能當作正式發布包；正式候選包建置也會拒絕此選項。

常用檢查按改動範圍選擇：

| 命令 | 覆蓋範圍 |
| --- | --- |
| `npm run test:redesign:content-admin` | 作品發布、發行平台、後台介面與受保護縮圖 |
| `npm run test:redesign:public` | 公開內容、素材權限與封面展示 |
| `npm run test:redesign:platforms` | 平台網址、發行狀態與公開入口 |
| `npm run test:redesign:home` | 首頁內容與展示 |
| `npm run test:music:staging` | 隔離環境的依賴與資源邊界 |
| `npm run test:station:first-launch` | 候選包及已退役入口的處理 |
| `npm test` | 音樂與既有站點服務的廣泛回歸 |

完整托管 CI 還包含瀏覽器、原生接口、資料保留等檢查，實際步驟見 [CI workflow](.github/workflows/ci.yml)。單項測試或本機建置成功不等於完整 CI 通過。

正式部署使用**經核對的完整生產配置、靜態候選包與 Worker bundle**，保留現有綁定、Secrets、服務開關和已退役入口的處理，並在上線後檢查公開頁面及登入後台。倉庫根目錄的 `wrangler.toml` 不是當前完整生產配置，不可直接以它覆蓋正式環境；Wrangler 使用發布流程核定的版本，而非自動追蹤 `latest`。合併程式碼、部署服務與修改正式內容是分開的操作。

## 程式結構

| 位置 | 用途 |
| --- | --- |
| `src/pages/`、`src/layouts/` | Astro 頁面、共用佈局與內部模板 |
| `src/worker.js` | Cloudflare Worker 入口與既有服務整合 |
| `src/redesign/` | 新版網站、內容發布、首頁、平台與公開查詢 |
| `src/music/` | 音樂素材、上傳、音頻、縮圖及既有音樂接口 |
| `src/scripts/` | 後台互動、播放器及瀏覽器端狀態管理 |
| `public/` | 靜態圖片、樣式、字型與遊戲檔案 |
| `migrations/`、`migrations-music/` | 帳號與站點服務、音樂與新版內容的資料庫遷移 |
| `scripts/`、`tests/` | 建置工具、隔離預覽與回歸測試 |
| `ops/` | 發布範圍、配置提案與驗收檢查工具 |
| `docs/` | 設計、實作、相容性與歷次驗收記錄 |

主要資料與資產綁定包括 `ASSETS`（靜態資產）、`MUSIC_DB` / `MUSIC_BUCKET`（音樂與網站作品）、`WAITLIST_DB`（帳號與既有站點資料）、`CONTENT_BUCKET` 與 `DOWNLOADS_BUCKET`（既有受保護內容和下載資源）。音樂資料庫與帳號資料庫分離；這份簡表不是完整部署配置。

## 延伸文件

- [新版後台與導航](docs/station-cat-redesign/L07-unified-admin-and-music.md)
- [首頁主推一次更新](docs/station-cat-redesign/L13-simple-home-feature.md)
- [歌曲頁的平台收聽與試聽](docs/station-cat-redesign/L14-platform-listening.md)
- [發行平台狀態與網易雲網址](docs/station-cat-redesign/L23-platform-release-status.md)
- [新上傳封面的自動後台預覽](docs/station-cat-redesign/L24-admin-new-cover-preview.md)
- [Cloudflare Access 管理員保護](docs/cloudflare-access-admin.md)
- [改版需求與歷次執行記錄](docs/station-cat-redesign/README.md)

階段文件中的測試數量、待辦、部署狀態與配置範例是當時的記錄；應搭配目前程式碼、對應提交的 CI 和實際部署證據閱讀。

## 授權

本專案的程式碼以 MIT License 開源，詳見 [LICENSE](LICENSE)。

MIT 授權僅適用於本 repository 中的軟體程式碼與相關開發文件。

Station Cat 品牌名稱、Logo、圖片、截圖、文章、頁面文案、產品描述、社群作品、法律文本與其他內容資產不包含在 MIT 授權範圍內。未經書面同意，不得複製、修改、再發布或用於商業、品牌、行銷與二次創作用途。
