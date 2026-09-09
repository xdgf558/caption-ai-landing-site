# 音乐商业边界与价格证据

日期：2026-09-09。音乐未实现、未上线。本文件不调整支付规则或新增扣费。

## 不变的产品约束

免费曲可匿名完整收听；有效全站 VIP 收听 VIP/抢先作品完整版，其他人仅可独立短试听。不新增音乐套餐、单曲点数、自动续费或重复会员兑换。不因用户是管理员、余额充足或购买过游戏皮肤而授予音乐 VIP。

小说单章、游戏商品及独立软件原有权益不改变。VIP 音乐指在线收听，不自动承诺下载、离线、转授权或商用。规划中的音乐在验收上线前仍标为规划，不能因文档建档就更新公开承诺。

## 本次生产只读观察

- 完整 URL：https://wwwstationcat.org/api/novels/payments/status
- 方式：匿名 GET，无 Cookie、无支付 POST、无真实账户/后台访问。
- 响应 Date：2026-09-09T12:06:10Z（服务器响应时间；未单独记录客户端发起时刻）。
- HTTP 状态：200（HTTP/2）；代理的 Connection established 不是源站响应状态。
- cf-ray：a38610b7be482ea2-LAX。
- 本次响应头未提供 Cache-Control/ETag；不据此推断长期实时性。
- production deployment/commit：本次未通过受限部署记录关联；代码基线 3b8bbc8 不能当作本响应部署 SHA。
- 输出：publicCheckoutEnabled=true；provider=creem；mode=production。
- readerCredits.packs：100 Station Points / 10.00 USD。
- readerCredits.membership：enabled=true，membershipCreditCost=10，membershipDurationMonths=1，membershipCoversPaidContent=true。

这只是该时点公开配置响应，不证明真实扣款、到账、续期或退款撤销闭环通过。后续展示继续读既有配置，音乐不得硬编码这些价格。生产复验记录完整 URL、时间、HTTP、cf-ray 与经证实的部署版本；未核实则明确写未知。

## 尚需产品/原会员层确认

充值退款与已兑换 VIP 当前没有撤销联动，且多次续期/混合余额无法从单行记录可靠归因。需要明确赠送积分、充值积分、部分退款、拒付及多次续期的处理政策。不能把积分负余额自行解释为撤销 VIP。

原有兑换关闭开关是否应影响已购买服务，以及全站 VIP scope、未来期和终身是否支持，均须以原会员合同为准，不由音乐单独扩张或缩减。参见 [会员核对](MEMBERSHIP_INTEGRATION.md)。

本次未审查正式作品、第三方生成服务套餐、歌词/封面来源或具体授权。规格里的历史条款/额度不是新的法律或零成本承诺；M6 按实际作品与当时官方规则人工确认，证据私有保存。用户尚未提供正式音频，本地 fixtures 不得公开发布。
