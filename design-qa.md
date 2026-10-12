# Station Cat 清晰编辑台 — 设计 QA

source visual truth: `docs/station-cat-redesign/L07-evidence/selected-admin-design.png`，本轮第 3 个显示结果，原始 1487 × 1058。

implementation: `http://127.0.0.1:4224/admin-v2/`，Codex in-app browser。最终截图 `docs/station-cat-redesign/L07-evidence/admin-desktop-final.jpg`。

viewport: desktop CSS 1440 × 1024，输出 1440 × 1024，密度 1；参考归一到相同尺寸。来源为生成图，没有浏览器 DPR，横/纵缩放约 0.968/0.968。早期 getScreenshot 捕获了 999 像素高的可见区；最终比较改用完整 1024 像素捕获，不据早期底部裁剪判断设计漂移。手机 CSS 390 × 844，输出 390 × 844，使用正常 viewport capture 保留滚动状态。

state: 简中、浅色工作区、左侧深色导航、全部类型、第一首选中，五份歌曲草稿、一个公开游戏。夹具不连接生产。示意的 12 首计数、猫咪示意封面、500 MB 和混合文件类型不作为真实运营规则；示例画面复用仓库艺术素材，真实页面按关联资产读取原作品封面。当前线上 11 首已公开与本机草稿状态分开。

## 比较与修正记录

第一轮 `comparison-first.png` 把来源与实现放在同一输入中比较，随后检查实际尺寸。P1：继承的 label 布局令搜索框折成两层；P2：编辑器标签 margin、标题栏 padding、折叠区间距令保存按钮落到 y=1219；P2：logo 的 brightness 处理抹掉了眼睛。修正搜索 flex、输入字体与间距、去掉继承 padding/margin，次要语言/播放设置收进详情，保留真实操作说明；logo 采用提供的品牌图并保留眼睛。

第二轮 `comparison-second.png` 确认三栏与首屏操作恢复，继续放大检查字重、状态色和右侧行距。导航/状态字号补齐，技术提示和权利状态分别着色；长标题最多两行。运行检查另修复控制函数作用域及缺少 jobs/revisions 的报错。手机检查发现顶部导航可能遮住滚动目标，补 scroll-margin；菜单 hover/focus 保持深色背景，关闭导航为 inert，预览提示改为手机整行。空说明的焦点在控件解锁后进入文本域。

最终 `comparison-final.png` 是相同尺寸、相同选择状态的并排输入，已打开检查。另打开 `comparison-rail.png`、`comparison-catalog.png`、`comparison-editor.png` 同一输入中的局部配对；单独查看图片不被记作并排比较。

## 五项保真检查

- 字体：Noto Sans SC / PingFang SC / 系统 CJK 回退，主标题 36px、编辑标题 26px、作品标题 17px；层级、行高和换行与来源接近。生成图的具体字体无法识别，光学字重差异为 P3。
- 间距：220px 导航、约 800px 中区、420px 编辑区；64px 方形缩略图、90px 列表行、44px 表单控件，首屏保存/公开按钮可见，移动端选择后标题约 y=80，无横向溢出。没有用浏览器外框或密度差异作为缺陷。
- 颜色：深蓝导航、纸色背景、紫色选中/主按钮、音乐/游戏类别色和绿色公开态保持原意。权利状态与技术记录分开，禁用/焦点态可识别。
- 图像：品牌标记来自已有素材，作品图片来自既有图像和受控资源，清晰方形裁切；图中的猫咪示意封面不替代原作品。图标选用匹配线条风格的既有 Lucide 包，未手绘 SVG、div 画图或用 emoji 代替素材。参考了 [Lucide](https://lucide.dev/icons)、[Phosphor](https://phosphoricons.com/) 与 [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC)，沿用现有依赖。
- 文案：保留作品内容、资料与素材、标题、艺名等主要文案；计数按已读取记录，文件规则按真实用途。完整音频沿用旧权限，试听独立配置，技术校验不等同权利或公开。保存的新草稿与仍公开的旧版明确区分。

## 功能与残余边界

搜索、类型筛选、空态、未保存切换保护、说明必填、草稿保存、素材登记、预检、公开、截图上传和对应音乐素材标签已在浏览器操作。手机菜单、Escape、横向溢出与说明焦点验证通过；最终权利视图与素材深链接控制台无错误。

桌面、手机证据分别为 `admin-desktop-final.jpg`、`admin-mobile-list.jpg`、`admin-mobile-editor.jpg`；`local-publish-result.jpg` 与 `local-media-result.jpg` 是合成流程证据。保留旧系统的账号/订单合同，未以空夹具声称生产会员、订单或云存档验收。

上述视觉检查未发现剩余 P0/P1/P2，但没有覆盖完整 CI 和全部交互边界。PR #214 对 `6095729` 的代码审查另确认 1 项 P1、4 项 P2、1 项 P3，已按 `docs/station-cat-redesign/L07-unified-admin-and-music.md` 的审查修订补齐隔离清单、指定作品定位、上传选择保留、新建保护、冲突恢复与服务标签 URL。新增 13 项真实脚本事件回归；浏览器另验证新建保护及页内确认的保留/重新读取，截图为 `L07-evidence/review-fix-dirty-protection.png`。先前的局部通过记录不替代修订头完整 CI。

视觉 P3：图标笔画及系统字体的细微差异；真实内容比生成示意拥有更多语言、说明和回退选项，位于次要详情中。尚无真机或 VoiceOver 证据。

final result: passed
