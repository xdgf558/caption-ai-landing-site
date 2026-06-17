# Novel Real Payment Regression 6C

阶段 6C 用于生产环境真实小额支付回归：读者创建 NOWPayments 订单后，从支付返回、IPN 入库、点数入账或章节授权到前端刷新，都能被同一条订单状态链路验证。

## 已实现

- `GET /api/novels/payments/order?order={orderToken}`
- 支付返回站点后，书库页会按订单 token 轮询订单状态
- 章节购买返回站点后，章节页会按订单 token 轮询订单状态
- 订单查询 API 返回本地订单、最近 IPN 事件摘要、点数入账或阅读授权结果
- API 对账号订单校验 reader session，避免用订单 token 查看其他账号的购买记录
- API 使用 `Cache-Control: no-store` 和 `X-Robots-Tag: noindex`

## 订单状态 API

```text
GET /api/novels/payments/order?order=sc_xxx
```

账号订单要求当前读者已登录，并且 session 必须和订单的 `account_id` 一致。

成功响应包含：

- `order`
- `events`
- `fulfillment`

`fulfillment` 里的关键字段：

- `complete`: 点数入账、章节授权或打赏确认是否已经完成
- `pending`: 订单是否还在等待 IPN
- `needsReview`: 支付状态已确认，但本地没有找到入账或授权结果
- `nextCheckSeconds`: 前端建议多久后再次轮询

## 书库页行为

NOWPayments 成功返回：

```text
/library/?payment=success&order=sc_xxx
```

页面会：

1. 加载读者 session
2. 读取订单状态
3. 如果 `credit-pack` 已入账，刷新阅读点数和书库
4. 如果仍在等待 IPN，每 5 秒轮询一次，最多 12 次
5. 如果 `needsReview: true`，提示保留订单供后台排查

## 章节页行为

NOWPayments 成功返回：

```text
/zh-hant/works/{series}/{chapter}/?payment=success&order=sc_xxx
```

页面会：

1. 读取订单状态
2. 如果授权已经写入，重新检查章节权限
3. 权限通过后加载受保护正文
4. 如果仍在等待 IPN，保持门禁并提示正在确认
5. 如果支付已确认但没有授权，提示后台排查

## 生产真实回归步骤

1. 确认生产配置：

```text
https://wwwstationcat.org/api/novels/payments/status
```

需要看到：

```json
{
  "configured": {
    "apiKey": true,
    "ipnSecret": true,
    "database": true
  },
  "publicCheckoutEnabled": true
}
```

2. 登录书库：

```text
https://wwwstationcat.org/library/
```

3. 购买最小阅读点数包。

4. NOWPayments 支付完成后返回：

```text
/library/?payment=success&order=sc_xxx
```

5. 页面应显示：

```text
NOWPayments 已確認，閱讀點數已入帳。
```

6. 用同一账号打开付费章节，使用阅读点解锁。

7. 章节页应直接显示正文。

8. 后台或 D1 可核对：

- `novel_orders.status` 进入 `confirmed` 或 `finished`
- `novel_payment_events` 有合法 IPN 记录
- `reader_credit_ledger` 出现 `topup`
- `reader_credit_accounts.balance_credits` 增加
- 扣点后 `reader_credit_ledger` 出现 `spend`
- 扣点后 `novel_entitlements.source = reader-credits`

## 边界

6C 不做：

- 订单列表 UI
- 收入统计
- 失败订单后台排查 UI
- 退款自动回收

这些留给 6D 以后继续做。
