import { describe, expect, test } from 'vitest'
import { InboundPacket } from '../src/packets/inbound/InboundPacket'
import { SessionSetupResponse } from '../src/packets/inbound/SessionSetupResponse'
import { BeginSessionPacket } from '../src/packets/outbound/BeginSessionPacket'
import { EndModemFileTransferPacket } from '../src/packets/outbound/EndModemFileTransferPacket'
import { EndPhoneFileTransferPacket } from '../src/packets/outbound/EndPhoneFileTransferPacket'
import { FlashPartFileTransferPacket } from '../src/packets/outbound/FlashPartFileTransferPacket'
import { OutboundPacket } from '../src/packets/outbound/OutboundPacket'
import { TotalBytesPacket } from '../src/packets/outbound/TotalBytesPacket'

function packedInteger(packet: OutboundPacket, offset: number) {
  return (
    packet.data[offset]! |
    (packet.data[offset + 1]! << 8) |
    (packet.data[offset + 2]! << 16) |
    (packet.data[offset + 3]! << 24)
  )
}

describe('BeginSessionPacket', () => {
  test('packs the protocol version at offset 8', () => {
    const packet = new BeginSessionPacket()
    packet.pack()

    expect(packet.size).toBe(1024)
    expect(packedInteger(packet, 0)).toBe(0x64)
    expect(packedInteger(packet, 4)).toBe(0x00)
    expect(packedInteger(packet, 8)).toBe(0x04)
    expect(packedInteger(packet, 12)).toBe(0x00)
  })

  test('exposes its data size', () => {
    expect(BeginSessionPacket.dataSize).toBe(12)
  })
})

describe('TotalBytesPacket', () => {
  test('packs a small size with a zero upper dword', () => {
    const packet = new TotalBytesPacket(0x12345678)
    packet.pack()

    expect(packedInteger(packet, 0)).toBe(0x64)
    expect(packedInteger(packet, 4)).toBe(0x02)
    expect(packedInteger(packet, 8)).toBe(0x12345678)
    expect(packedInteger(packet, 12)).toBe(0)
  })

  test('splits a size larger than 4GiB across both dwords', () => {
    const packet = new TotalBytesPacket(5 * 1024 * 1024 * 1024 + 2)
    packet.pack()

    expect(packedInteger(packet, 8)).toBe(0x40000002)
    expect(packedInteger(packet, 12)).toBe(0x1)
  })
})

describe('EndPhoneFileTransferPacket', () => {
  test('packs all fields in the reference order', () => {
    const packet = new EndPhoneFileTransferPacket(123456, 0, 2, 24, true)
    packet.pack()

    expect(packedInteger(packet, 0)).toBe(0x66)
    expect(packedInteger(packet, 4)).toBe(0x03)
    expect(packedInteger(packet, 8)).toBe(0x00)
    expect(packedInteger(packet, 12)).toBe(123456)
    expect(packedInteger(packet, 16)).toBe(0)
    expect(packedInteger(packet, 20)).toBe(2)
    expect(packedInteger(packet, 24)).toBe(24)
    expect(packedInteger(packet, 28)).toBe(1)
  })

  test('uses the Lz4End request when the lz4 flag is set', () => {
    const packet = new EndPhoneFileTransferPacket(123456, 0, 2, 24, false, true)
    packet.pack()

    expect(packedInteger(packet, 4)).toBe(0x07)
    expect(packedInteger(packet, 28)).toBe(0)
  })
})

describe('EndModemFileTransferPacket', () => {
  test('packs all fields in the reference order', () => {
    const packet = new EndModemFileTransferPacket(7890, 1, 2, true)
    packet.pack()

    expect(packedInteger(packet, 0)).toBe(0x66)
    expect(packedInteger(packet, 4)).toBe(0x03)
    expect(packedInteger(packet, 8)).toBe(0x01)
    expect(packedInteger(packet, 12)).toBe(7890)
    expect(packedInteger(packet, 16)).toBe(1)
    expect(packedInteger(packet, 20)).toBe(2)
    expect(packedInteger(packet, 24)).toBe(1)
  })

  test('clears the end-of-file flag for an intermediate sequence', () => {
    const packet = new EndModemFileTransferPacket(7890, 1, 2, false)
    packet.pack()

    expect(packedInteger(packet, 24)).toBe(0)
  })
})

describe('FlashPartFileTransferPacket', () => {
  test('packs the sequence byte count', () => {
    const packet = new FlashPartFileTransferPacket(131072)
    packet.pack()

    expect(packedInteger(packet, 0)).toBe(0x66)
    expect(packedInteger(packet, 4)).toBe(0x02)
    expect(packedInteger(packet, 8)).toBe(131072)
  })

  test('uses the Lz4Part request when the lz4 flag is set', () => {
    const packet = new FlashPartFileTransferPacket(131072, true)
    packet.pack()

    expect(packedInteger(packet, 4)).toBe(0x06)
  })
})

describe('OutboundPacket', () => {
  test('packShort writes a little-endian 16-bit value', () => {
    const packet = new OutboundPacket(4)
    packet.packShort(0, 0x1234)

    expect(packet.data[0]).toBe(0x34)
    expect(packet.data[1]).toBe(0x12)
  })

  test('the base pack throws when a subclass has not implemented it', () => {
    expect(() => new OutboundPacket(4).pack()).toThrow('not implemented')
  })
})

describe('InboundPacket', () => {
  test('unpackInteger reads a little-endian 32-bit value', () => {
    const packet = new InboundPacket(4)
    packet.data = new Uint8Array([0x78, 0x56, 0x34, 0x12])

    expect(packet.unpackInteger(0)).toBe(0x12345678)
  })

  test('the base unpack rejects when a subclass has not implemented it', async () => {
    await expect(new InboundPacket(4).unpack()).rejects.toThrow('not implemented')
  })
})

describe('ResponsePacket', () => {
  test('unpack rejects when the received response type does not match', async () => {
    // a freshly constructed response has all-zero data, so the type reads as 0
    const response = new SessionSetupResponse()

    await expect(response.unpack()).rejects.toThrow('response types differ')
  })
})
