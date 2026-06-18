# Station Cat 小说阅读模块开发阶段

## 当前决定

第一版小说阅读、读者账户、NOWPayments、阅读点数和受保护章节交付已经跑通。接下来进入阶段 7，把日常内容运营从 GitHub Markdown 迁移到后端内容平台。

新的长期方向：

- GitHub 只作为网站代码仓库。
- 小说、章节、Blog/Devlog、收费规则、导入记录和审计日志逐步放到 D1 / R2。
- 新 Admin 2.0 统一管理小说、Blog、媒体、收费、读者账户、订单和授权。
- 旧 `/admin/` 的 GitHub token 写 Markdown 功能在迁移完成后由 Admin 2.0 取代。

过渡期原则：

- 当前静态页面继续可用。
- `src/content/devlog`、`src/content/serials`、`src/content/serialChapters` 暂不删除。
- 先建立后端内容模型，再逐步迁移正文读取和后台操作。

## 阶段 1：前台模块替换

### 目标

把用户看到的 `作品集 / Works` 入口，改成小说阅读入口。

### 范围

- 顶部导航改名
- 首页 `works` 相关板块改成小说书架 / 连载入口
- `/works/` 改造成小说列表页
- `/works/[series]/` 改造成单本小说页
- `/works/[series]/[chapter]/` 改造成章节页
- 新增 `serials` / `serialChapters` 内容集合
- 先放一部可替换的示例作品，证明结构可用

### 暂不包含

- 管理员上传后台
- 读者账户系统
- 打赏与付费阅读
- D1 阅读权限

### 验收标准

- 首页与导航不再把 `works` 当作 X 存档入口
- 至少有一个可打开的作品页
- 至少有一个可阅读的章节页
- 多语言壳层还能正常切换

## 阶段 2：真实连载发布流程

### 目标

把“结构可用”推进到“你能稳定发文”。

### 范围

- 确定你的小说命名、Slug 规则、章节编号规则
- 建立一套固定的 Markdown 模板
- 补作品封面、简介、更新节奏、卷信息
- 批量录入前几章正文
- 优化目录页、上一章 / 下一章跳转、空状态文案

### 验收标准

- 你能自己新增一本作品
- 你能自己追加新章节
- 章节顺序、目录和翻页没有错位

## 阶段 3：作者发布工具

### 目标

如果你不想长期手改 Markdown，再补作者侧工具。

### 两条路线

#### 路线 A：继续 Git 内容流

- 保留内容文件模式
- 在 `/admin/` 里补一个小说发布表单
- 表单写入 `src/content/serials` 和 `src/content/serialChapters`

#### 路线 B：独立内容后台

- 后台上传作品和章节
- Worker 接口写入 D1 / R2
- 前台动态读取内容

### 当前建议

历史执行时先做了路线 A。阶段 7G 后，当前发布入口已切到路线 B：Admin 2.0 + Worker API + D1/R2。

### 阶段 3 本轮执行范围

- 在 `/admin/` 增加 `連載小說` 管理入口
- 支持直接粘贴完整 Markdown，或选择本地 `.md` 文件导入
- 自动识别小说资料和章节正文
- 自动推导默认保存路径
- 允许读取远端 `src/content/serials` 和 `src/content/serialChapters` 已有文件继续编辑
- 保存时通过 GitHub Contents API 写回 `main`，继续沿用 GitHub 到 Cloudflare 的自动部署

### 暂不包含

- 读者账户
- D1 / R2 内容后台
- 富文本编辑器
- NOWPayments 权限发放
- 章节草稿预览站

## 阶段 4：读者账户与书库

### 目标

开始让读者拥有“已购 / 已解锁 / 已打赏”身份。

### 阶段 4A：账户与会话

- 邮箱 + magic link 登录
- `reader_accounts`
- `reader_sessions`
- `/library/` 已购书库
- 登录状态查询与退出登录
- 本地开发调试登录链接

### 阶段 4B：权限与书库内容

- `novel_entitlements`
- 付费 / 支持者章节的权限判断
- `/library/` 已解锁内容列表
- 管理员手动授权测试入口

### 验收标准

- 读者换设备后仍能找回已购章节
- 权限判断不依赖浏览器本地缓存

## 阶段 5：打赏与付费阅读

### 目标

接入变现闭环。

### 范围

- `NOWPayments Donation Tools / Payment Button`
- `NOWPayments Payment API`
- `novel_orders`
- `novel_tips`
- `POST /api/novels/webhooks/nowpayments`
- 单章 / 分卷 / 特典权限发放

### 验收标准

- 打赏记录能落库
- 订单状态能更新
- `confirmed / finished` 后自动发放阅读权限

## 阶段 6：运营与长期维护

### 目标

把小说模块从“可用”变成“可长期连载”。

### 范围

- 支持页
- FAQ
- 章节 SEO
- 系列页 OG 图
- 更新日志
- 读者通知与催更订阅
- 付费阅读说明、退款边界、支持邮箱流程

## 阶段 7：后端内容平台与 Admin 2.0

### 目标

把小说连载和网站 Blog 从 GitHub Markdown 发布流，升级为可以在后台直接管理的内容和商业平台。

### 阶段 7A：后端内容模型与迁移地基

1. 新增 D1 内容表，覆盖 Blog、小说作品、小说章节。
2. 新增内容版本、导入记录、收费规则和后台审计日志表。
3. 定义 R2 正文、HTML、封面、附件和导入备份 key 规范。
4. 新增 Admin 2.0 可复用的内容 API 骨架。
5. 保持当前静态页面和旧 admin Markdown 流不受影响。

### 阶段 7B：章节正文迁移到 R2

1. 付费章节正文从构建生成模块迁到 R2。
2. 受保护正文 API 改为从后端读取。
3. 未授权读者仍只看到门禁和购买入口。
4. 已授权读者可以直接看到后端正文。

### 阶段 7C：Admin 2.0 内容管理平台

1. 开发新的管理员平台，先放在 `/admin-v2/` 或新版 `/admin/` 子入口。
2. 接入小说作品、章节、Blog/Devlog 的创建、编辑、导入、预览和发布。
3. 接入媒体管理、收费设置、打赏开关、多章折扣、用户、订单、授权和审计日志。
4. 验证稳定后替换旧 GitHub token 写 Markdown 后台。

### 阶段 7D：前台动态内容读取

1. 小说页和 Blog 页逐步支持从后端内容 API 读取。
2. 保留静态内容作为兼容和回滚路径。
3. 支持发布后无需重新部署即可上线内容。

### 阶段 7E：付费规则后台化

1. 免费前几章、单章价格、整本/分卷价格进入后台配置。
2. 余额包、一次购买多章折扣、打赏开关和金额进入后台配置。
3. 前台购买入口直接读取后端收费规则。

#### 阶段 7E-A：收费规则模型与后台保存

- Admin 2.0 保存内容时同步 `content_pricing_rules`。
- 后台可配置免费章节、单章价格、支持者价格、阅读点包、打赏金额和多章折扣。
- 新增后台规则查询 API：`/admin/api/content/pricing-rules`。

#### 阶段 7E-B：前台购买入口消费后台规则

- 章节门禁、购买按钮和 NOWPayments 下单改为优先读取 `content_pricing_rules`。
- 余额支付和多章购买价格提示使用后台规则计算。
- 公开 `/api/novels/pricing` 返回前台展示所需的最终生效规则。

### 阶段 7F：订单 / 账户 / 授权管理后台化

1. 完整订单列表、筛选、失败订单排查。
2. 读者账户、余额、流水、授权记录管理。
3. 手动补单、手动授权、撤销授权全部进入审计日志。
4. 新功能全部进入 Admin 2.0；旧 `/admin/` 只保留迁移期兼容，不再扩展新能力。

当前实现见 [order-account-admin-7f.md](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/docs/order-account-admin-7f.md:1)。

### 阶段 7G：旧 Markdown 内容迁移与旧后台下线

1. 把现有 `src/content/devlog`、`src/content/serials`、`src/content/serialChapters` 导入 D1 / R2。
2. 校验 slug、语言、发布时间、章节顺序和 SEO 数据。
3. 移除旧 GitHub token 写 Markdown 后台。
4. 在 Admin 2.0 提供扫描、模拟和执行迁移的受保护入口。

当前实现见 [legacy-content-migration-7g.md](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/docs/legacy-content-migration-7g.md:1)。

## 当前执行：阶段 7G

阶段 7A 已完成后端内容模型和迁移基础，阶段 7B 已把受保护章节正文读取迁移到 R2，阶段 7C 已新增 `/admin-v2/` 后台内容平台，阶段 7D 已让前台小说和 Blog/Devlog 支持读取后端发布内容，阶段 7E 已把收费规则和前台购买入口切到后端规则优先，阶段 7F 已把订单、账户、余额、授权和审计管理集中到 Admin 2.0。当前进入 7G，把旧 Markdown 内容迁入 D1/R2，并退役旧 GitHub Token 作者后台。

详细文档见 [legacy-content-migration-7g.md](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/docs/legacy-content-migration-7g.md:1)。

## 已完成：阶段 6C

阶段 5C 已完成 NOWPayments IPN 自动发放阅读权限。阶段 6 开始把付费阅读产品化。6A 已完成账户余额 / 阅读点数模式；6B 已完成已授权读者的受保护正文交付；6C 已把真实小额支付回归需要的订单状态自查和返回页轮询接上。

### 阶段 6A：阅读点数余额模式

1. 新增 `reader_credit_accounts`
2. 新增 `reader_credit_ledger`
3. 支持 `credit-pack` NOWPayments checkout
4. IPN `confirmed / finished` 后自动给读者账户入账
5. `/api/readers/credits` 查询余额、充值包和流水
6. `/api/novels/credits/unlock` 扣点并写入 `novel_entitlements`
7. `/library/` 增加阅读点数充值 UI
8. 付费章节门禁增加“用阅读点解锁”

### 阶段 6B：付费章节正文真正解锁显示

1. 构建时生成 `src/generated/protectedSerialContent.js`
2. 只把 `published` 且 `paid/supporter` 的章节正文写入 Worker 专用模块
3. 新增 `/api/novels/chapters/protected-content`
4. 正文 API 必须检查读者 session 和 `novel_entitlements`
5. 章节页初始只显示门禁，不在公开静态 HTML 中输出付费正文
6. `allowed: true` 后自动拉取正文并替换门禁
7. 阅读点数扣点成功后立即加载正文

### 阶段 6C：真实小额支付回归

在生产环境用 NOWPayments 做一笔真实小额订单，从下单、支付、IPN 到自动入账 / 授权完整验证。

1. 新增 `GET /api/novels/payments/order?order={orderToken}`
2. 订单状态 API 返回本地订单、最近 IPN 事件摘要、点数入账或授权结果
3. 账号订单必须校验 reader session 和订单归属
4. `/library/?payment=success&order=...` 自动轮询订单状态并刷新阅读点数
5. 付费章节返回页自动轮询订单状态，授权完成后重新检查权限并加载正文
6. 支付已确认但未找到入账 / 授权时提示保留订单供后台排查
7. 输出 `docs/novel-real-payment-regression-6c.md` 作为生产真实支付回归清单

### 阶段 6D：订单 / 收入后台管理

把基础订单和授权 API 扩展成 Admin 里的订单列表、筛选、状态查看、充值流水和失败订单排查。

### 阶段 6E：购买后体验

完善支付成功返回页、订单处理中提示、已购买章节入口、书库里的“继续阅读”。

### 阶段 6F：付费规则细化

继续细化免费前几章自动判断、会员 / 整本 / 分卷模式、已购买多章后的价格提示。
