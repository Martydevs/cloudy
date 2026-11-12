// T029 / T072 — Selección de Peticiones (feature 007, research D10).
import { beforeEach, describe, expect, it } from 'vitest'
import { prayer, prayerText } from './prayer-fixtures'

beforeEach(() => {
  usePrayerSelection().clear()
})

describe('usePrayerSelection', () => {
  it('toggle agrega una copia y la quita', () => {
    const selection = usePrayerSelection()
    const request = prayer(1)
    expect(selection.toggle(request)).toBe(true)
    expect(selection.isSelected(request.id)).toBe(true)
    expect(selection.count.value).toBe(1)
    request.senderName = 'cambiado'
    expect(selection.ordered.value[0]!.senderName).toBe('Invitado 1')
    expect(selection.toggle(request)).toBe(false)
    expect(selection.count.value).toBe(0)
  })

  it('solo marca tarjetas con texto', () => {
    const selection = usePrayerSelection()
    expect(selection.toggle(prayer(1, { text: prayerText({ status: 'empty', text: null }) }))).toBe(false)
    expect(selection.toggle(prayer(2, { text: prayerText({ text: '   ' }) }))).toBe(false)
    expect(selection.count.value).toBe(0)
  })

  it('con 40 elegidas llega al tope y no agrega más, pero sí quita', () => {
    const selection = usePrayerSelection()
    for (let i = 1; i <= 40; i++) selection.toggle(prayer(i))
    expect(selection.count.value).toBe(40)
    expect(selection.limitReached.value).toBe(true)
    expect(selection.toggle(prayer(41))).toBe(false)
    expect(selection.count.value).toBe(40)
    selection.toggle(prayer(1))
    expect(selection.limitReached.value).toBe(false)
  })

  it('ordered sigue aprobación, envío e id; groups corta de 4 en 4', () => {
    const selection = usePrayerSelection()
    for (const n of [3, 1, 5, 2, 4]) selection.toggle(prayer(n))
    // `prayer(n)`: mayor n = aprobada antes.
    expect(selection.ordered.value.map(r => r.senderName)).toEqual(['Invitado 5', 'Invitado 4', 'Invitado 3', 'Invitado 2', 'Invitado 1'])
    expect(selection.groups.value.map(g => g.length)).toEqual([4, 1])
    expect(selection.groups.value[1]![0]!.senderName).toBe('Invitado 1')
  })

  it('unreadable lista las elegidas con marcas de ilegible', () => {
    const selection = usePrayerSelection()
    selection.toggle(prayer(1, { text: prayerText({ text: 'Por [ilegible]' }) }))
    selection.toggle(prayer(2))
    expect(selection.unreadable.value.map(r => r.id)).toEqual([prayer(1).id])
  })

  it('remove y clear', () => {
    const selection = usePrayerSelection()
    for (const n of [1, 2, 3]) selection.toggle(prayer(n))
    selection.remove([prayer(1).id, prayer(3).id, 'otro'])
    expect(selection.ordered.value.map(r => r.id)).toEqual([prayer(2).id])
    selection.clear()
    expect(selection.count.value).toBe(0)
  })

  it('la selección es compartida (useState) y sobrevive a que la tarjeta deje de estar en la lista', () => {
    usePrayerSelection().toggle(prayer(1))
    expect(usePrayerSelection().isSelected(prayer(1).id)).toBe(true)
  })

  it('el estado no se filtra entre pruebas', () => {
    expect(usePrayerSelection().count.value).toBe(0)
  })

  it('sync reemplaza la copia elegida y la quita si se queda sin texto', () => {
    const selection = usePrayerSelection()
    selection.toggle(prayer(1))
    selection.sync(prayer(1, { text: prayerText({ text: 'Texto corregido', editedAt: '2026-11-07T11:00:00.000Z' }) }))
    expect(selection.ordered.value[0]!.text.text).toBe('Texto corregido')
    selection.sync(prayer(2))
    expect(selection.isSelected(prayer(2).id)).toBe(false)
    selection.sync(prayer(1, { text: prayerText({ status: 'empty', text: null }) }))
    expect(selection.count.value).toBe(0)
  })
})
