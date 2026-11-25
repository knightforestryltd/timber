# Knight Forestry Android app

A thin Android shell around the live site. The app opens the Cloudflare site, so **every upload to
Cloudflare updates the app** with no reinstall. The shell adds what a web page cannot do:

- GPS that keeps logging with the screen off during a driver's shift (a "Shift in progress"
  notification shows from shift start to submit), via `@capacitor-community/background-geolocation`
- PDFs (driver logs, invoices) go to the phone's own share screen (Print, Gmail, Drive...)
- Invoice previews open inside the app

## Site address
`capacitor.config.json` → `server.url`. Changing it means building and installing a new APK.

## Build (Linux, needs JDK 21, Android SDK platform 36 + build-tools 36)
```
npm install
npx cap sync android
cd android && ./gradlew assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk
```
Signing: `android/keystore.properties` (not in git) points to the release key (.jks).
**Keep the key and its password safe.** Updates must be signed with the same key, or the phone
refuses to install them over the old app (you would have to uninstall first and lose saved data).

## When a new APK is needed
Only for changes to the app shell itself (site address, icon, permissions, plugins).
Page changes never need a new APK.
