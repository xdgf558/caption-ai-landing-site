# Station Cat Music：Codex 启动指令 v1.1

配套完整规格：`Station_Cat_Music_开发文档_v1.1_VIP整合版.md`。

把完整开发文档放入 `docs/music/DEVELOPMENT_SPEC.md`；本启动指令可放入 `docs/music/CODEX_START.md`。两份文件不可互相覆盖。已经按v1.0开发时保留原进度和数据库，先按规格第19.4节做差异核对。

```text
请在 xdgf558/caption-ai-landing-site 的当前工作分支中，
按照 docs/music/DEVELOPMENT_SPEC.md v1.1 开发 Station Cat Music。

先读取 AGENTS.md、原项目阶段文件、音乐当前阶段、package.json、
wrangler.toml、Worker、公共布局、后台鉴权、现有会员中心与支付说明。
先核对实际分支，不把文档里的历史代码快照当成当前生产状态。

如果尚未开工，先完成 M0，并在可验证范围内继续 M1。
如果已按 v1.0 开发，保留已有进度，建立 v1.1 差异清单，
按第19.4节增量实现。不要重置数据、重跑迁移或覆盖别的项目记忆。
本次不部署生产、不创建付费资源、不修改真实VIP价格或扣费规则。

必须遵守：
1. 原站Astro增量开发，单一HTMLAudioElement，保留其他业务。
2. 私有R2 Standard MUSIC_BUCKET和独立MUSIC_DB继续采用；不迁到VPS。
3. 免费精选免登录完整播放；VIP曲独立短试听；现有有效全站VIP完整播放。
4. 音乐并入原VIP，额外收费为零，不新增音乐月卡、自动续费或按次扣点。
5. 复用现有服务端账号与全站VIP，只读适配；不复制会员期限或支付账本。
   积分余额、作品级权限、客户端isVip、付款成功URL均不能授予音乐VIP。
6. M0核对真实全站范围、起止日期、多grant、终身、退款和资格撤销路径。
   未证实的生产配置列上线前置条件，不能猜测；开发用隔离fixtures继续。
7. 独立试听默认至多45秒，短曲按半长上限；服务端时长解析、源绑定和发布阻断。
   禁止完整音频先发给免费用户，再由JS倒计时暂停。
8. GET/HEAD/Range/条件请求共用当前发布与会员守卫；完整/试听物理隔离。
   VIP资格故障返回503，不能免费放开；免费曲和试听不依赖VIP服务成功。
9. 实现free/vip/early_access，默认7天抢先并明确结束后去向，服务器时间判定。
10. 队列过滤、试听结束停止、到期/登出/账号切换、歌词偏移、本地v1迁移都需测试。
11. 会员中心复用现有价格和流程；返回后只读核验资格，保持暂停，不再扣费。
12. 最小第一方统计独立开关，隐私条件满足后启用，不把试听或Range请求当完整收听。
13. 草稿/证据隔离、上传实际字节限制、幂等、并发guard、私有缓存均须测试。
14. 不新增全站ClientRouter，不承诺跨页不断播、下载、离线、商用授权或完全防复制。
15. 不改变原独立商品权益，不发布测试音频/假统计/未核对作品，不擅自改退款政策。
16. 上线过VIP曲后，禁止回滚到会公开完整音频的旧v1.0处理器。

维护 docs/music/PROJECT_CONTEXT.md、CURRENT_PHASE.md、TASKS.md、
DECISIONS.md、TEST_MATRIX.md、HANDOFF.md、OPERATIONS.md、
MEMBERSHIP_INTEGRATION.md、COMMERCIAL_RULES.md。

每阶段输出：任务编号、改动文件、实际测试命令与结果、未验证项、
迁移影响、现站回归、回滚边界、会员与退款映射证据、下一阶段输入。
没有实际执行的测试明确写“未运行”，不要将设计方案写成已上线能力。
```
