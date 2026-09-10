# 测试矩阵

## 最新：M2-04 音频媒体协议

2026-09-10，main@9fc9e95 基线。`test:music:media` 10/10、会员 21/21、存储 12/12、本地 Miniflare runtime 18/18、全仓 `npm test` 与 `npm run build` 通过；构建 146 页、111 条 sitemap。详见 [M2_MEDIA_PROTOCOL](M2_MEDIA_PROTOCOL.md)。

覆盖总闸关闭零读取、发布版本/下架状态、独立试听、免费 full、匿名/普通/过期/受限/故障/VIP full、200/206/416、逐字节/开放/后缀/裁剪范围、无效及多范围、HEAD、If-Range 强 ETag/日期、无媒体 304、R2 缺失/变更/MIME/大小/范围异常和无媒体元数据泄漏。真实本地 R2 验证 preview/full 分段字节及 HEAD；响应直接流式返回 R2 body。

没有真实云端 D1/R2、预发/生产、浏览器播放器、Safari、正式音频、公开目录、歌单、清理或限流验收；未改开关与绑定。M2-03 歌单仍为 IN_PROGRESS，不影响本轮单曲媒体合同，但公开上线前仍需闭合相应产品范围。

## 最新：M2 私有上传与审核发布

2026-09-10，main@1ca7e02 基线。上传 11 项、runtime 17 项、npm test/build 通过，145 页/111 sitemap，详见 [M2_PRIVATE_UPLOADS](M2_PRIVATE_UPLOADS.md)。新增隔离真实字节上传到权利/技术审核/发布、会话四并发、无长度头 32 MiB 上传、实际字节超限/截断、技术事务零行回滚、新版失败保留旧版、附件 GET/HEAD；uploads/runtime 均在 CI 中。没有云端/真实授权/完整解码/实际试听/UI/真机验收，不是 M2 整体验收。

## 历史：M2-ADMIN

2026-09-10，main@9dc86e3 基线。管理接口 20 项、只读会员 21 项、发布 25 项、本地 runtime 14 项及全仓 npm test/build 通过，145 页/111 sitemap。详见 [管理接口](M2_ADMIN_API.md)。管理套件加入 npm pretest，runtime 沿用独立 CI 步骤。

真实 Worker 入口核对 RSA JWT/allowlist 与伪造身份拒绝；请求体实际计数/超时/UTF-8；跨曲资源、权利指纹、旧版保留；每步零写入与丢响应重放；原生 D1 管理 CRUD、末尾 RAISE(IGNORE) 回滚、四并发与下架归档。没有完整资源验证器时，HTTP 发布入口固定 503；只有测试模块注入合成发布材料。没有实际云端资源/迁移/部署/解码试听或 UI/Safari 验收。

## 历史：M2-RUNTIME

2026-09-10，main@3c48aa4 基线。`npm run test:music:storage` 12 项、`npm run test:music:runtime` 10 项与全仓 `npm test` 通过，正常 `npm ci` 重建成功。详见 [运行环境与存储](M2_RUNTIME_STORAGE.md)。runtime 是本地 workerd + D1 + R2 原生接口，不是生产/预发 Cloudflare；脚本进入仓库和 CI。

覆盖真实迁移与缺 0002、五份音频的条件 GET/BYOB、损坏 MP3 的写前拒绝、完整发布的 json_object guard、末尾零命中整批回滚、同键四并发、独立 reader D1 只读查询、32 MiB/4 MiB 单读与四并发及测试路由隔离。固定缓冲与本地耗时不能当作生产 CPU/整体内存指标；证据审核仍是合成 stub，不证明完整发布资源验证或音频语义同源。没有真实资源、迁移、部署、人工试听或 UI 验收。

## 历史：M1-05

2026-09-10，main@ac8ac76 基线。`npm run test:music:mp3` 21 项、`npm run test:music:publication` 24 项通过；真实编码 CBR/VBR/MPEG-2/原始流/试听样本与独立 packet 样本数一致，比较去填充 PCM 差异；覆盖 ID3/边界分块/伪造信息头/损坏/预算/中断/源绑定及容差。32 MiB/4 MiB 分块边界测试固定 carry 67,584 字节。新增真实字节核验阻断和成功发布的隔离数据库联测。见 [M1_MP3_VALIDATION](M1_MP3_VALIDATION.md)。

本地 workerd 五份 MP3 与截断失败检查通过；npm test/build 通过，145 页/111 sitemap。合成资源不进 public/Worker，CI 不下载/执行 FFmpeg。无真实 R2/预发 D1/多实例/生产 CPU 配额/Safari/音乐 UI 验收。npm audit 仍有原依赖的 9 项告警，新增两库未列入，详见核验文档。

## 历史：M1-04

2026-09-10，main@233d716 基线。`npm run test:music:publication` 23 项通过，已接 npm pretest/CI；覆盖新旧发布指针、逐步 SQL 失败及零命中整批回滚、同键重放/异键冲突/丢响应、并发多曲目录版本、下架留存、审核指纹与证据变动、资源证明缺失/错误、slug/文本/试听边界、500 首及自然到期竞态。见 [条件发布](M1_PUBLICATION.md)。

`npm test` / `npm run build` 通过，145 页 / 111 sitemap。Wrangler 4.130.0 在隔离本地 D1 从 0001 增量应用 0002 成功；Miniflare 的 first-primary、INTEGER 值、changes() 和早/晚步骤零命中整批回滚实测通过。没有运行完整生产服务、远程数据库、R2、真 MP3、Safari 或音乐 Playwright；没有修改 UI。

## 历史：M1-03

2026-09-09，main@8994fa4。`npm run test:music:membership` 18 项通过，已接 npm pretest/CI；复用真实会员/退款迁移和业务函数，以内存 SQLite 验证只读资格。覆盖真实会话、单次 first-primary 查询形状、最小字段、全库不变、日期/失效/故障/超时、未知多 grant/终身拒绝、四语路径、VIP 关闭、免费/试听隔离及 HEAD/条件请求合同。联测确认撤销后下一次读按原会员期限失效、保留未撤销续购。见 M1_VIP_ADAPTER。

没有 Worker 路由、音频字节、生产数据库或 UI 变更；不声称完成 D1 生产副本/多实例、Safari、真实支付或音乐 Playwright 验收。M1-04、M1-05 和 M2 媒体入口仍待做。

本轮 `npm test`、`npm run build` 均通过，145 页 / 111 条公开 sitemap；无新增依赖或部署动作。

## 历史：M1-01 / M1-02

2026-09-09，main@dee3cdf 基线。`npm run test:music:foundation` 17 项通过，已接入 npm pretest/CI；覆盖独立迁移、归属、不可变与 OR REPLACE、UTC/策略/显式 variant、四语私有字段过滤、自然到期 ETag、500 曲、隐藏曲歌单过滤、审核证据和统计结构。Wrangler 4.130.0 本地 D1 迁移通过，14 表/28 触发器，foreign_key_check 为空、quick_check=ok。`npm test` / `npm run build` 通过，145 页/111 sitemap。详见 M1_FOUNDATION。

无新 UI，未跑音乐 Playwright、真机或真实音频。M1-03 VIP 适配、M1-04 发布事务、M1-05 MP3 字节实测仍未实现。#118/#119 已上线，真实兑换、退款后台登录后及真实撤销验收由用户报告完成，不据此填写代理/Safari/多实例验证。

## M0 历史快照

日期：2026-09-09；基线 main@3b8bbc8；本地 Node v24.15.0。全部 M0 测试均未访问真实会员或执行交易。

### M0 当时已运行

| 命令/操作 | 结果 | 证据边界 |
| --- | --- | --- |
| `node docs/music/evidence/audit-current-membership.mjs` | exit 0，6 类观察均复现 | 使用现有 Worker/SQL 的隔离特征测试，不是合格音乐行为断言，也不是生产验收 |
| `npm test` | exit 0，全部现有测试通过 | 覆盖原站、游戏、会员、本地支付模拟、文章等；日志中的故障注入提示是测试场景 |
| `npm run build` | exit 0；144 页；111 条公开 sitemap；built foundation passed | serials/serialChapters 无 Markdown 的现有 glob 警告不阻塞；无新音乐页面 |
| 公开 payments/status 匿名 GET | HTTP 200 | 仅配置观察，详见 COMMERCIAL_RULES |

审计脚本包括：真实路由相同请求键双扣点、会员 INSERT 故障后仍扣点、未来开始时间仍 active、会话查询写 last_seen、签名退款保留会员、返回地址 helper 允许 slash-backslash 外站解析。

内存 SQLite 包装实现当前 D1 调用形状和 batch 事务，不能替代 Cloudflare 真实故障/并发/读复制测试。脚本对现状缺陷断言用于复核证据，**不得加入 CI 作为长期正确性要求**；修复后应改为保证正确行为的正式回归测试并归档本次观察。脚本没有复制会员业务实现，仅返回地址 helper 按明确源码边界提取，未走浏览器登录流程。

### M0 当时的后续计划（历史，不代表当前状态）

| 阶段 | 必测内容 | 当前状态 |
| --- | --- | --- |
| 原会员独立修复 | 原子兑换、同意图幂等、响应未知重放、真实退款/拒付/撤销、未来期和有效范围 | 未实现；涉及现有模块需授权 |
| M1 | 原规格 U01–U16 中领域/权益/发布/解析器用例，尤其未知值、精确 UTC、VBR/ID3、250ms 及半长边界 | 未运行 |
| M2 | 原规格 I01–I26 中 auth、GET/HEAD/Range/条件请求、逐字节/缓存、发布 CAS 与幂等、上传失败恢复 | 未运行 |
| M3 | 最后切歌生效、单 audio、队列/洗牌/循环、试听停止、撤销/登出卸载、连续失败停止 | 未运行 |
| M4 | 四语、320/390/768/桌面、44px、键盘焦点、歌词/收藏/存储失败、安全回跳、统计关闭/故障 | 未运行 |
| M5 | Access+Origin、冲突保留、审查门槛、真实上传进度、发布/下架/归档、无假统计 | 未运行 |
| M6 | 全部原规格 U/I 编号逐项有证据；原站完整回归与浏览器；500曲、30次首声、30分钟；备份/回滚 | 未运行 |
| 真机/商业 | iPhone Safari、音频中断/锁屏/网络切换，正式作品权利，生产白名单 VIP 及退款撤销 | 未运行 |

M0 当时没有跑 Playwright：没有 UI 代码变化。该历史测试结果不覆盖当时新发现的缺陷，也不表示音乐已具备付费上线条件。当前进度以本文顶部和 CURRENT_PHASE 为准；不得把 Node 内存 webhook 模拟写成真实 Creem 支付测试。
