# Novel Payments 5B

阶段 5B 在 5A 支付底座上增加公开 checkout 入口：读者可以创建 NOWPayments invoice，并跳转到 NOWPayments 完成支付。

## 已实现

- `POST /api/novels/payments/checkout`
- 作品页打赏入口
- 付费 / 支持者章节的解锁订单入口
- 创建本地 `novel_orders`
- 打赏订单同步创建 `novel_tips`
- 调用 NOWPayments Invoice API 创建支付链接
- 将 `invoice_url` 写回 `novel_orders.payment_url`
- checkout 未配置时安全返回 503
- 购买型订单要求读者先登录
- `/library/?returnTo=...` 登录后回跳原章节页

## 仍未开放

- 支付成功后自动发放 `novel_entitlements`
- 受保护正文交付
- 退款 / 取消后的自动回收

这些留到 5C。5B 的目标是让订单创建和支付跳转先跑通。

## Checkout API

```text
POST /api/novels/payments/checkout
```

打赏示例：

```json
{
  "orderType": "tip",
  "seriesSlug": "deng-hai-liang-zhe",
  "amount": 5,
  "priceCurrency": "USD",
  "returnPath": "/zh-hant/works/deng-hai-liang-zhe/"
}
```

单章解锁示例：

```json
{
  "orderType": "chapter",
  "seriesSlug": "deng-hai-liang-zhe",
  "chapterSlug": "chapter-slug",
  "returnPath": "/zh-hant/works/deng-hai-liang-zhe/chapter-slug/"
}
```

支持者权限示例：

```json
{
  "orderType": "supporter",
  "seriesSlug": "deng-hai-liang-zhe",
  "returnPath": "/zh-hant/works/deng-hai-liang-zhe/"
}
```

成功响应会返回：

```json
{
  "ok": true,
  "provider": "nowpayments",
  "paymentUrl": "https://...",
  "order": {
    "orderToken": "sc-...",
    "status": "waiting"
  }
}
```

## 安全边界

必须同时配置以下两个 secret，checkout 才会启用：

```text
NOWPAYMENTS_API_KEY
NOWPAYMENTS_IPN_SECRET
```

原因：只配置 API Key 会导致网站可以收款，但 IPN 无法验签更新订单状态。5B 直接拒绝这种半配置状态。

购买型订单必须有读者 session：

- `chapter`
- `supporter`

匿名只允许：

- `tip`

## 可选价格环境变量

Worker 会优先使用小说 Markdown 里的收费设置创建购买型订单。部署前的 `npm run build` 会运行 `scripts/build-novel-payment-config.mjs`，把 `src/content/serials` 和 `src/content/serialChapters` 生成到 `src/generated/novelPaymentConfig.js`，Worker 会读取这个生成配置。

这些环境变量现在只作为兜底价格和打赏上下限：

```text
NOVEL_CHAPTER_PRICE_USD=1.99
NOVEL_SUPPORTER_PRICE_USD=4.99
NOVEL_TIP_MIN_USD=1
NOVEL_TIP_MAX_USD=500
```

作品 Markdown 里的价格字段会同时影响页面展示和 Worker checkout：

```yaml
tipAmounts:
  - 3
  - 5
  - 10
tipCurrency: "USD"
chapterPriceAmount: 1.99
chapterPriceCurrency: "USD"
supporterPriceAmount: 4.99
supporterPriceCurrency: "USD"
bundlePurchasesEnabled: true
chapterBundleDiscounts:
  - chapters: 5
    discountPercent: 10
```

多章购买使用 `orderType: "chapter-bundle"`。Worker 不信任前端传入的金额，会按生成配置里的单章价格、折扣规则和已发布付费章节顺序重新计算 invoice 金额；IPN 达到 `confirmed` / `finished` 后，会为 bundle 内的每个章节写入 `novel_entitlements`。

## 验证建议

未配置 NOWPayments secret 时：

- `GET /api/novels/payments/status` 应返回 `publicCheckoutEnabled: false`
- `POST /api/novels/payments/checkout` 应返回 503

配置 secret 后：

- 打赏按钮应创建 `tip` 订单并跳转 NOWPayments
- 付费章节按钮应要求读者先登录
- 登录后应创建 `chapter`、`chapter-bundle` 或 `supporter` 订单并跳转 NOWPayments
- 支付完成后的 IPN 应把订单更新为 `confirmed` / `finished`，并写入对应阅读授权
