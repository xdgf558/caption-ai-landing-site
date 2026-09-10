# M2-04 音频媒体协议

日期：2026-09-10。基线：main@9fc9e95。分支：`codex/music-media-protocol`。

## 已完成

- 接入版本化单曲音频入口：`GET/HEAD /api/music/tracks/{trackId}/audio?v={revisionNo}&variant=full|preview`。
- 公开总闸默认关闭；关闭时不读取 MUSIC_DB、WAITLIST_DB 或 R2。未修改任何部署配置或开关值。
- 每次请求读取当前已发布修订，并复用 `resolveMusicAccess`。试听只映射独立 preview；免费 full 不查会员；VIP full 在触及 R2 前重查现有全站 VIP。
- R2 只读取数据库映射出的规范对象键，并用已发布 ETag 做条件 GET。对象缺失、变更、MIME/大小/范围不符统一返回私有 503。
- 支持完整 200、单段 206、越界 416、HEAD、开放范围、后缀范围和 If-Range。多范围、反向范围和不安全整数按首版合同忽略，返回完整 200。
- 所有媒体与错误响应均为 `private, no-store`、`Vary: Cookie`；媒体不返回 304，不使用 Cache API，不整曲缓冲。

## 权限与错误边界

- 只有显式 `variant=full` 或 `variant=preview` 可进入；不存在默认 full，也不存在通用 `?key=` 桶读取。
- 未登录 VIP full 返回 401；无 VIP、已过期或受限账号返回 403；资格服务或 VIP 交付关闭返回 503。上述响应不含媒体 ETag、长度或范围信息，也不访问 R2。
- 版本不一致返回 409；下架/归档返回 410；独立试听不存在返回 404。授权后的有效越界范围才返回 `Content-Range: bytes */{total}`。
- `If-None-Match` 和 `If-Modified-Since` 不产生 304。If-Range 只有匹配强 ETag 或不早于当前发布时间的规范 HTTP 日期才保留 Range。

## 验证

- `npm run test:music:media`：10/10，通过协议、权限、泄漏、Range、If-Range、HEAD、存储变更及生产路由测试。
- `npm run test:music:runtime`：18/18，通过本地 Miniflare 的真实 D1 发布、R2 preview/full 分段字节、VIP 查询、HEAD 和 416。
- `npm run test:music:membership`：21/21；`npm run test:music:storage`：12/12。
- `npm test`：通过；`npm run build`：通过，146 页、111 条 sitemap 路由。

## 未包含

没有完成 M2-03 歌单，没有管理 UI、播放器、公开目录、封面/歌词媒体路由、清理/限流或统计；没有迁移、远程资源变更、正式音频、预发/生产部署或开闸。当前生产配置未提供音乐公开绑定和 true 开关，即使代码合入也不会开放播放。

下一阶段输入是这里固定的 URL、错误码、Range 与缓存合同。M3 播放器可依赖该合同；正式开闸前仍须完成歌单所需产品范围、M2-05、公开目录和真实预发/生产验收。
