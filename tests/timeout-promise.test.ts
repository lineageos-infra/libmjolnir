import { describe, expect, test } from 'vitest'
import { timeoutPromise } from '../src/utils/helpers'

describe('timeoutPromise', () => {
  test('resolves with the underlying value when the promise wins', async () => {
    await expect(timeoutPromise(Promise.resolve('done'), 'too slow', 1000)).resolves.toBe('done')
  })

  test('rejects with an Error whose message is the reason on timeout', async () => {
    const pending = new Promise<never>(() => {})

    await expect(timeoutPromise(pending, 'too slow', 10)).rejects.toThrow('too slow')
    await expect(timeoutPromise(pending, 'too slow', 10)).rejects.toBeInstanceOf(Error)
  })

  test('propagates the underlying rejection unchanged', async () => {
    const cause = new Error('boom')

    await expect(timeoutPromise(Promise.reject(cause), 'too slow', 1000)).rejects.toBe(cause)
  })
})
