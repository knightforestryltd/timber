# Android app icon (v14.4)

The home-screen icon of `app.apk` is built into the app, so it changes only when the app is rebuilt.
The app must be rebuilt **with the same signing key** as today's app (otherwise phones refuse the update).

1. Copy everything in `res/` over `android/app/src/main/res/` in the Android (Capacitor) project.
2. Build a release APK, signed with the existing Knight Forestry key, and raise `versionCode` (it is 1 today).
3. Put the new `app.apk` on the website (same name). Phones install it over the old app.

`play-store-512.png` is the 512 x 512 icon if the app is ever listed on Google Play.
