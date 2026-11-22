# Android packaging sources (consumed by cargo-apk, not committed bootstrap)

- `res/drawable-v26/ic_launcher.xml`: adaptive launcher icon referenced by
  `[package.metadata.android.application] icon`. The Android launcher supplies
  the outline; the background and transparent V foreground are separate.
- `res/drawable/ic_launcher.png`: boxed PNG fallback with transparent corners.
  Regenerate both launcher PNGs with `pnpm gen-icons` from the canonical
  masters in `assets/brand/`. The historical `icon.png` copy is not packaged.
- `../assets/`: DM Sans Regular and Bold (Google Fonts static TrueType
  release v17) and the font's SIL OFL notice, bundled in the APK. Egui
  embeds these fonts for its native onboarding screens.
