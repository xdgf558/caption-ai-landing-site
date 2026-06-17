# Novel Reader Credits 6A

阶段 6A 把单章小额付费改成“充值阅读点数，再按章扣点”的账户余额模式。

## 为什么改成余额模式

NOWPayments 适合作为入金主通道，但真实加密支付会受到最低支付金额、链上成本和确认时间影响。单章如果直接收 0.1 USD，支付体验和到账稳定性都不理想。

6A 的做法是：

1. 读者先用 NOWPayments 购买阅读点数包
2. IPN 确认后，Worker 把点数写入 D1 账户余额
3. 读者解锁付费章时，从余额扣点
4. 扣点成功后，写入现有 `novel_entitlements`

这样读者只需要偶尔充值，之后每章可以做成 0.1 USD 级别的站内消费。

## 数据表

新增迁移：

- `migrations/0006_reader_credits.sql`

新增 D1 表：

- `reader_credit_accounts`
  - `account_id`
  - `balance_credits`
  - `lifetime_purchased_credits`
  - `lifetime_spent_credits`
  - `currency_label`

- `reader_credit_ledger`
  - `entry_type`: `topup` / `spend` / 后续可扩展 `refund`、`adjustment`
  - `credits_delta`
  - `balance_after`
  - `source`
  - `source_ref`
  - `series_slug`
  - `chapter_slug`
  - `metadata_json`

## 默认规则

默认充值包：

- `10 SC Credits` / `1.00 USD`
- `60 SC Credits` / `5.00 USD`
- `130 SC Credits` / `10.00 USD`

默认扣点：

- 付费章节：`1 SC Credit`

可通过 Worker 环境变量调整：

```text
NOVEL_CREDIT_PACKS=10:1,60:5,130:10
NOVEL_CHAPTER_CREDIT_COST=1
NOVEL_CREDIT_UNIT_LABEL=SC Credits
```

## API

### 查询余额

```text
GET /api/readers/credits
```

未登录时返回可用充值包；已登录时同时返回账户余额和最近流水。

### 点数充值

复用既有 checkout：

```text
POST /api/novels/payments/checkout
```

请求：

```json
{
  "orderType": "credit-pack",
  "credits": 10,
  "returnPath": "/library/"
}
```

IPN 进入：

```text
POST /api/novels/webhooks/nowpayments
```

当订单状态进入 `confirmed` 或 `finished` 后，Worker 根据订单 metadata 入账。重复 IPN 会先检查同一 `source_ref` 的充值流水，避免重复加点。

### 扣点解锁章节

```text
POST /api/novels/credits/unlock
```

请求：

```json
{
  "seriesSlug": "deng-hai-liang-zhe",
  "chapterSlug": "paid-chapter",
  "access": "paid"
}
```

成功后：

- `reader_credit_accounts.balance_credits` 减少
- `reader_credit_ledger` 写入 `spend`
- `novel_entitlements` 写入 `source = reader-credits`

## 阶段边界

6A 已覆盖：

- 账户余额
- 充值包 checkout
- NOWPayments IPN 入账
- 扣点解锁 API
- `/library/` 充值 UI
- 章节门禁的“用阅读点解锁”

后续阶段：

- 6B：付费章节正文真正解锁显示
- 6C：生产环境真实小额支付回归
- 6D：订单 / 收入后台管理
- 6E：购买后体验，包括成功返回页、处理中提示、继续阅读
- 6F：规则细化，包括免费前几章、会员 / 整本 / 分卷、多章价格提示
