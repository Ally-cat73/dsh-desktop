# Build notes

## Baseline

- Source commit/tree: `8a8dd988c19d5cf1f4ad5f48357a013448d2bbc9` / `75b4dcdcb408d8b51727cefb5710031e24bb0825`.
- Node/Yarn policy: repository-pinned Node-compatible environment and Yarn 4.18.0 through Corepack; immutable install only.
- No dependency or lockfile change is authorised.
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

## Full local gate

- Pinned submodule materialised at unchanged `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- `corepack yarn check`: PASS.
- Market: 23 test files, 268 tests PASS.
- Desktop: 111 test files, 1,083 tests PASS, 4 skipped.
- Runtime closure: 201 first-party nodes.
- Licence audit: 551 production packages; 2 notice-required licences retained.
- Operation reliability: 7 operations / 18 fault contracts.
- Build/typecheck, bilingual docs, layout, Fabric/Market contracts and package exports: PASS.
