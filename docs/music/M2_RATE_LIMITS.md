# M2-05B：跨实例限流与只读诊断

状态：本地实现、专项及原生 D1/R2 验收完成，待复审。本批基于 M2-05A / PR #134，先审清理，再审本批。

## 请求合同

公开总闸仍在任何 D1/R2 操作之前。总闸打开后，目录/详情/歌单/capabilities/access、封面/歌词、音频入口分别进入 catalog/artwork/audio 限流组。通过限流后才读取曲目、会员资格或 R2。HEAD、304 条件读取、GET 和每次音频 Range 请求都计一次；限流成功不能替代每次 `/audio` 的 VIP 检查。

使用独立 MUSIC_DB 的 `0005_music_rate_limits.sql`。每次请求通过一个 D1 batch，先受限回收旧计数，再执行条件 UPSERT。源计数与全局计数在同一条 SQLite 语句的触发器内更新；全局计数未命中/失败会回滚源计数。没有进程内 Map、KV 最终一致计数或新增服务。计数表只服务滥用保护，不写会员、内容、播放统计或计费记录。

默认是每分钟固定窗口，以下均为预发观察初值，须真实流量/拖动播放压测后确认：

| 组 | 入口 | 每来源/分钟 | 全局/分钟 |
| --- | --- | --- | --- |
| catalog | 目录、曲目、歌单、capabilities、access | 120 | 6000 |
| artwork | 封面、歌词 | 240 | 12000 |
| audio | full/preview、GET/HEAD/Range | 120 | 6000 |

`MUSIC_RATE_LIMITS_JSON` 可完整覆盖三组 `{source,global}`，不接受缺组、额外字段、零数、非整数或 global 小于 source。固定窗口边界允许两侧各用一个窗口的预算，不宣称滑动窗口。被单来源拒绝的请求不占用其他来源的全局容量。

超限返回 `429 MUSIC_RATE_LIMITED`、`Retry-After`（到下一分钟，1–60 秒）和 no-store。来源/配置/迁移缺失、数据库失败、计数异常或超时返回 `503 MUSIC_RATE_LIMIT_UNAVAILABLE`，不继续访问内容与 R2、不降级放行。未知写入结果可能保守多计一次请求，但不会据此授权媒体。

## 来源和保留

只使用 Cloudflare 注入的 `CF-Connecting-IP`，规范化 IPv4/IPv6，不使用 Cookie、URL、X-Forwarded-For 或客户端自报账号。需要配置独立 secret `MUSIC_RATE_LIMIT_SECRET`（至少 32 字符的随机值）；没有把测试 secret 写入部署配置，也未创建真实 secret。记录的是对“类别 + 分钟 + 规范化 IP”的 HMAC，不存原 IP，跨类别/窗口不共用同一个散列。secret 轮换会重建单来源键，但全局窗口计数不重置。

此来源假设适用于经 Cloudflare 入口的请求；同区 Worker 子请求及移除 IP 的 Transform 必须在真实预发核对。不能把此代码放到接受任意伪造同名 header 的裸源站。[Cloudflare header 合同](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip)解释了这些差异。

每次限流 batch 最多清除 100 条超过 10 分钟窗口的来源计数和 30 条无来源记录的旧全局计数。无流量时不会运行清除，积压由后续请求逐批回收；“10 分钟”是可回收条件，不是严格的物理删除期限。不覆盖既有 cron/queues，不新增定时任务。没有假称此功能是完整 DDoS 防护：拒绝请求也可能消耗 Worker/D1 调用；真实套餐、跨区域延迟和成本仍须预发验证。

## 诊断

`GET/HEAD /admin/api/music/diagnostics` 复用真实 Access 校验与 private/no-store，只读返回开关、音乐绑定/数据库可用性、上传计费、清理保留/回收额度及未知写入数量、有效限流阈值和当前窗口已放行次数。没有 IP/散列、会员/会话、objectKey、secret 或底层错误文本。不写审计；清理的 claim/prove/release 审计沿用 M2-05A。

绑定不存在时返回 `configured:false`；某个组件失败时单独显示 unavailable。诊断 HTTP 200 表示获得了诊断快照，不表示已经可以开闸，也不把正常权限拒绝或下架响应当系统故障。原有 401/403/410 与资格/媒体 503 错误合同保留。

## 验证和发布边界

- 限流/诊断专项 11/11：竞争下来源/全局上限、被拒不耗全局、IPv6 规范化、HMAC 窗口隔离、配置失败、全局计数故障回滚、受限回收、超时、总闸零访问、所有入口前置拦截及诊断只读。
- 公开接口 9/9，媒体协议 10/10；VIP 封面/歌词仍允许匿名读取，完整音频仍逐次核验 VIP。
- 原生本地 D1/R2 runtime 25/25，包含并发限流和全局计数 RAISE(IGNORE) 时回滚，且继续覆盖上传/审核/发布/清理/媒体。
- 全仓测试与构建结果见 HANDOFF，远端 CI 在 PR 中核对。

0005 仅 MUSIC_DB；未执行远程迁移、资源变更、secret 配置、部署、开闸或真实对象清理。M2-05A 的 0004 与维护开关仍独立。生产开启公开入口前必须先提供音乐绑定、0005、secret 并核对入口头和阈值；实际云端多实例、压测和恢复演练尚未完成。发生问题可关闭公开总闸，不回退到跳过 VIP 或限流的公开版本。

实现核对了 [D1 执行接口](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)与 Workers 官方类型 `@cloudflare/workers-types@5.20260910.1`；未增加运行依赖。
