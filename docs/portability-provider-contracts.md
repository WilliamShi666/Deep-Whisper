# Personal edition provider contracts

2026-10-07。本文约束个人版实际实现。配置收集见 docs/opensource/04-environment.md，业务 DTO/SSE 见 docs/opensource/implementation/api-contracts.md。数据库为私有 SQLite，不依赖 Supabase、PostgreSQL、Mem0 或会员服务。

## 代码边界

内部消息和契约在 src/lib/ai/types.ts、contracts.ts、embedding-contracts.ts；能力由各 *-provider.ts 注册表选择；环境唯一入口为 src/lib/config/runtime.ts；脚本与 worker 共用 scripts/lib/load-script-env.ts。对象存储入口为 src/lib/storage/object-store.ts。

业务 route 不导入供应商 SDK、消息类型或鉴权 helper。适配器允许注入 transport，契约测试不访问真实服务。错误不得包含凭据、Authorization、完整 prompt 或 Base64 媒体。

AiMessage.role 为 system/user/assistant，content 为文本或 text/image_url parts。Chat complete 返回非空文本，stream 只 yield 可见文本，structured complete 必须通过调用方 parse。VisionSafety 必须给出明确 safe boolean；超时、拒绝或格式错误使上传失败。Image/Speech 返回非空 bytes、已校验 MIME 与实际模型，不自行写数据库。上游临时 URL 必须在适配器内完成受限下载，不交给 route。ObjectStore 失败不得回退临时链接。

外部请求传递 AbortSignal 并受超时约束。400/401 不重试；408/429/5xx 仅有限重试。业务照片保守场景回退最多一次。媒体先成功持久化，再写消息。

## 环境与能力

| 能力 | 默认 | 凭据及缺失行为 |
|---|---|---|
| chat / vision safety | DeepSeek deepseek-flash，独立注册表与审核策略 | DEEPSEEK_API_KEY；缺失禁用聊天/上传，站点仍启动 |
| image | OpenRouter openai/gpt-image-2；AI_IMAGE_MODEL 可选兼容 Gemini Image | OPENROUTER_API_KEY；缺失禁用照片 |
| speech | 有 DashScope key 优先 Qwen；仅有 OpenRouter 时 Gemini | 无 key 禁用语音；显式 provider 要求对应 key |
| embedding | DashScope text-embedding-v4、1024维、每批最多10条 | auto 无 key 为 keyword、有 key 为 hybrid；显式 hybrid 缺 key 报错 |
| storage | local，在 development/test/production 均私有 | 无云 key；显式 r2 才收集五项 R2 配置 |
| external email | none，可选 smtp/resend | 不完整配置关闭转发并由 doctor 报错；聊天与站内信继续可用 |

APP_ENV 优先于 NODE_ENV，不使用 VERCEL_ENV 推导个人配置。默认 HOST=127.0.0.1、PORT=5000、APP_BASE_URL 为同端口回环 origin、APP_DATA_DIR=./data。local 模式要求回环；远程 password 模式要求至少12字符 OWNER_PASSWORD 和公开 HTTPS origin。

Qwen 默认模型为 qwen-audio-3.1-tts-flash，Gemini 默认为 google/gemini-3.1-flash-tts-preview；AI_TTS_MODEL 可选择当前语音provider的兼容HTTP合成模型，保留音色/音频/临时URL安全校验，Qwen的Gemini失败回退仍用默认Gemini模型。AI_CHAT_MODEL、AI_VISION_MODEL、AI_IMAGE_MODEL、AI_EMBEDDING_MODEL 同样允许选择现有提供商的兼容模型；上传审核默认独立于聊天模型。MaaS 默认 TTS endpoint=https://maas.qianwenaiapi.com/api/v1，embedding=https://maas.qianwenaiapi.com/compatible-mode/v1。更换平台时 key 与两条 endpoint 配套，不假定不同平台 key 互通。SQLite 向量验证实际模型、维度、内容版本，不混用向量空间。

E2E_MOCK_PROVIDERS=1 仅允许 APP_ENV=test 且所有真实凭据为空。mock hybrid 使用假向量无需真实 key，mock auto 无 key 仍为 keyword。测试使用独立临时 APP_DATA_DIR。

## 业务约束

聊天与审核显式关闭 thinking；后台整理器显式开启 thinking+reasoningEffort=low，不发送无效 temperature。SSE 保留 user_message/chunk/done/error、PHOTO holdback 和断开后的有界保存。只有含非空用户文本的回复原子保存 organizer job；开场白与纯图片回复不伪造文本来源。

图片参数按模型构造：GPT Image 2 使用 quality/aspect_ratio，不发送 Gemini resolution；内置Gemini 使用1K resolution、n=1；其他图像ID使用公共参数与上游默认画质，不盲发quality/resolution。参考图固定活动伴侣身份/比例 PNG，stale appearance 返回409。服装保持参考图，只有明确场景才改变；内容边界由 prompt/审核实施。

VOICE_OPTIONS 共25个公开代号，按性别过滤，中文在前。客户端不得导入上游目录/映射或回显原始 slug。Qwen 发送服务端映射的音色；临时 OSS URL 仅允许配置的 host suffix，立即下载 bytes。Qwen 失败且 OpenRouter 已配置时回退同性别 Gemini 兼容音色。Gemini-only 不产生25种独立声线，设置页需说明兼容模式。PCM 在 adapter 内封装 WAV。

TTS 只由用户点击触发，无商业配额/会员判断。归属、音色、缓存与 regenerate 语义保持稳定；key 使用公开 voice code，换声只重写当前 audio_url，不删旧媒体。preview 限120字，不写消息；未知旧音色显示中性占位。

## 验证

运行 pnpm test:unit、pnpm ts-check、pnpm lint、pnpm build；独立 code/spec review 通过后由专门成员做 E2E。真实付费探针遵循 docs/runbooks/ai-provider-live-canaries.md。mock 不证明账户模型权限、声线质量、云策略或邮件到达。本次实施不连接原项目数据库或调用真实付费服务。
