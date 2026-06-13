import { describe, expect, test, vi } from 'vitest'
import { WebSerialTransport } from '../../src/transport/WebSerialTransport'

function createFakePort() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    }
  })

  const writes: Uint8Array[] = []
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writes.push(chunk)
    }
  })

  const open = vi.fn().mockResolvedValue(undefined)
  const close = vi.fn().mockResolvedValue(undefined)
  const setSignals = vi.fn().mockResolvedValue(undefined)

  const port = {
    open,
    close,
    setSignals,
    readable,
    writable
  } as unknown as SerialPort

  return {
    port,
    writes,
    open,
    close,
    setSignals,
    enqueue: (data: number[]) => controller.enqueue(new Uint8Array(data)),
    closeStream: () => controller.close()
  }
}

async function connectedTransport() {
  const fake = createFakePort()
  const transport = new WebSerialTransport(fake.port)
  await transport.connect(1000)
  return { transport, ...fake }
}

describe('WebSerialTransport', () => {
  test('returns exactly the requested length and keeps the remainder buffered', async () => {
    const { transport, enqueue } = await connectedTransport()
    enqueue([1, 2, 3, 4, 5, 6])

    expect([...(await transport.receive(4, 1000))]).toEqual([1, 2, 3, 4])
    // resolves from the buffer without another read
    expect([...(await transport.receive(2, 1000))]).toEqual([5, 6])
  })

  test('accumulates across multiple chunks', async () => {
    const { transport, enqueue } = await connectedTransport()
    enqueue([1, 2])
    enqueue([3, 4])

    expect([...(await transport.receive(4, 1000))]).toEqual([1, 2, 3, 4])
  })

  test('skips empty chunks while buffering', async () => {
    const { transport, enqueue } = await connectedTransport()
    enqueue([]) // an empty chunk must not disturb buffering
    enqueue([1, 2])

    expect([...(await transport.receive(2, 1000))]).toEqual([1, 2])
  })

  test('writes sent data to the port', async () => {
    const { transport, writes } = await connectedTransport()
    await transport.send(new Uint8Array([9, 8, 7]), 1000)

    expect(writes).toHaveLength(1)
    expect([...writes[0]!]).toEqual([9, 8, 7])
  })

  test('resumes a timed-out read instead of dropping its chunk', async () => {
    const { transport, enqueue } = await connectedTransport()

    await expect(transport.receive(2, 20)).rejects.toThrow()

    enqueue([7, 8])
    expect([...(await transport.receive(2, 1000))]).toEqual([7, 8])
  })

  test('emptyReceive buffers bytes for the next receive', async () => {
    const { transport, enqueue } = await connectedTransport()
    enqueue([1, 2, 3])

    await transport.emptyReceive(1024, 1000)
    expect([...(await transport.receive(3, 1000))]).toEqual([1, 2, 3])
  })

  test('emptyReceive rejects when nothing arrives', async () => {
    const { transport } = await connectedTransport()
    await expect(transport.emptyReceive(1024, 20)).rejects.toThrow()
  })

  test('connect tolerates a port that cannot set DTR', async () => {
    const fake = createFakePort()
    fake.setSignals.mockRejectedValue(new Error('unsupported'))
    const transport = new WebSerialTransport(fake.port)

    await expect(transport.connect(1000)).resolves.toBeUndefined()

    // still usable afterwards
    fake.enqueue([1, 2])
    expect([...(await transport.receive(2, 1000))]).toEqual([1, 2])
  })

  test('connect throws when the port exposes no readable/writable streams', async () => {
    const port = {
      open: vi.fn().mockResolvedValue(undefined),
      setSignals: vi.fn().mockResolvedValue(undefined),
      readable: null,
      writable: null
    } as unknown as SerialPort
    const transport = new WebSerialTransport(port)

    await expect(transport.connect(1000)).rejects.toThrow(
      'serial port did not expose readable/writable streams'
    )
  })

  test('send throws before the port is open', async () => {
    const { port } = createFakePort()
    const transport = new WebSerialTransport(port)

    await expect(transport.send(new Uint8Array([1]), 1000)).rejects.toThrow(
      'serial port is not open'
    )
  })

  test('receive throws before the port is open', async () => {
    const { port } = createFakePort()
    const transport = new WebSerialTransport(port)

    await expect(transport.receive(1, 1000)).rejects.toThrow('serial port is not open')
  })

  test('receive throws when the serial stream closes', async () => {
    const { transport, closeStream } = await connectedTransport()
    closeStream()

    await expect(transport.receive(1, 1000)).rejects.toThrow('serial stream closed')
  })

  test('reset is a no-op that resolves', async () => {
    const { transport } = await connectedTransport()
    await expect(transport.reset()).resolves.toBeUndefined()
  })

  test('close releases resources and closes the port', async () => {
    const { transport, close } = await connectedTransport()

    await transport.close(1000)

    expect(close).toHaveBeenCalledTimes(1)
    // the writer was released, so the port is no longer usable
    await expect(transport.send(new Uint8Array([1]), 1000)).rejects.toThrow(
      'serial port is not open'
    )
  })

  test('close is safe before the port is connected', async () => {
    const { port, close } = createFakePort()
    const transport = new WebSerialTransport(port)

    await expect(transport.close(1000)).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('onDisconnect fires the callback only when its own port disconnects', () => {
    const { port } = createFakePort()
    const transport = new WebSerialTransport(port)
    let handler!: (event: Event) => void
    const serial = {
      addEventListener: vi.fn((_type, listener) => {
        handler = listener
      }),
      removeEventListener: vi.fn()
    }
    vi.stubGlobal('navigator', { serial })

    const callback = vi.fn()
    transport.onDisconnect(callback)

    handler({ target: {} } as unknown as Event) // a different port
    expect(callback).not.toHaveBeenCalled()

    handler({ target: port } as unknown as Event)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(serial.removeEventListener).toHaveBeenCalled()
  })
})
