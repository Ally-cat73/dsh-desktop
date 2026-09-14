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

## Expanded package audit remediation

- Rejected second package without installation: DMG SHA-256 `f3251c9e228ee4bf2608873c40cc1889be255e0aca8623294bc995cfc819dab0`; candidate `app.asar` SHA-256 `67e43d5566bc849029bda8cbdc324e35171ab01edb4962651fb9640ddb770c46`.
- Corrected the market conflict/terminal error copy and both initial/fallback renderer document titles.
- Retained internal package descriptions, source comments, exact `dsh` commands, legacy `DSH Desktop` migration key, protocol/schema names and truthful Provider/model names.
- Focused active-package regression remains 3 files / 40 tests PASS.

## Final candidate and installation

- Source: `7d9165b8eb3e7dfa3b4b524a7837fa43188f3100`, tree `cf472cabfdd983f55b185f06bb5e6d015b1ea3e9`.
- UbiCloud: run 34810374314 PASS (change classifier and full `yarn check`).
- DMG SHA-256: `da50978a0701d9e278a456117c2a04372a0e813148e85a25d0f246b7c9a5acba`.
- Candidate/installed `app.asar` SHA-256: `c90524cd10d5d9a45e78e9928772a647bdeca441ca9c913d5b2937666d10f84a`.
- Bundle/version/architecture: `dev.aerastudios.code`, 2.0.4, universal x86_64 + arm64.
- Rollback: `/Users/Allyd/AERA-Workspace/app-backups/Aera Code.app.pre-brand-convergence-20260914T154900`, prior `app.asar` SHA-256 `3326de95477cfbcdd7cfdefe1e1cd7cdaf29160bd5bc05108e05b563c8074001`.
- Visual evidence: eight JPEG captures under `screenshots/`; all required surfaces inspected without a Provider effect.
- Merge and canonical banking remain held pending owner visual acceptance.

## Canonical merge

- Owner acceptance: `OWNER_AERA_CODE_BRAND_ACCEPTANCE_ACCEPTED`.
- PR 15: MERGED into `agc/wo-agc-004-canonical-desktop-001`.
- Canonical merge: `d9f1aa15976e97d21d4a026fb260cc0f3e93c5bd`.
- Canonical tree: `cf472cabfdd983f55b185f06bb5e6d015b1ea3e9`, exactly equal to the accepted source tree.
- Accepted source `7d9165b8eb3e7dfa3b4b524a7837fa43188f3100` is the merge's second parent and a proven ancestor.
- Merge timestamp: `2026-09-14T17:39:45+10:00`.

## Canonical merge-source gate

- Clean detached worktree: `/Users/Allyd/AERA-Workspace/.worktrees/aera-code-brand-canonical-build-001` at canonical merge/tree.
- Immutable install completed with no source, lockfile, dependency version or submodule change.
- Full `yarn check`: PASS; Market 268; Desktop 1,084 PASS / 4 skipped; runtime closure 201; licence audit 551; operation reliability 7 / 18.

## Canonical package equivalence

- Canonical DMG: SHA-256 `8b86cfd38527310ebc0205e0836c52ed98186ee4ef39c167d1b07b5cfa09e66e`.
- Canonical `app.asar`: SHA-256 `c90524cd10d5d9a45e78e9928772a647bdeca441ca9c913d5b2937666d10f84a`.
- Accepted-candidate `app.asar`: identical SHA-256.
- Entire accepted and canonical application bundles: 23,275 files each; per-file SHA-256 manifests have no difference.
- DMG containers are not byte-identical (`da50978a…` accepted versus `8b86cfd3…` canonical) because a new HFS/DMG container carries regenerated build-time filesystem metadata. Contained app semantics and bytes are exact.
- Canonical expanded packaged-brand audit: PASS.

## Final canonical installation and regression

- Accepted-candidate preservation: `/Users/Allyd/AERA-Workspace/app-backups/Aera Code.app.accepted-pr15-7d9165b8`.
- Exact canonical build installed at `/Users/Allyd/Applications/Aera Code.app`; package and installed `app.asar` hashes match.
- Post-merge visual smoke: PASS across all required product surfaces.
- Zero-Provider New Session readiness: PASS; governed route and ready composer present; no Provider request.
- Active Aera brand composition is canonical. Visible donor-host identity is removed while technical DSH compatibility identifiers and truthful Provider/model identities remain.
- Historical rejected package records remain intact above.
- Baseline receipt: `AERA_CODE_PRODUCT_IDENTITY_BASELINE_V1.json`, SHA-256 `6fd65b95a741906ca38dde8fb4d270ac3080a3ee1fe97854bd504ea554c4a374`.
- Final verdict: `AERA_CODE_PRODUCT_IDENTITY_CONVERGED_AND_CANONICALLY_BANKED`.

## Full local gate

- Pinned submodule materialised at unchanged `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- `corepack yarn check`: PASS.
- Market: 23 test files, 268 tests PASS.
- Desktop: 111 test files, 1,083 tests PASS, 4 skipped.
- Runtime closure: 201 first-party nodes.
- Licence audit: 551 production packages; 2 notice-required licences retained.
- Operation reliability: 7 operations / 18 fault contracts.
- Build/typecheck, bilingual docs, layout, Fabric/Market contracts and package exports: PASS.
