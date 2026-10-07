# Deep Whisper · 个人开源版

简体中文 | [English](README.en.md)

Deep Whisper 是一款 AI 伴侣聊天产品：选择喜欢的角色，定制名字、性格和称呼，与 TA 聊天、听语音、收照片，让共同的经历成为长期记忆。

这是 Deep Whisper 的**个人自托管开源版本**。您可以在自己的电脑上运行，聊天记录、记忆、图片和音频保存在自己的数据目录。一个安装实例对应一位主人，可以保留多个伴侣和会话。

想先看看产品？访问 **[Deep Whisper 线上版本](https://www.deepwhisperai.com)**。

本版使用 Next.js、React、TypeScript 和 SQLite。AI 能力通过您自己的云服务 API key 调用；聊天和生成内容仍需要网络。本地使用无需注册项目账号、配置 Supabase 或安装 PostgreSQL，也没有项目会员购买流程。

## 能玩什么

- **聊天**：流式回复，可定制伴侣名字、称呼、职业和性格。
- **角色与装扮**：8 个角色、Q 版和正常比例形象，可选择壁纸及梦幻玫瑰／梦幻蓝风格。
- **语音**：点击助手消息下方的朗读按钮生成并播放；默认推荐千问，可选择音色。
- **照片与发图**：向伴侣明确索要照片，或上传图片一起聊。
- **长期记忆**：同一伴侣在新会话中仍能使用之前整理的记忆；默认关键词检索，也支持可选向量检索。
- **伴侣来信**：在设置里主动开启后，来信保存在站内；邮箱转发可选。
- **中英文界面**：可在聊天页切换语言。

## 第一步：准备运行工具

您需要 **Node.js 24 LTS** 和 **pnpm 9**。下载代码可以用 Git，也可以直接下载 ZIP。

1. 在 [Node.js 官网](https://nodejs.org/en/download)选择 **24 LTS**，下载对应操作系统的安装程序并安装。项目要求 Node 24，请不要用 Node 26。
2. 打开终端：macOS 用“终端”，Windows 用 PowerShell，Linux 用终端。安装 pnpm：

   ```sh
   npm install --global pnpm@9.0.0
   ```

   这条命令仅安装 pnpm 工具，项目依赖统一用 pnpm 安装。

3. 确认版本：

   ```sh
   node --version
   pnpm --version
   ```

   应分别看到 `v24.x.x` 和 `9.x.x`。安装后找不到命令时，关闭并重新打开终端。

**SQLite 不需要单独安装。** `pnpm install` 会安装项目使用的 SQLite 驱动，首次启动自动创建数据库、表和全文检索索引。无需手动下载数据库文件、执行建表 SQL 或启动数据库服务。

## 第二步：下载代码、安装依赖

如果已经安装 [Git](https://git-scm.com/downloads)，执行：

```sh
git clone https://github.com/WilliamShi666/Deep-Whisper.git
cd Deep-Whisper
pnpm install --frozen-lockfile
pnpm run setup
```

也可以在本仓库页面点击 **Code → Download ZIP**，解压后在终端进入解压目录，再执行最后两条命令。

`pnpm run setup` 会生成 `.env.local` 和 `data/` 目录；已有 `.env.local` 不会被覆盖。请使用完整的 **`pnpm run setup`**，不要用 pnpm 自带的 `pnpm setup` 代替它。

以下命令均在项目目录中执行，也就是包含 `package.json` 的目录。

## 第三步：填写环境变量

环境变量就是应用读取的配置。请用纯文本编辑器打开根目录的 **`.env.local`**，在等号后填写自己的 API key。

不要修改 `.env.example`：它是空白模板。也不要把文件保存成 `.env.local.txt`。macOS 可执行 `open -e .env.local`，Windows 可执行 `notepad .env.local`。

### 最小配置：先把聊天跑起来

只必须填写一项：

```dotenv
DEEPSEEK_API_KEY=your-deepseek-api-key
```

在 [DeepSeek API 平台](https://platform.deepseek.com/api_keys)创建 API key，替换上面的示例文字。其余模板值先保持不变。

这就可以使用文字聊天、人格定制、图片理解与审核、关键词长期记忆和站内来信。DeepSeek 的聊天网站账号不能代替 API key；请确认 API 账户可以调用模型。模型调用由您自己的供应商账户承担用量费用。

### 可选配置：照片、千问语音和向量记忆

| 环境变量 | 是否必须 | 能开启什么 | 从哪里获取 |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | **必须** | 聊天、图片理解、安全审核、记忆整理 | [DeepSeek API keys](https://platform.deepseek.com/api_keys) |
| `OPENROUTER_API_KEY` | 可选 | 生成伴侣照片、Gemini 语音 | [OpenRouter API keys](https://openrouter.ai/settings/keys) |
| `DASHSCOPE_API_KEY` | 可选 | 千问语音、向量检索 | [千问 AI 平台 API key 指南](https://platform.qianwenai.com/docs/api-reference/preparation/api-key) |

想使用三类 AI 功能，在同一个 `.env.local` 中填写：

```dotenv
DEEPSEEK_API_KEY=your-deepseek-api-key
OPENROUTER_API_KEY=your-openrouter-api-key
DASHSCOPE_API_KEY=your-qianwen-api-key
```

示例文字不是有效密钥，必须替换。没有填写可选 key 不影响文字聊天；对应功能会提示未配置。不要把真实 key、`.env.local` 或 `data/` 上传到 GitHub。

**语音怎么选？** 填了千问 key 就优先使用千问 `qwen-audio-3.1-tts-flash`；同时填了 OpenRouter key 时，千问调用失败会回退 Gemini，回退时声音会变化。只填 OpenRouter 时使用 Gemini，均未填写时仍可文字聊天。

**长期记忆是否必须用向量？** 不必。模板中的 `MEMORY_RETRIEVAL_MODE=auto` 会在没有千问 key 时使用 SQLite FTS5/BM25 关键词检索，有千问 key 时启用混合检索。向量模型默认为 `text-embedding-v4`，维度为 1024；应用后台负责保存和补建向量，无需安装向量数据库。

如果想使用千问语音，但暂时不开向量检索，可以改为：

```dotenv
MEMORY_RETRIEVAL_MODE=keyword
```

关键词模式同样支持长期记忆。确认向量接口可用后，改回 `auto` 或使用 `hybrid`，然后重启应用。

千问默认端点是一组配对配置：

```dotenv
# 仅在需要明确指定端点时加入 .env.local
DASHSCOPE_TTS_BASE_URL=https://maas.qianwenaiapi.com/api/v1
DASHSCOPE_EMBEDDING_BASE_URL=https://maas.qianwenaiapi.com/compatible-mode/v1
```

这些地址对应千问 AI 平台的 key。阿里云百炼的账户、地区和 key 不自动等同于这个配置；使用其他平台配置时，需要填写它对应的端点并确认模型权限。不要只换网址而继续使用不匹配的 key。

### 可选：不换提供商，只切换模型

在 `.env.local` 中添加或修改下面的模型 ID，保存后重启应用。不填时继续使用默认模型，不需要为切换模型另换 API key、提供商或地址；但账户必须有该模型的调用权限。

| 变量 | 默认值 | 用途 |
|---|---|---|
| `AI_CHAT_MODEL` | `deepseek-flash` | DeepSeek 对话、人格完善、记忆整理及来信 |
| `AI_VISION_MODEL` | `deepseek-flash`，独立于聊天模型 | DeepSeek 上传图片安全审核 |
| `AI_IMAGE_MODEL` | `openai/gpt-image-2` | OpenRouter 生图 |
| `AI_TTS_MODEL` | 千问：`qwen-audio-3.1-tts-flash`；Gemini：`google/gemini-3.1-flash-tts-preview` | 当前语音提供商的主模型 |
| `AI_EMBEDDING_MODEL` | `text-embedding-v4` | 千问/DashScope 混合记忆检索 |

例如，使用千问语音时，可以明确填写默认模型：

```dotenv
AI_CHAT_MODEL=deepseek-flash
AI_VISION_MODEL=deepseek-flash
AI_IMAGE_MODEL=openai/gpt-image-2
AI_TTS_MODEL=qwen-audio-3.1-tts-flash
AI_EMBEDDING_MODEL=text-embedding-v4
```

想切换某一项，就把它的值替换为供应商提供的完整模型 ID。只用 OpenRouter 语音时，`AI_TTS_MODEL` 要填兼容的 Gemini 语音模型，不能照抄千问值。千问失败时的 Gemini 后备仍使用默认 Gemini 模型。OpenRouter ID 通常带 `openai/` 或 `google/` 等前缀。

模型需要兼容当前接口：

- **对话**：支持流式 Chat Completions、JSON 输出和项目使用的 thinking 设置；图片聊天还要求聊天模型支持图片。上传审核独立使用 `AI_VISION_MODEL`，该模型必须支持图片和结构化审核。
- **生图**：支持 OpenRouter `/images` 的参考图输入，返回 PNG/JPEG/WebP 字节。两个内置模型保留各自的 `quality` 或 `resolution` 参数；其他模型使用公共参数和上游默认画质。可用 ID 与能力可在 [OpenRouter 图片 API 文档](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)查看。
- **语音**：千问模型须兼容现有合成接口、允许的音频下载主机及项目音色；Gemini 模型须兼容 OpenRouter `/audio/speech`、现有音色和音频格式。音色与模型是两个配置，切换模型不会新增音色目录。
- **Embedding**：须支持当前 `/embeddings` 接口、`dimensions=1024` 和浮点输出。切换后，后台会为已有记忆补建新模型的向量；不删除记忆正文，关键词检索继续可用，旧模型向量不会和新模型向量混用。补建会产生供应商用量。

`doctor` 只检查本地配置，不查询云端模型目录或验证账户权限。若模型不兼容或未开通，恢复原模型值并重启。**已有消息的语音缓存保持不变**；切换语音模型后请用新消息测试；若同时更换了音色，可使用“用新音色重新生成”入口。详细配置见 [环境变量指南](docs/opensource/04-environment.md)。

### 其他配置：初次使用保持默认即可

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `HOST` | `127.0.0.1` | 只在本机监听 |
| `PORT` | `5000` | 网页端口 |
| `APP_DATA_DIR` | `./data` | 数据库、私有图片、语音及签名密钥保存位置 |
| `APP_ACCESS_MODE` | `local` | 本机免登录模式 |
| `MEMORY_RETRIEVAL_MODE` | `auto` | 自动选择关键词或混合检索 |
| `EMAIL_PROVIDER` | `none` | 默认不转发到外部邮箱 |
| `LETTER_DELIVERY` | `in-app` | 默认站内来信 |

不需要填写 Supabase、PostgreSQL、Mem0、支付平台或验证码环境变量。高级选项见 [.env.advanced.example](.env.advanced.example) 和 [完整环境变量指南](docs/opensource/04-environment.md)。

## 第四步：检查并启动

保存 `.env.local` 后，执行：

```sh
pnpm run doctor
pnpm dev
```

`doctor` 检查 Node、配置、SQLite/FTS5 和数据目录。成功时命令退出且没有报错；缺少必填 key 会提示具体名称。它不调用付费 AI，不能证明网络连通或云账户模型权限。

看到服务启动后，用浏览器打开 **[http://127.0.0.1:5000](http://127.0.0.1:5000)**。运行时保持这个终端窗口打开；停止时在终端按 **Ctrl+C**。下次启动只需进入项目目录执行 `pnpm dev`，不用重新安装依赖或重新配置。

网页与记忆／来信后台 worker 由一条命令一起启动，不需要再开第二个终端。修改环境变量后，先 Ctrl+C 停止，再重新启动。

## 第五步：开始和 TA 聊天

1. 首次进入，按引导选择性别、取向、角色和形象比例，填写伴侣名字、性格、称呼，并确认自己的时区。
2. 进入聊天页，发一句“你好，今天想和你聊聊”，观察回复逐字出现。
3. 填了语音 key 后，点击助手消息下方的**朗读按钮**。语音按点击生成，不会自动播放；可在伴侣设置里换音色。
4. 填了 OpenRouter key 后，明确说“拍一张你在窗边的自拍给我”，等待照片生成并出现在聊天里。
5. 试试记忆：“我喝茶不加糖，平时喜欢桂花乌龙，请记住。”等后台整理完成后，给**同一个伴侣**开启新话题，问“你记得我的喝茶习惯吗？”记忆整理异步进行，不保证发完消息后立即完成。
6. 打开聊天装扮或伴侣设置，调整壁纸、配色、人格、音色和来信偏好。换伴侣会保留原伴侣与旧会话；记忆按伴侣隔离。

数据保存在本实例，刷新页面、换浏览器或重启电脑后可继续使用。换电脑则需要迁移数据目录或备份；这不是云端跨设备账户同步。

## 邮件可以先不配置

默认来信留在站内；在伴侣设置里主动开启即可，无需邮箱 key。应用运行时才会处理后台任务，电脑休眠或关机时不会持续生成来信。

想把来信转发到自己的邮箱，可以选择 **SMTP** 或 **Resend**：

| 方式 | 需要填写的变量 |
|---|---|
| SMTP | `EMAIL_PROVIDER=smtp`、`LETTER_DELIVERY=both`、`EMAIL_FROM`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD` |
| Resend | `EMAIL_PROVIDER=resend`、`LETTER_DELIVERY=both`、`EMAIL_FROM`、`RESEND_API_KEY` |

SMTP 参数和应用专用密码由自己的邮箱服务商提供；465 使用隐式 TLS，587 使用 STARTTLS。Resend 需要自己的账户和已验证发信域名。**收件地址在应用设置中保存，不用填写 `EMAIL_TO`。** 本版不读取外部收件箱；服务端接受发送不等于邮件已经进入收件箱。详细示例见 [环境变量指南](docs/opensource/04-environment.md)。

## 常见问题

| 遇到的情况 | 处理方法 |
|---|---|
| `pnpm` 或 `node` 找不到 | 确认已安装，重新打开终端，再检查版本。 |
| 找不到 `package.json` | 先 `cd Deep-Whisper`，ZIP 下载者进入解压后的项目目录。 |
| `doctor` 提示缺少 `DEEPSEEK_API_KEY` | 检查是否填写在根目录 `.env.local`，文件名没有多余 `.txt`，值不是示例文字。 |
| 语音或照片提示“未配置” | 补齐对应可选 key，保存后重启。 |
| AI 请求超时或连接失败 | 检查运行应用的电脑／终端能否连接该供应商端点；浏览器能上网不等于 Node 请求走同一代理。查看终端错误和账户模型权限；不要把密钥贴到 issue。 |
| 千问语音／Embedding 连不上 | 核对 key 与配对端点、终端网络。向量暂不可用时设置 `MEMORY_RETRIEVAL_MODE=keyword`；文字聊天和关键词记忆仍可使用。 |
| `EADDRINUSE`／5000 被占用 | 停止旧实例，或把 `.env.local` 的 `PORT` 改为 `5001` 后重启，打开 `http://127.0.0.1:5001`。通常不用额外填写 `APP_BASE_URL`。 |
| SQLite 原生模块版本不兼容／`NODE_MODULE_VERSION` | 确认当前终端是 Node 24，再执行 `pnpm rebuild better-sqlite3` 和 `pnpm run doctor`。不要删除 `data/` 来解决依赖问题。 |
| 安装提示 `gyp`、编译器或 Python 缺失 | SQLite 驱动未能使用预编译包时需要本机编译工具，见下方说明。 |
| 实例锁报错 | 先停止之前启动的应用，确认进程退出。保留数据，按 [实例锁恢复指南](docs/opensource/04-environment.md#环境加载检查与维护)处理；不要删除整个数据目录。 |

原生依赖编译问题可参考 [better-sqlite3 官方排障文档](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md)。macOS 可安装 Command Line Tools（`xcode-select --install`）；Windows 安装 Python 及 Visual Studio Build Tools 的 C++ 构建工具；Debian/Ubuntu 安装 Python 3、`make`、`g++`。工具准备好后重新执行 `pnpm install --frozen-lockfile`。普通使用者先尝试标准安装流程，只有出现编译错误时才需要这些工具。

## 长期运行、备份与远程访问

想使用正式构建，在停止开发服务后执行：

```sh
pnpm build
pnpm start
```

备份命令：

```sh
pnpm data:backup
```

它会保存数据库、媒体和必要密钥，并显示备份路径。请妥善保管整个备份目录。数据库默认位于 `data/deep-whisper.sqlite`；不要只复制正在使用的 SQLite 主文件，也不要让两个独立实例同时共享同一个 `data/`。

默认仅供本机使用。个人远程访问需配置 `APP_ACCESS_MODE=password`、至少 12 字符的 `OWNER_PASSWORD`、自己的 HTTPS `APP_BASE_URL` 和反向代理。Docker 示例见 [compose.yaml](compose.yaml)，同样需要密码配置。完整远程、Docker、迁移和恢复步骤见 [环境变量指南](docs/opensource/04-environment.md)。

## 开发与许可证

制作计划、架构、Spec 和接口契约见 [项目文档](docs/opensource/README.md)。开发检查可执行：

```sh
pnpm test:unit
pnpm ts-check
pnpm lint
```

默认测试使用临时 SQLite 和模拟外部服务，不调用真实 AI 或发送真实邮件。真实供应商能力和不同操作系统需要分别验证。

代码和项目文档采用 [MIT](LICENSE)。角色插画、壁纸、音色样本和品牌的授权单独说明，见 [ASSETS.md](ASSETS.md)。
