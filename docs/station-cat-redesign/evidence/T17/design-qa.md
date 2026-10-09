# T17 推广管理设计 QA

Final result: passed（本机设计与交互范围）。没有遗留 P0/P1/P2 界面问题；真机、VoiceOver、生产资源和原生渠道验收未进行。

## 对比依据

应用 Product Design 的已有产品界面与 image-to-code / design QA 流程。源图为 T16 `../T16/admin-final.png`，实现为 `campaign-final-1440.png`，两者均为 1440 CSS px 视口下 1425 px 内容宽度。`source-and-implementation.png` 将两张原始截图的顶部 1100 px 并排，仅用于同宽 QA，不作设计重绘。源图的推广草稿与实现的已公开夹具不同，比较共同壳、导航、侧栏、编辑区域与控件；新增 Campaign 区域按原组件风格扩展。公共首页没有重新设计。

## 五个方面

- 字体：复用 admin-music.css 的系统/CJK 字体、26 px 主标题与 14 px/1.6 正文。编号、中文标签、来源渠道、长网址均保持可读；网址用只读 textarea，可选中和滚动查看全文。
- 间距：保留原导航、260/220 px 侧栏和编辑内边距。Campaign 记录用原分隔线而非新增卡片堆叠；宽屏 QR 与地址并排，1050 以下上下排。五宽度实际 clientWidth 分别 305/375/753/1009/1425，均等于 scrollWidth，见 viewport-metrics.json。
- 色彩：沿用灰绿背景、深绿正文、绿主按钮和原提示/错误样式。白底黑色 QR 保留静区，未添加背景纹理、渐变或装饰插画。
- 图像：QR 来自既有锁定库，是实际机器码而非模拟图案；下载 SVG 已用另一解码器证明与复制地址相等。管理界面没有新栅格美术资产。落地页封面取自本机既有素材作夹具，不代表实际发行封面或使用权。
- 文案：明确单渠道登记、维度固定、当前有效/失效、历史保留、重新核对以及二维码无中转。生产域名提案与本机临时数据的区别显示在页顶。空主推、真实链接、试听与版权依旧待用户确认。

五个宽度的完整截图 campaign-final-320/390/768/1024/1440.png，以及相应 campaign-detail-* 裁切均已打开检查。裁切只截取实际截图，不改布局。history/ 中三张早期观察仅作历史，不作为最终界面验收。

## 实际操作与修正

IAB 通过 UI 保存了 Campaign 字段为空的推广草稿，公开指针保持旧版；创建第三个渠道 ui-local-bilibili，与 douyin/youtube 使用同一测试视频。复制结果逐字与只读地址相等，实际下载 SVG 保存 ui-downloaded-qr.svg；downloaded-qr-check.json 记录独立 sharp/jsQR 解码、文件 SHA-256 与相等结果。二维码编码的是规范生产域名合同地址，本机落地核对仅将 origin 替换为 loopback，未点击正式线上或发行平台地址。

重复编号收到明确拒绝；停止推广后所有 QR 被移除，记录显示当前不可用，仍可停用单个历史 Campaign；恢复测试推广后重新启用重新核对资源。空字段保存、失效推广停用、重复拒绝的截图分别为 empty-campaign-save-passed.png、invalid-promotion-archive.png、campaign-duplicate.png。落地页 DOM 确认 registered Campaign 与干净 canonical/语言/内部链接，见 landing-browser.json；管理页和该落地页读取的控制台 error/warn 均为空。

本轮发现并修复两个 P2：操作说明原先随创建区折叠/失效禁用，导致历史链接无法手动停用；已移到独立始终可见的说明区。Campaign 输入的 required/pattern 原先属于推广表单，会阻止空白或未完成链接的推广草稿保存；已将校验限定在登记按钮操作，浏览器实际保存成功。登记输入还从网站 dirty 判断中排除。

本轮未用浏览器脚本注入存储或网络故障；匿名存储、超时及顺序上下文是工厂测试，后台原命令未知回执是控制器/原生测试。100 字节视频夹具没有播放验收。UI 已沿用标签、状态区和原 focus 样式，但没有完成全键盘、VoiceOver、iOS/Android 或平台内置浏览器检查。临时视口 override 已重置，管理预览保留供用户查看；生产未启用，T18 未开始。

执行中断后已恢复 4217 预览并再次打开推广模块。临时存储按合同重置为两个渠道夹具，见 preview-after-restart.png；此前三渠道操作与下载证据保留，不声称临时数据跨进程持久化。
