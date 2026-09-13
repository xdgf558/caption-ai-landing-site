# M6 隔离预发表面与维护部署

本切片把 M5 完成后的音乐页面接到既有隔离预发 Worker，作为 M6 回归的受控入口。它不部署正式站、不加入首页导航、不发布正式作品，也不授权打开公开读取、VIP、上传、统计或清理。

## 维护状态

迁移或更换预发 Worker 前先运行 `npm run build:music:staging-maintenance-config`。它从受版本管理的预发配置生成忽略文件 `.generated/music-staging-maintenance.jsonc`，并强制以下五个开关全部为 `false`：

- `MUSIC_PUBLIC_ENABLED`
- `MUSIC_UPLOADS_ENABLED`
- `MUSIC_VIP_DELIVERY_ENABLED`
- `MUSIC_ANALYTICS_ENABLED`
- `MUSIC_CLEANUP_ENABLED`

维护部署只能使用这个生成配置。受版本管理的 `ops/music-staging-app.jsonc` 保留后续受控 HTTP 验收所需的 public/VIP 值；不能在迁移窗口直接拿它部署。

M6-04 增加源配置隔离守卫：维护生成器和运维 helper 均检查账号、入口、Access、两库、桶、静态/迁移路径及五旗，拒绝额外执行配置和明文 secret。该检查不验证远端状态；完整维护、恢复与预算步骤见 [MUSIC_OPERATIONS_READY](../../ops/MUSIC_OPERATIONS_READY.md)。

生成器会按配置文件的新位置重新计算入口、静态目录与两个 D1 迁移目录的相对路径，确保仍指向原文件。身份库迁移目录仍在 `ops/migrations-music-staging-identities/`，不复制或改写迁移 SQL。

## 精确页面与静态资源

`npm run build:music:staging-assets` 先执行完整站点构建，再只复制下列八个页面及其递归静态依赖：

- `/admin/music/`
- `/admin/music/collections/`
- `/admin/music/collections/upload/`
- `/admin/music/featured/`
- `/music/`
- `/en/music/`
- `/ja/music/`
- `/zh-hans/music/`

无尾斜杠形式只对这些精确页面做 308 规范化。部署包检查器要求每个依赖既存在于裁剪目录，也通过 Worker 的静态白名单；文章后台、会员页、小说页及其他站点 chunk 不进入预发包。默认繁体入口沿用 `/music/`，不另建 `/zh-hant/music/`。

检查器只接受上述八个 HTML 文件，并扫描 HTML 中的静态引用及 JS/CSS 依赖；缺少页面脚本或样式、混入额外 HTML 或不在白名单内的 chunk 都会失败。页面导航链接不作为静态依赖打包。

Cloudflare Access 仍在页面、静态资源和 API 之前。Worker 继续复核 Access JWT 与管理员邮箱；公开接口复用正常限流，完整 VIP 音频每次重查隔离身份库。生产读者 Cookie 会被丢弃，只有 `station_cat_music_staging_session` 可被翻译到隔离读取器。

## 数据库顺序与恢复边界

对隔离 `MUSIC_DB` 应按 Wrangler 迁移表的顺序应用未落地迁移。每次迁移前先导出数据库到仓库外的私有目录，并在本地 SQLite 中导入后运行完整性和外键核对。已成功落地的迁移文件不得改写，也不得手工补迁移回执。

回退 Worker 不会回退 D1 schema。若新版本异常，先保持五个开关关闭，再修复或部署仍理解当前 schema 的版本；不得用旧 Worker 绕过限流、VIP 或专辑投影。清理开关关闭只停止新清理，不能恢复已经删除的对象。

## 验收边界

代码验收包括精确路由、跨域/遍历拒绝、Access 先于绑定、Cookie 隔离、静态依赖闭包、原生 D1/R2 运行时和全站回归。部署后还要分别检查匿名 Access 拦截和已登录页面/API；开关关闭时，页面可以加载，目录与媒体业务必须失败关闭。

数据库导出、命令输出、请求响应、计数、截图、Access token、Cookie、session 和经过脱敏的执行报告都只保存在仓库外，不提交到分支或 PR。仓库只记录可复现的合同、脚本和未验证边界。
