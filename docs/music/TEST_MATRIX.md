# 测试矩阵与 M0 实测

## 最新：M1-01 / M1-02

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
