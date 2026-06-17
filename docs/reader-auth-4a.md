# Reader Auth 4A

阶段 4A 只建立读者账户和登录会话，不发放付费阅读权限。

## 已实现

- `POST /api/readers/magic-link`
- `GET /api/readers/verify?token=...`
- `GET /api/readers/session`
- `POST /api/readers/logout`
- `/library/` 读者书库入口
- D1 表：
  - `reader_accounts`
  - `reader_login_tokens`
  - `reader_sessions`

## 本地调试

本地请求 `/api/readers/magic-link` 时，如果访问来源是 `localhost`、`127.0.0.1` 或 `::1`，接口会在 JSON 里返回 `debugLoginUrl`。

这让本地可以不接真实邮件服务就完成登录流程验证。

如果使用 Wrangler dev 且项目配置了 custom domain route，可以在 `.dev.vars` 里设置：

```text
READER_AUTH_DEBUG_LINKS=1
READER_AUTH_DEBUG_ORIGIN=http://localhost:8787
```

## 生产邮件

生产环境不会返回 `debugLoginUrl`。

如果没有配置 Cloudflare Email Sending binding，`POST /api/readers/magic-link` 会返回：

```json
{
  "ok": false,
  "message": "Reader login email delivery is not configured yet."
}
```

等 Cloudflare Email Sending 可用后，再在 Worker 环境里配置 `EMAIL` binding，并设置发送地址：

```toml
[[send_email]]
name = "EMAIL"
```

可选环境变量：

```text
READER_EMAIL_FROM=noreply@wwwstationcat.org
READER_EMAIL_FROM_NAME=Station Cat
```

## 下一阶段

4B 再实现：

- `novel_entitlements`
- 管理员手动授权
- `/library/` 已解锁内容列表
- 章节页付费 / 支持者内容权限判断
