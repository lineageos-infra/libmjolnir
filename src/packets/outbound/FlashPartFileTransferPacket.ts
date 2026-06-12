import { FileTransferPacket, FileTransferRequest } from './FileTransferPacket'

export class FlashPartFileTransferPacket extends FileTransferPacket {
  sequenceByteCount: number

  constructor(sequenceByteCount: number, lz4 = false) {
    super(lz4 ? FileTransferRequest.Lz4Part : FileTransferRequest.Part)
    this.sequenceByteCount = sequenceByteCount
  }

  pack() {
    super.pack()
    this.packInteger(FileTransferPacket.dataSize, this.sequenceByteCount)
  }
}
