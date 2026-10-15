import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireCron } from '../../server/utils/cron'
import { expectStatus, makeEvent, RUNTIME_CONFIG } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requireCron', () => {
  it('acepta solo el Bearer exacto de CRON_SECRET', async () => {
    vi.stubGlobal('useRuntimeConfig', () => RUNTIME_CONFIG)
    expect(() => requireCron(makeEvent({ auth: undefined, headers: { authorization: 'Bearer cron-secreto' } }))).not.toThrow()
    for (const authorization of ['Bearer otro', 'Bearer cron-secret', 'cron-secreto', 'Basic cron-secreto', '']) {
      await expectStatus(Promise.resolve().then(() => requireCron(makeEvent({ auth: undefined, headers: { authorization } }))), 401)
    }
    await expectStatus(Promise.resolve().then(() => requireCron(makeEvent({ auth: undefined }))), 401)
  })

  it('sin secreto configurado rechaza todo', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ...RUNTIME_CONFIG, cronSecret: '' }))
    await expectStatus(Promise.resolve().then(() => requireCron(makeEvent({ auth: undefined, headers: { authorization: 'Bearer ' } }))), 401)
  })
})
