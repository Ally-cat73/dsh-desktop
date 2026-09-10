/** Canonical owner-facing identity for this AERA desktop overlay. */

/** Product metadata shared by Electron, renderer composition, and packaging tests. */
export const AERA_CODE_PRODUCT = Object.freeze({
  productName: 'Aera Code',
  shortName: 'Aera Code',
  bundleIdentifier: 'dev.aerastudios.code',
  description: 'AERA-branded desktop agent workspace with governed AERA Gateway integration',
  userDataDirectoryName: 'Aera Code',
  legacyUserDataDirectoryName: 'DSH Desktop',
  windowTitle: 'Aera Code',
  iconFilename: 'aera-code-icon.png',
  macIconFilename: 'aera-code-icon-mac.png',
  trayIconFilename: 'aera-aperture-tray.svg',
  gatewayProfileName: 'aera-gateway-eval',
  gatewayCredentialEnvironmentName: 'AERA_GATEWAY_DSH_EVAL_KEY',
  gatewayKeychainService: 'com.aera.gateway.canary.execution',
  gatewayKeychainAccount: 'Allyd',
  gatewayProfiles: Object.freeze({
    'aera-gateway-eval': Object.freeze({
      credentialEnvironmentName: 'AERA_GATEWAY_DSH_EVAL_KEY',
      keychainService: 'com.aera.gateway.canary.execution',
      keychainAccount: 'Allyd',
    }),
    'aera-gateway-dev-eval': Object.freeze({
      credentialEnvironmentName: 'AERA_GATEWAY_DEV_EXECUTION_KEY',
      keychainService: 'com.aera.gateway.dev.execution',
      keychainAccount: 'Alyshia Daley',
    }),
    // WO-AGC-004 §21 — the governed dogfood execution credential. The
    // Keychain account is the Router-side credential record name, so the
    // stored item names the exact bounded key it carries. Only the NAME
    // appears here; the value is imported into Keychain by the install
    // custody step and never touches source, Git, the bundle, or evidence.
    'aera-gateway-agc': Object.freeze({
      credentialEnvironmentName: 'AERA_GATEWAY_AGC_EXECUTION_KEY',
      keychainService: 'com.aera.gateway.agc.execution',
      keychainAccount: 'agc-relay-dogfood-canonical-2026-09-10',
    }),
  }),
} as const)

export type AeraCodeProduct = typeof AERA_CODE_PRODUCT
