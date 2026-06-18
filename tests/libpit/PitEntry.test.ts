import { describe, expect, test } from 'vitest'
import { EntryBinaryType, EntryDeviceType, PitEntry } from '../../src/libpit/PitEntry'

function sampleEntry() {
  const entry = new PitEntry()
  entry.binaryType = EntryBinaryType.ApplicationProcessor
  entry.deviceType = EntryDeviceType.MMC
  entry.identifier = 5
  entry.blockSizeOrOffset = 100
  entry.blockCount = 200
  entry.partitionName = 'BOOT'
  entry.flashFilename = 'boot.img'
  return entry
}

describe('matches', () => {
  test('returns true for two equivalent entries', () => {
    expect(sampleEntry().matches(sampleEntry())).toBe(true)
  })

  test('returns false when a numeric field differs', () => {
    const other = sampleEntry()
    other.identifier = 99
    expect(sampleEntry().matches(other)).toBe(false)
  })

  test('returns false when a name differs', () => {
    const other = sampleEntry()
    other.partitionName = 'RECOVERY'
    expect(sampleEntry().matches(other)).toBe(false)
  })

  test('returns false for an undefined counterpart', () => {
    expect(sampleEntry().matches(undefined as unknown as PitEntry)).toBe(false)
  })
})

describe('isFlashable', () => {
  test('is false for an entry with a blank partition name', () => {
    expect(new PitEntry().isFlashable).toBe(false)
  })

  test('is true once the entry has a partition name', () => {
    const entry = new PitEntry()
    entry.partitionName = 'BOOT'
    expect(entry.isFlashable).toBe(true)
  })
})

describe('name accessors', () => {
  test('partitionName, flashFilename and fotaFilename round-trip', () => {
    const entry = new PitEntry()
    entry.partitionName = 'SYSTEM'
    entry.flashFilename = 'system.img'
    entry.fotaFilename = 'fota.bin'

    expect(entry.partitionName).toBe('SYSTEM')
    expect(entry.flashFilename).toBe('system.img')
    expect(entry.fotaFilename).toBe('fota.bin')
  })
})
