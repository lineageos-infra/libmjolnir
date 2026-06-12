import { describe, expect, test, vi } from 'vitest'
import { requestDevice } from '../src/helpers'

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
