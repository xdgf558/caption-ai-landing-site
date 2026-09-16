# PR 打包复核 · 2026-09-16

范围：将此前独立本地 M0 交付物纳入现有网站仓库 docs/mobile-ios-m0，供代码审查。未接入产品构建或接口。

- 在 PR 工作树重新执行 Python unittest：31项通过。
- check_report.py 对先前模拟器记录的断言通过；这是证据文件一致性检查，本轮未重新执行模拟器。
- `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build` 通过，含 postbuild / built-site foundation 与四语音乐入口检查。该环境与仓库CI的空小说设置一致，仅用于构建验证，不是生产部署包。
- 原生Swift编译及16项本机HTTP结果为2026-09-15的历史证据。
- 既有生产来源的81项专项回归仍记录80通过、1失败；封面size=display旧断言未在本PR修复。
- Keychain -34018、真实AASA/认证、D1事务、实体iPhone未通过；没有将它们计入通过数。
- 私有Wrangler日志、编译产物、缓存及用户原README修改未纳入PR。日志本机目录脱敏；artifact-sha256为打包后文件清单。
- 规格副本仅清理行尾空格；原始附件未改，原始与PR副本哈希分别记录。
