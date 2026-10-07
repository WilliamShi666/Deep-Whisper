# Frozen personal API contract

Baseline is Git commit `027d10fdd4e9fb72269bdf325461b0152981067e`; source was compared using local Git reads. The commercial project itself was not modified. This records intentional identity/billing changes; successful core wrappers, message/SSE payloads and stable testids retain their consumers.

| Endpoint / shape | Baseline | Personal edition |
|---|---|---|
| GET visitor | `{visitor,companion,visitor_id,is_new,claimed,auth:{authed,email}}`; token/guest identity and claim | Same envelope; persisted owner, `is_new:false`, `claimed:false`, `auth:{authed:true,email:null}` after owner access check; no hosted account or fake entitlement |
| POST/PATCH visitor | `{visitor}`, gender/orientation and UI/locale/palette | Same wrapper/fields; updates owner; theme-context409 and invalid-input400 retained |
| POST/PATCH companions | `{companion}`; character/style/persona/name/title/voice/theme | Same wrapper and public voice IDs; ownership is owner-scoped; avatar derived from character |
| GET/POST conversations | `{conversations,next_cursor}` / `{conversation}` | Same; list rows include flat active companion name/avatar/character key; creation replay scoped to owner |
| GET/PATCH/DELETE conversation | `{conversation}` / updated wrapper / `{ok:true,forget:{status,deleted,failed}}` | Same wrappers, including `ok:true`; deletion reports source memory result and cancels jobs in one transaction |
| GET messages | `{messages,next_cursor}` | Same DTO roles/text/image/photo_status/audio URL; UTC ISO timestamps, cursor tie-breaker; storage paths use private `/api/media/...` |
| profile / relationship | `{profile}` / `{snapshot}` | Same JSON fields and manual communication prefs; SQLite CAS and observedAt checks |
| themes / feedback | themed DTO / `{feedback}` | Same activity scope/gender filtering and assistant-only feedback; admin routes removed |
| chat | SSE described below | Same event frames and message DTO; no paid quota fields/events |
| upload / photo | `{path}` / `{message}` | Same; approved upload receipt and persistent private media instead of commercial object URL |
| tts / preview | `{audio_url}`; paid access previously required | Same success payload/cache semantics; configured capability replaces paid membership gate |
| persona-enhance | `{persona,based_on}` | Same success wrapper; no commercial quota |
| locale-default | `{locale}` from trusted network country | Same payload; device Accept-Language default, never writes owner locale/cookie |
| letters/preferences | hosted-email preferences and verified account recipient | Intentional single-owner DTO change: see `api-contracts-letters.md`; independent station/email switches, saved fixed recipient |
| billing/admin/hosted auth configuration | commercial endpoints/pages | Removed; absent paths are404. New owner session/capabilities/inbox/media endpoints are explicit personal capabilities |
| GET capabilities | No personal capability endpoint | `{capabilities,accessMode,speechPresentation}`. Safe speechPresentation is `{mode:'catalog'|'compatibility'|'unconfigured',fallback:'gender-compatible'|'none'}`; no keys, provider voice names or secret model configuration |

## SSE fixture and semantics

`tests/fixtures/personal/core-sse.json` contains synthetic examples. Wire format remains `data: <JSON>\n\n`, with no separate named `event:` frame:

- `user_message`: `{type,message}` for persisted user input.
- `chunk`: `{type,text}`, photo marker holdback prevents exposing hidden tags.
- `done`: `{type,message,photo_request,photo_scene}`; no appearance_style field added.
- `error`: `{type,error,code}`; localized client copy derives from code.

Reader cancellation closes only the stream writer. Server generation has an independent finite deadline; a successful nonempty user text exchange commits assistant plus organizer job atomically once. Opening and image-only exchanges preserve assistant/image understanding but do not invent a user text source or enqueue a text organizer job. Errors do not commit partial assistant text.

## Deliberate access/configuration changes

The browser visitor ID is a mirror, never an authorization selector. Client `X-Visitor-Id`/`x-session` values are stripped; server binds requests to the persisted owner and password cookie when enabled. Missing optional capabilities return503 `FEATURE_NOT_CONFIGURED`, not membership errors. Mail configuration conflicts disable external mail and doctor reports them, while chat/media and existing station letters remain usable.

API evidence: real temporary SQLite tests in `personal-core-api.test.ts`, `personal-core-repository.test.ts`, `personal-chat-stream.test.ts`, owner tests and letter routes. OSS-014 includes simultaneous chat/provider work exclusion, reader disconnect release, provider rejection recovery and token/expiry fencing; sequential duplicate opening alone is not treated as concurrency coverage.
