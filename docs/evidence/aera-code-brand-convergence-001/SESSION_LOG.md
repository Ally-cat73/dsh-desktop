# Session log

## 2026-09-14 — Re-anchor and inventory phase

- Boot identity: Athena v3.1 (River), anchors intact.
- Repository: owner-controlled downstream `Ally-cat73/dsh-desktop`; upstream donor remote remains fetch reference only.
- Canonical branch: `fork/agc/wo-agc-004-canonical-desktop-001`.
- Fresh-fetch source: commit `8a8dd988c19d5cf1f4ad5f48357a013448d2bbc9`, tree `75b4dcdcb408d8b51727cefb5710031e24bb0825`.
- Governed worktree: `/Users/Allyd/AERA-Workspace/.worktrees/aera-code-brand-convergence-001`; branch `agc/wo-aera-code-brand-convergence-001`; clean at re-anchor.
- Installed app: `/Users/Allyd/Applications/Aera Code.app`; version 2.0.4; bundle `dev.aerastudios.code`; `app.asar` SHA-256 `3326de95477cfbcdd7cfdefe1e1cd7cdaf29160bd5bc05108e05b563c8074001`.
- Rollback: `/Users/Allyd/AERA-Workspace/app-backups/Aera Code.app.pre-real-desktop-readiness-892fd90e`.
- Active Aera assets inspected: Aera aperture app icon and transparent aperture mark are present and visually match the accepted identity.
- Live baseline inspection: native menu, About, Settings General, Models and Desktop settings already say Aera Code; truthful AERA Gateway and operational Profile names are correct. The compatibility shell still visibly renders the donor fish + `deepseek HARNESS` in the sidebar, and the accessibility document title remains `<session> — DeepSeek Harness`.
- Source inventory found an existing Aera brand slot implementation and same-origin aperture route, but `applyAeraBrand()` is not invoked by the client composition. It also found donor host copy in the first-run welcome notice and a small number of user-facing recovery/terminal errors.
- Current phase: finish the durable classification inventory, then make presentation-only changes and add user-visible regression coverage. No runtime execution seam is in scope.

## 2026-09-14 — Presentation implementation

- TDD red: the real desktop client composition registered Settings and shell slots but none of the three Aera brand occupants. Focused test failed with only `settings.section`, `settings.action`, and `shell.overlay` observed.
- Green: `applyAeraBrand(ctx)` now runs for every validated desktop renderer before mode-specific composition. It registers `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark`, and retains the existing document-title observer.
- TDD red/green: a defined-surface brand contract initially found `DSH Terminal`, DSH plugin host copy, donor onboarding copy and the `DSH home` diagnostic label. The product-facing copies now say Aera Code or product-neutral runtime/plugin wording. The test explicitly proves `@deepseek-ai/dsh-llm-deepseek` and core DSH package identity remain present.
- Patch-lock update changed only the settings-models patch resolution hash/checksum. No package version, dependency resolution or submodule pin changed.
- Focused brand tests: 36/36 PASS. Desktop build and typecheck PASS under Node 22 / Yarn 4.18.0.
- Current phase: complete the full headless product gate, bank a candidate commit and run required UbiCloud CI. Merge remains prohibited pending owner visual acceptance.

## 2026-09-14 — Local acceptance gate

- First `yarn check` stopped before product tests because the fresh worktree's pinned upstream submodule was not materialised. This was an environment precondition, not a source failure.
- Exact pinned submodule `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (`dsh-v0.1.1-rc.2`) was initialised without changing the gitlink.
- The next full check exposed one expected copy-contract assertion still requiring the historical `DSH home` phrase. The test was corrected to require the truthful `settings.yaml` plus product-neutral `运行时补丁` wording.
- Final full headless gate PASS: Market 23 files / 268 tests; Desktop 111 files / 1,083 tests PASS, 4 skipped; runtime closure 201 nodes; licence audit 551 packages; operation reliability 7 operations / 18 fault contracts; build/typecheck and repository/document contracts PASS.
- Current phase: create the Alyshia-authored candidate commit, open the owner-controlled PR, run UbiCloud CI, then package and visually inspect the unmerged PR head.

## 2026-09-14 — First candidate package rejected by packaged-content audit

- Candidate commit `1a83e7322bc58a4f8f1c9dee8cde332a2eae8b63` was pushed to owner-controlled PR 15; UbiCloud run 34807711561 passed both required jobs on that exact head.
- `dist:mac-smoke` produced a universal candidate, but the pre-install packaged-content audit rejected it. It was not installed and the accepted installed app remained untouched.
- Mechanically proven gaps: active community-market and optional `dshmarket` client copy still named the donor host; the settings-models patch had branded only a retained `.orig` file rather than the active client; native-picker errors said DSH Desktop; and the expandable system-context identity sentence named DeepSeek Harness.
- TDD expansion now scans reachable installed dependency clients rather than patch prose. The active settings-models, market, picker and system-context surfaces are branded Aera Code or product-neutral, while their package/config/protocol identities remain unchanged.
- Focused active-package identity gate: 3 files / 40 tests PASS.
- Repeated full headless gate PASS after packaged-content remediation: Market 23 files / 268 tests; Desktop 111 files / 1,084 tests PASS, 4 skipped; runtime closure 201 nodes; licence audit 551 packages; operation reliability 7 operations / 18 fault contracts; build/typecheck and repository/document contracts PASS.
- Current phase: update the existing unmerged PR, rerun UbiCloud CI, and create a replacement package from the exact new head.

## 2026-09-14 — Second candidate package rejected by expanded audit

- Corrected head `93eabb760f20c778b2e572873f5e15aa65193a87` passed required UbiCloud run 34809389720 (change classifier and full check).
- The replacement universal package passed DMG verification, bundle identity and architecture checks, but expanded `app.asar` inspection found four further reachable donor-host strings: a market conflict fallback, a market terminal transport error, the renderer fallback document title and the initial packaged HTML title. The package was not installed.
- Added deterministic active-package regression coverage for all four paths, then branded only their visible copy. The `dshmarket` package identity, renderer APIs, web frontend behavior and terminal route semantics remain unchanged.
- Focused post-repair gate: 3 files / 40 tests PASS.
- Current phase: repeat full validation and candidate custody on the complete packaged-surface inventory.

## 2026-09-14 — Final candidate installed for owner visual acceptance

- Final candidate head `7d9165b8eb3e7dfa3b4b524a7837fa43188f3100`, tree `cf472cabfdd983f55b185f06bb5e6d015b1ea3e9` passed the complete local gate and required UbiCloud run 34810374314.
- Final DMG SHA-256: `da50978a0701d9e278a456117c2a04372a0e813148e85a25d0f246b7c9a5acba`; final `app.asar` SHA-256: `c90524cd10d5d9a45e78e9928772a647bdeca441ca9c913d5b2937666d10f84a`.
- The previously installed app was quit cleanly and moved intact to `/Users/Allyd/AERA-Workspace/app-backups/Aera Code.app.pre-brand-convergence-20260914T154900`; its `app.asar` hash remains `3326de95477cfbcdd7cfdefe1e1cd7cdaf29160bd5bc05108e05b563c8074001`.
- Installed candidate identity matches the audited candidate hash exactly. Bundle `dev.aerastudios.code`, version 2.0.4, launched from `/Users/Allyd/Applications/Aera Code.app`.
- Visual inspection passed for main shell, existing conversation, zero-send New Session, Settings General, Models, Desktop settings/Profiles, About, and a restart confirmation dialog. The dialog was cancelled. No message or Provider request was made, and no model/Channel/Profile selection changed.
- PR 15 remains open and unmerged. Current gate: `OWNER_AERA_CODE_BRAND_ACCEPTANCE_REQUIRED`.

## 2026-09-14 — Owner acceptance and canonical merge

- Owner verdict: `OWNER_AERA_CODE_BRAND_ACCEPTANCE_ACCEPTED` for every required visual surface; the merge prohibition was explicitly lifted by closure order WO-AERA-CODE-BRAND-CONVERGENCE-CANONICAL-MERGE-AND-CLOSURE-002.
- Pre-merge fresh-fetch proved PR 15 remained open, mergeable and based on `agc/wo-agc-004-canonical-desktop-001`; its head was exactly accepted commit `7d9165b8eb3e7dfa3b4b524a7837fa43188f3100`, tree `cf472cabfdd983f55b185f06bb5e6d015b1ea3e9`, with required UbiCloud run 34810374314 successful.
- PR 15 merged through the repository merge-commit method at `2026-09-14T17:39:45+10:00`.
- Canonical branch: `agc/wo-agc-004-canonical-desktop-001`; merge commit `d9f1aa15976e97d21d4a026fb260cc0f3e93c5bd`; merge tree `cf472cabfdd983f55b185f06bb5e6d015b1ea3e9`.
- Fresh-fetch ancestry proof passed: accepted source is the second parent and an ancestor of the canonical merge. GitHub author authority is `Ally-cat73 <211229238+Ally-cat73@users.noreply.github.com>`.
- Current phase: clean canonical-merge rebuild, package equivalence audit, exact canonical reinstall and bounded post-merge visual smoke.

## 2026-09-14 — Canonical merge-source validation

- A separate detached build worktree was created at exact merge `d9f1aa15976e97d21d4a026fb260cc0f3e93c5bd`; tree `cf472cabfdd983f55b185f06bb5e6d015b1ea3e9`; submodule remained `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Initial immutable install left a stale install-state marker without materialised `node_modules`. The generated marker was moved intact to `/private/tmp/aera-code-canonical-install-state.pre-rematerialize.gz`; repeating the unchanged immutable install materialised dependencies successfully without source or lockfile change.
- Canonical `corepack yarn check`: PASS; Market 23 files / 268 tests; Desktop 111 files / 1,084 tests PASS, 4 skipped; runtime closure 201 nodes; licence audit 551 packages; operation reliability 7 operations / 18 fault contracts.
- Current phase: package the exact clean canonical merge, audit package identity/equivalence, then reinstall and smoke-test.

## 2026-09-14 — Canonical package accepted for reinstall

- Canonical DMG SHA-256: `8b86cfd38527310ebc0205e0836c52ed98186ee4ef39c167d1b07b5cfa09e66e`; canonical `app.asar` SHA-256: `c90524cd10d5d9a45e78e9928772a647bdeca441ca9c913d5b2937666d10f84a`.
- Bundle `dev.aerastudios.code`, version 2.0.4, universal x86_64 + arm64; DMG smoke verification PASS.
- Accepted and canonical DMGs differ because the DMG/HFS container is regenerated with build-time filesystem metadata. The contained application is exact: 23,275 files on each side and no per-file SHA-256 difference; `app.asar` is byte-identical.
- Expanded canonical packaged audit PASS: executable product-title, HTML-title, system-context and market/terminal presentation paths remain Aera Code; no audited donor-host fallback returned.
- Pre-install rollback remains preserved. Current phase: preserve the accepted PR-head app separately, install the exact canonical app bundle, launch and perform bounded zero-Provider visual smoke.

## 2026-09-14 — Canonical install, smoke and closure

- Accepted PR-head installed bundle was moved intact to `/Users/Allyd/AERA-Workspace/app-backups/Aera Code.app.accepted-pr15-7d9165b8` before canonical reinstall; its `app.asar` hash is unchanged.
- Exact canonical app installed at `/Users/Allyd/Applications/Aera Code.app`; installed, canonical package and accepted-candidate `app.asar` hashes all equal `c90524cd10d5d9a45e78e9928772a647bdeca441ca9c913d5b2937666d10f84a`.
- Bundle `dev.aerastudios.code`, version 2.0.4, universal x86_64 + arm64; launched normally and remained running.
- Bounded post-merge visual smoke PASS: aperture/sidebar/title, New Session, active conversation and Aera Code system-context label, Settings General, Models with `AERA Gateway (governed)`, Aera Code settings with unchanged Profiles, About, and restart confirmation. Confirmation was cancelled.
- Zero-Provider readiness PASS: workspace catalogue loaded, New Session created, governed route present and composer ready. No message sent; Provider effects zero.
- AERA_DEV, Canary, AeraLab, Pi, Gateway, Sentinel, ClickHouse, Provider/model/Channel configuration and hosting remain unchanged.
- Closure/current-state/receipt documentation prepared for a documentation-only canonical banking PR. Future integration and Dev/Canary work is recorded as OPEN only and was not started.
- Baseline receipt `AERA_CODE_PRODUCT_IDENTITY_BASELINE_V1.json` validated as JSON and hashed SHA-256 `6fd65b95a741906ca38dde8fb4d270ac3080a3ee1fe97854bd504ea554c4a374`.
- Closure verdict: `AERA_CODE_PRODUCT_IDENTITY_CONVERGED_AND_CANONICALLY_BANKED`.
