# M6-05 完整生产关闸候选

本切片只生成本机候选、验证配置和完整站点；不修改根 `wrangler.toml`，不部署、不安装 secret、不迁移或调配额。实际资源 ID、候选 JSON、构建清单、云端元数据及验收记录保持私有，不附 PR。M6-05 以及 M6-01/M6-02 剩余验收仍未完成。

## 配置来源与守卫

`build-music-production-candidate.mjs` 以已审的完整生产 `wrangler.toml` 为基线，用 SHA-256 锁住其原文。任何变化（包括 Access、兼容日期、路由、变量、绑定、调度或构建配置）都会停止生成，需要重新审查整个基线后才更新该摘要。不要为了通过检查而直接改摘要。

输入采用此前独立资源初始化留下的私有严格 JSON（`resources.json`），不允许注释或尾随逗号；生成器使用 `JSON.parse`，不解析 JSONC。字段只允许 `account_id`、`compatibility_date`、单个 `d1_databases` 和单个 `r2_buckets`。要求生产音乐资源名、MUSIC_DB/MUSIC_BUCKET 绑定、绝对音乐迁移目录；拒绝预发两库、原会员库、额外绑定和 secret/环境覆盖字段。资源文件的日期只作格式校验，**不会覆盖正式 Worker 的兼容日期**。

名称和 UUID 形状校验不能证明云端归属：每次准备/批准部署前，操作员必须用当前账号只读盘点，将私有 ID 与获批资源匹配，核对私有桶、迁移、配额、当前生产版本及绑定。不得把任意 UUID 填入同名资源字段来绕过这一步。

候选保留完整生产 Worker、`dist`、原 Access/管理员、WAITLIST_DB、两个原站桶、AI/EMAIL、支付变量、队列与 cron。MUSIC_DB 只承接音乐数据；不引入预发入口、Access AUD、测试身份库、Cookie 翻译或夹具。原会员库不执行本包迁移。

仅新增 MUSIC_DB、MUSIC_BUCKET 和明确的关闭变量：public、uploads、VIP 交付、analytics、cleanup、分享卡片，以及首次空库的统计保留任务。后者仅适用于尚无统计数据的首次候选，不是已有数据后的停采集/回滚工具；已有数据时应使用另行审查的保留方案。

所有 main、assets.directory、D1 migrations_dir 都转为绝对路径；WAITLIST_DB 的默认 migrations 目录显式指回原仓库。沿用原 compatibility_date/flags，不照搬预发 nodejs_compat。原 Worker 秘密不导出、不复制进候选，新增生产限流 secret 仍须另行批准安装；部署前后都要核对既有 secret 名称保留。

## 本机生成与验证

先完成正式站完整构建，再使用仓库外的私有资源文件及已存在的私有输出目录：

```sh
npm run build
npm run build:music:production-candidate -- --resources /absolute/private/resources.json --output /absolute/private/closed-candidate.jsonc
npm run test:music:production-candidate
node --test scripts/test-music-production-assets.mjs
```

生成器不调用云端或 shell，不默认选库，不覆写任何已有输出。资源文件和输出目录必须在 checkout 外；真实路径解析后仍在 checkout 内的符号链接也会被拒绝。新文件权限为 0600。错误仅输出固定错误码，不回显输入 JSON、秘密、资源 ID 或文件路径。

候选没有独立业务状态、部署命令或自动放行逻辑。`assertMusicProductionCandidate` 可在实际使用前将读回的 JSON 与当次已审基线/私有资源文件比较，任一开关、身份、绑定、路径或额外字段的漂移都应停止。

使用已安装 Wrangler 的 `deploy --help` 核对参数后，对该候选运行显式 `--dry-run`，产物和日志放到私有目录。不得省略 `--dry-run`，不得运行 `versions upload`、`deploy` 或 secret 命令代替打包检查。干跑不代表云端绑定、Secret、Access 或权限验收。

配置仍指向当前 checkout 的完整源文件和 `dist`。交付时在仓库外记录提交、工作区状态、锁文件、配置、全部静态文件与 Worker bundle 的哈希；后续任何源文件/构建产物变化都使旧候选失效，必须重建并复核。不要把 dry-run 目录中的 bundle 与其他版本静态包混用。

## 测试与验收解释

配置测试覆盖原站配置保留、生产基线漂移、预发/原身份库拒绝、秘密/额外字段拒绝、路径与输出覆盖保护，以及实际 Worker 的关闸路径零绑定读取。分析配置接口关闭时可以返回 `200 + available:false`；它不采集也不代表分析可用。

构建后测试用完整 `src/worker.js`、候选实际兼容日期和原生 assets 路由运行 Miniflare，验证四语曲库、别名、无尾斜杠和编码路径均不能绕过关闭门禁，普通四语首页仍可读取，匿名管理诊断仍被拒绝。此测试使用内存合成资源 ID、无云端绑定、禁止外部请求；不能代替真实 Access 登录或生产会员验收。

CI 保留全量测试、上传/后台合同、D1/R2 runtime、独立预览、完整构建、预发闭包，以及原站/文章/支付/音乐后台浏览器回归。准备正式候选还需比较**当前生产部署源码到候选**的全部差异，而非只看本 PR；共享页眉页脚、会员回跳、Reader Session 通知和 Worker dispatch/scheduled 改动纳入回归。

通过后只交付可审查候选。实际关闸部署必须按 [上线方案](MUSIC_RELEASE_PREPARATION.md) 另行批准具体提交、配置和静态包；缺 secret 的诊断状态如实保留，不能为了“全绿”临时开启业务或沿用预发 secret。生产绑定接线、原站回归和匿名拒绝仍需在部署后单独核验。来源材料可选不等于正式作品发布授权，性能/设备缺口也不会因本 PR 合入而消失。
