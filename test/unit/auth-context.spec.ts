import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { describe, expect, it } from 'vitest'
import { createH3RequestContext } from '../../server/utils/auth'

function mockEvent(headers: Record<string, string>) {
  const req = new IncomingMessage(new Socket())
  req.method = 'GET'
  req.url = '/api/me'
  req.headers = headers
  const res = new ServerResponse(req)
  return { event: createEvent(req, res), res }
}

describe('createH3RequestContext', () => {
  it('lee solo las cookies de Neon Auth', async () => {
    const { event } = mockEvent({
      host: 'cloudy.test',
      cookie: '__Secure-neon-auth.session_token=abc; cloudy-theme=cloudy',
    })
    const cookies = await createH3RequestContext(event).getCookies()
    expect(cookies).toContain('__Secure-neon-auth.session_token=abc')
    expect(cookies).not.toContain('cloudy-theme')
  })

  it('devuelve cadena vacía sin cookies', async () => {
    const { event } = mockEvent({ host: 'cloudy.test' })
    expect(await createH3RequestContext(event).getCookies()).toBe('')
  })

  it('agrega un Set-Cookie por cada llamada', async () => {
    const { event, res } = mockEvent({ host: 'cloudy.test' })
    const ctx = createH3RequestContext(event)
    await ctx.setCookie('a', '1', { path: '/', httpOnly: true, secure: true, sameSite: 'lax' })
    await ctx.setCookie('b', '2', { path: '/', maxAge: 60 })
    const header = res.getHeader('set-cookie') as string[]
    expect(header).toHaveLength(2)
    expect(header[0]).toMatch(/^a=1/)
    expect(header[0]).toContain('HttpOnly')
    expect(header[1]).toMatch(/^b=2/)
  })

  it('getHeader no distingue mayúsculas y devuelve null si falta', async () => {
    const { event } = mockEvent({ host: 'cloudy.test', 'user-agent': 'vitest' })
    const ctx = createH3RequestContext(event)
    expect(await ctx.getHeader('User-Agent')).toBe('vitest')
    expect(await ctx.getHeader('x-nada')).toBeNull()
  })

  it('getOrigin usa el host de la petición', async () => {
    const { event } = mockEvent({ host: 'cloudy.test' })
    const ctx = createH3RequestContext(event)
    expect(await ctx.getOrigin()).toBe('http://cloudy.test')
    expect(ctx.getFramework()).toBe('nuxt')
  })
})
