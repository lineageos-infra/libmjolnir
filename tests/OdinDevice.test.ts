import fs from 'fs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PitData } from '../src/libpit/PitData'
import { OdinDevice } from '../src/OdinDevice'
import { ResponseType } from '../src/packets/inbound/ResponsePacket'
import { OdinTransport } from '../src/transport/OdinTransport'
import { WebUsbTransport } from '../src/transport/WebUsbTransport'
import { ByteArray } from '../src/utils/ByteArray'

const SAMPLE_PIT = 'tests/libpit/samples/i9100-stock-sample.pit'
const FLG_DEFAULT = 0x68 // version 1, block independence, content size

function readFixture(filePath: string) {
  const fileData = fs.readFileSync(filePath, 'binary')
  const bytes = new Uint8Array(fileData.length)
  for (let i = 0; i < fileData.length; i++) {
    bytes[i] = fileData.charCodeAt(i) & 0xff
  }
  return bytes
}

function createFakeTransport() {
  const sent: Uint8Array[] = []
  const queue: Uint8Array<ArrayBuffer>[] = []
  const transport = {
    connect: vi.fn(async () => {}),
    send: vi.fn(async (data: Uint8Array<ArrayBuffer>) => {
      sent.push(data.slice())
    }),
    receive: vi.fn(async () => {
      const next = queue.shift()
      if (!next) throw new Error('fake transport: no queued response')
      return next
    }),
    emptyReceive: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    onDisconnect: vi.fn()
  } satisfies OdinTransport
  return { transport, sent, queue }
}

/** Builds an 8-byte response packet: LE response type at 0, LE payload at 4. */
function response(type: ResponseType, payload = 0): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(8)
  const view = new DataView(buf.buffer)
  view.setUint32(0, type, true)
  view.setUint32(4, payload, true)
  return buf
}

function readUint32LE(data: Uint8Array, offset: number) {
  return (
    data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)
  )
}

/** Queues the responses a `getPitData` dump consumes for the given PIT bytes. */
function queuePitDump(
  queue: Uint8Array<ArrayBuffer>[],
  pitBytes: Uint8Array<ArrayBuffer>,
  endResponse = response(ResponseType.PitFile, 0)
) {
  queue.push(response(ResponseType.PitFile, pitBytes.length))
  for (let offset = 0; offset < pitBytes.length; offset += 500) {
    queue.push(pitBytes.subarray(offset, Math.min(offset + 500, pitBytes.length)))
  }
  queue.push(endResponse)
}

/** Builds a minimal LZ4 frame with stored (uncompressed) blocks. */
function buildLz4Frame(contentSize: number, blockDataSizes: number[]): Uint8Array<ArrayBuffer> {
  const blocksLength = blockDataSizes.reduce((total, size) => total + 4 + size, 0)
  const frame = new Uint8Array(15 + blocksLength + 4)
  const view = new DataView(frame.buffer)

  view.setUint32(0, 0x184d2204, true)
  frame[4] = FLG_DEFAULT
  frame[5] = 4 << 4
  view.setUint32(6, contentSize, true)
  view.setUint32(10, 0, true)
  frame[14] = 0xff

  let offset = 15
  for (const size of blockDataSizes) {
    view.setUint32(offset, 0x80000000 | size, true)
    offset += 4
    frame.fill(0xab, offset, offset + size)
    offset += size
  }
  view.setUint32(offset, 0, true)

  return frame
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('constructor', () => {
  test('uses an OdinTransport directly', () => {
    const { transport } = createFakeTransport()
    const device = new OdinDevice(transport)

    expect(device.transport).toBe(transport)
    expect(device.usbDevice).toBeUndefined()
  })

  test('wraps a raw USBDevice in a WebUsbTransport', () => {
    const usb = { transferIn: vi.fn() } as unknown as USBDevice
    const device = new OdinDevice(usb)

    expect(device.transport).toBeInstanceOf(WebUsbTransport)
    expect(device.usbDevice).toBe(usb)
  })

  test('exposes the underlying device of a WebUsbTransport', () => {
    const usb = { transferIn: vi.fn() } as unknown as USBDevice
    const device = new OdinDevice(new WebUsbTransport(usb))

    expect(device.transport).toBeInstanceOf(WebUsbTransport)
    expect(device.usbDevice).toBe(usb)
  })

  test('merges options over the defaults', () => {
    const { transport } = createFakeTransport()
    const device = new OdinDevice(transport, { timeout: 1234, logging: true })

    expect(device.deviceOptions).toEqual({ timeout: 1234, logging: true, resetOnInit: false })
  })
})

describe('lz4Supported', () => {
  test('reflects the negotiated flag', () => {
    const { transport } = createFakeTransport()
    const device = new OdinDevice(transport)

    expect(device.lz4Supported).toBe(false)
    device._lz4Supported = true
    expect(device.lz4Supported).toBe(true)
  })
})

describe('onDisconnect', () => {
  test('clears the session flag and runs the callback on disconnect', () => {
    const { transport } = createFakeTransport()
    const device = new OdinDevice(transport)
    device._flashSessionStarted = true

    const callback = vi.fn()
    device.onDisconnect(callback)

    const wrapper = transport.onDisconnect.mock.calls[0]![0]
    wrapper()

    expect(device._flashSessionStarted).toBe(false)
    expect(callback).toHaveBeenCalledTimes(1)
  })
})

describe('initialize', () => {
  test('connects then performs the handshake', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(ByteArray.fromString('LOKE'))
    const device = new OdinDevice(transport)

    await device.initialize()

    expect(transport.connect).toHaveBeenCalledWith(5000)
    expect(ByteArray.toString(sent[0]!)).toBe('ODIN')
  })

  test('throws a wrapped error when connect fails', async () => {
    const { transport } = createFakeTransport()
    transport.connect.mockRejectedValue(new Error('boom'))
    const device = new OdinDevice(transport)

    await expect(device.initialize()).rejects.toThrow('Unable to open and claim device')
  })

  test('logs the failure when logging is enabled', async () => {
    const { transport } = createFakeTransport()
    transport.connect.mockRejectedValue(new Error('boom'))
    const device = new OdinDevice(transport, { logging: true })

    await expect(device.initialize()).rejects.toThrow('Unable to open and claim device')
    expect(console.log).toHaveBeenCalled()
  })
})

describe('handshake', () => {
  test('completes when the device answers LOKE', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(ByteArray.fromString('LOKE'))
    const device = new OdinDevice(transport)

    await device.handshake()

    expect(ByteArray.toString(sent[0]!)).toBe('ODIN')
  })

  test('throws when the challenge response is wrong', async () => {
    const { transport, queue } = createFakeTransport()
    queue.push(ByteArray.fromString('NOPE'))
    const device = new OdinDevice(transport)

    await expect(device.handshake()).rejects.toThrow('handshake challenge mismatch')
  })

  test('resets the device first when resetOnInit is set', async () => {
    const { transport, queue } = createFakeTransport()
    queue.push(ByteArray.fromString('LOKE'))
    const device = new OdinDevice(transport, { resetOnInit: true })

    await device.handshake()

    expect(transport.reset).toHaveBeenCalledWith(5000)
  })

  test('logs the exchange when logging is enabled', async () => {
    const { transport, queue } = createFakeTransport()
    queue.push(ByteArray.fromString('LOKE'))
    const device = new OdinDevice(transport, { logging: true })

    await device.handshake()

    expect(console.log).toHaveBeenCalled()
  })
})

describe('close', () => {
  test('delegates to the transport', async () => {
    const { transport } = createFakeTransport()
    const device = new OdinDevice(transport)

    await device.close()

    expect(transport.close).toHaveBeenCalledWith(5000)
  })
})

describe('requestDeviceType', () => {
  test('sends a DeviceType packet and reads the response', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.SessionSetup, 0))
    const device = new OdinDevice(transport)

    await device.requestDeviceType()

    expect(readUint32LE(sent[0]!, 0)).toBe(0x64) // Session control
    expect(readUint32LE(sent[0]!, 4)).toBe(1) // DeviceType request
  })
})

describe('eraseUserdata', () => {
  test('sends an erase packet and reads the response', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.SessionSetup, 0))
    const device = new OdinDevice(transport)

    await device.eraseUserdata()

    expect(readUint32LE(sent[0]!, 0)).toBe(0x64) // Session control
    expect(readUint32LE(sent[0]!, 4)).toBe(7) // EraseUserdata request
  })
})

describe('beginSession', () => {
  test('starts a session without large packets when result is 0', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.SessionSetup, 0))
    const device = new OdinDevice(transport)

    vi.useFakeTimers()
    const begin = device.beginSession()
    await vi.runAllTimersAsync()
    await begin

    expect(device._flashSessionStarted).toBe(true)
    expect(device.lz4Supported).toBe(false)
    expect(device._flashPacketSize).toBe(131072)
    expect(sent).toHaveLength(1)
    expect(readUint32LE(sent[0]!, 4)).toBe(0) // BeginSession request
  })

  test('detects LZ4 support from the response bit', async () => {
    const { transport, queue } = createFakeTransport()
    queue.push(response(ResponseType.SessionSetup, 0x8000))
    queue.push(response(ResponseType.SessionSetup, 0))
    const device = new OdinDevice(transport)

    vi.useFakeTimers()
    const begin = device.beginSession()
    await vi.runAllTimersAsync()
    await begin

    expect(device.lz4Supported).toBe(true)
  })

  test('negotiates a large packet size when result is non-zero', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.SessionSetup, 0x1234))
    queue.push(response(ResponseType.SessionSetup, 0))
    const device = new OdinDevice(transport)

    vi.useFakeTimers()
    const begin = device.beginSession()
    await vi.runAllTimersAsync()
    await begin

    expect(device._flashTimeout).toBe(120000)
    expect(device._flashPacketSize).toBe(1048576)
    expect(device._flashSequence).toBe(30)
    expect(readUint32LE(sent[1]!, 4)).toBe(5) // FilePartSize request
    expect(readUint32LE(sent[1]!, 8)).toBe(1048576)
  })

  test('is a no-op when a session is already started', async () => {
    const { transport, sent } = createFakeTransport()
    const device = new OdinDevice(transport)
    device._flashSessionStarted = true

    await device.beginSession()

    expect(sent).toHaveLength(0)
  })

  test('forces a new session when forceBegin is set', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.SessionSetup, 0))
    const device = new OdinDevice(transport)
    device._flashSessionStarted = true

    vi.useFakeTimers()
    const begin = device.beginSession(true)
    await vi.runAllTimersAsync()
    await begin

    expect(sent).toHaveLength(1)
  })
})

describe('setFlashPacketSize', () => {
  test('stores the packet size when the device accepts it', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.SessionSetup, 0))
    const device = new OdinDevice(transport)

    await device.setFlashPacketSize(4096, 42)

    expect(device._flashPacketSize).toBe(4096)
    expect(device._flashSequence).toBe(42)
    expect(readUint32LE(sent[0]!, 8)).toBe(4096)
  })

  test('throws when the device rejects the packet size', async () => {
    const { transport, queue } = createFakeTransport()
    queue.push(response(ResponseType.SessionSetup, 1))
    const device = new OdinDevice(transport)

    await expect(device.setFlashPacketSize(4096, 42)).rejects.toThrow('Unexpected file part size')
  })
})

describe('setFlashTotalSize', () => {
  test('sends the total size when the device accepts it', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.SessionSetup, 0))
    const device = new OdinDevice(transport)

    await device.setFlashTotalSize(0x1000)

    expect(readUint32LE(sent[0]!, 4)).toBe(2) // TotalBytes request
    expect(readUint32LE(sent[0]!, 8)).toBe(0x1000)
  })

  test('throws when the device rejects the total size', async () => {
    const { transport, queue } = createFakeTransport()
    queue.push(response(ResponseType.SessionSetup, 1))
    const device = new OdinDevice(transport)

    await expect(device.setFlashTotalSize(0x1000)).rejects.toThrow('Unexpected file part size')
  })
})

describe('endSession', () => {
  test('is a no-op when no session is started', async () => {
    const { transport, sent } = createFakeTransport()
    const device = new OdinDevice(transport)

    await device.endSession()

    expect(sent).toHaveLength(0)
  })

  test('ends an active session', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.EndSession))
    const device = new OdinDevice(transport)
    device._flashSessionStarted = true

    await device.endSession()

    expect(readUint32LE(sent[0]!, 0)).toBe(0x67) // EndSession control
    expect(readUint32LE(sent[0]!, 4)).toBe(0) // EndSession request
    expect(device._flashSessionStarted).toBe(false)
  })

  test('requests a reboot when asked', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.EndSession))
    const device = new OdinDevice(transport)
    device._flashSessionStarted = true

    await device.endSession(true)

    expect(readUint32LE(sent[0]!, 4)).toBe(1) // RebootDevice request
  })

  test('forces an end even when no session is started', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.EndSession))
    const device = new OdinDevice(transport)

    await device.endSession(false, true)

    expect(sent).toHaveLength(1)
  })
})

describe('reboot', () => {
  test('reboots by force-ending the session', async () => {
    const { transport, sent, queue } = createFakeTransport()
    queue.push(response(ResponseType.EndSession))
    const device = new OdinDevice(transport)

    await device.reboot()

    expect(readUint32LE(sent[0]!, 0)).toBe(0x67) // EndSession control
    expect(readUint32LE(sent[0]!, 4)).toBe(1) // RebootDevice request
  })
})

describe('getPitData', () => {
  test('dumps and parses the device PIT, caching the result', async () => {
    const { transport, sent, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    const pitBytes = readFixture(SAMPLE_PIT)
    queuePitDump(queue, pitBytes)

    const pit = await device.getPitData()

    const reference = new PitData()
    reference.unpack(pitBytes)
    expect(pit.matches(reference)).toBe(true)
    expect(device._devicePit).toBe(pit)
    expect(readUint32LE(sent[0]!, 0)).toBe(0x65) // PitFile control
    expect(readUint32LE(sent[0]!, 4)).toBe(1) // Dump request
  })

  test('continues when ending the PIT transfer fails', async () => {
    const { transport, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    const pitBytes = readFixture(SAMPLE_PIT)
    // a wrong-size end response makes the final receivePacket throw; it is swallowed
    queuePitDump(queue, pitBytes, new Uint8Array(4))

    const pit = await device.getPitData()

    const reference = new PitData()
    reference.unpack(pitBytes)
    expect(pit.matches(reference)).toBe(true)
  })

  test('tolerates a failing empty receive during the dump', async () => {
    const { transport, queue } = createFakeTransport()
    transport.emptyReceive.mockRejectedValue(new Error('drain failed'))
    const device = new OdinDevice(transport)
    const pitBytes = readFixture(SAMPLE_PIT)
    queuePitDump(queue, pitBytes)

    const pit = await device.getPitData()

    expect(pit.entryCount).toBeGreaterThan(0)
  })
})

describe('receivePacket', () => {
  test('rejects a response of the wrong size', async () => {
    const { transport, queue } = createFakeTransport()
    queue.push(new Uint8Array(4))
    const device = new OdinDevice(transport)

    await expect(device.requestDeviceType()).rejects.toThrow('incorrect size received')
  })

  test('rejects a mismatched response type', async () => {
    const { transport, queue } = createFakeTransport()
    queue.push(response(ResponseType.PitFile, 0)) // wrong type for a SessionSetup response
    const device = new OdinDevice(transport)

    await expect(device.requestDeviceType()).rejects.toThrow('response types differ')
  })

  test('logs packet activity when logging is enabled', async () => {
    const { transport, queue } = createFakeTransport()
    const device = new OdinDevice(transport, { logging: true })
    const pitBytes = readFixture(SAMPLE_PIT)
    queuePitDump(queue, pitBytes)

    await device.getPitData()

    expect(console.log).toHaveBeenCalled()
  })
})

describe('sendFile', () => {
  test('sends a file split into sequences and parts', async () => {
    const { transport, sent, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    device._flashPacketSize = 4
    device._flashSequence = 2 // max sequence = 8 bytes
    const file = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) // 2 sequences (8 + 2)

    queue.push(response(ResponseType.FileTransfer)) // Flash ack
    // sequence 0: FlashPart ack, 2 parts, end ack
    queue.push(response(ResponseType.FileTransfer))
    queue.push(response(ResponseType.SendFilePart, 0))
    queue.push(response(ResponseType.SendFilePart, 1))
    queue.push(response(ResponseType.FileTransfer))
    // sequence 1: FlashPart ack, 1 part, end ack
    queue.push(response(ResponseType.FileTransfer))
    queue.push(response(ResponseType.SendFilePart, 0))
    queue.push(response(ResponseType.FileTransfer))

    await device.sendFile(file, 0, 0, 5) // ApplicationProcessor

    expect(readUint32LE(sent[0]!, 0)).toBe(0x66) // FileTransfer control
    expect(readUint32LE(sent[0]!, 4)).toBe(0) // Flash request
    // the last packet is an EndPhone file transfer (FileTransfer control, End request)
    const endPacket = sent[sent.length - 1]!
    expect(readUint32LE(endPacket, 0)).toBe(0x66)
    expect(readUint32LE(endPacket, 4)).toBe(3) // End request
  })

  test('uses the modem end packet for CP partitions', async () => {
    const { transport, sent, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    const file = new Uint8Array([1, 2, 3, 4])

    queue.push(response(ResponseType.FileTransfer)) // Flash ack
    queue.push(response(ResponseType.FileTransfer)) // FlashPart ack
    queue.push(response(ResponseType.SendFilePart, 0))
    queue.push(response(ResponseType.FileTransfer)) // end ack

    await device.sendFile(file, 1, 0, 5) // CommunicationProcessor

    const endPacket = sent[sent.length - 1]!
    expect(readUint32LE(endPacket, 0)).toBe(0x66)
    expect(readUint32LE(endPacket, 4)).toBe(3) // End request
  })

  test('throws when the device echoes the wrong part index', async () => {
    const { transport, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    const file = new Uint8Array([1, 2, 3, 4])

    queue.push(response(ResponseType.FileTransfer)) // Flash ack
    queue.push(response(ResponseType.FileTransfer)) // FlashPart ack
    queue.push(response(ResponseType.SendFilePart, 7)) // wrong index

    await expect(device.sendFile(file, 0, 0, 5)).rejects.toThrow('Expected file part index')
  })
})

describe('sendLz4File', () => {
  test('sends compressed data as-is when the device supports LZ4', async () => {
    const { transport, sent, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    device._lz4Supported = true
    const frame = buildLz4Frame(100000, [100000])

    queue.push(response(ResponseType.FileTransfer)) // Lz4Flash ack
    queue.push(response(ResponseType.FileTransfer)) // FlashPart ack
    queue.push(response(ResponseType.SendFilePart, 0))
    queue.push(response(ResponseType.FileTransfer)) // end ack

    await device.sendLz4File(frame, 0, 0, 5)

    expect(readUint32LE(sent[0]!, 0)).toBe(0x66) // FileTransfer control
    expect(readUint32LE(sent[0]!, 4)).toBe(5) // Lz4Flash request
  })

  test('decompresses on the host when the device lacks LZ4 support', async () => {
    const { transport, sent, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    device._lz4Supported = false
    const frame = buildLz4Frame(100000, [100000]) // stored block size == contentSize

    queue.push(response(ResponseType.FileTransfer)) // Flash ack
    queue.push(response(ResponseType.FileTransfer)) // FlashPart ack
    queue.push(response(ResponseType.SendFilePart, 0))
    queue.push(response(ResponseType.FileTransfer)) // end ack

    await device.sendLz4File(frame, 0, 0, 5)

    expect(readUint32LE(sent[0]!, 4)).toBe(0) // Flash request (not Lz4)
  })

  test('throws when the decompressed size does not match the header', async () => {
    const { transport, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    device._lz4Supported = false
    const frame = buildLz4Frame(100000, [50000]) // contentSize 100000 != 50000 decompressed

    queue.push(response(ResponseType.FileTransfer)) // Flash ack

    await expect(device.sendLz4File(frame, 0, 0, 5)).rejects.toThrow('decompressed sequence size')
  })
})

describe('flashPartition', () => {
  test('runs the full begin, dump, flash and end flow', async () => {
    const { transport, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    const pitBytes = readFixture(SAMPLE_PIT)

    const reference = new PitData()
    reference.unpack(pitBytes)
    const entry = reference.entries.find((candidate) => candidate.isFlashable)
    expect(entry).toBeDefined()

    queue.push(response(ResponseType.SessionSetup, 0)) // beginSession
    queuePitDump(queue, pitBytes) // getPitData
    queue.push(response(ResponseType.SessionSetup, 0)) // setFlashTotalSize
    queue.push(response(ResponseType.FileTransfer)) // sendFile Flash ack
    queue.push(response(ResponseType.FileTransfer)) // FlashPart ack
    queue.push(response(ResponseType.SendFilePart, 0))
    queue.push(response(ResponseType.FileTransfer)) // end ack
    queue.push(response(ResponseType.EndSession)) // endSession

    vi.useFakeTimers()
    const flash = device.flashPartition(entry!.partitionName, new Uint8Array(16))
    await vi.runAllTimersAsync()
    await flash

    expect(device._flashSessionStarted).toBe(false)
    expect(device._devicePit).toBeDefined()
  })

  test('reuses a cached PIT and skips the dump', async () => {
    const { transport, sent, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    const pitBytes = readFixture(SAMPLE_PIT)

    const pit = new PitData()
    pit.unpack(pitBytes)
    device._devicePit = pit
    device._flashSessionStarted = true
    const entry = pit.entries.find((candidate) => candidate.isFlashable)!

    queue.push(response(ResponseType.SessionSetup, 0)) // setFlashTotalSize
    queue.push(response(ResponseType.FileTransfer)) // sendFile Flash ack
    queue.push(response(ResponseType.FileTransfer)) // FlashPart ack
    queue.push(response(ResponseType.SendFilePart, 0))
    queue.push(response(ResponseType.FileTransfer)) // end ack
    queue.push(response(ResponseType.EndSession)) // endSession

    await device.flashPartition(entry.partitionName, new Uint8Array(16))

    // no PitFile dump was sent: the first packet is the TotalBytes request
    expect(sent.every((packet) => readUint32LE(packet, 0) !== 0x65)).toBe(true)
    expect(readUint32LE(sent[0]!, 0)).toBe(0x64) // Session control
    expect(readUint32LE(sent[0]!, 4)).toBe(2) // TotalBytes request
  })

  test('throws when the partition is not in the PIT', async () => {
    const { transport } = createFakeTransport()
    const device = new OdinDevice(transport)
    const pitBytes = readFixture(SAMPLE_PIT)

    const pit = new PitData()
    pit.unpack(pitBytes)
    device._devicePit = pit
    device._flashSessionStarted = true

    await expect(device.flashPartition('nope', new Uint8Array(4))).rejects.toThrow(
      'does not have a partition named nope'
    )
  })

  test('uses the LZ4 path for an LZ4 frame', async () => {
    const { transport, sent, queue } = createFakeTransport()
    const device = new OdinDevice(transport)
    device._lz4Supported = true
    const pitBytes = readFixture(SAMPLE_PIT)

    const pit = new PitData()
    pit.unpack(pitBytes)
    device._devicePit = pit
    device._flashSessionStarted = true
    const entry = pit.entries.find((candidate) => candidate.isFlashable)!

    queue.push(response(ResponseType.SessionSetup, 0)) // setFlashTotalSize
    queue.push(response(ResponseType.FileTransfer)) // Lz4Flash ack
    queue.push(response(ResponseType.FileTransfer)) // FlashPart ack
    queue.push(response(ResponseType.SendFilePart, 0))
    queue.push(response(ResponseType.FileTransfer)) // end ack
    queue.push(response(ResponseType.EndSession)) // endSession

    await device.flashPartition(entry.partitionName, buildLz4Frame(100000, [100000]))

    // the file transfer request is Lz4Flash (5), proving the LZ4 path ran
    const transferPacket = sent.find((packet) => readUint32LE(packet, 0) === 0x66)!
    expect(readUint32LE(transferPacket, 4)).toBe(5)
  })
})
