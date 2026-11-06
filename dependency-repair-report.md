
# Dependency Repair Report

**Project:** `Aternos24-7-HostingBot`
**Audit date:** 2026-11-06
**Status:** Registry-based dependencies and lockfile restored; clean install was
blocked by the local sandbox's symlink restriction.

## Root cause

The manifest depended on Mineflayer through the Git URL
`git+https://github.com/PrismarineJS/mineflayer.git#78424bf5abf0f351b1a3751b2f8e0423ab54b350`.
The reported Termux npm 12 `EALLOWGIT` failure is consistent with npm refusing
that Git dependency under its security policy. The specified Termux environment
was not available here; this audit ran on Node.js 24.20.0 and npm 11.19.0.

At audit time, the workspace's tracked lockfile existed and agreed with the
manifest's root dependency declarations, but it locked Mineflayer and its
transitive `minecraft-protocol` dependency to Git sources. The lockfile was
regenerated to remove those sources.

## Dependency origin and verification

The referenced SHA is a real commit in the official
[PrismarineJS/mineflayer repository](https://github.com/PrismarineJS/mineflayer/commit/78424bf5abf0f351b1a3751b2f8e0423ab54b350).
GitHub identifies its author as `github-actions[bot]`, dated 2026-09-15, with
the message “Update to version 26.3.” Its changes add 26.3 to the documented
and tested version list, and replace the npm `minecraft-protocol` dependency
with the `pc26_3` Git branch.

The same commit changes CI to fetch a moving `pc_26_3` minecraft-data branch
and to download Protodef files from another repository's moving `dlog` branch.
Those workflow steps, plus the unreleased protocol branch, make the
experimental compatibility claim dependent on mutable development sources;
they are not part of a self-contained npm release.

The npm registry reported Mineflayer **4.39.0** as the latest official release
at audit time. Its published package has a registry tarball and a different
Git head (`c168635cf2f6602069fc5e408bec864702335581`) from the experimental
commit. It does not contain that commit's 26.3 update. The official Mineflayer
documentation lists stable support through 26.1; direct native 26.3 support
with the repaired dependency set is therefore **not verified**.

## Changes made

- Pinned `mineflayer` to the official npm release `4.39.0`.
- Pinned `mineflayer-pathfinder` to its already locked npm release `2.4.5`
  instead of the mutable `latest` tag.
- Changed the repository `.npmrc` from `allow-git=all` to `allow-git=none`,
  enforcing npm's Git-dependency restriction. The package manifest and lockfile
  use only registry packages and the existing local vendor directories.
- Regenerated `package-lock.json` (lockfile version 3). The root manifest and
  lock dependencies agree, and the lock contains no Git or GitHub package
  resolutions. Mineflayer, minecraft-protocol, and Pathfinder resolve from
  `registry.npmjs.org`.
- Left vendor licenses and attribution files unchanged. The vendored 26.3
  protocol schema was intentionally modified for the targeted teleport-confirm
  compatibility patch.
- Updated the README's runtime and compatibility guidance and marked the
  earlier protocol report as historical.
- Removed the implicit 26.3-to-26.1 client fallback. A fallback now applies
  only when explicitly configured and must itself be supported by the installed
  protocol library; a real version-translating proxy is required.
- Added an informational `server.loader: "fabric"` setting to the example
  configuration and a startup warning explaining the bot's client-mod limit.
- Added Fabric networking guidance: server-side-only mods may remain
  protocol-compatible, while client-required custom payloads need
  mod-specific support.
- Added local compatibility patches based on upstream Mineflayer work:
  `teleport_confirm` now echoes resolved coordinates and rotation when the
  active schema declares those fields; movement packets are followed by
  `tick_end` on versions whose data advertises that packet.
- Extended `vendor/minecraft-data`'s 26.3 teleport-confirm schema with the
  fields documented by
  [minecraft-data PR #1301](https://github.com/PrismarineJS/minecraft-data/pull/1301).
  Existing vendor license/attribution files were preserved.
- Did not apply automatic audit fixes, implement anti-idle behavior, or add
  hosting-provider inactivity workarounds.

## Lockfile and install status

Manifest/lock consistency validation passed. The clean install command
`npm ci --no-audit --no-fund` was attempted against the regenerated lockfile,
but npm failed while creating a symlink from the vendored
`vendor/prismarine-physics` directory into `node_modules`:

```text
EPERM: operation not permitted, symlink
```

The sandbox also reported cleanup permission errors. This is a local sandbox
filesystem restriction, not a dependency-resolution error. The clean install
could not complete here, so the complete post-repair test suite could not be
run against a fully installed tree.

## Test and security results

- `package.json` parsing and lockfile root-dependency agreement: **passed**.
- Scan of lockfile resolutions for Git/GitHub sources: **passed; none found**.
- Vendor attribution/license check: **passed; no license or attribution files
  changed**. The intended 26.3 protocol schema change is the only vendor edit.
- Dependency-independent unit tests (`patrol`, `bot-supervisor`,
  `manual-controls`, version resolution, and protocol packet compatibility):
  **passed, 25/25**, after the Fabric/26.3 changes, including the diagnostic
  that verifies the active teleport-confirm schema and outgoing field names.
- Full `npm test` after the interrupted install: **blocked** because
  `mineflayer-pathfinder` was unavailable in the partial `node_modules` tree.
  Before dependency changes, the full suite passed 32/32 on the experimental
  installed stack; that is not a post-repair result.
- Full read-only `npm audit`: **13 advisories** (1 high, 11 moderate, 1 low).
  The high advisory is in `serialize-javascript`; Mineflayer's protocol/auth
  dependency chain also has moderate findings. No `npm audit fix` was applied.

## Remaining limitations

- Native Minecraft 26.3 compatibility is not guaranteed by the published
  Mineflayer 4.39.0 release. A compatible proxy path may be required for a
  26.3 server; that configuration needs separate testing.
- The 26.3 implementation is partial: the confirmed
  [teleport-confirm PR #4130](https://github.com/PrismarineJS/mineflayer/pull/4130)
  is still open, as are broad schema changes in
  [minecraft-data PR #1301](https://github.com/PrismarineJS/minecraft-data/pull/1301)
  and
  [node-minecraft-protocol PR #1538](https://github.com/PrismarineJS/node-minecraft-protocol/pull/1538).
  Their remaining packet/entity-data changes are not included here; other
  26.3 parser errors can therefore persist.
- The [client tick-end change #4137](https://github.com/PrismarineJS/mineflayer/pull/4137)
  has merged upstream, but is not in the pinned 4.39.0 npm tarball. The local
  shim emits tick-end after movement writes; it does not replace the complete
  upstream per-physics-tick implementation.
- The `loader` field is informational; it does not install or emulate Fabric
  mods. Mods that require client-side custom payloads must be assessed
  individually. See the [Fabric networking guide](https://docs.fabricmc.net/develop/networking).
- The exact Termux Node.js 24.22.2/npm 12.2.2 `EALLOWGIT` failure could not be
  reproduced in this Windows environment. The repaired manifest no longer
  declares Git dependencies.
- A complete `npm ci` and full post-repair `npm test` remain to be run in an
  environment permitted to create the vendor-package symlink. The sandbox
  policy for this workspace path must allow that operation.

## Historical runtime note

The previous version of this document said the experimental 26.3 stack was
installed and its native protocol tests passed. That statement referred to the
Git-based dependency tree before this repair and does not describe the current
manifest or the post-repair test results. The local packet patches added later
are regression-tested in isolation, but have not been tested against the live
server.
