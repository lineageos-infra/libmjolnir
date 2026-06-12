import { EndFileTransferPacket, FileTransferDestination } from './EndFileTransferPacket'

export class EndModemFileTransferPacket extends EndFileTransferPacket {
  endOfFile: number

  constructor(
    sequenceByteCount: number,
    binaryType: number,
    chipIdentifier: number,
    endOfFile: boolean,
    lz4 = false
  ) {
    super(FileTransferDestination.Modem, sequenceByteCount, binaryType, chipIdentifier, lz4)
    this.endOfFile = endOfFile ? 1 : 0
  }

  pack() {
    super.pack()

    this.packInteger(EndFileTransferPacket.dataSize, this.endOfFile)
  }
}
