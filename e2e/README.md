# Personal edition E2E

Use Node 24 LTS and install the locked pnpm dependencies. Chromium must be installed for Playwright (`pnpm exec playwright install chromium`). The runner creates disposable synthetic SQLite/media/private-secret data, clears all seven real provider credential variables, uses local mock providers, and confirms its owned supervisor and registered web/worker processes are offline before removing data. If cleanup cannot be confirmed, it returns nonzero and retains the synthetic data. It does not require or use a live AI key, email account, Supabase, PostgreSQL or a real payment.

```sh
pnpm test:e2e
E2E_PROFILE=hybrid pnpm test:e2e
E2E_PROFILE=gemini pnpm test:e2e --grep 'Gemini-only'
E2E_PROFILE=password pnpm test:e2e --grep 'password owner'
```

`E2E_PROFILE`, `E2E_DATA_DIR` and `E2E_BASE_URL` are internal test settings. They are not personal-app setup requirements. `keyword` is the default profile; `hybrid` uses deterministic fake embeddings; `gemini` exercises the compatibility presentation; `password` uses a fixed synthetic test password. Tests for other profiles explicitly skip. Desktop Chromium and a Pixel 7 Chromium viewport run serially so the one-owner test database is never concurrently reset.

The production lifecycle case requires a separate, clean exported candidate with its own locked dependency installation and successful `pnpm build`, so its production server cannot contend with the development server's Next build directory:

```sh
E2E_CANDIDATE_DIR=/absolute/path/to/built-clean-export pnpm test:e2e --grep 'clean exported'
```

It exercises eight character presets, no-key capability behavior, persisted owner/data across restart, backup while a reply is in flight, maintenance rejection, restoring into a new directory and stopping the whole process tree after a worker exits. It skips when the separate candidate is not supplied. Synthetic data is removed only after successful checks and confirmed process cleanup; it is retained on failure for diagnosis. Browser traces and screenshots are under `test-results/personal-<profile>/`; tests never declare real cloud output, real email delivery, human voice quality or native Windows/Linux support verified.
