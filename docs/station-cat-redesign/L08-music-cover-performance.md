# L08 音乐页封面加载修复

用户在正式 `/music/` 进入和刷新时，封面比文字晚约 2 秒出现。本批从 `origin/main` 的 `64e0f113` 单独开发，不包含待审 PR #214 的后台改版。

匿名 HTTP 与页面 DOM 核对发现，96×96 的卡片实际加载 1254×1254 PNG；11 首封面合计 22,722,019 字节。原资源端点使用 `no-store`，携带当前 ETag 重试仍返回完整 200。前三张仅正文下载耗时约 1.9–2.4 秒；这属于本机 HTTP 抽测，包含测试网络因素，不是用户 Chrome 的性能追踪或 LCP。

## 最终行为

音乐目录、搜索和推荐卡片通过原受控资源地址的 `?size=card` 请求 192 像素 WebP，详情主封面使用 `?size=display` 的至多 768 像素压缩图。公开 DTO 的原始 `coverUrl`、原图/Range、音频和平台链接合同保留。首次列表前 6 张 eager、首张 high，其余 lazy；图片采用 async 解码。目录投影最多 3 项并行，保持来源顺序、过滤规则和来源游标，不建立共享授权缓存。

复用既有 `musicDisplayCover` 的构建期资源和私有重新验证机制。每个图片请求先核对实际 schema、当前网站公开引用、归属、素材权利和 R2 HEAD，再由条件 R2 GET 验证原对象身份；只有此时才允许 `private, max-age=0, must-revalidate` 和 304。撤销、下架、开关关闭、原对象变化或不明结果不返回缓存授权。与现有合同一样，D1 与 R2 核对不是跨系统原子事务。

保留 `/api/music/__cover-files/` 的 Worker 拦截，不直接公开构建目录。新尺寸仅允许 cover；其他查询、重复参数、音频/试听泛型资源请求仍被拒绝。没有生成图、静态对象缺失或失效时，原封面回退保持 `no-store`。后续公开的新封面需再次运行公开封面生成器并发布对应包；请求路径不进行图像编码，也不新增 R2 对象或迁移。

生成器按来源游标遍历网站 `/api/station/content/tracks`，读取当前网站发布版本实际公开的 `coverUrl`，再补入旧 `/api/music/catalog` 的歌曲和合集封面。网站独立发布、仅更换网站封面均纳入；旧音乐的 lifecycle 和封存版本不决定网站封面的生成范围。空的过滤结果页仍按游标继续；循环游标、非法来源、请求失败或超出读取预算会报错，所有来源和图片读取成功前不替换现有 manifest。两个系统相同内容按原图 SHA-256 去重编码。

768 像素 display 和 192 像素 card 分别与原图比较体积，仅登记各自有收益的文件。manifest 允许只有 card：目录返回卡片图并可重新验证，详情仍由现有处理器回退原图及 `no-store`。这次修订不改变资源处理器的发布、权利或对象身份校验。

## 体积与验证

首次生成使用 13 个旧版来源：11 首歌曲与 2 个既有专辑封面。2026-10-12 修订后重新匿名生成，读取 11 个当前网站来源和 13 个旧版来源，24 个地址按原图指纹去重后仍为 13 组、26 个派生文件，文件字节与首次产物一致。根据匿名 SSR 的歌曲 ID、受控封面地址与生成器来源一一对应，11 首的卡片图合计 **79,554 字节**，减少 **99.65%**；详情展示图合计 1,006,900 字节。此比较是图片正文体积，不包含 HTML、脚本、请求头，也不是相同百分比的页面耗时承诺。

- 修订后 **92 项相关源码回归、21 项 staging 测试**通过。原 86 项覆盖缓存撤销/下架/开关、HEAD/Range、两次存储校验间替换、缺图回退、参数边界、并发上限、源码文件指纹及实际 Worker/D1/R2；相关公开查询、音乐页和旧音乐接口共同重跑。
- 新增 6 项生成回归通过，并加入托管 CI 的 `test:redesign:public`：网站独立发布且旧生命周期仍为 draft；仅替换网站封面且旧歌曲/合集继续生成；display 无收益但 card 有收益；空过滤页继续分页；循环游标拒绝覆盖旧 manifest；非法外部来源在下载前拒绝。前三项用 SQLite 真实迁移夹具、原 HTTP 处理器、原生成函数及写到临时目录的真实图片文件联测，ASSETS 读取实际产物，再核对 card 的 200/304、内容指纹和尺寸。压缩分支夹具为合法 1440×1440 JPEG：原图 77,512 字节、display 109,997 字节、card 9,488 字节；生成后仅 card 登记，详情原图回退已核对。这些是本机夹具结果，不是生产素材或网络时延。
- `npm run build:station:first-launch` 无空正文选项通过；59 个 HTML、424 个文件，既有价格/正文兼容清单保持一致。另用独立的 `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build` 准备既有历史回退测试需要的开发 `dist`，不将它当生产包。初次运行时测试缺失 `dist`，随后错误使用首发允许清单产物导致两个旧地址夹具失败；补齐独立开发包后，86 项全部重跑通过。
- 本次修订重新完成首发候选构建（59 个 HTML、424 个文件）及 `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build:music:staging-assets`（完整开发构建、8 个隔离页、37 个精确资源检查）。构建和资源检查均未执行部署。
- 隔离浏览器确认卡片实际解码为 192×192、主封面为 768×768；首次 19 张卡片为 200，普通刷新同 19 个资源为 304。夹具画面不含真实管理员、订单、会员或存档；合成歌曲与试听均非生产配置。
- 托管 CI 需按 PR 的精确头另行核对。本批没有执行部署、后台内容写入、迁移或旧入口重新开放；线上性能、真机和既有首发 LCP 未在本批验收。

证据在 [L08-evidence](./L08-evidence/)：匿名基线 `baseline-http.json`、公开来源 `public-cover-generation.json`、11 首体积 `cover-byte-comparison.json`、86 项 `regression.log`、两种构建日志、隔离 HTTP 记录和浏览器截图。生产私有发布快照不参与本批核对或 PR。

本次审查修订的完整重跑证据另存为 `review-regression.log`、`review-staging-tests.log`、`review-first-launch-build.log`、`review-staging-build.log` 和 `review-public-cover-generation.json`，保留首次证据供对照。

实现参考：[Cloudflare ASSETS binding](https://developers.cloudflare.com/workers/static-assets/binding/) 与 [HTTP 304](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/304)。保留完整播放的原权限校验和 `private, no-store`。
