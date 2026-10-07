# 个人版环境变量与启动指南

已批准并按当前个人版实现更新。实际入口：[项目README](../../README.md)。环境模板是 `.env.example` 和 `.env.advanced.example`；parser唯一入口是 `src/lib/config/runtime.ts`，app/worker/脚本共用 `loadScriptEnv()`。

## 从干净目录启动

安装Node.js 24 LTS、pnpm9，执行：

```sh
pnpm install --frozen-lockfile
pnpm run setup
# 编辑 .env.local，填写自己的 DEEPSEEK_API_KEY
pnpm run doctor
pnpm dev
```

打开 `http://127.0.0.1:5000`。setup不覆盖现有环境文件；不要用pnpm内置的 `pnpm setup` 代替项目脚本。SQLite、私有媒体和签名密钥由首次启动初始化，owner固定为本实例主人，不注册账号。首次引导确认个人时区，无法检测时回退Asia/Shanghai，之后可以修改。

不要沿用商业副本的生产环境文件。先使用安全模板，再逐项填写自己的key。旧的Supabase、PG、Mem0、支付和验证码凭据不再参与数据/鉴权或权益判断，也不需要获取。

## 需要收集的秘密

| 功能 | 收集项 | 获取方式 / 缺失时行为 |
|---|---|---|
| 基础聊天、捏人完善、图片审核、关键词记忆、站内来信 | `DEEPSEEK_API_KEY` | [DeepSeek个人API key](https://platform.deepseek.com/api_keys)；缺失doctor非零，聊天显示未配置，不伪造成功 |
| 照片 / Gemini语音 | `OPENROUTER_API_KEY` | [OpenRouter个人API key](https://openrouter.ai/settings/keys)；缺失不阻止文字聊天 |
| 千问语音 / 混合向量检索 | `DASHSCOPE_API_KEY` | 按[千问AI平台获取API Key](https://platform.qianwenai.com/docs/api-reference/preparation/api-key)创建自己的通用按量key；须有TTS和embedding模型权限并配对正确endpoint |
| SMTP可选转发 | `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`EMAIL_FROM` | 自己邮箱商提供的SMTP资料及应用专用密码；设置 `EMAIL_PROVIDER=smtp`、`LETTER_DELIVERY=both` |
| Resend可选转发 | `RESEND_API_KEY`、`EMAIL_FROM` | 自己的Resend账户和验证发信域；设置 `EMAIL_PROVIDER=resend`、`LETTER_DELIVERY=both` |
| 个人远程访问 | `OWNER_PASSWORD` | 自设不少于12字符的密码；设置password模式及自己的HTTPS origin |

最小外部秘密只有DeepSeek key。三把AI key启用照片、千问语音和向量混合检索；自己承担所选供应商的用量费用，应用没有商品或会员状态。

收件地址保存在站内偏好设置，不放 `EMAIL_TO`。服务端只能给主人保存的固定地址转发，不接受任意To请求。本版不读取外部收件箱，也不把邮件内容作为AI指令入口。

## 非秘密配置与默认值

| 变量 | 默认 / 合法值 | 校验与用途 |
|---|---|---|
| `HOST` | `127.0.0.1` | local模式仅允许回环；容器/反代可在password模式监听0.0.0.0 |
| `PORT` | `5000` | 1–65535整数；更改后自动派生默认本机URL |
| `APP_BASE_URL` | `http://127.0.0.1:<PORT>` | 纯http(s) origin，无路径/查询/凭据；local端口须匹配；远程须HTTPS |
| `APP_DATA_DIR` | `./data` | 相对项目根目录或自选绝对持久目录；不可共享给第二实例 |
| `APP_ACCESS_MODE` | `local` / `password` | local免账号只用于本机；password有cookie、限速、Host/Origin保护 |
| `MEMORY_RETRIEVAL_MODE` | `auto` / `keyword` / `hybrid` | auto无向量key用keyword，有key用hybrid；显式hybrid缺key拒绝 |
| `EMAIL_PROVIDER` | `none` / `smtp` / `resend` | 不按“碰巧有key”自动发邮件 |
| `LETTER_DELIVERY` | `in-app` / `both` / `email` | 默认站内；both/email仍保留持久站内副本 |
| `OBJECT_STORAGE_PROVIDER` | `local` / `r2` | 默认私有本地媒体，在development/production均可用；不自动切R2 |
| `APP_ENV` | development/test/preview/production | 未指定时按NODE_ENV推导，测试另有严格mock凭据护栏 |

空白和模板占位key视为未配置。未知枚举或无效监听/公开origin不会静默默认。可选邮件配置冲突使doctor非零并禁外发，应用仍保护聊天与已有站内信可读。

## AI provider配对与模型

| 变量 | 默认 |
|---|---|
| `AI_CHAT_PROVIDER` / `AI_VISION_PROVIDER` | `deepseek` |
| `AI_CHAT_MODEL` / `AI_VISION_MODEL` | 各自默认 `deepseek-flash`；聊天与上传审核独立 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `AI_IMAGE_PROVIDER` | `openrouter` |
| `AI_IMAGE_MODEL` | `openai/gpt-image-2` |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| `AI_TTS_PROVIDER` | 有千问key选qwen-audio；只有OpenRouter选openrouter-gemini；无key能力未配置 |
| `AI_TTS_MODEL` | Qwen为`qwen-audio-3.1-tts-flash`，Gemini为`google/gemini-3.1-flash-tts-preview` |
| `DASHSCOPE_TTS_BASE_URL` | `https://maas.qianwenaiapi.com/api/v1` |
| `DASHSCOPE_EMBEDDING_BASE_URL` | `https://maas.qianwenaiapi.com/compatible-mode/v1` |
| `DASHSCOPE_AUDIO_HOST_SUFFIX` | `.aliyuncs.com`，临时音频下载的HTTPS主机白名单 |
| `AI_EMBEDDING_PROVIDER` | `dashscope`，1024维，单批≤10 |

推荐profile两条端点对应同一千问AI平台key。阿里云百炼的账户/地区/key不自动等同，改用其他profile时须提供它对应的地址并验证权限。doctor能校验配置结构与模型ID格式，不证明云账户模型权限或费用。没有implicit MiniMax后备。两把语音key都有时Qwen失败才回退Gemini，按性别兼容音色，回退会换声；只有Qwen时无未配置后备请求。

### 同一提供商内切换模型

`AI_CHAT_MODEL`、`AI_VISION_MODEL`、`AI_IMAGE_MODEL`、`AI_TTS_MODEL`、`AI_EMBEDDING_MODEL` 都是可选的模型ID，不是密钥。Embedding模型默认 `text-embedding-v4`。只更改对应变量并重启，不改变provider、key和endpoint；新增云端模型权限可能需要供应商账户设置。模型ID来自自己的供应商目录，非空、无空白且不超过200字符。格式通过不代表模型可用。

聊天模型要兼容Chat Completions流式、JSON、thinking设置；图片聊天还需要多模态能力。`AI_VISION_MODEL`独立控制上传安全审核，默认不随聊天模型变化。图像模型须兼容OpenRouter `/images`、参考图与PNG/JPEG/WebP输出；两个内置模型保留GPT的quality或Gemini的resolution，其他ID不发送这两个特有参数，采用上游默认画质。TTS模型必须兼容当前语音provider的请求、音色与音频格式；不能将实时/WebSocket/自定义音色模型ID直接当作现有HTTP合成模型使用。`AI_TTS_MODEL`只作用于主链路，Qwen的Gemini回退仍用默认模型。原语音缓存不会自动重生成，新消息使用新模型。

Embedding须接受 `/embeddings`、`dimensions=1024`、`encoding_format=float`。chat与worker使用同一个配置模型命名空间，召回只比较同模型/维度/正文版本向量。切换后后台有界补建已有记忆的新向量，旧facts/FTS不删除；关键词召回继续，补建产生API用量。新模型不可用时可恢复原ID或用keyword模式，不需要删除data或重置库。

英文快速上手见 [README.en.md](../../README.en.md)，中文步骤见 [README.md](../../README.md)。

## 站内信与可选邮箱转发

默认 `EMAIL_PROVIDER=none`、`LETTER_DELIVERY=in-app`，无需邮箱env。主人在伴侣设置里主动开站内来信，按个人时区每天全实例最多一封。网页与worker由dev/start共同启动和监督，电脑休眠期间不实时生成；恢复只评估当天，不连发历史队列。

SMTP端口465使用隐式TLS，587强制STARTTLS；不提供关闭证书校验选项。用户名/应用密码由自己的邮箱商给出。`EMAIL_REPLY_TO`可选，缺省使用EMAIL_FROM；它指向主人自己的邮箱，不建立外部收信处理链。Resend可选回执需 `RESEND_WEBHOOK_SECRET`，且provider=resend时才启用验签endpoint。

服务器accepted仅表示接受提交，不是已到收件箱。提交后断线/租约失去结果的unknown不自动重发。bounced/complained或签名POST退订只关闭邮箱转发，站内生成独立。GET退订只是确认页面，邮件扫描器不能改偏好；恢复邮箱转发需要主人明确确认。

`LETTER_PUBLIC_BASE_URL`可选；一旦填写，必须是与APP_BASE_URL相同的公开HTTPS origin。不可填写本机HTTP地址、另一个域名或生产项目域名。本机配置不生成假公网退订/回站链接，通过站内设置停收。若需要从邮箱使用公开退订链接，显式配置自己同源HTTPS地址。

显式R2需要 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_ENDPOINT`、`R2_BUCKET_NAME`、`R2_PUBLIC_URL`。这是可选云对象profile，其公开URL/存储权限由自己的bucket政策决定；默认本地媒体有owner访问检查与音频Range。

## 环境加载、检查与维护

Shell变量优先于文件；文件优先级从高到低：`.env.<NODE_ENV>.local`、`.env.local`（test跳过）、`.env.<NODE_ENV>`、`.env`。脚本和worker采用同一规则，不输出secret值。

`pnpm run doctor`默认离线，检查配置、目录可读写、Node/native SQLite/FTS5、已有库版本和完整性。它不会调用付费AI或外发邮件。命名live canary必须额外显式请求：`pnpm run doctor --live --provider deepseek|image|qwen-tts|gemini-tts`，并填写运行手册的确认、精确请求数与费用上限；没有这些项就拒绝分发。没有自动批量外发检查。

生产执行 `pnpm build`、`pnpm start`。Docker示例默认password，容器内部0.0.0.0，宿主只映射127.0.0.1。远程用自己的HTTPS反代，公开端口与内部5000相互独立。Node24有原生SQLite依赖，各系统安装/启动证据单独记录，CI存在不代表已经运行。

```sh
pnpm data:backup
# 停应用后显式升级旧版库，先备份再迁移
pnpm data:migrate
# 恢复到新建且尚不存在的目录，不覆盖现有数据
pnpm data:restore /absolute/backup-directory /absolute/new-data-directory
```

备份必须有已初始化的有效数据库；使用SQLite backup API含WAL状态，并协调暂停新写/等在途完成，再复制媒体和必要密钥、生成hash manifest。恢复验证版本、哈希和数据库完整性。实例/维护锁不随备份恢复。旧备份可能恢复之后已删除的内容；备份由主人妥善保管。没有隐式db reset或向远端数据库迁移。

启动与 data:migrate 共用版本2的PID/token锁，记录 supervisor 及实际 worker、web wrapper、Next server 子进程。每个写入进程在数据库/外部调用前自行登记；父进程死亡或token变化后，持续守卫终止旧进程，外部调用返回后的提交仍重新校验。只要任一登记进程仍活着，即使父进程已死，第二实例与迁移也会拒绝；等待全部旧进程退出后才可安全回收锁。迁移全程持有自己的锁；确认所有写入进程离线后，备份无需等待遗留任务lease超时，任务状态仍保留在备份中。

旧版只有 `{pid,token}` 而没有子进程清单的死PID锁、格式损坏的锁或不完整的恢复锁目录不会自动删除，因为不能据此证明所有写入者离线。恢复步骤：先停止该实例的 supervisor、worker、web wrapper、Next server 及其tsx/Node启动进程，检查没有仍使用该数据目录的进程；保留整个数据目录副本；再把 `private/instance.json`（若报错指向 `private/instance-recovery.lock`，也保留并移出该目录）移动到数据目录之外，随后运行 `pnpm data:migrate` 或重新启动。不要删除数据库、媒体、私有密钥或整个数据目录来解决锁错误。
