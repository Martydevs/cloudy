// T029 / T072 — Selección de Peticiones (feature 007, research D10).
import { beforeEach, describe, expect, it } from 'vitest'
import { prayer } from './prayer-fixtures'

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
    expect(selection.ordered.value[0]!.request.senderName).toBe('Invitado 1')
    expect(selection.toggle(request)).toBe(false)
    expect(selection.count.value).toBe(0)
  })

  it('cualquier petición aprobada se elige y nace sin texto', () => {
    const selection = usePrayerSelection()
    expect(selection.toggle(prayer(1))).toBe(true)
    expect(selection.ordered.value[0]!.text).toBe('')
    expect(selection.missingText.value).toBe(1)
    expect(selection.ready.value).toBe(false)
  })

  it('setText guarda el texto; con todos escritos queda lista para generar', () => {
    const selection = usePrayerSelection()
    selection.toggle(prayer(1))
    selection.toggle(prayer(2))
    selection.setText(prayer(1).id, 'Oremos por Ana')
    expect(selection.missingText.value).toBe(1)
    expect(selection.ready.value).toBe(false)
    selection.setText(prayer(2).id, '  Oremos por Luis  ')
    expect(selection.missingText.value).toBe(0)
    expect(selection.ready.value).toBe(true)
    // Un texto en blanco vuelve a faltar.
    selection.setText(prayer(2).id, '   ')
    expect(selection.ready.value).toBe(false)
    // Un id que no está elegido no agrega nada.
    selection.setText(prayer(9).id, 'x')
    expect(selection.count.value).toBe(2)
  })

  it('sin nada elegido no se puede generar', () => {
    expect(usePrayerSelection().ready.value).toBe(false)
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
    expect(selection.ordered.value.map(e => e.request.senderName)).toEqual(['Invitado 5', 'Invitado 4', 'Invitado 3', 'Invitado 2', 'Invitado 1'])
    expect(selection.groups.value.map(g => g.length)).toEqual([4, 1])
    expect(selection.groups.value[1]![0]!.request.senderName).toBe('Invitado 1')
  })

  it('remove y clear', () => {
    const selection = usePrayerSelection()
    for (const n of [1, 2, 3]) selection.toggle(prayer(n))
    selection.remove([prayer(1).id, prayer(3).id, 'otro'])
    expect(selection.ordered.value.map(e => e.request.id)).toEqual([prayer(2).id])
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

  it('el texto escrito se conserva al cambiar otra entrada', () => {
    const selection = usePrayerSelection()
    selection.toggle(prayer(1))
    selection.toggle(prayer(2))
    selection.setText(prayer(1).id, 'Primero')
    selection.setText(prayer(2).id, 'Segundo')
    expect(selection.ordered.value.map(e => e.text)).toEqual(['Segundo', 'Primero'])
  })
})
