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
