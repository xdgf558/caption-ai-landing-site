# M2 运行环境与私有存储适配

2026-09-10，基线 main@3c48aa4（PR #123），分支 `codex/music-runtime-storage`。

范围：M2-RUNTIME 的本地代码和可复现验收，不是整个 M2 完成。没有生产 Worker 路由、UI、鉴权接线、远程资源创建、迁移、正式歌曲上传、发布、部署或开闸。后续 UI 仍须 Product Design。

## 内部接口

- `musicRuntime(env)`：检查独立 `MUSIC_DB` 的 session 能力与 `MUSIC_BUCKET.get`，缺失返回 `MUSIC_NOT_CONFIGURED` 503。若 MUSIC_DB 和 WAITLIST_DB 是同一绑定对象则拒绝，绝不回退原库。对象引用不同不证明远端 database ID 不同；预发仍须核对实际 ID。
- 四个开关只接受布尔 true 或字符串 `true`，其他输入默认 false。本轮只解析开关，不把检查结果当鉴权，也没有把开关写进生产配置或接入路由。
- `checkMusicDatabase(db)`：单个 first-primary session 的只读 batch，检查 0002 所需列/守卫表/回执表及 catalogVersion、previewLimitMs。缺表或坏设置返回 `MUSIC_DATABASE_UNAVAILABLE` 503，不自动建表，不迁移。这是就绪探测，不替代全部 schema/trigger 完整性审计；路由接线时须添加整体请求预算。
- `verifyStoredMusicAudio(bucket, asset, options)`：只接受来自受信服务端记录的 validated audio/preview；检查 UUID、用途、规范 object key、MIME、哈希、时长与大小，再读取真实对象并交给 M1-05 核验。不是完整发布验证器，也不发播放响应/令牌。

对象 key 精确匹配规格 `music/audio/{trackId}/{assetId}.mp3` 或 `music/previews/{trackId}/{assetId}.mp3`。输入不能是任意 URL、跨曲路径或证据资源。旧单元测试中的 `private/...` 是历史隔离夹具，不是需要迁移的线上数据；本轮未发现或改写线上音乐资源。

## R2 读取边界

每个对象只发一次 `get(key, { onlyIf: { etagMatches } })`；不逐块发送 Range GET，不 HEAD 后无条件读取。空对象、条件不匹配、key/大小/类型不符都不能生成核验结果。原生 R2 可返回 `range: { offset: 0, length: size }` 的完整对象元数据；只接受无 range 或这个完整范围，不接受部分内容。

读取使用原生 BYOB reader，每次提供 65536 字节缓冲区，适配输出 highWaterMark=0；不先 `arrayBuffer()` 整曲，也不通过默认 reader 取出巨大块再切片。没有 BYOB 支持时返回 503，不能悄悄降级。哈希是逐字节 SHA-256；ETag 只用于对象条件匹配，不当作 SHA-256。

上限沿用完整 32 MiB / 试听 4 MiB、解析 carry 67584 字节。解析预算只能收紧。整个 GET + 解析共享最多 10 秒墙钟/I/O 时限，支持 AbortSignal；未及时返回的 GET 若后来带回 body，会取消该 body；迟到拒绝被处理。读失败、超限与取消会释放 reader。没有硬中断同步 CPU 的承诺。

结果增加 `storageRead.maxChunkBytes/chunks` 供内部测试诊断，不包含对象 key；未来公开接口仍须用白名单投影，不直接序列化内部结果。真实路由必须在调用前核对管理员或当前发布/访问资格，并继续覆盖 GET/HEAD/Range。

## 可复现验证

`npm ci` 安装固定依赖后：

```sh
npm run test:music:storage
npm run test:music:runtime
npm test
npm run build
```

storage 在 npm pretest；runtime 是 CI 独立步骤。runtime 使用 Miniflare 4.20260730.0 / workerd 1.20260730.1，兼容日期 2026-07-30、browser ESM 打包、不启用 nodejs_compat。测试只监听回环地址、使用临时 D1/R2、阻断出站 fetch，不加载 wrangler.toml 或 Cloudflare 凭证，结束 dispose。五份小型合成编码样本复用已提交的 tests/fixtures/music-mp3，不进入 public/dist；大文件仅运行时生成，不进入 git 或部署产物。

本轮以上测试与构建均通过，145 个静态页面、111 条 sitemap；正常 `npm ci` 已验证。未跑 UI Playwright 或真实 Safari，本轮没有界面改动；GitHub CI 状态以 PR 检查为准。

迁移脚本通过 Node SQLite 的 sourceSQL 解析完整语句（含触发器），再将原语句交给 D1 batch；不是简单按分号切 SQL，也不是直接复制 SQLite 的最终 schema。本地实际应用 0001 后仍拒绝就绪，应用 0002 后才通过。

- 12 项 storage 测试：绑定和默认开关、坏设置、五份 MP3、条件 GET、范围/类型/路径拒绝、BYOB 要求、损坏/截断/hash/时长、GET 超时和迟到 body、取消/读错清理、预算与错误信息边界。
- 10 项 runtime 测试：缺迁移、原生 R2 五份 MP3、对象缺失/替换/类型改变、成功发布/重放、损坏 MP3、末尾零命中回滚、四并发同键、一份独立本地会员 D1 的只读查询、测试路由隔离、大文件单读/四并发。
- 发布测试执行现有完整 `executeMusicPublication`，实际核对 `json_object` 快照和 `changes()`。回滚通过真实 D1 trigger 对末尾回执 INSERT 执行 RAISE(IGNORE)，断言所有音乐表数据完全不变，移除测试 trigger 后同键成功。
- 会员测试只创建合成的 reader 表和 INTEGER 账号；UTC 时间列按现有合同为 TEXT，验证会话先到期时的 validUntil，无会员写入或真实账号数据。仍不代表生产 withSession/副本验证，也未在本轮修 PR #121 的重复 Cookie/坏 clock 接口边界。

**重要：运行时夹具的权利/证据审核是明确命名的合成 stub，只有音频走真实 R2 + MP3 验证。** 这套测试不能当作完整证据文件验证器、可发布作品或真实权利审核。夹具 Worker 位于 scripts/helpers，仅测试打包，绝不部署；它不带 HTTP 管理鉴权。

一次本地大文件观测：32 MiB 单读约 274ms、四并发约 1087ms；4 MiB 单读约 35ms、四并发约 139ms。每条解析 carry 都为 67584 字节、R2 输入最大 65536 字节。时间由 Node 端记录，是本地墙钟而非生产 CPU；固定应用缓冲也不是整个 isolate 的堆内存峰值。每次执行输出当次诊断，CI 不锁死耗时阈值。

## 依赖范围

仅新增 devDependencies：固定 Miniflare 和 esbuild 0.28.2。Miniflare 的 undici/sharp 分别限定 7.29.0 / 0.35.4，避免新测试工具带入其旧版告警。原站 Astro 使用的 esbuild 0.27.7 保留在自身子目录；原共享 @emnapi/runtime、semver 版本保留，新测试树使用独立所需版本。

`npm audit` 仍有原来的 9 个包告警（1 low / 7 high / 1 critical），不是审计全绿。新增 Miniflare/undici 不在最终告警名单；原站 Astro、sharp 等升级/可达性检查须独立处理，不在这批隐式升级。

## 真实预发门槛（未执行）

1. 另行授权创建独立预发 MUSIC_DB 与 R2 Standard 桶，核对数据库 ID 不等于 WAITLIST_DB，r2.dev 和自定义公开域均关闭；桶绑定本身不能证明私有。
2. 备份/记录资源身份，按序仅向 MUSIC_DB 应用 migrations-music/0001、0002。没有新增迁移，不执行原站 migrations。生产配置、套餐、预算提醒和权限最小化另审。
3. 在已鉴权、不会被公开调用的预发验收入口，用真实 D1 复测成功发布与末尾零命中回滚；验证 primary 会话、INTEGER 回传、json_object、changes()，记录完整环境/版本/UTC 证据。**不得把本测试 Worker 部署到预发来省略鉴权。**
4. 用私有真实 R2 的隔离对象复测 ETag、BYOB、截断、取消及 32 MiB/4 MiB。在实际 Workers 套餐上测 CPU 时间、整体 heap、并发与故障恢复，配置合适 CPU 预算和跨实例配额/限流；未实测前不宣称免费套餐足够。
5. 后续补封面/歌词/证据的完整验证器、不可覆盖上传、引用与清理协调。D1/R2 不共享事务，条件 GET 不能防止核验后的对象删除；本轮不解决整个 TOCTOU。
6. 发布前人工实际试听完整音频与独立试听，确认可解码、对应同曲和权利材料。MP3 帧/hash 检查仍不证明 Huffman 解码或语义同源。

上述检查未完成前不开放音乐路由、导航或 VIP 媒体。没有新音乐套餐、扣点入口或会员账本。

官方接口核对：[R2 条件读取和对象流](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[Workers ReadableStream/BYOB](https://developers.cloudflare.com/workers/runtime-apis/streams/readablestream/)、[D1 batch/session](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Workers 资源限制](https://developers.cloudflare.com/workers/platform/limits/)。类型核对使用临时下载的 @cloudflare/workers-types 5.20260908.1，不加入应用依赖。
