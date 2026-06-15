const LZ4_FRAME_MAGIC = 0x184d2204

export type Lz4FrameHeader = {
  contentSize: number
  blockMaxSize: number
  headerLength: number
}

export type Lz4Sequence = {
  decompressedSize: number
  data: Blob
}

const BLOCK_MAX_SIZES: Record<number, number> = {
  4: 64 * 1024,
  5: 256 * 1024,
  6: 1024 * 1024,
  7: 4 * 1024 * 1024
}

export function isLz4Frame(data: Uint8Array): boolean {
  if (data.length < 4) {
    return false
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return view.getUint32(0, true) === LZ4_FRAME_MAGIC
}

export function parseLz4FrameHeader(data: Uint8Array): Lz4FrameHeader {
  if (!isLz4Frame(data)) {
    throw new Error('Not a valid LZ4 frame')
  }
  if (data.length < 15) {
    throw new Error('LZ4 frame header is truncated')
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const flg = data[4]!

  const version = (flg >> 6) & 0x03
  if (version !== 1) {
    throw new Error(`Unsupported LZ4 version: ${version}`)
  }

  const blockIndependence = ((flg >> 5) & 0x01) === 1
  const blockChecksum = ((flg >> 4) & 0x01) === 1
  const contentSizeFlag = ((flg >> 3) & 0x01) === 1
  const dictIdFlag = (flg & 0x01) === 1

  if (!contentSizeFlag) {
    throw new Error('LZ4 content size must be enabled')
  }
  if (blockChecksum) {
    throw new Error('LZ4 block checksum must be disabled')
  }
  if (!blockIndependence) {
    throw new Error('LZ4 block independence must be enabled')
  }

  const blockMaxSizeCode = (data[5]! >> 4) & 0x07
  const blockMaxSize = BLOCK_MAX_SIZES[blockMaxSizeCode]
  if (!blockMaxSize) {
    throw new Error(`Invalid block max size code: ${blockMaxSizeCode}`)
  }

  const contentSize = view.getUint32(10, true) * 0x100000000 + view.getUint32(6, true)

  let headerLength = 6 + 8
  if (dictIdFlag) {
    headerLength += 4
  }
  headerLength += 1

  return { contentSize, blockMaxSize, headerLength }
}

export function decompressLz4Block(src: Uint8Array, maxDecompressedSize: number): Uint8Array {
  const dst = new Uint8Array(maxDecompressedSize)
  let srcIndex = 0
  let dstIndex = 0

  while (srcIndex < src.length) {
    const token = src[srcIndex++]!

    let literalLength = token >> 4
    if (literalLength === 15) {
      let lengthByte
      do {
        lengthByte = src[srcIndex++]!
        literalLength += lengthByte
      } while (lengthByte === 255)
    }

    dst.set(src.subarray(srcIndex, srcIndex + literalLength), dstIndex)
    srcIndex += literalLength
    dstIndex += literalLength

    if (srcIndex >= src.length) {
      break
    }

    const offset = src[srcIndex]! | (src[srcIndex + 1]! << 8)
    srcIndex += 2

    if (offset === 0 || offset > dstIndex) {
      throw new Error('Invalid LZ4 block match offset')
    }

    let matchLength = (token & 0x0f) + 4
    if ((token & 0x0f) === 15) {
      let lengthByte
      do {
        lengthByte = src[srcIndex++]!
        matchLength += lengthByte
      } while (lengthByte === 255)
    }

    let matchIndex = dstIndex - offset
    for (let i = 0; i < matchLength; i++) {
      dst[dstIndex++] = dst[matchIndex++]!
    }
  }

  return dst.subarray(0, dstIndex)
}

export function decompressLz4Sequence(sequenceData: Uint8Array, blockMaxSize: number): Uint8Array {
  const view = new DataView(sequenceData.buffer, sequenceData.byteOffset, sequenceData.byteLength)
  const blocks: Uint8Array[] = []
  let offset = 0
  let totalSize = 0

  while (offset + 4 <= sequenceData.length) {
    const blockSize = view.getUint32(offset, true)
    offset += 4

    const dataSize = blockSize & 0x7fffffff
    const data = sequenceData.subarray(offset, offset + dataSize)
    offset += dataSize

    const isCompressed = (blockSize & 0x80000000) === 0
    const block = isCompressed ? decompressLz4Block(data, blockMaxSize) : data

    blocks.push(block)
    totalSize += block.length
  }

  const result = new Uint8Array(totalSize)
  let resultOffset = 0
  for (const block of blocks) {
    result.set(block, resultOffset)
    resultOffset += block.length
  }

  return result
}

export async function* lz4Sequences(
  data: Blob,
  header: Lz4FrameHeader,
  maxSequenceDecompressedSize: number
): AsyncGenerator<Lz4Sequence> {
  let remainingDecompressed = header.contentSize
  let offset = header.headerLength
  let finished = false

  while (!finished) {
    const decompressedSize = Math.min(remainingDecompressed, maxSequenceDecompressedSize)
    remainingDecompressed -= decompressedSize

    let decompressedSizeUpperBound = 0
    let end = offset

    for (;;) {
      if (end + 4 > data.size) {
        finished = true
        break
      }

      const blockHeader = new Uint8Array(await data.slice(end, end + 4).arrayBuffer())
      const blockSize = new DataView(blockHeader.buffer).getUint32(0, true)
      if (blockSize === 0) {
        finished = true
        break
      }

      decompressedSizeUpperBound += header.blockMaxSize
      end += 4 + (blockSize & 0x7fffffff)

      if (end > data.size) {
        end = data.size
        finished = true
        break
      }

      if (decompressedSizeUpperBound >= decompressedSize) {
        break
      }
    }

    if (end === offset) {
      return
    }

    yield { decompressedSize, data: data.slice(offset, end) }
    offset = end
  }
}
