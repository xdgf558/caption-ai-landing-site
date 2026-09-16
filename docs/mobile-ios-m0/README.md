# Station Cat Music · M0

v1.0.1规格核对及本地技术验证。主报告：[baseline-audit](docs/baseline-audit.md)；下一阶段：[M1任务](docs/M1-tasks.md)。本目录不是可发布App，没有修改网站业务、配置或数据。

- [架构决策](docs/decisions/ADR-001-architecture.md)
- [安全与恢复协议](docs/decisions/ADR-002-security-recovery.md)
- [接口与迁移](docs/api-and-migrations.md)
- [测试记录](evidence/models.log)、[原生记录](evidence/native-probe.jsonl)、[网站基线](evidence/website-tests.log)

31项本地故障模型通过；模拟器真实合成MP3加载/分段认证/seek/完整缓冲后硬截止停止通过；16项本机HTTP身份矩阵通过。既有网站81项中80通过、1个封面旧断言失败。Keychain探针返回-34018，真实登录/设备/存储联调未通过。不能写成所有M0验收全部通过。

## 复现

从本目录运行：

```sh
python3 -m unittest discover -v -s experiments/models -p 'test_*.py'
experiments/native/build.sh
python3 experiments/native/mock_server.py
```

另一终端运行 `python3 experiments/native/check_http.py`。服务仅监听127.0.0.1:18761，使用本地合成fixture。Ctrl-C退出。没有生产媒体/凭据。

模拟器运行需本机权限和已安装的Xcode；build.sh使用本次发现的Xcode 27 beta 6，正式工程须重新锁定稳定工具链。应用为临时签名，Keychain未通过不能忽略。

```sh
export DEVELOPER_DIR=/Applications/Xcode-27-beta-6.app/Contents/Developer
xcrun simctl list devices available
# 选择本机现有模拟器，再依次执行（这里的 DEVICE_ID 须替换）：
xcrun simctl boot DEVICE_ID
xcrun simctl install DEVICE_ID experiments/native/build/M0Probe.app
xcrun simctl launch DEVICE_ID org.stationcat.m0.probe
xcrun simctl get_app_container DEVICE_ID org.stationcat.m0.probe data
```

从返回的本实验app数据容器取 `Documents/probe.jsonl`，放入 `evidence/native-probe.jsonl`；运行 `python3 experiments/native/check_report.py` 验证记录。实验约12秒完成；播放器音量为0，3秒强制停止。可在完成后卸载本实验app并关闭由本次启动的模拟器。不要读取其他应用容器。

代码故意很小，只为证明实际媒体请求和协议模型。没有完整刷新/删除服务、正式加密结果存储、严格Swift并发实现、生产网络配置、系统控制测试或正式产品UI；禁止将实验凭据和HTTP配置拷入产品。文件journal与SQLite模型不冒充Keychain与D1。

## PR审查范围

本目录随网站仓库提交仅用于审查M0文档和隔离实验。没有接入构建、路由或生产Worker；不是已上线移动API。evidence为2026-09-15的历史运行记录，不自动代表当前提交重新运行。build/cache、私有CLI日志及用户其他改动未包含。
