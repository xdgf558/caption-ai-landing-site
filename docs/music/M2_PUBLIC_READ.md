# M2-01: 公开读取合同

状态：本地实现与测试完成，未部署、未开闸。

## 路由

- `GET/HEAD /api/music/catalog?locale={locale}`：最多 500 首已发布曲目及有效歌单的匿名投影。
- `GET/HEAD /api/music/tracks/{trackId}?locale={locale}`：已发布曲目详情和公开故事。
- `GET/HEAD /api/music/collections/{slug}?locale={locale}`：单个已发布歌单及其精确曲序。
- `GET/HEAD /api/music/tracks/{trackId}/cover?v={revisionNo}` 和 `/lyrics`：仅读当前已发布修订引用的规范私有对象。
- `GET/HEAD /api/music/me/capabilities?locale={locale}` 和 `/tracks/{trackId}/access?v={revisionNo}`：复用实时会员资格的私有 UI 辅助响应，不返回媒体字节，也不作为播放令牌。

`POST /api/music/events` 属于 M4-05 统计与隐私范围，本批不实现。

## 数据与缓存边界

公开 JSON 只从字段白名单组装，不展开 D1 行、私有对象 key、hash、审核材料、当前账号或 VIP 到期日。目录不包含故事全文；曲目详情才返回已审核的公开 `story`。

目录、详情和歌单使用 `public, max-age=0, must-revalidate` 与强 ETag。ETag 来自完整公开响应，因此语言、版本和 `early_access` 自然到期后的实际权限都会改变校验值。资格响应继续使用 `private, no-store` 和 `Vary: Cookie`。封面、歌词和音频都不进入公共缓存。

曲目下架、版本不匹配或存储映射异常时，在读 R2 前失败。封面和歌词对 R2 执行存储 ETag 条件 GET，直接流式返回 body，不提供通用 `?key=` 入口。歌单只引用仍然公开的曲目，加入歌单不改变单曲的 free/VIP 策略；公开投影为空或数据损坏的歌单静默隐藏。

## 验证与排除

`test:music:public` 覆盖路由和输入、总闸、四语回退、ETag/304/HEAD、自然到期、详情、歌单顺序与 500 条目录窗口、封面/歌词字节、下架/版本冲突、通用错误以及资格不读 R2。Miniflare runtime 使用原生 D1/R2 路径覆盖公开目录、曲目、歌单和真实发布后的封面/歌词字节。

本批没有 UI、播放器、新迁移、配额、云端读写、部署、导航或开闸。M2-05 的清理、全局限流和诊断仍是上线阻断项；浏览器播放体验从 M3 开始。
