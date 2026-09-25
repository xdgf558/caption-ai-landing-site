# R3 永久免费离线许可与封面缓存

本批配合原生 iOS 0.1.0 (2)，仅连接专用 HTTPS 隔离 Worker。生产原生开关、网站部署、支付和订阅均不变。

## 接口和边界

`MOBILE_FREE_OFFLINE_ENABLED=true` 仅加入 `wrangler.mobile-r2.jsonc`，仍要求既有 isolated/native/music 开关。目录新增显式 `offlineEligible`；不能由显示状态 free 推导离线资格。

`POST /api/mobile/v1/music/tracks/{id}/offline-permit` 接受精确 audioVersion，校验已发布版本，仅允许永久免费完整版；VIP、限时免费、试听和提前访问均不允许。回执含曲目版本、策略版本、音频 SHA-256、字节数、时长及七天到期时间，不包含音频 URL。下载仍需正常播放授权及逐 Range 校验。客户端完成下载后校验散列并再次核对许可；断网期间已有许可是有期限的本机使用权，不是 DRM 或立即远程撤销。

隔离封面路由先运行原有发布、版本、对象检查，仅允许成功、小于等于 2 MiB、带版本、没有 Cookie/Vary 的图片使用五分钟客户端缓存。CDN 保持 no-store，失败不缓存。

## 验证与已部署状态

- `test:mobile:music` 18/18，真实临时 Miniflare D1/R2 覆盖永久免费许可、付费及限时拒绝、版本冲突和撤回。
- `test:mobile:r2` 12/12，覆盖封面缓存、错误版本、撤回与对象变化。
- 153 页 Astro 构建通过，使用 `ALLOW_EMPTY_SERIAL_CONTENT=1`，仅为本地验证，不可当作生产包。
- 专用隔离 Worker 已部署版本 `114ef63a-cc1a-4c78-af0f-9fade8983d74`；公开封面和真实曲目离线许可的 HTTPS 检查通过。此次开 PR 不额外部署。
- iOS 真实歌曲缓存重开后，以拒绝所有音频授权/媒体网络调用的传输层验证播放与续播；模拟器及 iPhone Air 均通过。无线电断网/飞行模式需单独人工验收。

真实曲目及导入材料留在忽略目录，不提交 MP3、生产备份、账号或密钥。完整销户、生产接入和 App Store 发布仍需后续验收。审查后应先合并本仓配套 PR，再合并 iOS PR。

## PR #181 复审修正（2026-09-25）

成功图片改为 `private, max-age=300`，保留两枚 CDN `no-store`，明确只允许设备本机缓存。iOS 同步允许不带 Cookie/Vary 的匿名图片使用此 private 策略。

`--real-album` 现在逐首检查 `offlineEligible=true`、免费许可 200、许可精确字段、策略版本/时长/大小/七天期限以及原始音频 SHA-256；合成 VIP 必须 offlineEligible=false 且离线许可 403。所有真实封面必须 private 且两枚 CDN no-store。限时免费拒绝继续由真实临时 D1/R2 用例验证，不改远端歌曲策略来做负例。

回执单测锁定字段集合、policyVersion、durationSeconds 及无 playbackUrl。音乐 18/18、隔离入口/封面 12/12 通过；脚本语法和默认无网络模式通过。此轮未部署，因此新增 HTTPS 缓存头断言尚未在修正版远端 Worker 运行；上文部署记录属于上一版本，不能替代新验证。153 页本地空小说构建仍只作检查。
