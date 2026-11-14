# Groovy for iOS

The iOS app bundles the existing React UI with Capacitor. Swift owns streaming audio, background playback, system media commands, artwork, and progress saving. Browser playback still uses HTML audio and Media Session.

## Build and install

1. Install Xcode and its iOS simulator runtime, then run `npm ci`.
2. Deploy the Worker containing `GET /api/me`'s `accountId` field before using the native app. This is a backward-compatible API addition and needs no migration. The app reports an update-required error when the server lacks it.
3. Run `npm run ios:sync` to build and copy the web UI into the iOS project.
4. Run `npm run ios:open`. Select the **Groovy** scheme, your iPhone, and your own signing team under the App target's Signing & Capabilities. The bundle identifier is `com.naveenv92.groovy`; change it if your team cannot provision it.
5. Enable Developer Mode on the phone if Xcode requests it, then build and run. A free Personal Team's provisioning expires after seven days; reinstall through Xcode to renew it.

The app connects to `https://groovy.naveen-venkatesan.workers.dev`. It uses the existing password-only accounts. The native API transport restricts requests to that backend, supplies its expected Origin header, stores its session in Keychain, and never sends credentials to audio/artwork publishers. Browser cookie and origin protections are unchanged.

The UI is bundled, not remotely updated: after UI changes, run `npm run ios:sync` and reinstall. Swift changes require an Xcode build. No signing team or developer account is checked into the project.

## Playback and progress

- One `AVPlayer` handles streaming, pitch-preserving speed, background audio, interruption recovery, and route disconnections. Unplugging headphones or disconnecting Bluetooth pauses playback.
- Native remote commands support play, pause, toggle, seek, and configurable skip intervals. Previous/next also map to skips. Artwork is decoded by iOS and supplied as native Now Playing artwork; its availability in a particular car still requires hardware testing.
- Swift writes progress every ten seconds during playback and on pause, seek completion, episode changes, and completion. The latest unsynced snapshot per account/episode is retained in app-private preferences. Failed writes retry during playback or on foreground entry.
- Writes are serialized, and an older response cannot remove a newer queued snapshot. Pending writes flush before account refresh. Cross-device conflicts retain the existing last-successful-write behavior.
- Mark played/unplayed enters the same queue. It updates the UI immediately; server persistence may wait for connectivity. Marking the current episode stops its playback.
- Sign-out first attempts to flush progress; if records remain, it asks for confirmation before discarding them. Expired authentication preserves account-isolated snapshots for the same account's next login.
- A web-view reload reconnects to the live native player. A cold app launch restores unfinished server progress paused; zero-progress and completed episodes do not restore. Force-quitting stops playback.

This version does not download episodes or cache the library for offline use. Bundled UI can launch offline, but account data and streaming need connectivity. It does not provide a CarPlay browsing interface.

## Verification

Run `npm test` and `npm run ios:sync`. For native tests:

```
xcodebuild -project ios/App/App.xcodeproj -scheme Groovy \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO test
```

On the real phone, verify login, settings (including podcast speed overrides), play/pause, scrubbing, replay, completion, mark played/unplayed, and progress after relaunch. Verify screen lock, ten minutes of background playback, incoming calls, manual pause during interruptions, Bluetooth disconnect/reconnect, and network loss/recovery. Sign out and sign into another account to check isolation.

In the Rivian, verify steering-wheel play/pause and skip, lock-screen controls, title/artwork changes across episodes, and reconnection while paused and playing. Simulator tests cannot establish Bluetooth interoperability.
