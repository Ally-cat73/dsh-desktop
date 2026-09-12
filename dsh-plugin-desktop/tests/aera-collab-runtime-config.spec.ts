import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AERA_COLLAB_RUNTIME_CONFIG_FILENAME,
  applyAeraCollaborationProfileConfig,
} from '../src/aera-collab-runtime-config.ts'

function fixture(): { profileDir: string, environment: NodeJS.ProcessEnv } {
  const profileDir = mkdtempSync(join(tmpdir(), 'aera-collab-runtime-config-'))
  return { profileDir, environment: {} }
}

function validDocument(root: string): Record<string, unknown> {
  return {
    version: 1,
    environment: {
      AERA_COLLAB_STORE_DIR: join(root, 'store'),
      AERA_COLLAB_CORPUS_ROOT: join(root, 'corpus'),
      AERA_COLLAB_STACK_ROOT: join(root, 'stack'),
      AERA_COLLAB_PRINCIPAL_ID: 'aera:participant:1282bf47-b171-46dc-a40c-a20e17c449b5',
      AERA_COLLAB_PRINCIPAL_NAME: 'TEST Owner',
      AERA_COLLAB_WORKSPACE_ROOT: join(root, 'worktree'),
      AERA_COLLAB_AGENT_NAME: 'TEST Governed Worker A',
      AERA_COLLAB_AGENT_ROLE: 'IMPLEMENTER',
      AERA_COLLAB_DELEGATION_ID: 'TEST-governed-delegation-001',
    },
  }
}

function writeDocument(profileDir: string, document: Record<string, unknown>): void {
  writeFileSync(
    join(profileDir, AERA_COLLAB_RUNTIME_CONFIG_FILENAME),
    `${JSON.stringify(document)}\n`,
    { mode: 0o600 },
  )
}

describe('Aera collaboration profile runtime configuration', () => {
  it('keeps collaboration honestly unconfigured when the selected Profile has no document', () => {
    const input = fixture()
    expect(applyAeraCollaborationProfileConfig(input)).toEqual({ status: 'not-configured' })
    expect(input.environment).toEqual({})
  })

  it('loads only the strict non-secret collaboration keys from the selected Profile', () => {
    const input = fixture()
    const document = validDocument(input.profileDir)
    writeDocument(input.profileDir, document)

    expect(applyAeraCollaborationProfileConfig(input)).toEqual({ status: 'loaded', fieldCount: 9 })
    expect(input.environment).toEqual(document.environment)
    expect(Object.keys(input.environment).some(key => /KEY|TOKEN|SECRET|PASSWORD|COOKIE/i.test(key))).toBe(false)
  })

  it('makes the selected Profile authoritative over conflicting ambient collaboration values', () => {
    const input = fixture()
    writeDocument(input.profileDir, validDocument(input.profileDir))
    input.environment.AERA_COLLAB_STORE_DIR = '/tmp/wrong-profile-store'
    input.environment.AERA_COLLAB_AGENT_ROLE = 'REVIEWER'

    expect(applyAeraCollaborationProfileConfig(input).status).toBe('loaded')
    expect(input.environment.AERA_COLLAB_STORE_DIR).toBe(join(input.profileDir, 'store'))
    expect(input.environment.AERA_COLLAB_AGENT_ROLE).toBe('IMPLEMENTER')
  })

  it('rejects unknown or credential-shaped fields instead of importing them', () => {
    const input = fixture()
    const document = validDocument(input.profileDir)
    ;(document.environment as Record<string, string>).AERA_GATEWAY_AGC_EXECUTION_KEY = 'must-not-load'
    writeDocument(input.profileDir, document)

    expect(() => applyAeraCollaborationProfileConfig(input)).toThrow(/unsupported environment key/)
    expect(input.environment.AERA_GATEWAY_AGC_EXECUTION_KEY).toBeUndefined()
  })

  it('rejects malformed paths, roles, and symlinked configuration files', () => {
    const badPath = fixture()
    const badPathDocument = validDocument(badPath.profileDir)
    ;(badPathDocument.environment as Record<string, string>).AERA_COLLAB_STORE_DIR = 'relative/store'
    writeDocument(badPath.profileDir, badPathDocument)
    expect(() => applyAeraCollaborationProfileConfig(badPath)).toThrow(/absolute path/)

    const badRole = fixture()
    const badRoleDocument = validDocument(badRole.profileDir)
    ;(badRoleDocument.environment as Record<string, string>).AERA_COLLAB_AGENT_ROLE = 'OWNER'
    writeDocument(badRole.profileDir, badRoleDocument)
    expect(() => applyAeraCollaborationProfileConfig(badRole)).toThrow(/agent role/)

    const linked = fixture()
    const external = mkdtempSync(join(tmpdir(), 'aera-collab-runtime-config-external-'))
    mkdirSync(external, { recursive: true })
    const externalFile = join(external, 'config.json')
    writeFileSync(externalFile, `${JSON.stringify(validDocument(linked.profileDir))}\n`, { mode: 0o600 })
    symlinkSync(externalFile, join(linked.profileDir, AERA_COLLAB_RUNTIME_CONFIG_FILENAME))
    expect(() => applyAeraCollaborationProfileConfig(linked)).toThrow(/regular file/)
  })
})
