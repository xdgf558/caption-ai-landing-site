# M3-01 播放器内核与独立预览

本包实现单一原生音频实例和前端状态视图。视觉采用已选定的曲目列表、右侧封面及固定底栏；窄屏保持选曲和播放操作可用。生产页面尚未引用该组件，正式音乐路由及导航由 M4 接入。

## 播放合同

- `MusicPlayer.astro` 只有一个 `HTMLAudioElement`，`preload="none"`，不设 autoplay 或初始 src。初始化、读取目录和只选中歌曲都不读取音频。
- `musicPlayerClient.js` 并行读取目录和 capabilities。免费曲直接使用 full；VIP 仅在资格明确有效时默认 full，否则使用可用的 preview。界面选择不能替代 `/audio` 的逐次资格核对。
- 点击播放时同步设置同源、带音频版本及 variant 的 `/audio` 地址，并在同一用户操作中调用 `play()`。不等待其他请求、歌词或统计。
- `musicPlayerCore.js` 使用 `sourceGeneration` 与每次播放的尝试编号隔离迟到 Promise。切源先停止并卸载旧资源。原生媒体事件还要核对当前资源及媒体属性，不能凭旧事件名称修改新歌曲状态。
- `playing` 由实际媒体事件确认。暂停使未完成的播放尝试失效；预期 `AbortError` 不显示为故障，浏览器拒绝播放提供再次点击提示，解码/网络失败提供普通重试提示。
- 时长、进度和可拖动区间由已加载媒体的原生属性驱动。内核上报 ended；挂载 M3-02 队列层后由其决定是否推进，见 [队列合同](M3_QUEUE.md)。
- 组件卸载会取消目录请求、移除监听并卸载音频；同一元素重复初始化复用同一控制器。bfcache 返回保留原实例。

`musicPlayerCatalog.js` 校验公开目录的版本、唯一曲目 ID、时长及试听边界。封面和音频地址按曲目 ID 和版本在客户端重新构造，不信任目录里提供的任意远端媒体地址。

## 本地预览

```sh
npm run preview:music:player
```

打开 `http://127.0.0.1:4198/`。预览采用独立 Astro 入口和输出目录 `.generated/music-player-preview`；仅监听 loopback，拒绝其他 Host 和写入方法，不代理真实 API，不读取凭据，不绑定 D1/R2。

三张生成封面及曲目目录位于 `scripts/fixtures/music-player`。音频由本地脚本生成 WAV，只用于原生播放、暂停、切源和拖动交互。它们不属于正式作品，不是 MP3 质量或权利验收材料。正式 `npm run build` 不包含该示例页面、示例封面或音频。

空目录和失败场景可分别启动：

```sh
MUSIC_PLAYER_PREVIEW_SCENARIO=empty npm run preview:music:player
MUSIC_PLAYER_PREVIEW_SCENARIO=catalog-error npm run preview:music:player
```

不要同时占用同一端口；必要时设置 `MUSIC_PLAYER_PREVIEW_PORT`。这些场景仅由启动环境指定，不进入产品界面。

## 验证入口与后续边界

`npm run test:music:player` 覆盖首次零媒体加载、用户手势内同步调用、原生事件确认、连续切源、暂停竞态、同源重复播放竞态、故障恢复、进度区间、试听版本、清理及目录策略校验。该命令纳入 `npm test`；CI 另构建独立预览，避免生产页面尚未引用组件时遗漏其编译检查。

本地浏览器截图、设计对照、运行输出及 session 材料保留在被忽略的 `.generated/`、`design-qa.md` 或仓库外，不作为源码、文档或 PR 附件发布。

M3-03 仍需处理资格到期、登出/换账号、回前台重查、主动切换 full/preview 以及错误后的 access 复核。M4 仍需完整目录/歌单、正式路由、四语文案和会员回跳；M6 仍需真实设备、实际 MP3、隔离预发和多实例验收。本组件不能作为生产开放依据。

无数据库迁移、Worker 配置、支付/VIP 账本或功能开关变更。回退本包仅移除组件和本地预览，不涉及云端数据恢复。
