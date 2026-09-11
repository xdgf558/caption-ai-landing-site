# M3-03 资格生命周期与卸源

`musicAccessLifecycle.js` 接入既有 capabilities、catalog 和 access 读取合同，不增加会员账本或媒体授权接口。首次目录与资格并行独立完成；资格读取慢或失败不阻塞免费曲。M3-01 的单一 audio、首次无媒体请求、点击内同步 play 与 M3-02 有界队列继续成立。

## 到期与账号变化

校验 capabilities 的类型、服务端 UTC 时间、截止时间与授权组合。用 `validUntil - serverNow - 请求耗时` 安排一次性复核；计时以单调时钟计算，长周期拆成不超过浏览器上限的定时段。到期时立即废弃旧资格、卸载已知受保护 full，再重读资格与目录。即使定时器尚未运行，同步播放守卫也拒绝过期的 VIP hint。浏览器时间或通知均不能授权音频。

页面回到前台、获得焦点或从 bfcache 恢复时重新读取；重叠前台事件合并为同一轮。受保护 full 在复核开始时先卸源，成功后保持暂停，等待主动继续。隐藏页面本身不暂停普通播放。免费曲和正在播的独立试听不因账号通知或资格复核被强制停止。

会员中心的登录、注册、密码重置、改密和登出请求由 `withReaderSessionChange()` 包裹。请求开始前发出 changing，响应或网络失败后发出 changed；通知失败不改变原请求、响应或付款逻辑。已有登录成功跳转也触发失效通知。通知只包含 version、phase、随机 nonce，通过同页事件、BroadcastChannel 和短暂 storage 事件传递；不携带用户 ID、Cookie、VIP 状态或密钥，不从存储读取历史资格。重复消息去重，所有消息只能废弃旧状态并触发服务端重查。

收到 changing 时立即废弃旧资格、取消旧请求并卸载受保护 full；changed 后重查。旧响应不能覆盖新账号状态。若发送页关闭导致 changed 丢失，可在音乐页手动重查或回前台恢复。没有可用跨标签通道时依赖这些触发点和服务端新请求检查，不能宣称任意设备都在到期瞬间清空缓存。

## 切源和位置

卸源使用 pause、移除 src、load 和递增 sourceGeneration，保留曲目选择并进入 access_required / access_unavailable 等状态。到期/撤销记录只含曲目 ID、音频版本、full 标识和位置，限当前页面内存；不持久化资格、身份或付款提示。未收到账号变更通知、版本和 variant 未变时，重新核验后主动继续播放可在 metadata/seekable 就绪后恢复到合法位置。明确的账号切换清掉旧恢复位置；客户端不新增账号标识或自行推断账号相同。

试听中确认 VIP 不自动升级音频；用户点击“从头播放完整版”才同步切到 full 并从零开始。点击“播放试听”也从独立片段开头开始，不能把 full 的位置直接当试听偏移。音频或策略版本变动卸载旧源、更新选择并保持不播放。新目录确认 early_access 已成为 free 后按免费规则判断，先前为核验卸载的资源仍须用户继续。

## 媒体错误只复核一次

队列遇到实际 error 时暂缓自动跳过，由生命周期层对当前 ID/音频版本调用一次 `/access?v=...`。不 fetch /audio 探测，不重试 access，不读取错误媒体正文。8 秒超时或请求失败停止当前 full。响应要同时匹配当前请求实例、账号复核轮次、sourceGeneration 和 error 状态；即使同一首重试没有更换 sourceGeneration，旧请求也不能影响新尝试。迟到结果不能恢复暂停、卸载后来选择的曲目或自动启动新曲。

- 401/403 且为已知资格错误：卸载并显示登录、会员或账号受限说明；不自动切试听。
- 503、未知响应或无效正文：显示服务暂不可用，不诱导付款。
- 404/409/410：显示内容更新/不可用，排除当前版本的后续队列遍历，等目录刷新后再判断。
- 200 且完整访问有效：保留普通解码/网络错误，由 M3-02 有界恢复继续处理；第三次连续失败停，不请求第四首。

access 接口描述 full 权限，不能用它对匿名试听返回的 401/403 推断“试听需要付费”。试听媒体失败维持普通错误且不自动切歌。每次真实 /audio 请求仍由服务端重新鉴权；这个 UI 辅助查询不能替代服务端检查。

## 验证与本地场景

`npm run test:music:access-lifecycle` 纳入 `npm test`，覆盖时间边界、账号通知、失效竞态、full/preview、内容变更、错误分类、有界恢复和销毁。原播放器/队列回归继续运行；完整主站与独立播放器预览分别构建。正式音乐页面/导航、M3-04 系统控制和 M4 持久化记录不在本包。

隔离预览支持 `MUSIC_PLAYER_PREVIEW_SCENARIO=access-lifecycle node scripts/serve-music-player-preview.mjs`。先构建预览，并在本地忽略目录写入 `.generated/music-player-access-state.json`，例如 `{"membership":"vip"}`；membership 可为 vip、anonymous、unavailable，validUntil 可设 UTC 截止时间，catalog=free 可模拟公开策略，audioError=true 可模拟媒体失败。状态文件由操作者本地修改，预览仍只接受回环 Host 和 GET/HEAD，没有远端绑定或账号写接口。默认场景仍为免费曲和匿名资格。

`/account/` 是同一独立预览下的通知夹具，仅发送失效信号，无登录、Cookie 或授权功能；永不放入主站产物。音频仍为合成 WAV，不能替代远程 MP3、Range、真实会员或真机验收。本地状态文件、截图、执行记录和 session 材料不提交、不上传。

实现参考：[Broadcast Channel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)、[storage 事件](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event)、[媒体 load 行为](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/load)。真实设备的后台计时与缓存限制仍由 M6 验收。
