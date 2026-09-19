# M5 个人音乐库：隔离实现

收藏、最近播放和账号级历史偏好使用现有原生 Bearer 身份，保存在隔离 WAITLIST_DB。新增迁移仅在 migrations-mobile，生产迁移目录和 wrangler 配置未改。必须同时满足 MOBILE_AUTH_ENABLED、MOBILE_MUSIC_ENABLED、MOBILE_PERSONAL_SYNC_ENABLED=true 与 MOBILE_ENVIRONMENT=isolated；站点正式域名仍被认证配置拒绝。网页 Cookie 不替代失败的 Bearer。

收藏带资源版本和 mutationId，取消保留墓碑。账号级 revision CAS 与批事务保证状态、操作回执一同提交；同 ID 不同内容返回冲突，相同操作只执行一次。多页读取带 revision，快照过期需重读。最多 5000 个有效收藏。

最近播放只接受至少 5 秒的客户端事件（不作为权限、积分或奖励证据）。每个事件去重，同曲合并为最近一次，最多 1000 首/90 天；新增事件时物理清理并由隔离维护任务清理过期行。关闭历史由服务端拒绝事件；开关和清空均推进 historyEpoch，旧离线事件不能恢复已清空的历史。

本批墓碑与幂等记录保留至账号清理，未引入不安全的过期重放。隔离阶段每账号最多 100000 个操作，超出返回 LIBRARY_LIMIT；正式启用前需要实施经审查的压缩/游标失效策略，不能直接开启生产。新四表已列入销户 private_data_purge 草案，approved/executionEnabled 保持 false，无实际清理器。

网页现有本地收藏不自动迁入云端；没有新增网页登录同步或跨设备遥控。本批可验证的是两个隔离原生会话使用同一账号的数据共享。测试桥接仅 random loopback + 临时 proof，凭据只用于合成会话，不归档。

本地测试：移动认证 29、音乐 17、个人库 9、销户盘点 11 项；153 页构建使用 ALLOW_EMPTY_SERIAL_CONTENT=1，仅验证构建，不是生产部署包。真实 HTTPS/AASA、完整销户执行与实体机验收仍未完成。
