# Android packaging sources (consumed by cargo-apk, not committed bootstrap)

- `icon.png`: launcher source (brand mark, copy of `assets/brand/veyvox-app-icon.png`).
- `res/drawable/ic_launcher.png`: packaged `@drawable/ic_launcher` referenced by
  `[package.metadata.android.application] icon`. Regenerate from the brand
  asset if the mark ever changes; keep the filename stable.
