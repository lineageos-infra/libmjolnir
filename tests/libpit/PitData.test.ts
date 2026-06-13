import fs from 'fs'
import { describe, expect, test } from 'vitest'
import { PitData } from '../../src/libpit/PitData'

const SAMPLES_DIR = 'tests/libpit/samples'
const LEGACY_SAMPLE = `${SAMPLES_DIR}/i9100-stock-sample.pit`

function getFileAsByteArray(filePath: string) {
  const fileData = fs.readFileSync(filePath, 'binary')

  const bytes = [] as number[]
  for (let i = 0; i < fileData.length; i++) {
    bytes.push(fileData.charCodeAt(i) & 0xff)
  }

  return new Uint8Array(bytes)
}

test('unpacks and re-packs a legacy PIT file', () => {
  const bytes = getFileAsByteArray(`${SAMPLES_DIR}/i9100-stock-sample.pit`)
  // clone the bytes array so we can compare it later
  const unpackBytes = bytes.slice()

  const data = new PitData()
  // unpack the data, check for success
  expect(data.unpack(bytes)).toBe(true)

  // re-pack the data
  data.pack(bytes)

  // ensure all bytes match up exactly
  expect(
    unpackBytes.every(function (byte, index) {
      return byte === bytes[index]
    })
  ).toBe(true)
})

function loadLegacyPit() {
  const data = new PitData()
  data.unpack(getFileAsByteArray(LEGACY_SAMPLE))
  return data
}

describe('matches', () => {
  test('returns true for identical PIT data and false when a field differs', () => {
    const a = loadLegacyPit()
    const b = loadLegacyPit()

    expect(a.matches(b)).toBe(true)

    b.lunCount += 1
    expect(a.matches(b)).toBe(false)
  })
})

describe('clear', () => {
  test('resets every field to its empty state', () => {
    const data = loadLegacyPit()
    expect(data.entryCount).toBeGreaterThan(0)

    data.clear()

    expect(data.entryCount).toBe(0)
    expect(data.entries).toHaveLength(0)
    expect(data.lunCount).toBe(0)
    expect(data.fileType).toBe('')
    expect(data.boardType).toBe('')
  })
})

describe('getPaddedSize', () => {
  test('pads up when the data size is not a multiple of the boundary', () => {
    const data = new PitData() // no entries -> 28-byte header
    expect(data.getDataSize()).toBe(28)
    expect(data.getPaddedSize()).toBe(28 + 4096)
  })

  test('leaves an exact multiple of the boundary unchanged', () => {
    const data = new PitData()
    data.entries = new Array(217) // 28 + 217 * 132 = 28672 = 7 * 4096
    expect(data.getDataSize()).toBe(28672)
    expect(data.getPaddedSize()).toBe(28672)
  })
})

describe('unpack', () => {
  test('returns false when the file identifier is wrong', () => {
    const data = new PitData()
    expect(data.unpack(new Uint8Array(64))).toBe(false)
  })
})

describe('fileType and boardType setters', () => {
  test('round-trip through the getters', () => {
    const data = new PitData()
    data.fileType = 'COM_TAR2'
    data.boardType = 'SPRD8735'

    expect(data.fileType).toBe('COM_TAR2')
    expect(data.boardType).toBe('SPRD8735')
  })
})

describe('entry lookups', () => {
  test('getEntry returns the entry at the given index', () => {
    const data = loadLegacyPit()
    expect(data.getEntry(0)).toBe(data.entries[0])
  })

  test('findEntryByName finds a flashable entry and ignores unknown names', () => {
    const data = loadLegacyPit()
    const flashable = data.entries.find((entry) => entry.isFlashable)!

    expect(data.findEntryByName(flashable.partitionName)).toBe(flashable)
    expect(data.findEntryByName('does-not-exist')).toBeUndefined()
  })

  test('findEntryByIdentifier finds a flashable entry by identifier', () => {
    const data = loadLegacyPit()
    const flashable = data.entries.find((entry) => entry.isFlashable)!

    const found = data.findEntryByIdentifier(flashable.identifier)
    expect(found?.identifier).toBe(flashable.identifier)
    expect(found?.isFlashable).toBe(true)
    expect(data.findEntryByIdentifier(0xffffff)).toBeUndefined()
  })
})

test('unpacks and re-packs a PIT file with additional data', () => {
  const bytes = getFileAsByteArray(`${SAMPLES_DIR}/gtexswifi-stock-sample.pit`)
  // clone the bytes array so we can compare it later
  const unpackBytes = bytes.slice()

  const data = new PitData()
  // unpack the data, check for success
  expect(data.unpack(bytes)).toBe(true)
  expect(data.fileType).toBe('COM_TAR2')
  expect(data.boardType).toBe('SPRD8735')

  // re-pack the data
  data.pack(bytes)

  // ensure all bytes match up exactly
  expect(
    unpackBytes.every(function (byte, index) {
      return byte === bytes[index]
    })
  ).toBe(true)
})
