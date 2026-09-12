# M4-06 歌曲分享卡片

用户追加的独立切片，采用确认的第 3 套“留白明信片”：1200×630 横版链接卡、1080×1800 竖版海报。基于 M4-05/#146；先审查并合并 #146，再将本 PR 改打 main。实现、测试与公开合同进入 PR；设计图、本地执行记录、截图及 session 材料不发布。

## 页面与分享

四语歌曲详情的“分享歌曲”打开卡片面板；歌单继续使用 M4-04 的链接分享。卡片只使用当次公开曲目标题、创作者、封面与免费/VIP/试听政策，VIP 标签不是当前访问者的资格证明。竖版二维码编码本站四语歌曲页面及一个 track UUID，没有音频地址、会员字段、Cookie、token 或跟踪参数。横版卡片用于 Open Graph 和 Twitter large-image 元数据。

面板在用户打开后重新读取曲目详情，再按最新 audioVersion 请求 PNG；请求固定同源、credentials=same-origin、redirect=error，以便浏览器通过前置 Cloudflare Access，会话凭据不传到其他源，图片处理器不查询读者身份或会员库。首次目录加载不生成图、不加载音频。提供横竖切换、保存图片、支持时的系统文件分享、复制链接和 X intent。系统分享使用已准备的文件，在点击手势中同步调用；取消不报失败，不支持时仍可保存。X 入口只打开带歌曲标题和规范 URL 的编辑页，不代发帖子。微信提供保存/长按图片后手动发送的路径，没有接入微信 SDK，不保证链接在微信中自动呈现特定卡片样式。

关闭、切换目标和销毁会取消未完成读取、撤销 blob URL；迟到结果不能覆盖新目标。浏览器 Back 先回原详情，Forward 仅恢复面板标记并重新制作图片；history 中无图像或媒体 URL。面板不接受 audio/queue/account/storage API，分享过程不播放、不换歌、不写本机偏好或统计。

## 公开读与开关

新增 GET/HEAD `/api/music/tracks/:id/share.png?locale=zh-Hans&v=1&format=poster`；format 只允许 card/poster，三个 query 必须各出现一次，UUID/版本/语言严格校验，不接收外部图片 URL、key、尺寸、文案或客户端 VIP 状态。

处理顺序是输入检查 → MUSIC_PUBLIC_ENABLED → MUSIC_SHARE_CARDS_ENABLED → 原子限流 → 当前发布投影 → 封面/字体 → 渲染。两个开关都必须为字符串 true；新增卡片旗缺省关闭，关闭时不碰 D1/R2/ASSETS/渲染器。HEAD 同样计次和检查当前发布，但不读取封面/字体或渲染。缺 secret、坏来源头、计数故障保持 503，不放行；超限 429 带 Retry-After。

卡片复用 M2-05B artwork 的原子来源/全局分钟计数，将本次请求上限收紧到 source 6 / global 120（已有配置更低则用更低值）。它不是独立预算：普通封面请求也会占同一窗口，可能让卡片提前限流；卡片也占用该窗口。来源只信 CF-Connecting-IP；计数与 HMAC/保留期语义保持原合同。阈值为待预发验证的保守值，不是成本或可用性保证。

每次图像请求重新查询 primary 上的发布投影。已下架/归档 410，不可公开或不存在 404，修订不符 409；不渲染旧目录副本。双旗开启的 track 页面同样先通过 catalog 限流读取当前公开详情，再用 HTMLRewriter 替换一组 title/canonical/description/OG/Twitter 标签；不能读取时返回对应错误而非旧歌曲卡片。去掉静态 ETag/Last-Modified/Content-Length，忽略 ASSETS 条件和 Range 头。卡片旗关闭时页面维持原通用元数据。音频继续逐次走 /audio 和既有资格守卫。

所有动态页面/图片返回 private, no-store，图片另有 nosniff/no-referrer/noindex。本站后续请求会重新检查发布状态；用户已保存的文件、转发的图片及外部社交平台自己的缓存无法撤回。公开素材用于外部分发的权利确认仍属开闸前清单。

## 渲染与资源边界

从当前修订的封面资产读私有 R2，先验对象身份/etag/size，再核实际字节 SHA-256；只解码经过结构验证的 PNG/JPEG/WebP，最多 5 MiB、4,194,304 像素。Photon 将封面缩到最长边 840 后转 PNG，再交现有 resvg 排版；不会把任意 URL/SVG 交给解码器。缺封面时只展示站名，不伪造封面。导出 PNG 最多 4 MiB，读取有 5 秒期限、精确字节上限和 read 次数预算；客户端详情 64 KiB、图片 4 MiB、12 秒期限。客户端同时校验 PNG 类型/签名/尺寸，并在浏览器解码失败时撤销图像。

字体为官方 Noto Serif SC Bold 的原始 OFL 文件，12,094,336 字节，由固定 ASSETS 路径按长度与 SHA-256 校验；来源与许可证见 `public/fonts/music/`。不从远端字体服务取字，不将字体装入普通页面。覆盖本包四语文案，未承诺所有 Unicode/emoji；超长标题/作者有界换行与省略。二维码由现有 qrcode-generator 生成真实矩阵，保留四模块留白。WASM 对象显式释放，没有 R2 写入、图片永久缓存、新迁移或定时生成。

卡片渲染器仅在通过开关、限流和发布检查后加载。每次字体读入与栅格处理仍有 CPU/内存成本；本机 workerd 并发回归不能代替实际套餐、打包尺寸、跨实例和真实 R2 压测。预发开放前必须测量完整 Worker 的上传大小、启动/渲染资源占用与失败行为；若不满足限制，应保持卡片旗关闭并调整实现。

## 回归与后续验收

`npm run test:music:share-cards` 覆盖零读取门禁、当前发布/版本、限流/存储失败、资源预算、真实 PNG 和二维码解码、迟到请求/取消、文件分享手势以及真实 workerd/D1/R2/ASSETS/HTMLRewriter。面板历史回归纳入 `test:music:panels`；专项已加入 npm test。主站和独立播放器预览均需构建通过。

本机预览可在完成 `npm run build` 后运行：

```sh
MUSIC_LIBRARY_PREVIEW=true MUSIC_SHARE_CARDS_PREVIEW=true MUSIC_PLAYER_PREVIEW_SCENARIO=sharing-return MUSIC_PLAYER_PREVIEW_PORT=4221 node scripts/serve-music-player-preview.mjs
```

预览仅 127.0.0.1，合成音频和公开夹具；其二维码是本机 URL，不可充作手机或社交平台上线验收。预览的状态夹具、输出及日志不入库。

本包不部署、不修改 ops/wrangler/白名单/原业务开关、不远程迁移或改支付/VIP。隔离预发当前已有的公开读状态以原配置为准，不能笼统声称“五旗全关”。新卡片旗、预发字体资源/路径、可信入口头、权利与成本验收必须独立安排。关闭卡片旗只停新图片及逐曲元数据，不撤回已分发图片。X 抓取、微信保存/长按、iPhone 系统分享与真实设备均留 M6；Access 仍在前，不能为爬虫绕过它。下一功能阶段仍是 M5 后台，包含已确认的 WAV→MP3 和专辑上传计划。
