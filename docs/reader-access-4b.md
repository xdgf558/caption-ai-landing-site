# Reader Access 4B

阶段 4B 负责读者权限和书库内容，不接真实支付。

## 新增能力

- `novel_entitlements`
- `GET /api/novels/access`
- `GET /api/novels/library`
- `GET /admin/api/novels/entitlements`
- `POST /admin/api/novels/entitlements/grant`
- `POST /admin/api/novels/entitlements/revoke`
- `/admin/` 里的「读者授权」面板
- `/library/` 已解锁内容列表

## 权限模型

`novel_entitlements` 通过 `account_id` 绑定读者账号。

授权范围：

- `scope = chapter`：只解锁单章
- `scope = series`：解锁整本作品

权限类型：

- `paid`：付费章节
- `supporter`：支持者内容
- `all`：两类都可读

`revoked_at` 为空且 `expires_at` 为空或晚于当前时间时，权限才有效。

## 管理员手动授权

进入 `/admin/` 后选择「读者授权」：

1. 填写读者 Email
2. 填写 `seriesSlug`
3. 选择「单章」或「整本作品」
4. 单章授权时填写 `chapterSlug`
5. 选择权限类型
6. 保存

保存后，读者用同一个 Email 登录 `/library/` 就能看到对应的已解锁内容。

管理员授权 API 位于 `/admin/api/novels/entitlements*`。生产环境必须由 Cloudflare Access 保护 `/admin*`，同时 Worker 会校验 Cloudflare Access JWT；如果缺少 Access 环境变量或 JWT 无效，生产请求会被拒绝。本地 `localhost` 开发会放行，方便 Wrangler 验证。

## 章节页门控

免费章节仍然静态展示正文。

`paid` / `supporter` 章节不会把正文直接渲染到静态 HTML 中，而是显示锁定提示，并调用：

```text
GET /api/novels/access?series={seriesSlug}&chapter={chapterSlug}&access={paid|supporter}
```

4B 只验证权限路径。真正的受保护正文交付会和阶段 5 的支付订单、内容存储策略一起落地。

## 下一阶段

阶段 5 会接：

- NOWPayments 打赏入口
- NOWPayments 动态订单
- `novel_orders`
- `novel_tips`
- `POST /api/novels/webhooks/nowpayments`
- 支付 `confirmed` / `finished` 后自动写入 `novel_entitlements`
