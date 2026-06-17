# Novel Protected Content 6B

阶段 6B 把“权限判断”推进到“已授权读者真正看到付费正文”。

## 目标

- 未授权读者只看到章节门禁、登录、充值和购买入口
- 已授权读者打开受保护章节后，页面自动加载正文
- 付费正文不写入公开静态 HTML
- 正文接口必须走读者 session 和 `novel_entitlements` 检查

## 构建产物

构建脚本现在会同时生成：

- `src/generated/novelPaymentConfig.js`
- `src/generated/protectedSerialContent.js`

`protectedSerialContent` 只包含：

- `status: published`
- `access: paid` 或 `access: supporter`

免费章节仍由 Astro 静态页面直接渲染。

## API

```text
GET /api/novels/chapters/protected-content?series={seriesSlug}&chapter={chapterSlug}
```

返回条件：

1. 对应章节存在于 `protectedSerialContent`
2. 读者已登录
3. D1 中存在有效 `novel_entitlements`
4. `paid` 章要求 `paid` 或 `all` 权限
5. `supporter` 章要求 `supporter` 或 `all` 权限

响应头会带：

```text
Cache-Control: no-store
X-Robots-Tag: noindex
```

## 前端行为

受保护章节页面初始只渲染门禁，不输出正文。

页面加载后：

1. 调用 `/api/novels/access`
2. 如果 `allowed: false`，继续显示门禁
3. 如果 `allowed: true`，调用正文 API
4. 正文 API 成功后，把 HTML 插入隐藏的正文容器
5. 隐藏门禁，展示章节正文

阅读点数扣点成功后，也会立即调用正文 API。

## 阶段边界

6B 已覆盖：

- 受保护正文构建
- Worker 授权正文 API
- 章节页授权后正文加载
- 扣点解锁后即时阅读

后续阶段：

- 6C：生产环境真实小额支付回归
- 6D：订单 / 收入后台管理
- 6E：购买后体验
- 6F：免费章、会员、整本、分卷、多章价格规则细化
