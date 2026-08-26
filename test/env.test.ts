import { describe, expect, it } from 'vitest'

import { agentRuntimeEnvSchema } from '../src/config/env.js'

const requiredRuntimeEnv = {
  SPEC2PROOF_ALLOWED_HOSTS: 'staging.example.com, API-STAGING.EXAMPLE.COM ',
}

describe('agent runtime environment', () => {
  it('applies boolean defaults using the transformed output type', () => {
    const env = agentRuntimeEnvSchema.parse(requiredRuntimeEnv)

    expect(env.SPEC2PROOF_ALLOW_HTTP).toBe(false)
    expect(env.SPEC2PROOF_ALLOW_PRIVATE_HOSTS).toBe(false)
    expect(env.SPEC2PROOF_BROWSER_HEADLESS).toBe(true)
    expect(env.SPEC2PROOF_ALLOWED_HOSTS).toEqual([
      'staging.example.com',
      'api-staging.example.com',
    ])
  })

  it('parses explicit boolean strings from process-style environment values', () => {
    const env = agentRuntimeEnvSchema.parse({
      ...requiredRuntimeEnv,
      SPEC2PROOF_ALLOW_HTTP: 'true',
      SPEC2PROOF_ALLOW_PRIVATE_HOSTS: 'true',
      SPEC2PROOF_BROWSER_HEADLESS: 'false',
    })

    expect(env.SPEC2PROOF_ALLOW_HTTP).toBe(true)
    expect(env.SPEC2PROOF_ALLOW_PRIVATE_HOSTS).toBe(true)
    expect(env.SPEC2PROOF_BROWSER_HEADLESS).toBe(false)
  })
})
