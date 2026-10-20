# Station Cat Music 隐私页审查说明

2026-10-20。为 iOS 公开作品平台版准备四语隐私说明，当前是**未发布、未生效的草稿**。页面不改变现有网站服务的数据处理方式。

## 页面范围

在现有 `/zh-hans/privacy/`、`/zh-hant/privacy/`、`/en/privacy/`、`/ja/privacy/` 中新增 `#station-cat-music-privacy` 区段和导航入口，保留原网站音乐隐私说明及其他产品链接；条款页不插入该区段。正文来自 `src/data/station-cat-music-privacy.json`，通过 Astro 转义渲染，不注入 HTML 或客户端脚本。

`effectiveDate` 仍为 `null`，四语页面均明确显示准备稿状态。审查通过后，需要在实际发布时设置生效日，再核对线上链接；合并本 PR 不等于发布政策或提交 Apple 隐私问卷。

## 文案依据与边界

- 运营者姓名、地区、公开支持邮箱及支持邮件保留规则由用户确认。私人审核联系电话、认证材料、原始 IP、坐标和访客日志不进入本 PR。
- 2026-10-20 只读核对当前 Workers Free 套餐：调用日志保留 3 天；音乐 D1 的 Time Travel 页面显示 7 天恢复窗口。这不是 Cloudflare 所有内部网络、安全和账户数据的统一期限。
- 服务端安全摘要超过 10 分钟后由后续请求分批清理；10 分钟是清理资格阈值，不是最长保留承诺。本机收藏、搜索和最近查看与请求日志分别说明。
- 支持邮件按用户要求在问题解决后保留一个月；Proton 政策另列最长 30 天加密备份。政策不把用户确认、服务商文档或设置核对描述成实际删除执行审计。
- IP 推断的地域和坐标不等于 App 请求设备 GPS，也不证明实际定位精度。商店分类在配套 iOS 草稿中单独审查。

四语正文随附 Cloudflare Workers Logs、D1 Time Travel、Cloudflare 和 Proton 隐私政策链接。

## 验证

`ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build` 本地通过，生成 185 页；postbuild 的站点基础、音乐告知及链接检查通过。此构建只用于预览，**不是生产部署包**。

对四语生成页面核对了独立锚点、每语 8 节全部正文、服务商链接，以及条款页没有新增 App 隐私区段；简体中文浏览器预览已检查。`git diff --check` 通过。没有修改 Worker、数据库、日志配置、支付或原生服务开关。
