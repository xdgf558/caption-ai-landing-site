# ADR-002 · 四项安全与恢复协议

状态：M0 方案冻结；故障模型可执行，业务后端未实现。配套 v1.0.1。所有 token/账号/音频均为实验夹具。

## 实际媒体身份

VIP 媒体必须同时拥有有效 opaque grant 和独立 Bearer。每次 GET、HEAD、Range、条件请求首先解析真实 principal，再验证 grant 的 accountId/sessionId/track/version/variant/expiry、账号及内容状态和权益。A URL 无 Bearer=401；B 即使 VIP、A 另一 session=403；同一 session 刷新后仍可使用未过期 grant。未知/无效 Bearer 不降级 Cookie 或匿名。拒绝及依赖故障不得交付 R2 字节。

public 模式只允许服务器确认的当前免费/独立试听，数据库约束要求 account/session 均为空；session_bearer 要求二者均非空。grant 哈希唯一，多次 Range 允许。上限 min(issued+600s, access/session/连续权益/下一策略边界)，playbackValidUntil=expiresAt。目录返回字段不能替代媒体鉴权。

本轮：真实 AVPlayer -> 委托 -> URLSession -> 本机 HTTP 服务发出了带固定测试 Bearer 的 HEAD 与 Range；另有 16 项 HTTP 请求矩阵。服务端只是夹具身份映射，不是生产 Bearer 验证。模型覆盖同 session 换 generation、公有模式和依赖失败。HTTPS TLS、CDN、R2、401 换代、并发取消/大文件背压需 M3/M4 真正集成。

URL+原始有效 Bearer 一起泄露仍能重放；本版不做 DPoP、DRM 或设备指纹身份。日志只记录认证是否匹配，不记录 token 或真实 grant。

## 独立播放硬截止

使用 ContinuousClock，包含休眠。预算=max(0,playbackValidUntil-serverNow-RTT-2s)，从收到响应的连续时刻起算。revalidateAt=min(issued+60s,deadline-5s)，不得早于 issued。无效时间、作用域/序号冲突拒绝安装。

权限请求单次最多 5s，有限退避 2/4/8s，429 服从 Retry-After，但都不推迟硬截止。普通 token 刷新、目录或权益 200 不延长。只有完整匹配的新 grant 可以原子更新活动 URL 与期限；旧在途请求仍有旧截止，版本变化重建 PlayerItem。

硬截止先 pause、取消 URLSession、移除 PlayerItem/可控缓冲、取消自动下一首、设置 explicitResume，再解释暂不可验证。明确拒绝、登出、删除使旧成功序号失效。恢复允许只能更新待播放状态，必须等用户再按播放。系统音频残余不可远程收回，实体机需记录调度误差，不能声称 DRM。

本轮：可控时钟模型覆盖 503/timeout/429、整首缓冲、迟到允许、旧成功覆盖拒绝、休眠和坏时间；模拟器探针实际在悬挂网络请求返回前移除播放器。探针使用 3s 合成截止，而非真实后端 grant，不含生产授权续期。

## 刷新事务与跨进程 journal

一个认证 Keychain item 保存完整旧凭据与 pending={requestId,oldGeneration,canonicalDigest,createdAt}；请求前必须成功保存。同会话 AuthService actor 单飞。重启沿用原 token/ID/body。收到结果逐项校验账号/session/family/代数/ID；一个 item 原子替换新凭据+pending=null，写成功后才发布 access token。登出/B 账号/更高代/删除先赢，晚响应无权复活。

服务端按已验证旧 token 哈希定位，不信任请求体 family/account。CAS 推进 + 操作唯一记录 + 加密结果同事务。唯一约束至少 (family,oldGeneration)、(family,requestId)、tokenHash。同操作 120s 内下一代仍当前时重放同结果/原期限；不续窗。密文清理后保留墓碑至 family 绝对期限：同操作过窗409、已被下一轮超过409、同 ID 改 body409；旧 token 换 ID 才撤销该 family；未知 token 不撤销别人。

本轮 SQLite 采用 BEGIN IMMEDIATE + 检查 UPDATE rowcount + 同事务 result insert；零行 CAS 明确抛错回滚。真实多连接并发和事务两处注入失败均有测试。四个真实子进程 os._exit 断点为 pending 已保存未发、server 已提交未回、响应收到未存、新状态已存未发布。文件原子 replace 模型只证明 journal 协议，不证明设备 Keychain 的数据保护/电源故障原子性。

**SQLite 的交互事务不能直接复制为 D1 db.batch 实现。**M2 必须使用实际支持的同库批处理/数据库约束阻止零行 CAS 后续写入，证明整个 batch 同成同败；不要把 JavaScript 读取 rowcount 后再发第二个 batch 当事务。本轮没有运行 D1 迁移或验证生产存储事务。测试 result 为虚构明文，不是生产加密；正式需带 keyVersion 的加密封装、无明文日志及轮换策略。

## 删除准备与独立查询

32 随机字节 receipt，base64url 无 padding；对解码后字节做 SHA256。请求 ID/receipt 在 prepare 前存进独立 DeletionRecoveryEnvelope。prepare 只提交 hash+scopeVersion，默认10min；状态查询凭据默认14day。服务器不能从哈希证明随机熵。

用户明确确认时先存 confirm ID/attempted，并确认原 receipt 可读和准备状态/期限。confirm 必须有 Bearer、服务端新近认证<=5min及适用 TOTP。原子提交 accepted、账号阻止访问、会话撤销和 outbox；此后普通重试401可接受，转 receipt 查询。receipt 只能查询一个任务最小状态，不能确认/取消/登录/读取个人资料。

重启只查询原任务，不自动确认。prepared/404 快照不证明在途 confirm 未提交；不换 ID 猜测。prepared 超时不删除；accepted/processing/retrying/attention_required 都保持账号阻止。队列发送失败依赖持久化 outbox 补偿。清理账号后最小任务状态仍存活。无效/过期 receipt统一404，查询503不假报成功。登出/切换/清缓存不清删除 item。

本轮模型覆盖两端响应丢失、存储失败、受理事务失败、未发送 outbox、撤销会话后查询、账号行清理、查询503、错 receipt/任务/过期和重复准备。模拟模型未实现完整最近认证、TOTP、队列消费者、真实个人数据删除或 receipt TTL 清理作业，不能把该测试当删除功能完成。

现有数据库有 game_purchases / game_entitlements 等 ON DELETE RESTRICT，以及部分财务记录的引用。正式删除需逐表匿名化/保留政策、备份处理和客服核验流程；不能为了通过 DELETE 擅自改成 CASCADE。M2 先保持封禁态并可恢复处理，M5 发布前关掉全部未决关卡。
