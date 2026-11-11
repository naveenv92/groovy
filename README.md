# Groovy

A mobile-first RSS podcast player for iPhone Safari and Android Chrome. React + TypeScript on Cloudflare Pages, Pages Functions for the API, and D1 for accounts, subscriptions, progress, and preferences.

## Local setup

Use Node 22.13 or newer (tests use Node's built-in SQLite).

```sh
npm ci
npm run db:migrate
npm run user -- my-account
```

The user command prompts for your chosen password twice, without echoing it, and prints a JSON entry containing its salted hash. Create `.dev.vars` with the complete user map on one line (replace the example hash with the actual output):

```dotenv
USER_PASSWORD_HASHES='{"my-account":"scrypt$32768$8$3$..."}'
```

Then start the app:

```sh
npm run build
npm run preview
```

Open the URL Wrangler prints and enter the password you chose. The account ID is an administrator identifier; listeners enter only their password. No Cloudflare login or database write happens during hash generation.

For frontend development, keep `npm run preview` running on port 8788 and run `npm run dev` in another terminal. Vite proxies `/api` to Wrangler; rebuild when changing Functions. `.dev.vars` is ignored by Git. Manual RSS entry works without directory credentials; search works without credentials through Apple’s podcast directory.

## Deploy to your Cloudflare account

1. Run `npx wrangler login` and `npx wrangler d1 create groovy`. Replace the placeholder `database_id` in `wrangler.jsonc` with the returned ID.
2. Run `npx wrangler d1 migrations apply groovy --remote`.
3. Run `npm run build`, then `npx wrangler pages project create groovy --production-branch main` and `npx wrangler pages deploy dist --project-name groovy`.
4. Run `npm run user -- my-account`, choose a password, and merge the printed entry into the `USER_PASSWORD_HASHES` Pages secret. Set the secret in the Cloudflare dashboard under the project's Settings → Variables and Secrets, or run:

   ```sh
   npx wrangler pages secret put USER_PASSWORD_HASHES --project-name groovy
   ```

   Paste the complete JSON object containing all users. Redeploy after setting or updating the secret. Configure production and preview secrets separately; local `.dev.vars` is not uploaded.

The Cloudflare Pages project is named `groovy`. The D1 database is named `groovy`. The D1 binding is named `DB`. For Git-based Pages builds, use `npm run build`, output directory `dist`, and the repository root. Pages discovers the `functions` directory automatically. Never upload `.dev.vars` or account passwords. `npm run deploy` builds and deploys to Pages; add `--project-name groovy` to Wrangler if prompted to select a project.

## Behavior

- Search Apple’s podcast directory or open a public RSS URL, then follow shows in your library. Feeds and search results are cached for 15 minutes. Feeds are limited to 4 MB, 500 items, and four redirects. RSS 2.0 audio enclosures are supported; Atom and private feeds are outside v1.
- Audio streams directly from publishers. Native audio provides pitch-preserving 0.5×–2× speed, seeking, and independently configurable 5–120 second skips (15 back / 30 forward by default).
- Progress syncs every 10 seconds during playback, on pause, when switching episodes, and on page hide on a best-effort basis. On refresh or login, the most recently listened-to unfinished episode reopens paused at its saved position. Playback never starts automatically. Older history is restored from the publisher feed when available. The latest server write wins across devices.
- Passwords are chosen by you (1–256 characters, including spaces and Unicode) and hashed with salted scrypt (`N=32768, r=8, p=3`, 32-byte output). The `USER_PASSWORD_HASHES` secret maps stable account IDs to these hashes. Each person must have a different password because login has no username. Use long, unique passwords.
- The user map is one JSON object, for example `{"naveen":"scrypt$...","friend":"scrypt$..."}`. Merge entries when adding users; replacing the object with only a new user disables everyone omitted. Neither passwords nor hashes belong in Git, Wrangler's public variables, or `VITE_` variables.
- Accounts are created in D1 on first successful login. D1 stores a fingerprint of the configured hash to validate sessions; the secret is the source of authentication. Keep the same account IDs when moving existing users to this setup so their libraries and progress are retained. Existing database-only passwords are no longer accepted; configure each user in the secret before deploying this change.
- Rotate a password by generating a new hash for the same account ID, updating the secret, and redeploying. Changed or removed entries invalidate existing sessions. Sessions otherwise expire after 30 days. Login is limited to 10 attempts per IP per 15 minutes.
- Password-only login verifies each configured account sequentially. It is intended for a small manually managed user list; login cost grows with that list. Node crypto compatibility is enabled in `wrangler.jsonc`.
- Feed fetches validate URLs and redirects, check public DNS addresses, limit response size/time, and reject XML entity/DOCTYPE declarations. The Worker must have no private-network or service bindings for arbitrary publisher requests.
- Media Session publishes title, podcast name, artwork, position, and supported playback actions. The phone OS handles Bluetooth output. Car artwork and controls are best effort, depending on browser, OS, and receiver. No Web Bluetooth pairing is needed.
- Screen-locked playback uses the native audio element. The browser must remain alive; offline downloads and playback after browser termination are outside v1. Publisher codecs, HTTPS availability, and seeking support can affect playback.

## Checks

```sh
npm test
npm run build
npx wrangler pages functions build --outdir /tmp/groovy-functions --compatibility-flags nodejs_compat
```

After pulling schema changes, run `npm run db:migrate` locally and `npx wrangler d1 migrations apply groovy --remote` before deploying.

Tests cover RSS parsing and metadata fallbacks, malformed XML, URL/DNS restrictions, fetch limits, login/session security, account isolation, settings validation, progress persistence, and secret-based credential rotation using an in-memory SQLite database, plus scrypt and secret validation checks.

Before release, test the actual iPhone, Android phone, and car: login → search or paste RSS → follow → play → change speed → skip → reload → resume. Check natural pitch, screen lock, backgrounding, Bluetooth reconnects, car title/artwork updates between episodes, and car play/pause/seek buttons. Test publisher failures, missing artwork, and slow connections. No physical device or browser automation verification has been performed in the restricted build environment.
