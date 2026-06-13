import { describe, expect, test, vi } from 'vitest'
import { requestDevice, requestSerialDevice } from '../src/helpers'

describe('requestDevice', () => {
  test('throws an error if browser does not support webUSB', async () => {
    vi.stubGlobal('navigator', {})

    await expect(requestDevice()).rejects.toBeTruthy()
  })

  test('returns a device after one is connected and selected', async () => {
    const usb = { requestDevice: vi.fn().mockResolvedValue({}) }
    vi.stubGlobal('navigator', { usb })

    await expect(requestDevice()).resolves.toBeTruthy()
  })
})

describe('requestSerialDevice', () => {
  test('throws an error if browser does not support Web Serial', async () => {
    vi.stubGlobal('navigator', {})

    await expect(requestSerialDevice()).rejects.toBeTruthy()
  })

  test('returns a device after a port is selected', async () => {
    const serial = { requestPort: vi.fn().mockResolvedValue({}) }
    vi.stubGlobal('navigator', { serial })

    await expect(requestSerialDevice()).resolves.toBeTruthy()
  })
})
