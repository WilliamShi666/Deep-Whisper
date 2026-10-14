# Deep Whisper Personal Spec v0.1

状态：已批准，实施中。支持Node 24 LTS和固定pnpm；默认本机，远程单主人密码模式已纳入实施。跨系统、真实供应商与素材发布授权的实际验收见实施台账。

## 1. 产品与配置契约

| ID | 必须行为 | 主要验收 |
|---|---|---|
| OSS-001 | 干净 clone，只有 `DEEPSEEK_API_KEY` 外部秘密时，可初始化、创建伴侣、聊天、整理/保存/召回关键词记忆、使用开启后的站内来信 | 干净目录 quickstart；真实 SQLite + fake AI；后续独立真实 key canary |
| OSS-002 | 不需要 Supabase/PG/Mem0/R2/Resend/Waffo 账号即可启动；不把一项可选供应商缺失当成全局错误 | 清空全部旧变量；dev、build、production start |
| OSS-003 | 配置支持 auto/keyword/hybrid 记忆模式；auto 无向量配置用 keyword，有完整配对配置用 hybrid；显式 hybrid 缺配置报告具体缺项 | 配置矩阵；运行中向量失败降关键词，事实写入持续有效 |
| OSS-004 | 公开能力状态只返回 enabled/configured/unavailable 与原因，不返回凭据；缺可选 key 的 UI 说明“未配置”，不出现会员/价格 | 浏览器 payload、DOM、server error 脱敏 |
| OSS-005 | 默认 HOST=`127.0.0.1`、PORT=`5000`、APP_DATA_DIR=`./data`；local模式更改端口时默认 APP_BASE_URL 一并派生，显式本机URL端口冲突时报错；password模式公开HTTPS URL与内部监听端口独立 | 本机端口变化、HTTPS443反代内部5000、路径含空格/Windows路径 |
| OSS-006 | doctor 默认只做配置/路径/SQLite 特性与版本检查，不发送付费请求或邮件；明示 --live 才做有上限的可选检测 | transport 调用计数=0；live 独立 guard |
| OSS-007 | app、worker、脚本共享配置加载契约；shell env 优先；按 NODE_ENV 使用 Next 相应文件优先级；test 不继承真实 `.env.local` | dev/prod/test 加载矩阵、复制的旧 env 不会引发 PG/商户连接 |

空 key / 占位值视为未配置。原生DeepSeek聊天缺key时doctor返回非零并说明获取位置；完整OpenAI兼容聊天配置不要求DeepSeek key，无认证兼容服务允许key留空。页面可展示配置状态，但真实聊天不假装成功。主模板仅含必要和常用项，高级模板不得与实际 parser 漂移。

## 2. 身份和功能

| ID | 必须行为 | 主要验收 |
|---|---|---|
| OSS-008 | 单实例只有一个 owner，多个浏览器/刷新/清 localStorage/重启仍访问同一主人；不得由 X-Visitor-Id 选择他人身份 | 第二浏览器访问、伪造 header、owner 唯一约束 |
| OSS-009 | local 免密码只允许回环监听和允许的同源来源；跨站写请求及不允许的 Host 拒绝，不能驱动 AI 请求 | 浏览器跨源与Host测试；计数确认未打到 provider |
| OSS-010 | password 模式要求 OWNER_PASSWORD；远程有登录限速、httpOnly/SameSite cookie、HTTPS、CSRF保护；改密码使旧 session 失效 | 未登录 API/媒体401、正确/错误密码、cookie属性、轮换 |
| OSS-011 | 保留 8角色×2比例、捏人、多个会话、换角色保留旧会话；所有头像/音色/主题/照片绑定活动 companion | 16组合数据验收；两伴侣往返与旧会话保留 |
| OSS-012 | 保留 L1画像、关系快照、偏好、主题、壁纸、中英界面、反馈；既有稳定 testid 保持 | API契约与desktop/mobile，两种 palette、多语言 |
| OSS-013 | 删除收费UI、会员/免费商业额度、账单 API/webhook/SDK/部署断言；不通过伪造永久 entitlement 来绕过 | 运行时依赖扫描、无 WAFFO env production build、无价格/购买按钮 |
| OSS-014 | 保留重复开场白保护、同会话请求并发互斥、有限重试/期限与故障释放 | 两请求同时发、重复opening、异常/断开后的lease回收 |

## 3. 核心 API 与 AI

### 保留的业务边界

保留 `/api/visitor`（内部改为owner，身份字段按ledger有意变更）、companions/conversations/messages/profile/relationship/themes/feedback、`/api/persona-enhance`、`/api/tts-preview`、`/api/locale-default`、`/api/letters/preferences` 等实际产品消费者需要的端点。companions/conversations/messages成功JSON包装保持：`{companion}`、`{conversation}`、`{messages}`；`upload` 保持 `{path}`，`photo` 保持 `{message}`，TTS 保持 `{audio_url}`。locale-default改为不依赖Vercel地理头的个人默认/设备语言链，用户显式选择优先；letters/preferences增加站内/邮箱独立偏好并在ledger记录变化。不因换数据库把所有前端重写成新协议。

`/api/chat` 现状实际还包含 `user_message` 事件，不能只按简化 AGENTS 清单冻结三个事件。P0 从 types.ts、route 与客户端消费者捕获完整当前事件 fixture，再去掉确属 billing 的字段/consumer；其余 `user_message/chunk/done/error`、photo 场景、消息字段及语义保持。变更的身份/计费字段必须在契约 ledger 写出 before/after，不保留假的付费状态。

有意移除 `/api/supabase-config`、`/api/auth-providers`、OAuth/注册、billing 路由与运营管理路由，客户端不再请求它们。增加个人能力端点和 owner session endpoint、媒体读取、站内来信列表/已读接口；各精确 JSON DTO 在 P0 先写 schema 和 contract test，不能边实现边让模块自行决定响应。

| ID | 必须行为 | 主要验收 |
|---|---|---|
| OSS-015 | SSE首段、结束/错误与照片标记holdback保持；浏览器断开后服务端有界完成并保存回复；非空用户原话文本exchange同事务保存整理任务；opening/纯图片只保存回复不伪造文本来源 | 分帧fixture、断开读者、DB验证assistant+job各一份 |
| OSS-016 | 生图只在明确索照且功能已配置时发生；同角色同比例参考、stale409、失败一次保守重试与fallback说明保留 | 两比例切换/并发快照、fake provider失败分支、媒体落库 |
| OSS-017 | 用户上传必须安全审核；无法判定/格式错/超时拒绝；保留 MIME/大小/归属与图片理解 | 不安全/超限/伪装内容、provider无确切safe时不写文件 |
| OSS-018 | TTS只由点击触发；缓存、性别音色校验、代号、旧音色提示/重生成、切会话停播保留；后备只使用已配置provider | 正常/缓存/换声/失败/取消；无隐式MiniMax要求 |
| OSS-019 | AI业务层继续依赖内部contracts；模型参数、超时、AbortSignal、有限重试、SSRF下载白名单、bytes落对象存储保持 | provider contract tests；移除计费PromptScan后安全策略仍在 |
| OSS-020 | 推荐千问平台profile的key/TTS/embedding端点一致；向量批次按该接口上限≤10拆分；模型、维度和音色资格不靠变量名猜测 | transport校验分批和端点；有预算live验收独立记录 |

未配置可选能力时，直接请求对应接口返回可读 `FEATURE_NOT_CONFIGURED`（建议 503）及通用错误结构，不返回 `MEMBERSHIP_REQUIRED`。配置存在但provider报错时保留有限失败提示；不得伪报“已经生成/播放”。

## 4. SQLite 与记忆

| ID | 必须行为 | 主要验收 |
|---|---|---|
| OSS-021 | SQLite真实foreign keys、unique、CHECK、JSON/UTC DTO有效；同一schema事实来源、版本迁移、禁止db push/reset | 真实临时文件迁移、非法记录/归属/级联、UTC roundtrip |
| OSS-022 | FTS5统一预分词；中文bigram/单字片段、Latin整词；索引保留词频、查询去重/转义/绑定；BM25升序 | 胃镜/团子/单字片段/英文/数字/OR/引号/空/长输入 |
| OSS-023 | insert/update/delete与FTS事务一致；过滤scope/expiry/status后limit；BM25/RRF不冒充cosine分数 | 索引一致性与重建；多伴侣、过期占位、排序fixture |
| OSS-024 | hybrid扫描全部合格同scope向量，不限于keyword命中；不同model/dim/content version/非法分量不得混算；两路rank融合，cosine与rank字段分开 | 无字面交集的语义命中、两腿独有项、模型不一致、退关键词 |
| OSS-025 | 无embedding配置/超时/429不阻止事实与FTS落库；改正文同事务清空旧向量；补向量任务以content version fencing防旧写 | add/update无key、延迟补全、新正文不能用旧向量、文本更正竞争、重试幂等 |
| OSS-026 | L1/关系快照/近期原文/长期分类仍分层；communication绑定companion并逐字来源验证；助手话不得成为用户要求；avoid_topic每轮生效 | 保留领域回归，构造相同助手/用户文本反例与新伴侣 |
| OSS-027 | 召回失败区别可信空集；坏快照不吞成空；observedAt旧结果不覆盖新关系；resolved已结束事件仍可召回并按既有时效权重降权；每轮写入预算、分类多样性和证据护栏保留 | 超时/坏JSON/新旧并发/结束事件与过期区分、分类budget、inferred evidence |
| OSS-028 | 删除会话先穷尽所有来源记忆再级联；包含过期/非active/多来源以及同scope显式evidence_memory_ids的传递推断依赖；无法归属来源的行保留并报告partial；清FTS/向量/任务/快照、epoch fencing，旧任务不可复活 | >48条删除、共享来源、旧writer/运行job与delete竞争 |
| OSS-029 | 仅非空用户原话文本exchange建立整理任务，assistant_message_id唯一防重复入队；facts/FTS/sources/关系副作用/派生jobs/完成标记同事务防重复应用；claim/finalize校验lease token/epoch/来源；observedAt固定源交换完成时刻，其他会话epoch变化时合法任务重新读取并有界重试；AI在写事务外，失败不让完成SSE回滚 | 重复claim、ADD与完成间崩溃回滚、进程停止恢复、租约过期/错误token、来源被删取消/其他来源有界重试 |

检索性能用100/1,000/10,000条合成记忆记录机器与p50/p95。目标10,000条1024维本地检索p95≤250ms（不含网络embedding）；不达标不得静默截断scope数据，应调整架构与spec后复核。

## 5. 来信、存储与运行

| ID | 必须行为 | 主要验收 |
|---|---|---|
| OSS-030 | 来信默认站内，不需要邮箱账号/邮件env；用户主动开启后按事由、日期、个人时区、每日频控生成；重启同事由不重复 | fake clock生日/纪念日/窗口；每天全owner≤1；偏好关闭不调用AI |
| OSS-031 | worker由dev/start统一启动和监督；停止关句柄、异常可见；休眠后只评估当天，不补历史连发 | 无第二条必需启动命令、worker退出、sleep/restart |
| OSS-032 | SMTP/Resend只发给owner保存的固定地址；邮箱转发设置与站内来信启停分开；无邮件配置时站内仍可读 | 配置/偏好矩阵、拒任意To API、邮件失败站内副本保留 |
| OSS-033 | SMTP 465隐式TLS/587强制STARTTLS，无关闭证书验证配置；accepted与delivered不同；unknown不自动重复发 | 本地SMTP transportfixture：TLS/拒绝/提交后断线/unknown |
| OSS-034 | resend且webhook secret非空才启用验签回执，否则endpoint未配置；bounced/complained抑制邮箱、delivered只更新记录；GET退订无副作用、POST只停邮箱转发，站内独立；本机邮件不生成假公网链接 | 伪签名、扫描器GET、过期/伪token、邮箱停收不改站内开关、本人重新启用、在途再检偏好 |
| OSS-035 | local存储在production可用且私有，媒体有owner访问保护与音频Range；先存bytes再写DB，目录逃逸拒绝 | 未授权媒体、MIME/Range、路径/符号链接、DB写失败孤儿对象 |
| OSS-036 | 备份DB+media+必要secret与manifest一致，运行中协调写暂停；迁移/恢复验证版本/完整性，不能复制主文件忽略WAL | 有在途任务的backup/restore、旧版升级、磁盘满/只读/坏备份 |
| OSS-037 | 公开仓库无真实env/data/客户截图/商户绑定；许可证、素材与依赖声明完整；README从零可复现 | 文件+历史扫描、人工清单、干净clone，不将扫描未报错当绝对无秘密 |
| OSS-038 | 所有必须编号有测试/实现/验证边界映射；独立code/spec review修复复核后专职E2E | 两份review报告、AC ledger、最终E2E报告 |

`LETTER_DELIVERY=in-app` 不外发；`both` 保留站内副本并尝试外发；`email` 以邮箱为通知入口但仍保存站内可追溯副本。none provider + email/both 是配置冲突，doctor非零并提供修改方式；应用保护聊天与站内已有信可读，不启动外发。未知值不是静默默认。

日期：时间戳统一UTC，日限与触发日按owner设置的IANA timezone计算，避免把现有叫localSendDate但实际UTC的行为照搬。用户没设置时首次引导确认浏览器检测的时区，无法取得回退Asia/Shanghai并可修改。时区修改重新评估当天且仍防重复，不追溯大量旧信。

## 6. 测试与审查追踪

| 测试组 | Spec | 方法 |
|---|---|---|
| setup/config | 001–007、020 | 无真实env的临时目录；parser/doctor/启动器真实代码 |
| owner/core | 008–015 | 本地HTTP+真实SQLite，provider仅网络边界fake |
| image/voice/storage | 016–020、035 | transport contracts+真实文件，浏览器播放交互 |
| SQLite/memory | 021–029 | 真实SQLite/FTS/事务；确定性向量fixture；restart/竞争 |
| letters/email | 030–034 | fake clock+真实DB，SMTP/Resend只有transportfake |
| backup/release | 036–038 | 临时卷/新checkout、报告、人工授权清单 |

每条ID在实施时追加具体测试名与Red/Green证据；不能只把一条“测试通过”对应全部ID。code reviewer检查代码正确性，spec reviewer检查编号/文档/配置完整性；两者通过并完成修复后，E2E成员从公开README起步。

E2E至少覆盖：最小配置dev与build/start、完整配置mock媒体、缺可选key、两伴侣隔离与换形象、SSE断开、点击语音/换音色、上传审核、重启恢复、关键词/混合记忆与删除、站内信/SMTP/停收、desktop/mobile中英两色调、远程owner未登录保护、备份恢复。macOS/Windows/Linux分别记录安装和启动证据。离线E2E不证明真实音色、真实生图或邮箱实际投递；真实live每项按明确请求数/费用门禁和授权记录，首次读取 [现有canary runbook](../runbooks/ai-provider-live-canaries.md)，不得为测试自动群发或多次生成。

审查勘误（2026-10-07）：015/029明确原有文本整理入口的资格，不为开场白或纯图输入创造用户文本来源；028把同scope显式证据依赖纳入来源遗忘，避免成功删除来源后继续召回其推断内容。未关联画像/关系摘要不因此删除；其他伴侣或无证据关联的记忆不扩大删除。由独立reviewer复核相应真实SQLite与路由fixtures。

## 同提供商模型配置补充（2026-10-07）

- OSS-039：五个可选模型变量 AI_CHAT_MODEL / AI_VISION_MODEL / AI_IMAGE_MODEL / AI_TTS_MODEL / AI_EMBEDDING_MODEL 从共同runtime入口解析；不改供应商、密钥、API响应与SSE。缺省保留原模型，审核默认独立deepseek-flash；语音回退保留默认Gemini。模型ID格式校验不会替代供应商权限或兼容性验证。
- OSS-040：模型ID实际传到transport，保留请求超时、响应校验、音色映射、受限临时音频下载。内置两图像模型参数维持原状，其他兼容/images模型采用公共参数及上游默认画质。缓存语音不自动失效，新合成使用新配置。
- OSS-041：Embedding默认text-embedding-v4、1024维；查询和worker共享配置模型命名空间，同模型/维度/内容版本才参与余弦检索。模型切换异步有界重建（含历史completed任务），facts与FTS保持，不混向量空间、不发真实测试请求，不为同目标失败任务无界重置重试预算。
- OSS-042：中英文README与两env模板说明必填key和可选模型ID、提供商兼容要求、重启与向量补建用量。公开导出保留英文README，更新发布manifest。

验证：临时SQLite的模型切换/重建/租约/重试行为测试，模拟transport的模型字段与媒体字节契约，独立code/spec复核；本次不扩展浏览器端到端或付费live验收。

## 自定义AI接口与素材协议补充（2026-10-08）

本节扩展039–042；此前“同提供商模型配置”是历史增量，不再限制只能使用固定提供商。

- OSS-043：chat/image/TTS/embedding provider增加openai-compatible，各有AI_*_BASE_URL/API_KEY/MODEL；兼容profile要求显式根地址和模型，key仅在无认证服务时可空，禁止继承其他供应商key。原生profile及旧变量兼容，新变量优先；HTTP(S)根地址保留前缀、规范化尾斜杠，拒绝凭据/query/hash。配置、doctor和能力状态不普遍要求DeepSeek key，也不泄漏服务端地址/key。
- OSS-044：兼容chat使用流式/非流式Chat Completions与结构化JSON，不发送DeepSeek专有thinking字段；vision provider省略或为openai-compatible时继承兼容chat，可独立覆盖视觉模型/地址/key，地址变化不得继承chat key。没有兼容chat可继承时，兼容vision需自己的地址和模型。文本模型不冒充多模态能力；上传审核仍fail closed。前端包装和user_message/chunk/done/error不改变。
- OSS-045：兼容image有参考图走multipart edits，无参考图走generations；只支持同步Base64 PNG/JPEG/WebP，保留角色参考，不降级丢弃。兼容speech接收/audio/speech的MP3/WAV字节，女生/男生映射AI_TTS_VOICE_FEMALE/MALE（默认alloy/onyx），沿用公开音色代号与兼容模式提示，不宣称25个真实上游音色，不自动跨提供商回退；原千问/Gemini行为保留。bytes先保存私有存储，再写消息URL。
- OSS-046：Embedding维度可配置，AI_EMBEDDING_DIMENSIONS默认1024（1–65536整数），AI_EMBEDDING_SEND_DIMENSIONS默认true且只接受true/false；响应向量严格等长。自定义命名空间覆盖协议、规范化地址、模型、维度，不含key。切换空间异步有界补建，保留facts/FTS及重试预算，查询与worker共用配置，旧任务结果拒绝写入；仅换key不补建。默认旧profile向量继续可用，无schema迁移。
- OSS-047：ASSETS与中英文README明确16角色、40套壁纸及横版/缩略图采用CC BY-NC-SA4.0，保留原始作者、社区来源、项目改编与修改记录；商业使用须相关权利人授权，代码MIT不替代素材许可。独立抱心蓝鲸品牌另行授权，包含角色的品牌素材遵守角色协议。公开manifest同步更新。
- OSS-048：中英文上手提供原生与兼容两条启动路径，明确必填/可选、URL前缀、模型/音色协议、维度、重启app与worker、向量补建费用及缓存行为。网络边界fake、真实临时SQLite验证和独立code/spec review覆盖此增量；按用户要求本次不新增浏览器E2E、付费live模型或真实邮件投递验收。
