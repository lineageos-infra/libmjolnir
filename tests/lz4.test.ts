import { describe, expect, test } from 'vitest'
import {
  decompressLz4Block,
  decompressLz4Sequence,
  isLz4Frame,
  lz4Sequences,
  parseLz4FrameHeader
} from '../src/utils/lz4'

const FLG_DEFAULT = 0x68 // version 1, block independence, content size

function buildFrame(
  contentSize: number,
  blockDataSizes: number[],
  flg = FLG_DEFAULT,
  blockSizeCode = 4
) {
  const blocksLength = blockDataSizes.reduce((total, size) => total + 4 + size, 0)
  const frame = new Uint8Array(15 + blocksLength + 4)
  const view = new DataView(frame.buffer)

  view.setUint32(0, 0x184d2204, true)
  frame[4] = flg
  frame[5] = blockSizeCode << 4
  view.setUint32(6, contentSize, true)
  view.setUint32(10, 0, true)
  frame[14] = 0xff // header checksum

  let offset = 15
  for (const size of blockDataSizes) {
    view.setUint32(offset, 0x80000000 | size, true)
    offset += 4
    frame.fill(0xab, offset, offset + size)
    offset += size
  }
  view.setUint32(offset, 0, true) // EndMark

  return frame
}

describe('isLz4Frame', () => {
  test('detects the LZ4 frame magic', () => {
    expect(isLz4Frame(buildFrame(10, [10]))).toBe(true)
    expect(isLz4Frame(new Uint8Array([0x12, 0x34, 0x56, 0x78]))).toBe(false)
    expect(isLz4Frame(new Uint8Array([0x04]))).toBe(false)
  })
})

describe('parseLz4FrameHeader', () => {
  test('parses a valid frame header', () => {
    const header = parseLz4FrameHeader(buildFrame(100000, [10]))

    expect(header.contentSize).toBe(100000)
    expect(header.blockMaxSize).toBe(64 * 1024)
    expect(header.headerLength).toBe(15)
  })

  test('accounts for the dictionary ID in the header length', () => {
    const frame = buildFrame(100, [10], FLG_DEFAULT | 0x01)
    const header = parseLz4FrameHeader(frame)

    expect(header.headerLength).toBe(19)
  })

  test('rejects a frame without a content size', () => {
    expect(() => parseLz4FrameHeader(buildFrame(100, [10], 0x60))).toThrow('content size')
  })

  test('rejects a frame with block checksums', () => {
    expect(() => parseLz4FrameHeader(buildFrame(100, [10], FLG_DEFAULT | 0x10))).toThrow(
      'block checksum'
    )
  })

  test('rejects a frame without block independence', () => {
    expect(() => parseLz4FrameHeader(buildFrame(100, [10], 0x48))).toThrow('block independence')
  })

  test('rejects an invalid block max size code', () => {
    expect(() => parseLz4FrameHeader(buildFrame(100, [10], FLG_DEFAULT, 2))).toThrow(
      'block max size'
    )
  })
})

describe('decompressLz4Block', () => {
  test('decompresses a literals-only block', () => {
    const block = new Uint8Array([0x50, 0x41, 0x42, 0x43, 0x44, 0x45])

    expect(Array.from(decompressLz4Block(block, 64))).toEqual([0x41, 0x42, 0x43, 0x44, 0x45])
  })

  test('decompresses a block with a match', () => {
    const block = new Uint8Array([0x40, 0x61, 0x62, 0x63, 0x64, 0x04, 0x00])

    expect(Array.from(decompressLz4Block(block, 64))).toEqual([
      0x61, 0x62, 0x63, 0x64, 0x61, 0x62, 0x63, 0x64
    ])
  })

  test('decompresses an overlapping (RLE) match', () => {
    const block = new Uint8Array([0x16, 0x78, 0x01, 0x00])

    expect(Array.from(decompressLz4Block(block, 64))).toEqual(new Array(11).fill(0x78))
  })

  test('rejects an invalid match offset', () => {
    const block = new Uint8Array([0x10, 0x78, 0x05, 0x00])

    expect(() => decompressLz4Block(block, 64)).toThrow('match offset')
  })
})

describe('decompressLz4Sequence', () => {
  test('decompresses compressed and stored blocks', () => {
    const compressedBlock = new Uint8Array([0x16, 0x78, 0x01, 0x00])
    const storedBlock = new Uint8Array([0x01, 0x02, 0x03])

    const sequence = new Uint8Array(4 + compressedBlock.length + 4 + storedBlock.length)
    const view = new DataView(sequence.buffer)
    view.setUint32(0, compressedBlock.length, true)
    sequence.set(compressedBlock, 4)
    view.setUint32(4 + compressedBlock.length, 0x80000000 | storedBlock.length, true)
    sequence.set(storedBlock, 4 + compressedBlock.length + 4)

    const decompressed = decompressLz4Sequence(sequence, 64)

    expect(Array.from(decompressed)).toEqual([...new Array(11).fill(0x78), 0x01, 0x02, 0x03])
  })
})

describe('lz4Sequences', () => {
  test('yields one sequence when everything fits', () => {
    const frame = buildFrame(100000, [10, 20])
    const header = parseLz4FrameHeader(frame)

    const sequences = Array.from(lz4Sequences(frame, header, 1024 * 1024))

    expect(sequences).toHaveLength(1)
    expect(sequences[0]!.decompressedSize).toBe(100000)
    expect(sequences[0]!.data).toHaveLength(4 + 10 + 4 + 20)
    expect(sequences[0]!.data[0]).toBe(10)
  })

  test('splits blocks across sequences by decompressed size', () => {
    const frame = buildFrame(100000, [10, 20])
    const header = parseLz4FrameHeader(frame)

    const sequences = Array.from(lz4Sequences(frame, header, 64 * 1024))

    expect(sequences).toHaveLength(2)
    expect(sequences[0]!.decompressedSize).toBe(64 * 1024)
    expect(sequences[0]!.data).toHaveLength(4 + 10)
    expect(sequences[1]!.decompressedSize).toBe(100000 - 64 * 1024)
    expect(sequences[1]!.data).toHaveLength(4 + 20)
  })
})
