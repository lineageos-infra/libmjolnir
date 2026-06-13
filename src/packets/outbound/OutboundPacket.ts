import { BasePacket } from '../BasePacket'

export enum EmptySendKind {
  None,
  Before = 1 << 0,
  After = 1 << 1,
  BeforeAndAfter = Before | After
}

export class OutboundPacket extends BasePacket {
  constructor(size: number) {
    super(size)
  }

  packInteger(offset: number, value: number) {
    this.data[offset] = value & 0x000000ff
    this.data[offset + 1] = (value & 0x0000ff00) >> 8
    this.data[offset + 2] = (value & 0x00ff0000) >> 16
    this.data[offset + 3] = (value & 0xff000000) >> 24
  }

  packShort(offset: number, value: number) {
    this.data[offset] = value & 0x00ff
    this.data[offset + 1] = (value & 0xff00) >> 8
  }

  pack() {
    throw new Error('Packet has not implemented the `pack` method')
  }
}
