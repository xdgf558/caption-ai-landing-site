# Novel Payments 5C

阶段 5C 把 NOWPayments IPN 和阅读权限发放接起来：当购买型订单进入 `confirmed` 或 `finished` 后，Worker 自动写入 `novel_entitlements`。

## 已实现

- `POST /api/novels/webhooks/nowpayments` 在更新订单状态后自动判断是否发放权限
- `chapter` 订单自动发放单章 `paid` 权限
- `supporter` 订单自动发放整本作品 `supporter` 权限
- `tip` 订单只更新打赏状态，不发放阅读权限
- 重复 IPN 使用 `ON CONFLICT` 幂等更新，不会重复创建权限
- 自动授权来源写为 `source = nowpayments`
- `source_ref` 记录本地 `order_token`，方便后台追踪

## 发放规则

只有满足全部条件才会发放：

1. IPN 签名通过
2. 找到本地订单
3. 本地订单状态被映射为 `confirmed` 或 `finished`
4. 订单类型不是 `tip`
5. 订单绑定了 `account_id`
6. `series_slug` 存在
7. 单章订单必须有 `chapter_slug`

不会发放的常见原因：

- `tip_order`
- `status_not_grantable`
- `missing_reader_account`
- `missing_series_slug`
- `missing_chapter_slug`
- `order_not_found`

## 仍未开放

- 受保护正文交付
- `refunded` 后自动回收权限
- 订单详情页
- 读者主动刷新订单状态

退款和回收需要更谨慎，建议留到后续运营阶段做人工复核或单独的自动回收策略。

## 验证重点

### 单章购买

1. 创建 `chapter` 订单
2. 模拟 NOWPayments `payment_status = finished`
3. webhook 返回 `entitlementGrant.granted = true`
4. `novel_entitlements` 出现：

```text
scope = chapter
access_level = paid
source = nowpayments
```

### 支持者权限

1. 创建 `supporter` 订单
2. 模拟 NOWPayments `payment_status = confirmed`
3. `novel_entitlements` 出现：

```text
scope = series
access_level = supporter
source = nowpayments
```

### 打赏

1. 创建 `tip` 订单
2. 模拟 `finished`
3. `novel_tips.status` 更新
4. 不创建 `novel_entitlements`
