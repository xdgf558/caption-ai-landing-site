# M1-05 MP3 帧解析与试听核验

2026-09-10，基线 main@ac8ac76（PR #122 已合并）。分支 `codex/music-mp3-validation`。本轮仅本地解析器、对象测量合同、测试和文档；没有 Worker 路由、D1/R2 绑定、迁移、部署、真实音乐上传或开闸。

## 选型与支持范围

锁定 `mp3-parser@0.3.0` 和 `@noble/hashes@2.4.0`，均 MIT、无传递依赖。本轮 lockfile 仅新增两项，不升级原依赖。许可文本见 `src/music/THIRD_PARTY_NOTICES.txt`。

从 [mp3-parser 官方库](https://github.com/biril/mp3-parser) 复用固定帧头读取、样本表和帧长度计算；仅深导入锁定版本 `lib/lib.js`，不调用自动搜索/重同步或完整 ID3 文本解析。库较旧，MPEG-2.5 表缺失，因此外层在调用前明确拒绝该类型；不依赖库容错处理不可信输入。候选 codec-parser 面向播放的容错会丢弃不合格式数据，本次采用严格连续帧包装，任何帧间垃圾都拒绝。

首版接受 MPEG-1/MPEG-2 Layer III、无 CRC 帧、固定采样率与声道数，支持 CBR/逐帧变码率 VBR、帧 padding、首部 ID3v2.3/v2.4、v2.4 footer、尾部 ID3v1，以及首帧 Xing/Info。ID3 内容只限量跳过，不读其中标题/TLEN，不输出或执行嵌入内容。Xing 声明帧数/字节数只用于与遍历结果交叉核对，不能代替遍历。

MPEG-2.5、Layer I/II、CRC-protected、free-format、VBRI、ID3v2.2、其他标签/尾部填充、串联信息帧、变更采样率/声道或保留值都失败关闭，需本地规范化后重传。无“猜测时长”或自动云端转码降级。20 分钟仍是运营建议，不改成产品硬上限；极长低码率文件可能达到独立解析帧数预算而被拒绝。

## 测量语义

`inspectMp3` 逐帧累加实际编码样本数，以整数采样率计算 `ceil(samples * 1000 / sampleRate)`，不累计浮点帧时长，不使用文件体积除以标称码率。Xing/Info 无声信息帧不计入音频样本，其他帧的编码延迟/尾部填充保留，不采用不可信 LAME trim 值缩短限制。因此 durationMs 是保守的编码样本时长，而不是去填充后的净 PCM 时长。

真实合成样本的测量与 FFmpeg 独立 packet sample count 完全一致；与独立解码的净 PCM 时长差小于 250ms。特别大的/矛盾的编码填充可能导致拒绝，不能扩大容差绕过试听上限。

检查连续完整帧、文件边界、信息头计数、格式一致性及起始 bit reservoir 可用性，拒绝常见截断与结构损坏。但本模块不是 Huffman/音频解码器，也不逐样本比较原曲和试听，无法证明所有 payload 可解码或语义同源。没有 Xing 的文件若在完整帧边界被裁短且存储长度也已变更，单靠结构无法还原原长度。完整字节 SHA-256 与可信资源记录匹配、管理员实际试听确认仍不可省略。

## 资源限制

| 项目 | 强制预算 |
| --- | --- |
| 完整/试听实际字节 | 32 MiB / 4 MiB；必须匹配调用方提供的可信对象长度 |
| 每个输入 chunk | 64 KiB；不接收空块、非 Uint8Array 或更大块 |
| 固定 carry | 67,584 字节；另有至多一帧副本、当前上游块及 hash 状态，不常驻整曲 |
| 单帧/ID3 总量 | 2 KiB / 1 MiB |
| 总帧/读取次数 | 150,000 / 65,536（含 EOF 读取；极碎块可能达到次数上限） |
| I/O 总时限 | 10 秒；支持 AbortSignal，中断/失败取消 reader 并释放锁 |

限额可在可信调用方收紧，不可调大或传入 NaN。流式 SHA-256 使用 [noble-hashes](https://github.com/paulmillr/noble-hashes)，在每块到达时更新。提前终止、迟到的 read 拒绝和不推进的流不能返回成功证明。M2 须提供符合块大小合同的私有对象读取适配，不能先 arrayBuffer 整首音频再切片。

10 秒是墙钟/I/O保护，不宣称是 CPU 硬中断。Cloudflare 的 [计时 API](https://developers.cloudflare.com/workers/runtime-apis/performance/) 在无 I/O 时不持续推进；因此同步工作量另受字节/帧数硬预算限制，实际 CPU 上限仍依赖平台。M2 上线前必须按实际套餐和 [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) 配 CPU/并发上限并压测，不能凭本地测量声称免费套餐可运行。固定 carry 也不等于整个 isolate 的总内存占用。

本地 Node 边界运行：32 MiB、107,202 帧约 574ms；4 MiB、13,400 帧约 80ms（单次样本，不是性能承诺）。边界输入按块生成，不将 32 MiB 测试音频存入仓库。

## 发布与源绑定

`verifyMusicAudioAsset` 接受可信私有对象 metadata/body，核对 ETag、长度、MIME，实际解析并对照已验证资源的 hash/时长，输出 M1-04 所需 `mp3-frames` 证明。`validateMeasuredPreview` 进一步核对同曲归属、当前 full ID、独立对象 ID/key/hash、两份测量和源范围，强制 `min(配置15–45秒, full半长)`、最多250ms容差。原曲 ID/hash 或实际文件改变不能复用旧证明。两函数不访问网络，不授予身份或 VIP，不写数据库。

完整发布联测使用这两个真实函数；故意破坏试听字节时，M1-04 事务前拒绝且全库不变，恢复有效字节后同键可成功发布。证据资源仍为隔离 fixture，本轮不是整个生产对象验证器。M2 须核验封面/歌词/权利文件，并由服务端记录实际试听确认和审核指纹，不能把浏览器声明当可信 metadata。

D1 与 R2 仍不共享事务。核验后删除/替换竞态需要 M2 不可覆盖上传、引用保护、清理协调和条件读取；本轮不声称解决远程 TOCTOU，也没有把解析函数接成 HTTP 鉴权入口。

## 验证、供应链与后续

- `npm run test:music:mp3`：21 项，五份真实编码合成文件、不同 chunk 边界、结构损坏、Xing 伪造、ID3、预算/超时/中断、绑定与容差、32/4 MiB 边界，全部通过。
- `npm run test:music:publication`：24 项通过，新增真实 MP3 核验阻断/成功联测。两套均进入 npm pretest/CI。
- 本地 workerd（Miniflare）browser bundle：五份实际编码文件的时长/hash/样本数及截断拒绝通过，无绑定/远程资源。这是一次本地验证，复现脚本未纳入仓库，CI 未执行；M2 须补充可复现的运行时测试及真实 R2 适配验收，私有对象按不超过 64 KiB 分块读取，禁止先用 `arrayBuffer()` 缓冲整曲。
- `npm test` / `npm run build`：通过，145 页 / 111 sitemap。没有 UI，本轮不跑音乐 Playwright 或 Safari，不把模型/本地 runtime 测试当成预发验收。
- `npm audit` 非绿：9 项告警（1 low、7 high、1 critical），位于原有 astro/esbuild/js-yaml/nanoid/postcss/sharp/smol-toml/svgo/vite；两项新依赖未被列入。本轮没有升级这些既有版本，不将“无新增告警”写成供应链无风险；原站依赖风险应另开升级/可达性审查。

合成文件合计 132,395 字节，来源/生成参数/独立 packet 与 PCM 结果见 `tests/fixtures/music-mp3/manifest.json`。生成器只在本地调用 FFmpeg，CI 使用已提交 fixture；没有 FFmpeg 二进制、正式音频或 PCM 进入 public/dist/Worker。更换编码器版本可能改变字节，需显式审查 hash 与 oracle。

M1 本地基础已完成，下一步 M2 接线仍须逐项处理：预发独立 D1 完整 publish 成功/零命中回滚实测（含 json_object/changes）、Access JWT + Origin/CSRF、R2 字节与删除竞态、PR #121 重复 Cookie/异常 clock 与真实会话查询、空歌单，以及 PR #122 畸形 metadata 的 422 分类。预发资源、迁移、上传、真实发布、部署及开闸均需单独批准。涉及 UI 时按用户要求调用 Product Design。
