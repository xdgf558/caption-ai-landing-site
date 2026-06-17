# Novel Payments 5A

阶段 5A 只建立 NOWPayments 支付底座，不开放公开购买按钮，也不自动发放阅读权限。

## 已实现

- `novel_orders`
- `novel_tips`
- `novel_payment_events`
- `GET /api/novels/payments/status`
- `POST /api/novels/webhooks/nowpayments`
- `GET /admin/api/novels/payments/orders`
- NOWPayments IPN HMAC SHA-512 签名校验基础
- NOWPayments IPN 事件落库
- 已存在订单的状态同步

## 还没有在 5A 开放

- 小说页公开 checkout 按钮
- 打赏按钮
- 订单创建 API
- 支付成功后自动写入 `novel_entitlements`
- 受保护正文交付

这些会拆到 5B / 5C，避免支付、授权、正文交付一次性耦合。

## 环境变量

生产环境需要配置：

```text
NOWPAYMENTS_API_KEY=...
NOWPAYMENTS_IPN_SECRET=...
```

可选：

```text
NOWPAYMENTS_API_BASE=https://api.nowpayments.io/v1
NOWPAYMENTS_IPN_CALLBACK_URL=https://wwwstationcat.org/api/novels/webhooks/nowpayments
```

推荐用 Wrangler secrets 写入，不要写入仓库：

```bash
npx --yes wrangler@latest secret put NOWPAYMENTS_API_KEY
npx --yes wrangler@latest secret put NOWPAYMENTS_IPN_SECRET
```

## 状态检查

```text
GET /api/novels/payments/status
```

这个接口只返回是否已配置，不返回任何 secret。

示例字段：

```json
{
  "ok": true,
  "provider": "nowpayments",
  "configured": {
    "apiKey": true,
    "ipnSecret": true,
    "database": true
  },
  "publicCheckoutEnabled": false,
  "supportedCurrencies": ["USDTTRC20", "USDTERC20", "USDC", "BTC", "ETH"],
  "grantStatuses": ["confirmed", "finished"]
}
```

## Webhook 行为

NOWPayments IPN 回调统一进入：

```text
POST /api/novels/webhooks/nowpayments
```

Worker 会：

1. 读取 JSON payload
2. 用 `x-nowpayments-sig` 和 `NOWPAYMENTS_IPN_SECRET` 验签
3. 把合法事件写入 `novel_payment_events`
4. 尝试用 `order_id` / `payment_id` 匹配 `novel_orders`
5. 如果匹配到订单，更新本地订单状态

5A 不会自动发放 entitlement。后续阶段只应在本地订单状态进入：

```text
confirmed
finished
```

之后再写入 `novel_entitlements`。

## 后台订单检查

后台订单只读接口：

```text
GET /admin/api/novels/payments/orders
```

可选参数：

```text
status=confirmed
limit=50
```

这个接口属于 `/admin*`，必须继续被 Cloudflare Access 覆盖。

## 本地验证

```bash
npm run build
npx --yes wrangler@latest d1 migrations apply station-cat-waitlist --local
npx --yes wrangler@latest dev --local --port 8787
```

然后访问：

```text
http://127.0.0.1:8787/api/novels/payments/status
```

如果本地没有配置 NOWPayments secret，`configured.apiKey` 和 `configured.ipnSecret` 会是 `false`，这是预期行为。
