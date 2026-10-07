# Personal letters API and worker contract

All inbox and preference endpoints call `requireOwner(request)`; no endpoint accepts an arbitrary send-to address or triggers provider submission. Public signed unsubscribe and verified Resend receipts are narrow exceptions.

| Method/path | Request | Response |
|---|---|---|
| GET `/api/letters/preferences` | none | `{preference:{status,is_default,in_app_enabled,email_enabled,email_address,email_status,timezone},email:{enabled,provider,delivery,reason?}}` |
| PATCH `/api/letters/preferences` | any nonempty subset of `{in_app_enabled:boolean,email_enabled:boolean,email_address:string|null,timezone:IANA,reconsent?:boolean}`; legacy `{status:'enabled'|'paused'}` means in-app only | same envelope; 400 invalid, 409 email reconsent needed |
| GET `/api/letters` | none | `{letters:[{id,visitor_id,companion_id,conversation_id,companion_name,subject,body,kind,local_date,created_at:ISO,read_at:ISO|null}]}` newest first, at most 50 |
| PATCH `/api/letters/[id]` | `{read:true}` | `{letter}`; 404 for absent/other owner; marking read is idempotent |
| GET `/api/letters/unsubscribe?token=…` | signed private token | HTML confirmation; no preference write; invalid/expired 400 |
| POST same unsubscribe URL | HTML form or one-click POST | HTML 200; email-only suppression; invalid/expired 400 |
| POST `/api/webhooks/resend` | Svix headers and bounded JSON | 404 unless provider is resend and secret configured; 401 bad signature; `{ok:true,pending?:true}` |

Default station letters require explicit opt-in, have no email prerequisite and do not depend on paid access. Inbox copies survive email failure. Pausing station generation and stopping forwarding are independent. Changing recipient cancels queued copies; suppression cannot be silently reversed by changing the address. Resuming suppressed/unsubscribed forwarding requires `reconsent:true`.

`processLetterJobs(db,{now?:Date,clock?:()=>Date,env?,writeLetter?,send?})` uses an initialized SQLite connection, installs no schema, and returns `{generated,accepted,failed,unknown}`. The launcher supervises it. `clock` is an optional injectable clock; normal runtime rereads the actual time before claims, commits and submission. Jobs have leases and stable per-owner local-date/trigger uniqueness. Only today's jobs are eligible after sleep. Email `accepted` is not `delivered`; interrupted/ambiguous submissions become `unknown` and are never automatically resent. Explicit transient rejections have at most three attempts. No forwarding is attempted when runtime email capability is disabled by a missing credential or mode conflict.

The job payload persists the selected source fingerprint as well as writer input. Generation claims and atomic commits recheck current owner/companion scope, memory content/version, active status, expiry and event eligibility, or the profile's birthday/important-date values. Pending email copies revalidate the same completed job source both at claim and immediately before submission. Deleted/corrected sources cancel the job or pending copy; old payloads without a source snapshot fail closed. A station copy already saved before withdrawal remains inert. No transaction is held across provider IO.

Physical migration export: `src/storage/database/migrations/0003-letters.ts`, UTC milliseconds as INTEGER. In-app/read endpoints serialize instants to ISO strings. `getPrivateSecret('unsubscribe',dataDir?)` supplies persisted token signing material. A public callback is generated only with an explicit validated HTTPS `LETTER_PUBLIC_BASE_URL`; local mode sends a self-contained email without fake public unsubscribe headers.
