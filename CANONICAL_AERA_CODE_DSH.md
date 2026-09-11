============================================================
CANONICAL CURRENT AERA CODE
PRODUCT FAMILY: AERA_CODE_DSH
USE THIS PRODUCT FOR CURRENT AERA CODE WORK
============================================================

THIS IS THE WO-AGC-004 / CURRENT DOGFOOD PRODUCT.

LEGACY AERA IDE AND PRE-DSH AERA CODE SOURCES MUST NOT BE SUBSTITUTED.

Identity (machine-readable): .aera-product-identity.json at this repository root.

- Source repository: https://github.com/Ally-cat73/dsh-desktop.git (fork of anywhere-labs/deepseek-harness-desktop)
- Build target: dsh-plugin-desktop (electron-builder; productName "Aera Code"; appId dev.aerastudios.code)
- Canonical install path: /Users/Allyd/Applications/Aera Code.app — reserved for AERA_CODE_DSH_CANONICAL only
- Structural markers of this family: node_modules/@deepseek-ai/* runtime, lib/aera-collab*.js (native Agent
  Collaboration tools), lib/aera-gateway-agc-binding.js (Aera Gateway governed profile aera-gateway-agc / aera/auto)

FUTURE AGENT SAFETY RULE
"Aera Code" is a DISPLAY NAME, not product identity. Before any build, package, install, dogfood or
source mutation targeting Aera Code, prove productFamily == AERA_CODE_DSH and status == CANONICAL_ACTIVE
from .aera-product-identity.json. If identity is absent, ambiguous or legacy: STOP. Do not infer from
path, version or bundle id. Legacy families (aera-stack apps/aera-code = AERA_CODE_IDE_LEGACY;
apps/aera-msp + apps/aera-code-OLD = AERA_CODE_APP_LEGACY) share display names and bundle ids with
each other and must never be packaged or installed as current Aera Code.

Registry: Aera_Studios_Docs/central-authority/wo-aera-code-product-identity-hygiene-001/AERA_CODE_PRODUCT_VARIANTS_REGISTRY.md
