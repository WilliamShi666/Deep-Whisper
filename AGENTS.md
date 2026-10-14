# Deep Whisper Personal

This checkout is the single owner, self hosted personal edition. The original
commercial checkout is a separate project. Never connect its Supabase/Postgres,
merchant, production object store or real provider account for default tests.

- Use pnpm 9 and Node 24 LTS. Preserve existing work. Do not commit, push or release
  without explicit authorization.
- Read docs/opensource/03-spec.md and implementation/api-contracts-*.md before
  changing behavior. Use TDD and real temporary SQLite/file behavior tests. Mock
  only provider/email network boundaries; no paid calls or real email by default.
- All app/worker/scripts share config/runtime.ts and load-script-env.ts. Never read
  actual credentials into tool output. Shell env wins; test excludes .env.local.
- SQLite core schema is shared/schema.ts; memory-schema.ts and letters/personal-schema.ts
  define the corresponding domain tables. Versioned migrations are reviewed SQL,
  including FTS5 triggers. No db push/reset. Existing versions require an explicit
  backup and data:migrate; production data never silently falls back to an empty DB.
- Short synchronous transactions only. AI/SMTP operations stay outside write
  transactions. Facts, FTS, sources and task finalization share one fenced commit.
- Owner authentication and Host/Origin checks protect APIs and private media.
  X-Visitor-Id does not select owner. Keep apiFetch as the frontend business request
  entry point. Preserve response wrappers and user_message/chunk/done/error SSE.
- Keep user-text provenance for communication preferences. Assistant text never
  becomes user instructions. Memory and appearance/voice/theme belong to the active
  companion. Preserve the per-turn budget, avoid_topic, expiry and resolved semantics.
- Characters expose public voice codes only. Client code must not import qwen-voices
  or qwen-voice-map. All provider calls use internal contracts; media bytes are saved
  privately before message URLs. Voice plays only on explicit user click.
- Stable testids remain: palette-toggle, palette-unset-hint, sidebar-toggle,
  message-list-scroll, theme-settings, active-companion-header, voice-bar.
- Run pnpm test:personal, test:memory, test:providers, ts-check and lint as appropriate.
  Independent code/spec review must pass before a separate member performs E2E.
- Publish only a clean file export, never the commercial Git history/private docs.
  MIT covers code; assets and branding need separate owner approval (ASSETS.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
