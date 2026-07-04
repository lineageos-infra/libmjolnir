import { describe, expect, test } from 'vitest'
import { ByteArray } from '../src/utils/ByteArray'

describe('ByteArray', () => {
  test('converts a string to a byte array', () => {
    const message = 'LOKI'

    const bytes = ByteArray.fromString(message)
    expect(bytes).toHaveLength(4)
    expect(bytes[0]).toBe(0x4c) // L
    expect(bytes[1]).toBe(0x4f) // O
    expect(bytes[2]).toBe(0x4b) // K
    expect(bytes[3]).toBe(0x49) // I
  })

  test('converts a byte array to a string', () => {
    const bytes = new Uint8Array([0x4c, 0x4f, 0x4b, 0x49])

    const message = ByteArray.toString(bytes)
    expect(message).toBe('LOKI')
  })

  test('trims a byte array to a given length', () => {
    const bytes = ByteArray.fromString('TESTING', 4)
    const message = ByteArray.toString(bytes)

    expect(message).toBe('TEST')
  })

  test('sizes the buffer by encoded byte length, not code-unit count', () => {
    // 'é' is one UTF-16 code unit but two UTF-8 bytes
    const bytes = ByteArray.fromString('café')
    expect([...bytes]).toEqual([0x63, 0x61, 0x66, 0xc3, 0xa9])
  })

  test('never overflows a fixed-length buffer when the encoding is longer', () => {
    // 5 code units, 9 UTF-8 bytes, but the field is only 8 bytes
    expect(() => ByteArray.fromString('aaaaé', 8)).not.toThrow()
    expect(ByteArray.fromString('aaaaé', 8)).toHaveLength(8)
  })

  test('round-trips a multibyte string through fromString/toString', () => {
    const bytes = ByteArray.fromString('naïve')
    expect(ByteArray.toString(bytes)).toBe('naïve')
  })
})
