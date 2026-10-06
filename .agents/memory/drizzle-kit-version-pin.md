---
name: drizzle-kit version pin
description: Why drizzle-kit must stay on stable 0.31.x while drizzle-orm is on 0.4x
---

Rule: keep drizzle-kit on the stable 0.31.x line while the app uses stable drizzle-orm 0.4x. Do not upgrade drizzle-kit to 1.0.0-rc/beta.

**Why:** drizzle-kit 1.0 RC requires drizzle-orm 1.0 internals (`drizzle-orm/_relations` export); with stable drizzle-orm it crashes `db:push` with ERR_PACKAGE_PATH_NOT_EXPORTED. A security-upgrade task once bumped kit to 1.0.0-rc.4 and broke the post-merge script.

**How to apply:** if a CVE points at the esbuild bundled by drizzle-kit's `@esbuild-kit` deps, don't jump to the RC — use the npm override `overrides.@esbuild-kit/core-utils.esbuild = ^0.25.0` (already in package.json), which keeps `npm audit` at 0 while `db:push` keeps working.
