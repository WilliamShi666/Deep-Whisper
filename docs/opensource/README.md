# Deep Whisper Personal 开源版文档

方案已于2026-10-07批准并实施。代码采用MIT；原创素材与品牌已获所有者确认随本项目公开分发并用于个人自托管，原权利保留，详见[素材声明](../../ASSETS.md)。

1. [制作计划](01-plan.md)：保留功能、迁移阶段和验收门槛。
2. [架构文档](02-architecture.md)：SQLite、FTS5/BM25、可选向量、单主人身份、媒体和邮件。
3. [Spec](03-spec.md)：OSS-001至038的具体行为要求。
4. [环境变量指南](04-environment.md)：最小一把key、完整三把AI key、可选SMTP/Resend及远程访问。
5. [实施验收台账](implementation/acceptance-ledger.md)：每条要求的实现、测试和验证边界。

实际启动命令以项目根目录的[README](../../README.md)为准。默认只需自己的DeepSeek key；SQLite、私有本地媒体、关键词记忆和站内来信均无需商业项目的账号。

独立code/spec review已完成，随后专职成员执行E2E并通过24个不同场景、设备和配置用例；发现的问题已有修复与独立复核记录。完整证据见当前工作区的 implementation/code-review.md、spec-review.md 和 e2e-report.md（内部审查日志不随公开候选包分发）。离线测试不能证明真实音色、生图或邮件实际到达，跨系统安装证据也须逐项记录。公开候选包不携带商业仓库Git历史、真实环境变量、data或客户资料；本次素材公开范围以[素材声明](../../ASSETS.md)为准。

本地内部探索与提案评审保存在内部探索与审查证据（公开包不含商业项目记录）和内部探索与审查证据（公开包不含商业项目记录），它们不作为实现验收结论。
