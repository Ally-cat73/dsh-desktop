# Aera Code brand surface inventory

Status: COMPLETE BEFORE PRODUCT-SOURCE EDIT  
Baseline: `8a8dd988c19d5cf1f4ad5f48357a013448d2bbc9`

## Classification rule

Only visible host-product identity is replaced. Provider/model names, package/protocol/schema names, operational Profile names, compatibility paths and legally required lineage remain truthful and stable.

| Source path / packaged surface | String or asset | Visible surface | Classification | Action |
| --- | --- | --- | --- | --- |
| `dsh-plugin-desktop/src/client/index.ts` | `applyAeraBrand` absent from active composition | Every renderer generation | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE: invoke existing Aera brand occupant |
| `dsh-plugin-desktop/src/client/aera-brand.tsx` | Existing Aera aperture/name slot occupant and title observer | Sidebar, New Session hero, document title | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE: activate; retain implementation |
| `@deepseek-ai/dsh-client-ui-sidebar` packaged Client | fish mark + `deepseek HARNESS`/fallback build label | Main left sidebar | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE through supported brand slots |
| `@deepseek-ai/dsh-client-ui-conversation` packaged Client | fish hero fallback | New Session | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE through supported hero mark slot |
| Browser document title | `<session> — DeepSeek Harness` | Accessibility/window document title | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with `Aera Code` via existing observer |
| `.yarn/patches/@deepseek-ai-dsh-client-ui-settings-models…patch` | English/Chinese DeepSeek Harness internal-testing welcome copy | First-run onboarding notice | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with Aera Code copy; keep open/plugin language product-neutral |
| `dsh-community-market/src/client/locales.ts` | DeepSeek Harness/DSH Desktop host references | Community-market notices, confirmations and host-state guidance | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with Aera Code or product-neutral host wording; retain plugin compatibility terminology |
| patched `dshmarket/client/client.js` | Restart/start DeepSeek Harness host copy | Optional bundled market UI | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with Aera Code host wording; retain actual `dshmarket` product identity |
| patched `@deepseek-ai/dsh-client-ui-directory-picker-browse` | DSH Desktop native-picker error copy | Directory-picker failure | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with Aera Code; retain package/command identity |
| `dsh-community-market/src/host/routes.ts` and patched `dshmarket/lib/routes.js` | DSH Terminal / DeepSeek Harness host names | Market transport and conflict fallback errors | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with Aera Code; retain route/package semantics |
| patched `@deepseek-ai/dsh-client-ui-renderer` | DeepSeek Harness fallback document title | Initial/error renderer title before product occupant updates it | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with Aera Code; keep supported title composition |
| patched `@deepseek-ai/dsh-web-frontend/dist/index.html` | DeepSeek Harness HTML title | Initial packaged renderer document title | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with Aera Code; retain existing functional frontend patch |
| patched `@deepseek-ai/dsh-system-prompt` | `You are an AI agent powered by DeepSeek Harness.` | Expandable system-context evidence supplied to the model | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE sentence with Aera Code; retain `harness:identity`, config key and package identity |
| `dsh-plugin-desktop/src/client/desktop-settings-locales.ts` | `DSH Terminal could not be opened…` | Desktop settings error | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with Aera Code Terminal |
| `dsh-plugin-desktop/src/startup-recovery-window.ts` | `DSH Terminal is unavailable…` | Recovery error | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with Aera Code Terminal |
| `dsh-plugin-desktop/src/recovery-copy.ts` | `DSH will remove…`, `DSH plugin uninstall` | Recovery confirmation/status | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with Aera Code/built-in plugin wording |
| `dsh-plugin-desktop/src/startup-recovery-controller.ts` | `The DSH plugin command completed…` | Recovery failure | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE with built-in plugin command wording |
| `dsh-plugin-desktop/src/recovery-plugin-uninstall.ts` | `DSH plugin uninstall failed` | Recovery technical failure title | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE title; keep exact `dsh plugin` command in technical detail |
| `dsh-plugin-desktop/src/main.ts` | `DSH home` diagnostic concern label | Diagnostics/recovery presentation | USER_VISIBLE_PRODUCT_IDENTITY | REPLACE label with Aera Code runtime home |
| `dsh-plugin-desktop/src/recovery-copy.ts` | `Harness-home patch`, `DSH home` configuration description | Recovery configuration explanation | INTERNAL_COMPATIBILITY_IDENTIFIER shown in product prose | REPLACE prose with runtime-home wording; underlying paths/schema unchanged |
| `dsh-plugin-desktop/src/desktop-terminal.ts` | literal `dsh` commands | Aera Code Terminal help | INTERNAL_COMPATIBILITY_IDENTIFIER | KEEP_INTERNAL: commands must remain executable/truthful |
| Profile names `aera-gateway-agc`, `aera-gateway-dev-eval`, `aera-gateway-eval`, `desktop`, `headless` | operational Profile IDs | Desktop settings and native menu | INTERNAL_COMPATIBILITY_IDENTIFIER | KEEP_INTERNAL: owner explicitly forbids cosmetic Profile rename |
| `dsh-community-market`, `dsh-market` | actual plugin market identities | Desktop settings | INTERNAL_COMPATIBILITY_IDENTIFIER / third-party product truth | KEEP_INTERNAL |
| `@deepseek-ai/*`, `dsh-plugin-desktop`, `dsh-*` | package/module/slot/service names | Source and technical diagnostics | INTERNAL_COMPATIBILITY_IDENTIFIER | KEEP_INTERNAL |
| `session_id`, DSH URL query markers and settings namespaces | persisted/protocol values | Internal transport/configuration | PROTOCOL / PERSISTED_SCHEMA_IDENTIFIER | KEEP_INTERNAL |
| `legacyUserDataDirectoryName: DSH Desktop` | old application-data location | Migration-only source | PROTOCOL / PERSISTED_SCHEMA_IDENTIFIER | KEEP_INTERNAL: required safe state migration |
| donor update endpoint and update headers | donor-compatible update service identifiers | Internal network/config | INTERNAL_COMPATIBILITY_IDENTIFIER | KEEP_INTERNAL; ensure copy presented to user says Aera Code |
| root/package README, architecture docs, upstream acknowledgements and licence notices | donor lineage and legal attribution | Repository/package documentation | HISTORICAL_DOCUMENTATION | KEEP_HISTORICAL |
| Windows upgrade-smoke paths for `DSH Desktop.exe` and legacy AppData | prior-product compatibility test | Test-only legacy migration | TEST_FIXTURE | KEEP_INTERNAL / KEEP_HISTORICAL |
| DeepSeek Provider/model packages and names | DeepSeek model/provider truth | Model catalogue when configured | LEGITIMATE_PROVIDER_OR_MODEL_IDENTITY | KEEP_PROVIDER_TRUTH |
| `dsh-plugin-desktop/build/aera-code-icon*.png` | accepted Aera aperture app icon | Finder, Dock, About, installer | USER_VISIBLE_PRODUCT_IDENTITY | KEEP active; verify packaged hash/visual |
| `dsh-plugin-desktop/build/aera-aperture.png` | accepted transparent aperture | Sidebar and New Session hero | USER_VISIBLE_PRODUCT_IDENTITY | KEEP active; verify packaged route |
| `dsh-plugin-desktop/build/aera-aperture-tray*` | Aera aperture tray marks | macOS/Windows/Linux tray | USER_VISIBLE_PRODUCT_IDENTITY | KEEP active; verify packaged inclusion |
| obsolete generic `app-icon*` and `tray-icon*` assets | prior donor/generic variants | Not referenced by current Aera package configuration | NOT_USER_VISIBLE | Do not delete; record as unreachable compatibility assets |
| `dsh-plugin-desktop/package.json` | `productName: Aera Code`, `appId: dev.aerastudios.code`, Aera icon paths and Aera artifacts | Packaged metadata | USER_VISIBLE_PRODUCT_IDENTITY | KEEP and verify |
| Native menu and About panel | About/Hide/Quit Aera Code; Aera Code version; Aera Studios copyright | macOS menu/About | USER_VISIBLE_PRODUCT_IDENTITY | KEEP; visually verify |
| Settings General/Models/Desktop settings | Settings; AERA Gateway (governed); Aera Code settings | Settings UI | USER_VISIBLE_PRODUCT_IDENTITY plus provider truth | KEEP; visually verify |
| Conversation provider selection | Aera governed route; truthful OpenAI/DeepSeek/etc. when selected | Composer/models | LEGITIMATE_PROVIDER_OR_MODEL_IDENTITY | KEEP_PROVIDER_TRUTH |

## Baseline visual findings

- **Fail:** left sidebar visibly presents donor fish + `deepseek HARNESS`.
- **Fail:** accessibility document title ends in `DeepSeek Harness`.
- **At risk:** New Session hero falls back to donor fish because the Aera occupant is not activated.
- **At risk:** bundled market, onboarding, native-picker and system-context surfaces contain additional donor host-product copy even when the outer shell is branded.
- **Pass:** native application title bar, macOS app menu, About, Settings heading, Terminal action, bundle name and bundle ID already present as Aera Code.
- **Pass:** Models shows `AERA Gateway (governed)`; no truthful Provider/model identity is being hidden.

The minimum safe implementation is presentation-layer activation plus bounded copy replacement. No internal DSH/package/protocol migration is required.
