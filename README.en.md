# Deep Whisper · Personal Open Source Edition

[简体中文](README.md) | English

Deep Whisper is an AI companion chat product. Choose a character, customize their name, personality and how they address you, then chat, listen to their voice and receive photos. Your shared experiences can become long-term memories.

This is the **personal, self-hosted open source edition** of Deep Whisper. Run it on your own computer, with conversations, memories, images and audio stored in your own data directory. One installation belongs to one owner and can keep multiple companions and conversations.

Want to see the product first? Visit **[Deep Whisper online](https://www.deepwhisperai.com)**.

This edition uses Next.js, React, TypeScript and SQLite. AI features use your own cloud service API keys, so chat and generated content still need an internet connection. Local use requires no project account, Supabase configuration or PostgreSQL installation, and has no project membership purchase flow.

## What you can do

- **Chat:** receive streaming replies and customize your companion's name, occupation, personality and nickname for you.
- **Characters and appearance:** choose from 8 characters, chibi or standard proportions, wallpapers, and rose or blue visual styles.
- **Voice:** click the read-aloud button below an assistant message to generate and play audio. Qwen is the recommended default, with selectable voices.
- **Photos and image sharing:** explicitly ask your companion for a photo, or upload an image to discuss together.
- **Long-term memory:** the same companion can use memories from earlier conversations in a new conversation. Keyword search works without embeddings; optional vector search is also available.
- **Companion letters:** enable them in settings to receive letters inside the app. Forwarding to your email address is optional.
- **Chinese and English interface:** switch languages from the chat page.

## Step 1: Install the tools

You need **Node.js 24 LTS** and **pnpm 9**. You can download the code with Git or as a ZIP file.

1. Visit the [Node.js download page](https://nodejs.org/en/download), select **24 LTS**, and install the version for your operating system. This project requires Node 24; do not use Node 26.
2. Open Terminal on macOS or Linux, or PowerShell on Windows. Install pnpm:

   ```sh
   npm install --global pnpm@9.0.0
   ```

   This command installs the pnpm tool only. Use pnpm for the project's dependencies.

3. Check the versions:

   ```sh
   node --version
   pnpm --version
   ```

   You should see `v24.x.x` and `9.x.x`. If a command is unavailable after installation, close and reopen your terminal.

**You do not need to install SQLite separately.** `pnpm install` installs the SQLite driver. The first startup creates the database, tables and full-text search indexes automatically. You do not need a database server, a downloaded database file or manual SQL commands.

## Step 2: Download the code and install dependencies

If you have [Git](https://git-scm.com/downloads), run:

```sh
git clone https://github.com/WilliamShi666/Deep-Whisper.git
cd Deep-Whisper
pnpm install --frozen-lockfile
pnpm run setup
```

Alternatively, click **Code → Download ZIP** on this repository, extract the archive, open a terminal in the extracted project directory, then run the last two commands above.

`pnpm run setup` creates `.env.local` and the `data/` directory. It preserves an existing `.env.local`. Use the full command **`pnpm run setup`**, not pnpm's own `pnpm setup` command.

Run all subsequent commands from the project directory containing `package.json`.

## Step 3: Fill in your environment variables

Environment variables are settings read by the application. Open **`.env.local`** in the project root with a plain-text editor and place your own API keys after the equals signs.

Do not edit `.env.example`; it is a blank template. Make sure your editor does not save the file as `.env.local.txt`. On macOS you can run `open -e .env.local`; on Windows, `notepad .env.local`.

### Minimum configuration: start with chat

Only one key is required:

```dotenv
DEEPSEEK_API_KEY=your-deepseek-api-key
```

Create an API key on the [DeepSeek API platform](https://platform.deepseek.com/api_keys) and replace the example text above. Keep the other template settings unchanged initially.

This enables text chat, personality customization, image understanding and moderation, keyword-based long-term memory, and letters inside the app. A DeepSeek chat website account is not a substitute for an API key. Check that your API account has access to the configured model. Your own provider account pays for API usage.

### Optional keys: photos, Qwen voice and vector memory

| Variable | Required? | Enables | Where to get it |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | **Required** | Chat, image understanding, moderation and memory organization | [DeepSeek API keys](https://platform.deepseek.com/api_keys) |
| `OPENROUTER_API_KEY` | Optional | Companion photos and Gemini voice | [OpenRouter API keys](https://openrouter.ai/settings/keys) |
| `DASHSCOPE_API_KEY` | Optional | Qwen voice and vector retrieval | [Qianwen AI platform API key guide](https://platform.qianwenai.com/docs/api-reference/preparation/api-key) |

To use all three AI services, fill in the same `.env.local`:

```dotenv
DEEPSEEK_API_KEY=your-deepseek-api-key
OPENROUTER_API_KEY=your-openrouter-api-key
DASHSCOPE_API_KEY=your-qianwen-api-key
```

The example strings are placeholders, not valid keys. Replace them with your own. Missing optional keys do not prevent text chat; the corresponding feature will show that it is unconfigured. Do not upload real keys, `.env.local` or `data/` to GitHub.

**Which voice service is used?** With a Qwen key, the application prioritizes Qwen `qwen-audio-3.1-tts-flash`. If an OpenRouter key is also present, a failed Qwen request falls back to Gemini, which changes the voice. With only an OpenRouter key, it uses Gemini. With neither key, text chat still works.

**Does long-term memory require vectors?** No. The template's `MEMORY_RETRIEVAL_MODE=auto` uses SQLite FTS5/BM25 keyword search without a Qwen key, and hybrid search with one. The default embedding model is `text-embedding-v4`, with 1024 dimensions. Background tasks save and build vectors; you do not need a separate vector database.

To use Qwen voice while keeping memory retrieval on keywords, set:

```dotenv
MEMORY_RETRIEVAL_MODE=keyword
```

Keyword mode still supports long-term memory. After confirming that your embedding endpoint is accessible, change this back to `auto` or use `hybrid`, then restart the application.

The default Qwen endpoints are a matched pair:

```dotenv
# Add these only if you need to specify the endpoints explicitly.
DASHSCOPE_TTS_BASE_URL=https://maas.qianwenaiapi.com/api/v1
DASHSCOPE_EMBEDDING_BASE_URL=https://maas.qianwenaiapi.com/compatible-mode/v1
```

These addresses use Qianwen AI platform keys. Alibaba Cloud Model Studio accounts, regions and keys are not automatically interchangeable with this profile. For a different platform profile, configure its matching endpoints and check model access. Changing only the URL while keeping an incompatible key will not work.

### Optional: switch models while keeping the same providers

You can set model IDs in `.env.local` without changing providers, API keys or endpoints. Omit these variables to use the defaults. Use the exact model ID offered by your current provider and accessible to your API account.

| Variable | Default | Service and purpose |
|---|---|---|
| `AI_CHAT_MODEL` | `deepseek-flash` | DeepSeek chat, personality refinement, memory organization and letters |
| `AI_VISION_MODEL` | `deepseek-flash` (independent of chat) | DeepSeek upload moderation |
| `AI_IMAGE_MODEL` | `openai/gpt-image-2` | OpenRouter photo generation |
| `AI_TTS_MODEL` | `qwen-audio-3.1-tts-flash` for Qwen; `google/gemini-3.1-flash-tts-preview` for Gemini | The selected speech provider |
| `AI_EMBEDDING_MODEL` | `text-embedding-v4` | Qianwen/DashScope embeddings for hybrid memory retrieval |

For example, these explicitly select the default Qwen profile:

```dotenv
AI_CHAT_MODEL=deepseek-flash
AI_VISION_MODEL=deepseek-flash
AI_IMAGE_MODEL=openai/gpt-image-2
AI_TTS_MODEL=qwen-audio-3.1-tts-flash
AI_EMBEDDING_MODEL=text-embedding-v4
```

To choose another model, replace only its value, save the file and restart. OpenRouter IDs include their provider prefix, such as `openai/` or `google/`. If you use Gemini speech through OpenRouter, set `AI_TTS_MODEL` to a compatible Gemini speech model instead of a Qwen ID. The Qwen failure fallback continues to use the default Gemini speech model.

Models must support the application's existing API contract:

- **Chat:** streaming chat completions and the structured JSON/thinking options used by personality and memory tasks. Image chat also requires a multimodal chat model. Upload moderation separately uses `AI_VISION_MODEL`, which must support images and the moderation response format; its default remains `deepseek-flash` when chat changes.
- **Images:** OpenRouter's `/images` endpoint, reference images and the response formats handled by the app. The two built-in models retain their own `quality` or `resolution` parameters. Other models use common parameters with the provider's default quality. Outputs must be PNG, JPEG or WebP. See [OpenRouter image API documentation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) for model discovery and capabilities.
- **Speech:** Qwen speech models must use the existing synthesis response with an audio URL on the allowed Alibaba Cloud host and accept the configured voices. Gemini speech models must support OpenRouter `/audio/speech` and return a supported audio format with the existing Gemini voices. The speech model and voice selection are separate settings.
- **Embeddings:** the model must support the configured embeddings endpoint and **1024-dimensional** output. The dimension is fixed for this edition. After changing the embedding model, the application asynchronously rebuilds vectors for existing memories; it preserves the memory facts and keyword index. Keyword retrieval continues while compatible vectors are rebuilt. Rebuilding consumes API usage on your provider account.

Existing audio caches are preserved. Test a changed speech model with a new assistant message; after also changing voices, the “regenerate with new voice” action can replace a cached recording.

`doctor` checks local configuration, not your provider's current model catalogue or account permissions. If a new model is unavailable or incompatible, restore the previous model ID and restart. See the [complete configuration guide](docs/opensource/04-environment.md) for details.

### Other settings: keep the defaults initially

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen on this computer only |
| `PORT` | `5000` | Web port |
| `APP_DATA_DIR` | `./data` | Database, private images, audio and signing keys |
| `APP_ACCESS_MODE` | `local` | Local mode without login |
| `MEMORY_RETRIEVAL_MODE` | `auto` | Automatically choose keyword or hybrid retrieval |
| `EMAIL_PROVIDER` | `none` | No forwarding to an external mailbox by default |
| `LETTER_DELIVERY` | `in-app` | Keep letters inside the app by default |

You do not need Supabase, PostgreSQL, Mem0, payment platform or CAPTCHA environment variables. Advanced settings are listed in [.env.advanced.example](.env.advanced.example) and the [complete configuration guide](docs/opensource/04-environment.md).

## Step 4: Check and start

After saving `.env.local`, run:

```sh
pnpm run doctor
pnpm dev
```

`doctor` checks Node, configuration, SQLite/FTS5 and the data directory. It exits without an error when checks pass and names missing required keys when needed. It makes no paid AI calls, so it cannot confirm network connectivity or cloud account model permissions.

Once the server starts, open **[http://127.0.0.1:5000](http://127.0.0.1:5000)** in your browser. Keep the terminal open while using the application. To stop it, press **Ctrl+C** in that terminal. Next time, enter the project directory and run `pnpm dev`; you do not need to reinstall or configure it again.

One command starts both the website and the memory/letter background workers. You do not need a second terminal. After changing environment variables, stop with Ctrl+C and start again.

## Step 5: Meet your companion

1. Follow the first-run steps to choose gender, orientation, character and appearance proportions. Customize your companion's name, personality and nickname for you, and confirm your own timezone.
2. Send a message such as “Hi, I'd love to chat with you today” and watch the reply appear progressively.
3. With a speech key configured, click the **read-aloud button** below an assistant message. Audio is generated on click and never plays automatically. Change voices in companion settings.
4. With an OpenRouter key configured, explicitly ask “Send me a selfie of you standing by the window,” then wait for the photo to appear in chat.
5. Try memory: “I drink tea without sugar and usually prefer osmanthus oolong. Please remember that.” After background organization finishes, open a new conversation with **the same companion** and ask “Do you remember how I like my tea?” Memory organization is asynchronous and may not finish immediately after a message.
6. Open appearance or companion settings to adjust wallpapers, colors, personality, voice and letter preferences. Selecting another companion preserves the previous companion and conversations; memory is scoped to each companion.

Your data belongs to this installation. You can continue after refreshing, changing browsers or restarting your computer. Moving to another computer requires migrating or restoring the data directory; this edition does not synchronize accounts through the cloud.

## Email can wait

Letters stay inside the app by default. Enable them in companion settings; no email key is needed. Background jobs run while the application is running. A sleeping or powered-off computer does not keep generating letters.

To forward letters to your own mailbox, choose **SMTP** or **Resend**:

| Method | Required variables |
|---|---|
| SMTP | `EMAIL_PROVIDER=smtp`, `LETTER_DELIVERY=both`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` |
| Resend | `EMAIL_PROVIDER=resend`, `LETTER_DELIVERY=both`, `EMAIL_FROM`, `RESEND_API_KEY` |

Get SMTP settings and an app password from your mailbox provider. Port 465 uses implicit TLS; 587 uses STARTTLS. Resend requires your own account and a verified sending domain. **Save the recipient address in the app's settings; do not add `EMAIL_TO`.** This edition does not read external inboxes. A successful sending API response does not prove delivery to the recipient's inbox. Examples are in the [configuration guide](docs/opensource/04-environment.md).

## Troubleshooting

| Problem | What to do |
|---|---|
| `pnpm` or `node` is unavailable | Check installation, reopen your terminal, then check versions. |
| `package.json` cannot be found | Run `cd Deep-Whisper`, or enter the extracted project directory if you downloaded a ZIP. |
| `doctor` reports a missing `DEEPSEEK_API_KEY` | Check the root `.env.local`, its filename, and that the value is a real key rather than example text. |
| Voice or photos report “not configured” | Add the corresponding optional key, save and restart. |
| AI requests time out or fail to connect | Check whether the computer/terminal running the app can reach the provider endpoint. Your browser and Node requests may use different proxy settings. Check terminal errors and model permissions; never paste keys into issues. |
| Qwen speech or embeddings cannot connect | Check the matching key/endpoints and terminal network. Use `MEMORY_RETRIEVAL_MODE=keyword` while vectors are unavailable; chat and keyword memory still work. |
| A newly selected model returns an error | Check the exact model ID, endpoint contract, capabilities and API account access. Restore the previous ID and restart if necessary. |
| `EADDRINUSE` or port 5000 is occupied | Stop the old instance, or set `PORT=5001` in `.env.local`, restart and open `http://127.0.0.1:5001`. Usually no explicit `APP_BASE_URL` is needed. |
| SQLite native module mismatch or `NODE_MODULE_VERSION` | Confirm Node 24 in the current terminal, then run `pnpm rebuild better-sqlite3` and `pnpm run doctor`. Do not delete `data/` to fix dependencies. |
| Installation reports missing `gyp`, a compiler or Python | When a SQLite prebuilt package is unavailable, native build tools are needed; see below. |
| An instance-lock error occurs | Stop the previously started application and confirm its processes have exited. Keep your data and follow the [instance-lock recovery instructions](docs/opensource/04-environment.md#环境加载检查与维护); do not delete the entire data directory. |

See the [official better-sqlite3 troubleshooting guide](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md) for native dependency problems. On macOS, install Command Line Tools with `xcode-select --install`. On Windows, install Python and the C++ tools in Visual Studio Build Tools. On Debian/Ubuntu, install Python 3, `make` and `g++`. Then retry `pnpm install --frozen-lockfile`. Start with the standard installation; these extra tools are needed only if compilation fails.

## Production mode, backups and remote access

For a production build, stop the development server and run:

```sh
pnpm build
pnpm start
```

To back up:

```sh
pnpm data:backup
```

The command saves the database, media and required keys, then displays the backup path. Keep the entire backup directory safe. The default database path is `data/deep-whisper.sqlite`. Do not copy only the main SQLite file while it is in use, and do not let two independent installations share the same `data/` directory simultaneously.

Local access is the default. For personal remote access, configure `APP_ACCESS_MODE=password`, an `OWNER_PASSWORD` of at least 12 characters, your HTTPS `APP_BASE_URL` and a reverse proxy. The Docker example in [compose.yaml](compose.yaml) also requires password configuration. Full remote access, Docker, migration and recovery instructions are in the [configuration guide](docs/opensource/04-environment.md).

## Development and licenses

The implementation plan, architecture, specification and API contracts are in the [project documentation](docs/opensource/README.md). Development checks include:

```sh
pnpm test:unit
pnpm ts-check
pnpm lint
```

Default tests use temporary SQLite databases and simulated external services. They make no real AI calls and send no real email. Real provider capabilities and individual operating systems need their own verification.

Code and project documentation use the [MIT license](LICENSE). Artwork, wallpapers, voice samples and branding have separate terms in [ASSETS.md](ASSETS.md). Some detailed project documents are currently in Chinese; this guide contains the steps needed to get started in English.
