# Brand assets

Per the CG house style (see `CG_Dashboard` `src/assets/BRAND.md`): brand
assets are **imported as modules** from this folder; `publicDir` is disabled
in `vite.config.ts`, so nothing is served from a public directory.

Official assets (uploaded 2026-07-03):

- `CG Logo Small.png` — the boxed CG monogram (181×89). Used in the app
  shell nav rail and the CGOPS redirect screen. Rectangular (~2:1): size it
  by height with automatic width (`h-6 w-auto`), never as a square.
- `CG Logo.png` — the Charcoal Group Restaurants wordmark (1340×146).
  Not currently placed in the app (the standalone login screen that used a
  wordmark was removed with the CGOPS SSO handoff); available for future
  surfaces.

The earlier `cg-monogram.svg` / `cg-wordmark.svg` placeholder recreations
have been removed.
