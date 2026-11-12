// T082 — `preconnect` al almacenamiento para las fotos de Peticiones.
import { describe, expect, it } from 'vitest'
import { storagePreconnect } from '../../app/utils/preconnect'

describe('storagePreconnect', () => {
  it('devuelve el origen del endpoint, sin ruta ni credenciales', () => {
    expect(storagePreconnect('https://s3.us-east-1.storage.neon.tech/algo')).toEqual([{ rel: 'preconnect', href: 'https://s3.us-east-1.storage.neon.tech' }])
    expect(storagePreconnect('http://localhost:9000')).toEqual([{ rel: 'preconnect', href: 'http://localhost:9000' }])
  })

  it.each([undefined, '', 'no es url', 'ftp://host'])('sin endpoint útil (%s) no agrega nada', (endpoint) => {
    expect(storagePreconnect(endpoint)).toEqual([])
  })
})
