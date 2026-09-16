# M0 接口与迁移影响

以下是拟实施契约清单，不是线上已存在接口。完整字段/错误见 docs/specs 主规格第12节；M1交付可机读OpenAPI及fixtures。

| 路径（除注明外前缀 /api/mobile/v1） | 认证 | 现有复用 | 实施 |
|---|---|---|---|
| GET /config | 无 | 现有能力/开关投影 | M1契约，M3真实能力 |
| GET /auth/mobile/authorize（站点根） | 系统浏览器 | 登录、注册、TOTP/找回服务函数 | M2专用页面，精确redirect+state+PKCE |
| POST /auth/token | 一次性code+PKCE | 账号身份 | M2原子消费90秒code、初始化Keychain |
| POST /auth/refresh | 旧token+固定操作ID | 无原生等价物 | M2 journal、120秒结果/独立墓碑 |
| POST /auth/logout | Bearer | 会话撤销语义 | M2当前native session撤销 |
| GET /me，GET /me/entitlements | Bearer | reader_accounts、site VIP | M2身份，M3细分音乐权益 |
| GET /music/catalog、/music/featured、/music/tracks/{id}、/music/collections/{slug} | 无 | src/music投影/版本/封面/歌词 | M3只暴露已发布内容 |
| POST /music/tracks/{id}/playback-grants | VIP full须Bearer | resolveMusicAccess底层规则 | M3 server-selected authMode/期限 |
| GET/HEAD /music/media/{grant}/audio | grant+Bearer或明确public | Range/R2服务 | M3逐请求校验、不跟随重定向 |
| GET /me/music/favorites；PUT /me/music/favorites/{id} | Bearer | 当前仅浏览器本机数据 | M5状态版本、mutationId、墓碑 |
| GET /me/music/recent；POST /me/music/listens；DELETE /me/music/recent | Bearer | 现有匿名统计不等于个人历史 | M5阈值/去重/epoch |
| GET/PATCH /me/music/preferences | Bearer | 无共享偏好接口 | M5 enabled+epoch+version |
| POST /me/deletion-requests/prepare | Bearer+新近认证+幂等ID | 新增 | M2只准备不删号 |
| POST /me/deletion-requests/{id}/confirm | Bearer+新近认证+幂等ID | 新增 | M2显式确认、原子受理/outbox |
| GET /deletion-requests/{id}/status | DeletionReceipt | 新增 | M2无Cookie/无Bearer重试拦截器、只读最小任务状态 |
| 音乐offering、Apple purchase-intents/transactions/status/reconcile | Bearer | 不复用积分充值商品 | M6/M7；首版不显示购买 |
| POST /webhooks/apple/subscriptions（站点根） | Apple签名 | 独立通知入口 | M6持久化inbox后回应 |

## 迁移拆分

账号数据库现有 migrations/0001…0037；音乐独立 migrations-music/0001…0011。本轮未创建可执行生产迁移，避免误用原型SQL；实际编号必须在M2开始时按最新主线确定。

M2：增加native_auth_codes、native_sessions、native_refresh_operations、account_deletion_jobs/outbox。账号主键类型保持INTEGER，外部输出字符串；不批量重命名reader_*。原生会话与现有重置/封禁生命周期一起失效。删除状态查询不使用ON DELETE CASCADE账号外键。

M3：music_playback_grants的身份信息建议放WAITLIST_DB；会话/账号状态与授权约束可同库校验，内容信息仍从MUSIC_DB读取。public/绑定模式以CHECK约束约定。现有旧媒体接口保持独立契约。新权益聚合只添加适配，不提前改变全站VIP存储含义。

M5：music_user_favorites/recent/preferences/mutations，账号维度复合唯一键、稳定分页、墓碑/去重清理和historyEpoch。网页游客数据只经明确同意合并，不能静默绑定新账号。历史关闭及清空均失效旧epoch。

M6：Apple环境+bundle+交易链/单笔交易唯一绑定，inbox/outbox、权益来源分别保存。不得把苹果月付存入reader_memberships或给积分。

## 删除依赖与前滚

现有reader_sessions、login_tokens、credentials、bookmarks、comments、game_saves等存在账号CASCADE；novel_orders/payment/reading_events存在SET NULL；game_purchases/game_entitlements/game相关管理员记录存在RESTRICT；membership_refund_reviews也引用账号。reader_membership_redemptions还关联ledger。新增删除任务不能先随账号级联消失，也不能盲删财务引用以满足外键。

M2需逐表确定保留/匿名化/删除/脱关联顺序，验证旧游戏与账本只读管理、幂等阶段重跑和失败后仍阻止账号访问。outbox入库与发消息分开，失败可恢复；收据只读状态在其14日期限内独立存活。财务/备份保留期由产品与适用要求另行确认，本文件不捏造统一年限。

新增表先做隔离迁移/恢复演练；回退UI不DROP新表。独立订阅一旦售出，不能回退至完全不识别该来源的旧鉴权版本。生产迁移和部署需要后续单独任务；本次未执行。
