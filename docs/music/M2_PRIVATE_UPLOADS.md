# M2 私有上传与审核发布

2026-09-13 规则更新：整个音乐后台的来源材料已改为可选，详见 [OPTIONAL_SOURCE_MATERIALS](OPTIONAL_SOURCE_MATERIALS.md)。以下历史描述中必填来源/凭证及必须先取得 approved 的要求被替代；明确 blocked 仍阻止技术核对/发布，主动提交 approved 的完整性校验和技术核对要求保留。

2026-09-10。基线：已合并 PR #125，main@1ca7e0233e0315434566ca99247b1cd5280f9262。分支：codex/music-private-uploads。

本批本地实现与验收完成。没有 UI、远程迁移、云端资源创建、部署、正式歌曲上传/发布或公开开闸。测试中的权利材料和试听勾选仅为合成夹具，不代表真实授权或代理实际听过歌曲。

## 接口

全部沿用音乐专用 Access JWT 签名及 allowlist 检查，不信 email/Host/local bypass。写请求需同源 Origin、`X-Requested-With: StationCatMusicAdmin`；JSON 仍限 64 KiB，原始文件 PUT 独立计数。不接任意外部 URL，不发裸桶地址或签名播放凭据。

| 方法与路径（前缀 /admin/api/music） | 合同 |
| --- | --- |
| POST /uploads | `trackId, kind, format, byteSize, sha256`；preview 另需 `sourceAssetId, sourceStartMs, sourceEndMs`；Idempotency-Key 必需 |
| GET/HEAD /uploads/{id} | 仅创建该会话的管理员可查看；返回状态/到期/字节数/assetId，不返回 key/hash/write token |
| PUT /uploads/{id}/body | 精确 Content-Type、原始字节、Idempotency-Key；一次写入，查询/complete 恢复未知结果 |
| POST /uploads/{id}/complete | 空 JSON、Idempotency-Key；核验真实对象、结构/hash/长度及 MP3 时长后提交 validated |
| GET/HEAD /assets/{id} | 已验证私有素材的管理员审阅；证据/歌词强制 attachment，CSP sandbox、nosniff、same-origin、no-store |
| PUT /revisions/{id}/technical-review | If-Match + Idempotency-Key；`audioListened, previewListened, previewSourceConfirmed, artworkChecked` 四个显式布尔值及 reason |
| POST /tracks/{id}/publish | 既有 If-Match/政策版本/幂等合同，现在接实际资源验证器，可在本地完成成功发布 |

审阅下载忽略 Range/If-None-Match，返回完整 200，不发 304，不跳过鉴权；HEAD 不带 body。这不是 M2-04 的公开音频 Range 接口，公开媒体仍未接线。四开关默认关闭且没有加入部署配置；`/status` 分开返回 uploads、technicalReview、publish、adminAssets 与 public media 能力。

## 上传与配额

新增 **0003_music_uploads.sql，只能应用到 MUSIC_DB，禁止用于 WAITLIST_DB**。增加预期 SHA-256、一次写入令牌和会话不可变/禁止 REPLACE/DELETE/非法回退触发器；默认 `storageQuotaBytes=0`，即使上传开关为 true 也不能创建会话。项目配额须经独立运维批准配置，不提供公网配额修改接口。

配额在同一 D1 batch 中与预留、asset/session、audit/receipt 提交。计入所有会话 declared_bytes（不论成功、失败或过期）及没有会话的历史资源字节数；条件 guard 再核对配额与总量，防并发超卖。每管理员最多 10 个未过期的 reserved/uploading 会话。status 返回 chargedBytes 和 80% nearQuota 状态，无虚构账单统计。

会话 24 小时有效，服务端生成唯一 key；只有一个请求能从 reserved 取得写入资格，不接管同一 key。R2 PUT 使用 `etagDoesNotMatch: '*'`、SHA-256 校验和以及服务端 session/asset metadata。请求体从原生 BYOB 每次最多 64 KiB 读取，独立计数后经 FixedLengthStream 写入；缺少/伪造 Content-Length 不能放松长度限制。PUT 120 秒 I/O 期限，断连取消泵送；完整/试听从不整曲 arrayBuffer。客户端 SHA 只是预期值，R2 校验后 complete 还会重新计算实际字节 hash。

丢 PUT 响应：GET 会话后 POST complete；即便数据库仍显示 uploading，complete 可从匹配会话 metadata 的私有 R2 对象恢复。同键 complete 重放不再读 R2；已经完成的新键请求也返回完成状态。重传只能创建新会话，不能覆盖已上传/验证文件。无法确定 R2 写入结果时返回 UPLOAD_WRITE_UNCONFIRMED/UPLOAD_TIMEOUT，保留会话；确定的实际长度错误、文件结构错误会审计拒绝。

**配额回收与自动清理仍未实现。** 过期会话读时标记 expired，不能再 PUT/complete；失败对象始终私有并保留 charge。不得手工删回执/会话来恢复额度，或因为一次超时就删除可能刚写成功的对象。M2-05 要做引用/发布竞态保护、迟到写入处理、R2 对账、dry-run 和审计回收。本批保守不释放额度，可能提前停止新上传，但不会绕过配额。对象丢失的重试也保留旧预留，后台必须展示这一限制。

## 真实资源校验

沿用 32 MiB 原曲、4 MiB 试听、5 MiB 封面、128 KiB 歌词、10 MiB 证据上限。每次核验条件 GET 绑定 ETag/key/size/MIME；原生 BYOB 无降级，读取与解析有期限。小格式最多缓冲自身受限文件（上限 10 MiB）；MP3 沿用固定 carry 的逐帧时长/hash 检查。complete 全部对象读取共用 10 秒期限，发布整组最多 14 件资源串行共享 10 秒期限。

- MP3：沿用 M1-05 实测样本时长，uploaded 阶段单独测量函数，不放宽原 `verifyStoredMusicAudio` 的 validated-only 合同。试听验证同曲源 ID、不同 hash/key、范围、半长/45 秒上限和 250ms 容差。
- PNG：签名、IHDR 尺寸/像素格式、chunk 长度/CRC、IDAT/IEND，拒绝 APNG 控制块。
- JPEG：SOI/SOF/SOS/EOI 与有界 marker/scan 扫描、尺寸，不做像素解码。
- WebP：RIFF 容器长度、VP8/VP8L/VP8X 尺寸与标记，拒绝动画标记/ANIM/ANMF。
- 图像尺寸均限制 4096×4096；不接 SVG/HTML。以上是有限支持的容器检查，不是完整图片解码，人工查看仍必需。
- TXT/LRC：严格 UTF-8、控制字符拒绝、最多 5000 行。LRC 时间轴显示/编辑是后续 UI；这里不承诺自动修正时间戳。
- PDF 证据：只验证 PDF 版本头和 startxref/EOF 包络，**不是 PDF 语义校验、恶意文件扫描或真实性证明**。只在受保护附件下载中交付，不能内嵌站点执行；实际打开核对由管理员完成。

候选 image-size@2.0.2 因新增未修复安全告警被撤销，最终无新依赖、无 lockfile 更改。原 npm audit 9 项告警仍存在，不声称全绿。

## 审核与发布

先保存附件引用为新草稿、再权利审批、再技术审核。技术审核必须明确确认原曲试听；有 preview 时同时确认短文件已听、来源对应，有封面时确认图像已查看。仅勾选不够：服务端仍重验全部字节与同一发布领域合同，再计算指纹，事务写技术时间/指纹、editVersion、审计和回执。未知结果用原键重放，不能用新键覆盖竞争者版本。

发布不接受客户端 proof/fingerprint/approved；服务器再次核验所有音频、封面、歌词和证据。原权利指纹、技术指纹、条件事务及零命中回滚不变。更新草稿或权利后需重新审核；新版校验失败不切换旧公开版。图片/音频结构可过并不保证能解码，MP3 hash/时长/源 ID 也不证明语义同源；人工试听与授权核对不能省略。

D1 与 R2 仍不共享事务；核验后对象被外部删除的竞态、远端绑定 ID 配错、CPU 套餐与多实例仍待预发验证。本批不承诺公开媒体交付，不改原会员/积分/退款/支付路径。

## 本地验证

- `npm run test:music:uploads`：11 项，通过。配额竞争/历史计费、幂等重放/末尾回滚、会话隔离/不可变/过期、实际图片/文本/证据格式、结构拒绝与原子 complete。
- `npm run test:music:runtime`：17 项，通过。本地 Miniflare/workerd 原生 D1/R2；新增五类真实字节上传到审核发布、同会话四并发、未知 PUT 响应恢复、SHA/长度失败、32 MiB 无长度头上传、技术审核末尾 RAISE(IGNORE) 回滚、新版对象丢失保留旧公开版、私有附件 GET/HEAD。
- `npm test`、`npm run build`：通过；145 页、111 条 sitemap。uploads 与 runtime 均纳入 CI 独立步骤。
- 未跑音乐 UI/Playwright/Safari、真实解码试听、生产/预发 D1/R2、多实例及真实授权材料核查。本批没有 UI，后续界面开发须使用 Product Design。

**scripts/helpers 的 Worker 含假身份和上传测试开关入口，仅供隔离本地测试，禁止部署。** 应用 Worker 不引用夹具；测试绑定与真实账号、支付和音乐桶完全隔离。

参考：[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)，2026-09-10 核对条件 PUT、校验和与 R2 一致性合同。不能用本地通过代替实际云端验收。
