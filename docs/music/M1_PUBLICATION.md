# M1-04 条件发布

日期：2026-09-10；代码基线 main@233d716（已合并 PR #121）。独立分支 `codex/music-conditional-publication`。仅交付本地可测试的命令服务、校验与增量迁移，不接 HTTP 路由、生产数据库或真实音频。

## 命令边界

`executeMusicPublication` 接收 `action`（publish/unpublish）、trackId、revisionId、`ifMatch: "\"edit-N\""`、16–128 字符幂等键、非空操作理由；发布另需明确确认 `confirmedPolicyVersion`。actorId 必须来自可信服务端调用方，不能来自客户端邮箱。本模块不是鉴权入口；M2 必须先验证 Access JWT、管理员范围、Origin/CSRF、请求体大小，并解析 HTTP If-Match。没有此接线就不能公开调用。

返回字段仅为 trackId、revisionId、action、editVersion、catalogVersion、replayed，不含权利材料、对象 key 或播放资格。管理员身份不能授予 VIP，服务不读写原会员、积分或支付。

幂等键按 actor + route + key 隔离，规范化命令做 SHA-256。相同请求重放已提交回执，不再次发布；同键不同命令拒绝 409。先查回执再检查旧 If-Match，允许响应丢失后恢复原结果。旧发布回执在下架后重放不会重新上架。未知结果只能用原键重查，不能另造键冒充原操作。

## 校验与审核

发布复用 `projectPublicTrack` 和策略校验：同曲资源、draft 指针、递增 revision、slug、各语文本、UTC、显式策略、首次 policyVersion=1、策略变更版本及未来抢先结束日。上限 500 首已发布歌曲；独立试听绑定当前完整音频，长度不超过 min(配置, 半长)，配置 15–45 秒、默认 45 秒，编码容差最多 250ms。曾明确免费或已经自然转免费的公开版不能在本入口重新加付费门槛；事务执行时再检查自然转免费边界。

权利门槛不是 approved 布尔值：要求当前 revision 的人工审核人/时间、商业用途与官方下载记录、来源套餐、生成/下载/条款核对 UTC、歌词/封面/输入材料的权利说明，以及 1–10 份同曲、已验证的私有证据。免费来源或 Remix/其他输出另需明确的例外许可说明和指定证据。此为产品校验合同，不代表自动认定外部许可有效，也不替代正式内容上线前人工核对当时条款。

审核指纹覆盖 revision 身份、原始元数据、slug、策略、媒体身份/测量/hash/ETag、权利内容和证据集合。技术审核及权利审核都须保存相同的服务端计算指纹。改稿、换资源或复制旧审核到新 revision 都会失效。M2 审核入口必须使用同一 `publicationFingerprint`，不得接收客户端提供的指纹作为批准。

每次发布还必须注入可信 `verifyResources`：匹配每个引用对象的存在性、ETag、字节数、hash、MIME 和结构；音频要求 MP3 帧测量时长，封面需尺寸/非动画结果，歌词需 UTF-8/行数结果。核验结果最多 15 秒。默认没有验证器，返回 503，不能仅凭库中 validated 或技术时间戳发布。

**本批没有真实 MP3 解析器或 R2 验证器。** 测试验证器只返回隔离 fixture 的合约数据，不证明试听字节同源。M1-05 实现有预算的帧解析；M2 负责真正读取私有对象、核验 hash/结构、生成可信审核并接线。HEAD 元数据不等于完整字节核验。D1 与 R2 不共享事务，M2 必须以不可覆盖对象、引用保护和清理竞态协调补全；本批不宣称消除远程对象核验后的删除风险。

## 原子写入

所有读取使用 D1 `withSession('first-primary')`。写入批次首先比较已读 track、revision、旧发布版、权利记录、证据集合、所有引用资源和设置的完整业务字段，连未递增 editVersion 的修改也会冲突。事务内同时核对总量和时效。

临时 `music_publication_guards` 的 NOT NULL 条件将不满足的快照转为 SQL 失败。每个业务写之后检查 `changes()=1`，零行不能被当作成功。封存 revision、切换发布指针、递增 editVersion/catalogVersion、审计和回执都在同一个 D1 batch；任意步骤失败整笔回滚。guard 行在成功提交前删除。依据 [D1 batch 官方说明](https://developers.cloudflare.com/d1/worker-api/d1-database/)，不能仅凭 batch 未报错就把业务 CAS 视为成功。

编辑新版不影响旧公开版；发布失败保留旧版与首次发布时间。下架只切生命周期并写版本/审计/回执，保留封存版本及对象；验证器故障也不妨碍下架。发布审计包含前后策略及理由；下架审计记录生命周期、revision 与理由，不重新载入策略。

## 迁移与回滚

追加 `migrations-music/0002_music_publication.sql`，不修改已应用的 0001。新增两个私有审核指纹、批次 guard 和设置种子；保护 `music_mutations` 禁止 UPDATE、DELETE、INSERT OR REPLACE 覆盖。旧回执保留。expires_at 不是自动清理许可，本批继续保留回执，未来保留期清理需独立设计审查，不能当缓存删除。

迁移只针对独立 MUSIC_DB，**不得应用到 WAITLIST_DB**。历史封存数据不回填伪造指纹；已有草稿需重新审核才可发布。缺表/绑定/验证器失败关闭。生产资源创建与迁移仍需另批；回滚应关闭音乐写入，不得删除审计/回执或回退无 guard 的发布实现。

## 验证与后续

- `npm run test:music:publication`：23 项通过，已加入 npm pretest/CI。真实 SQLite 事务覆盖逐步 SQL 失败和零命中回滚、并发同键/不同曲、丢响应、旧版保留、下架、审批过期、政策时间竞态、无效 slug/试听、500 首竞态等。
- `npm test`、`npm run build`：通过；145 页、111 条公开 sitemap。未新增运行时依赖、UI、音乐页面、导航或构建资源。
- Wrangler 4.130.0 隔离本地 D1：从 0001 增量应用 0002 成功（9 条迁移命令）。另用 Miniflare 本地 D1 验证 first-primary、INTEGER 数值、`changes()` 跨语句语义和前段/后段零行导致全批回滚；这是基础事务合约实测，不是完整服务的生产多实例测试。
- 未运行真实 R2、真实 MP3、生产 D1/副本、多实例、Safari 或音乐 Playwright。没有 UI 的模型测试不替代后续页面验收。

PR #120 的 mutations REPLACE 保护、发布统一 slug/试听校验已在本批处理；空歌单投影仍留 M2。PR #121 的重复 Cookie 策略对齐、异常 clock/timeout 包装和真实 D1 会话查询仍留 M2，不因本地 guard 实测而标成已完成。下一步 M1-05 真 MP3 解析，再做 M2 接线；涉及 UI 时必须 Product Design 与桌面/移动验收。本 PR 合并不等于上传、部署、真实发布或开闸。
