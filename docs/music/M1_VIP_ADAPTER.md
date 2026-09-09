# M1-03 只读 VIP 适配

基线：main@8994fa4，PR #120 已合并。交付 `src/music/membership.js`、`src/music/access.js` 与隔离测试。不修改 Worker 路由、原会员/支付/退款实现、数据库迁移、生产开关或 UI。本模块尚未连接线上音乐请求；M2 必须在媒体入口重新鉴权，不能把 capabilities 或 access 响应当播放令牌。

## 唯一资格来源

只接受 Request 中与现有登录相同的 `station_cat_reader_session` 不透明 Cookie，对原始 token 做 SHA-256，通过 WAITLIST_DB 查询真实 `reader_sessions`。不读取 body/query 中的 accountId、isVip、expiry、payment=success、X-Reader-Account 或管理员 Access 邮箱。重复/非法 Cookie 不挑一个继续授权，返回匿名。

每次有有效格式 Cookie 的调用新建 `withSession('first-primary')`，以一次 SELECT 同时关联会话、账号和会员，避免分别查询出现不一致。读取列只有账号关联、账号状态、会话起止/撤销、会员 level/起止；不查询邮箱、密码、积分、订单、metadata、游戏/小说权益或退款审核表。最多两行，异常重复返回 503，不从未知多 grant 表里任挑一条。

Cloudflare 的 [D1 Session 合同](https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession) 说明 first-primary 的第一条查询读取主库；本模块仅执行这一条查询，不依赖后续副本或跨请求 bookmark。测试断言调用形状与单次查询；未声称跑过生产读复制或多实例验收。

沿用原 `membershipTimestamp` 和 `isReaderMembershipActive`。唯一确认映射是 `reader_memberships.membership_level = member` 的站点级有限期会员，它与某本小说的 member/paid、游戏商品、正/负积分无关。只在 `[started_at, expires_at)` 内授权；未来期不提前生效，空期限不能推导终身，非法/未知 level 或日期为 503。原表是 account_id 主键，没有独立多 grant/scope/终身字段，本轮不添加、不模拟合并未知 grant。续期和退款只读原表最终状态，不按 30 天重算，也不因负余额封禁。

查询默认预算 1500ms，超时返回 503；最多允许服务端测试/配置传入 5000ms。Promise 超时不能取消 D1 已发出的 SELECT，但迟到结果不修改已返回的资格，且完全没有写操作。使用查询结束后的服务端时间检查到期，不用开始查询的旧时间。无跨请求缓存；每个后续请求会重新读取撤销、禁用、续费或账号变化。

## Capabilities 与 Access 合同

`musicCapabilities(request, env, options)` 返回最小 JSON Response，包含规格中的 authenticated、membershipStatus、canPlayVipFull、validUntil、lifetime、serverNow、membershipCenterPath、loginPath、musicVipDeliveryEnabled。会员中心路径直接复用原站四语 `readerLibraryPaths`，不拼接用户提供的回跳路径；音乐精确回跳仍属 M4。

- 未登录/会话无效：正常 none；无 Cookie 时不访问数据库。普通账号 none，已过期 expired。
- 账号非 active：403 ACCOUNT_RESTRICTED，不提供购买/登录跳转来暗示付费能解禁。
- 缺绑定/表、数据库错误/超时、查询结果异常、未知会员类型或坏日期：503 MEMBERSHIP_UNAVAILABLE，状态 unavailable、能力 false、链接为空，不伪装成普通用户。
- 有效会员：active。`validUntil` 是会话和会员结束时间中较早者，用于客户端及时重查；不是另一个会员期限。原资格到期仍以 reader_memberships 为准。lifetime 始终 false。
- 原来源没有明确 revoked 字段；人工撤销通过压缩 expires_at 生效，所以使用 expired，不伪造“因退款撤销”的原因。
- `vipDeliveryEnabled` 默认 false，仅严格布尔 true 启用能力判断；不会从请求参数或字符串 true 授权。此处不是生产开关配置。

`musicAccess(request, env, options)` 接受未来服务端从 MUSIC_DB 读取的 record、解析后的整数 revisionNo 和显式 full/preview。先检查方法、variant、内容发布状态、投影校验和版本，再检查资格；草稿/坏记录 404、下架/归档 410、旧版本 409。未知策略、跨曲素材等继续由 M1-02 公开投影拒绝，不能按旧 URL 越过策略。

免费 full 和已有独立 preview 不查询会员，会员数据库故障和 VIP 交付关闭不拖死它们。preview 不存在返回 404，不回退完整音频。VIP full 按顺序返回交付关闭 503、资格故障 503、账号受限 403、匿名 401、过期 403、普通用户 403 或有效 VIP 200。

access 输出 effectiveAccess、canPlayFull、canPreview、reason；preview 分支没有查询 VIP，因此受保护曲的 canPlayFull 为 false（表示本次未确认，而非断言该账号不是 VIP）。界面先读 capabilities，主动请求 full 才确认完整权限，不得把一次试听查询误当成会员降级事件。

所有成功/错误 Response 均为 `Cache-Control: private, no-store`、`Vary: Cookie`。GET/HEAD 走同一判定，HEAD 无 body；Range/If-Range/If-None-Match 不跳过资格、不产生 304、不输出大小/ETag/对象 key。这里只测试资格合同，不返回音频，不代表 M2 Range 字节协议已完成。

## 验证与限制

`npm run test:music:membership`：18 项通过，接入 npm pretest/CI。真实迁移构造内存 SQLite；断言单次主库查询形状、哈希会话/账号隔离、全库快照不变、UTC/未来/失效/坏日期、未知类型/重复行、超时/迟到、四语路径、交付默认关闭、免费/试听隔离及 HEAD/条件请求失败关闭。

联测直接调用现有 `applyMembershipRedemption` 和 `decideMembershipRefundReview`，不是重写兑换/撤销逻辑。撤销一期不吃掉后续续费；全部撤销后按原服务计算的真实到期边界失效。原退款服务按秒计算，测试允许其不到 2 秒的边界误差并在实际 end 校验，不擅改原算法。这是隔离联测，不是生产退款/现金交易证据。

全站 `npm test` 通过（含原有 17 项音乐基础测试及新增 18 项资格测试）；`npm run build` 通过，145 页、111 条公开 sitemap。`git diff --check` 无错误。新增命令沿用现有 CI，不新增依赖。

没有 UI，不声称 Product Design 或浏览器/真机音乐验收已执行。无生产 D1 查询、资源创建、迁移、部署、上传或开闸。M1-04 发布事务、M1-05 真 MP3 解析和 M2 受控媒体交付仍是前置门槛。涉及 UI 时调用 Product Design 并做桌面/移动验收。

## PR #120 评论跟踪

- M2 写入口前：追加迁移保护 music_mutations 的 UPDATE/INSERT OR REPLACE，不把幂等回执当可覆盖缓存；本轮不改初始化迁移。
- M1-04：复用统一 slug、策略、素材和 preview 元数据校验，不能仅依靠 SQL 长度约束；后续需接 M1-05 真音频测量证据。
- M2 公共目录接入前：决定空歌单隐藏/空状态行为并补测试。本轮不改变已有目录表现。
- 历史交接中的退款待确认仅属于 M0，最新状态已在 CURRENT_PHASE 与本轮 HANDOFF 明确。
