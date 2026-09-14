# Build notes

## Baseline

- Source commit/tree: `8a8dd988c19d5cf1f4ad5f48357a013448d2bbc9` / `75b4dcdcb408d8b51727cefb5710031e24bb0825`.
- Node/Yarn policy: repository-pinned Node-compatible environment and Yarn 4.18.0 through Corepack; immutable install only.
- No dependency version or graph migration is authorised. Yarn patch locators/checksums may change only to carry this bounded presentation repair.
- Candidate must use `dist:mac-smoke`; canonical merge is held until owner acceptance.

## Baseline active assets

- `dsh-plugin-desktop/build/aera-code-icon.png`: SHA-256 `ea0ba98808b633b6c585095fd0e5ce0e498d324ca2377278873ceb9ce9f651ca`.
- `dsh-plugin-desktop/build/aera-code-icon-mac.png`: same SHA-256.
- `dsh-plugin-desktop/build/aera-aperture.png`: SHA-256 `e42ec031ff31ab83b6db26b39611d7b30ef6cf086e0d742b0a8f320eb43b8352`.
- Installed `icon.icns`: SHA-256 `f624622c32c72f6a8f35397e1db23b3346240be57ccda1f4258e3b4ee6632135`.

## Implementation

- Active brand: wired the existing `applyAeraBrand()` into the real Client `apply()` entry point.
- Copy convergence: English/Chinese first-run welcome notice; Desktop terminal error; recovery plugin/rollback/configuration prose; startup terminal error; plugin-removal failure title; Windows runtime-home diagnostic label.
- Intentionally retained: DSH package/protocol/command identifiers, exact `dsh plugin` technical command, legacy user-data migration name, Profile IDs, plugin-market identities, legal/historical docs and truthful DeepSeek model/provider packages.
- Lockfile: only the edited Yarn patch hash/checksum changed (`63bd72` -> `cd5952`); dependency graph versions unchanged.
- Validation so far: focused tests 36/36; build PASS; typecheck PASS.

## Packaged-content audit remediation

- Rejected first package without installation: DMG SHA-256 `fc87c806170981df5889592b4425371b4f3b4b979592be591258f2e8b18de7e0`; candidate `app.asar` SHA-256 `0879c2ae56e7d2a70b47c376014d59d4e780c1f8a163f09e2e857f259f4ba3d5`.
- Branded reachable community-market, optional `dshmarket`, settings-models onboarding, native-picker failure and system-context presentation strings.
- Added a Yarn patch for the system-context presentation sentence only. The package name, `includeHarnessIdentity` configuration key and `harness:identity` section name remain intact as compatibility identifiers.
- No dependency version changed. Lockfile movement is limited to updated or added local Yarn patch resolutions/checksums.
- Focused regression after active dependency materialisation: 3 files / 40 tests PASS.
- Repeated `corepack yarn check`: PASS; Market 268 tests; Desktop 1,084 tests PASS / 4 skipped; runtime closure 201 nodes; licence audit 551 packages; operation reliability 7 operations / 18 fault contracts.

## Full local gate

- Pinned submodule materialised at unchanged `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- `corepack yarn check`: PASS.
- Market: 23 test files, 268 tests PASS.
- Desktop: 111 test files, 1,083 tests PASS, 4 skipped.
- Runtime closure: 201 first-party nodes.
- Licence audit: 551 production packages; 2 notice-required licences retained.
- Operation reliability: 7 operations / 18 fault contracts.
- Build/typecheck, bilingual docs, layout, Fabric/Market contracts and package exports: PASS.
