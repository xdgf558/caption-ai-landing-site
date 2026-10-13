# 工作台第二方案证据

本批只调整 `/admin-v2/?view=dashboard` 的前端工作台，使用既有身份读取与管理入口。未部署、未修改生产数据或开关。

`selected-option-2.png` 是用户选定的第二张设计图。桌面、平板、手机、键盘焦点、连接失败及恢复截图记录本机合成预览；详细比较与限制见仓库根目录 `design-qa.md`。`prior-design-qa.md` 保留上一批服务后台报告。

本机预览准备命令：

```sh
npm run build:station:first-launch
node scripts/serve-station-admin-preview.mjs --services
```

本次使用 `http://127.0.0.1:4236/admin-v2/?view=dashboard`。发行平台、首页配置、上传和视频入口均已通过真实浏览器点击检查，未提交业务操作。预览服务器只提供后台合成页面，不提供网站首页和公开音乐页。

最终代码验证日志：

| 日志 | 命令与结果 |
| --- | --- |
| `logs/content-admin.log` | `npm run test:redesign:content-admin`，112 项通过 |
| `logs/staging-tests.log` | `npm run test:music:staging`，22 项通过 |
| `logs/build-first-launch.log` | `npm run build:station:first-launch`，通过 |
| `logs/staging-build.log` | `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build:music:staging-assets`，8 页面、40 精确资源通过 |

空正文构建、视口模拟和本机合成数据不能替代生产构建、真实身份、真机或 VoiceOver 验收。完整托管 CI 需按 PR 提交单独核对。
