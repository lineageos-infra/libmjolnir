import { EntryBinaryType, PitData } from './libpit'
import { EndSessionResponse } from './packets/inbound/EndSessionResponse'
import { FileTransferResponse } from './packets/inbound/FileTransferResponse'
import { InboundPacket } from './packets/inbound/InboundPacket'
import { PitFileResponse } from './packets/inbound/PitFileResponse'
import { ReceiveFilePartPacket } from './packets/inbound/ReceiveFilePartPacket'
import { SendFilePartResponse } from './packets/inbound/SendFilePartResponse'
import { SessionSetupResponse } from './packets/inbound/SessionSetupResponse'
import { BeginSessionPacket } from './packets/outbound/BeginSessionPacket'
import { DeviceTypePacket } from './packets/outbound/DeviceTypePacket'
import { DumpPartPitFilePacket } from './packets/outbound/DumpPartPitFilePacket'
import { EndModemFileTransferPacket } from './packets/outbound/EndModemFileTransferPacket'
import { EndPhoneFileTransferPacket } from './packets/outbound/EndPhoneFileTransferPacket'
import { EndSessionPacket, EndSessionRequest } from './packets/outbound/EndSessionPacket'
import { EraseUserdataPacket } from './packets/outbound/EraseUserdataPacket'
import { FilePartSizePacket } from './packets/outbound/FilePartSizePacket'
import { FileTransferPacket, FileTransferRequest } from './packets/outbound/FileTransferPacket'
import { FlashPartFileTransferPacket } from './packets/outbound/FlashPartFileTransferPacket'
import { OutboundPacket } from './packets/outbound/OutboundPacket'
import { PitFilePacket, PitFileRequest } from './packets/outbound/PitFilePacket'
import { SendFilePartPacket } from './packets/outbound/SendFilePartPacket'
import { TotalBytesPacket } from './packets/outbound/TotalBytesPacket'
import { ByteArray } from './utils/ByteArray'
import { timeoutPromise } from './utils/helpers'
import { decompressLz4Sequence, isLz4Frame, lz4Sequences, parseLz4FrameHeader } from './utils/lz4'

export type DeviceOptions = {
  /** whether to enable additional logging (basic logging is already enabled) */
  logging: boolean
  /** the number of milliseconds to time out after */
  timeout: number
  /** some OSes (like Ubuntu) have an issue with libusb that requires a reset call to be made on initialization */
  resetOnInit: boolean
}

const USB_CLASS_CDC_DATA = 0x0a

const BEGIN_SESSION_DELAY = 3000

// Short: no response is expected from a drain receive, so it just elapses.
const EMPTY_RECEIVE_TIMEOUT = 100;

const DEFAULT_DEVICE_OPTIONS = {
  logging: false,
  timeout: 5000,
  resetOnInit: false
} as DeviceOptions

export class OdinDevice {
  usbDevice: USBDevice
  outEndpointNum = -1
  inEndpointNum = -1
  deviceOptions: DeviceOptions

  _devicePit?: PitData

  /** The amount of time to wait for flash packets (per packet, in milliseconds) */
  _flashTimeout = 30_000
  _flashSequence = 800
  /** The maximum packet size for flash packets */
  _flashPacketSize = 131072

  _flashSessionStarted = false
  _lz4Supported = false

  constructor(usbDevice: USBDevice, options?: Partial<DeviceOptions>) {
    this.usbDevice = usbDevice
    this.deviceOptions = { ...DEFAULT_DEVICE_OPTIONS, ...options }
  }

  get lz4Supported() {
    return this._lz4Supported
  }

  onDisconnect(callback: () => void) {
    const eventHandler = (event: USBConnectionEvent) => {
      if (event.device === this.usbDevice) {
        callback()
        this._flashSessionStarted = false
        navigator.usb.removeEventListener('disconnect', eventHandler)
      }
    }
    navigator.usb.addEventListener('disconnect', eventHandler)
  }

  /**
   * Open and claim the device, and perform the Odin handshake
   */
  async initialize() {
    try {
      await timeoutPromise(
        this.usbDevice.open(),
        '[initialize] unable to open device handle',
        this.deviceOptions.timeout
      )

      if (!this.usbDevice.configuration) {
        await timeoutPromise(
          this.usbDevice.selectConfiguration(1),
          '[initialize] unable to select device configuration',
          this.deviceOptions.timeout
        )
      }

      let interfaceNum = -1
      let altInterfaceNum = -1

      if (!this.usbDevice.configuration) {
        throw new Error('Unable to select the proper configuration')
      }

      const usbConfiguration = this.usbDevice.configuration

      for (const interfaceIndex in usbConfiguration.interfaces) {
        const usbInterface = usbConfiguration.interfaces[interfaceIndex]!

        for (const altIndex in usbInterface.alternates) {
          const altInterface = usbInterface.alternates[altIndex]!

          const outEndpoint =
            altInterface.endpoints.find((endpoint) => endpoint.direction === 'out')
              ?.endpointNumber || -1
          const inEndpoint =
            altInterface.endpoints.find((endpoint) => endpoint.direction === 'in')
              ?.endpointNumber || -1

          if (
            altInterface.endpoints.length === 2 &&
            altInterface.interfaceClass === USB_CLASS_CDC_DATA &&
            outEndpoint != -1 &&
            inEndpoint != -1
          ) {
            altInterfaceNum = Number(altIndex)
            this.outEndpointNum = outEndpoint
            this.inEndpointNum = inEndpoint
            break
          }
        }

        if (altInterfaceNum !== -1) {
          interfaceNum = Number(interfaceIndex)
          break
        }
      }

      if (this.outEndpointNum === -1 || this.inEndpointNum === -1) {
        throw new Error('Unable to locate the bulk command endpoints')
      }

      await timeoutPromise(
        this.usbDevice.claimInterface(interfaceNum),
        '[initialize] unable to claim device interface',
        this.deviceOptions.timeout
      )

      if (altInterfaceNum !== 0) {
        await timeoutPromise(
          this.usbDevice.selectAlternateInterface(interfaceNum, 0),
          "[initialize] unable to select device's ODIN interface",
          this.deviceOptions.timeout
        )
      }
    } catch (errorMsg) {
      if (this.deviceOptions.logging) console.log(errorMsg)
      throw new Error('Unable to open and claim device', { cause: errorMsg })
    }

    return this.handshake()
  }

  /**
   * Perform the Odin handshake, required for any Odin operations
   */
  async handshake() {
    // Samsung are Norse mythology fans, I guess?
    const helloMsg = 'ODIN'
    const acknowledgeMsg = 'LOKE'

    if (this.deviceOptions.resetOnInit) {
      await timeoutPromise(
        this.usbDevice.reset(),
        '[handshake] unable to reset device',
        this.deviceOptions.timeout
      )
    }

    const outResult = await timeoutPromise(
      this.usbDevice.transferOut(this.outEndpointNum, ByteArray.fromString(helloMsg)),
      '[handshake] unable to send ODIN handshake',
      this.deviceOptions.timeout
    )
    if (this.deviceOptions.logging) console.log(`sent: ${helloMsg}, status: ${outResult.status}`)
    if (outResult.status !== 'ok') {
      throw new Error(`handshake transmit status ${outResult.status}`)
    }

    const inResult = await timeoutPromise(
      this.usbDevice.transferIn(this.inEndpointNum, 7),
      '[handshake] unable to receive ODIN handshake response',
      this.deviceOptions.timeout
    )
    if (inResult.data == null || inResult.status !== 'ok') {
      throw new Error(`handshake response status ${inResult.status}`)
    }

    const stringResult = ByteArray.toString(new Uint8Array(inResult.data.buffer))

    if (this.deviceOptions.logging) console.log(`received: ${stringResult}`)
    if (stringResult !== acknowledgeMsg) {
      throw new Error('handshake challenge mismatch')
    }
  }

  async close() {
    await timeoutPromise(
      this.usbDevice.close(),
      '[close] unable to close device',
      this.deviceOptions.timeout
    )
  }

  async requestDeviceType() {
    await this.sendPacket(new DeviceTypePacket())
    await this.receivePacket(SessionSetupResponse)
  }

  /**
   * Begin a session on the device. This is a pre-requisite for many Odin operations
   */
  async beginSession(forceBegin = false) {
    // ensure a flash session has not already been started
    if (this._flashSessionStarted && !forceBegin) {
      return
    }

    await this.sendPacket(new BeginSessionPacket())

    const beginSessionResponse = await this.receivePacket(SessionSetupResponse)

    const defaultPacketSize = beginSessionResponse.result

    this._lz4Supported = (defaultPacketSize & 0x8000) !== 0

    await new Promise((resolve) => setTimeout(resolve, BEGIN_SESSION_DELAY))

    if (defaultPacketSize !== 0) {
      this._flashTimeout = 120_000
      await this.setFlashPacketSize(1048576, 30)
    }

    this._flashSessionStarted = true
  }

  /**
   * Tells the device to accept a specific packet size for flash operations.
   *
   * Note: This is not supported on all devices.
   */
  async setFlashPacketSize(packetSize: number, sequence: number) {
    await this.sendPacket(new FilePartSizePacket(packetSize))

    const filePartSizeResponse = await this.receivePacket(SessionSetupResponse)

    if (filePartSizeResponse.result !== 0) {
      throw new Error(
        `Unexpected file part size response!, Expected: 0, Received: ${filePartSizeResponse.result}`
      )
    }

    this._flashPacketSize = packetSize
    this._flashSequence = sequence
  }

  /**
   * Tells the device the size of the payload you wish to send it
   */
  async setFlashTotalSize(totalSize: number) {
    await this.sendPacket(new TotalBytesPacket(totalSize))

    const fileTotalSizeResponse = await this.receivePacket(SessionSetupResponse)

    if (fileTotalSizeResponse.result !== 0) {
      throw new Error(
        `Unexpected file part size response!, Expected: 0, Received: ${fileTotalSizeResponse.result}`
      )
    }
  }

  /**
   * Ends the current flash session
   * @param reboot - whether to reboot the device
   */
  async endSession(reboot = false, forceEnd = false) {
    // ensure a flash session has been started
    if (!this._flashSessionStarted && !forceEnd) {
      return
    }
    await this.sendPacket(
      new EndSessionPacket(reboot ? EndSessionRequest.RebootDevice : EndSessionRequest.EndSession)
    )
    await this.receivePacket(EndSessionResponse)
    this._flashSessionStarted = false
  }

  /**
   * Reboots the device, ending the current flash session if one is in progress
   */
  async reboot() {
    await this.endSession(true, true)
  }

  /**
   * Returns the device's partion table in Samsung's "PIT" format
   */
  async getPitData(): Promise<PitData> {
    await this.sendPacket(new PitFilePacket(PitFileRequest.Dump))

    const dumpResponse = await this.receivePacket(PitFileResponse)

    const fileSize = dumpResponse.fileSize

    const transferCount = Math.ceil(fileSize / ReceiveFilePartPacket.dataSize)

    const buffer = new ArrayBuffer(fileSize)
    const fileData = new Uint8Array(buffer)
    let offset = 0

    for (let i = 0; i < transferCount; i++) {
      if (this.deviceOptions.logging)
        console.log(`getPitData: sending partial packet ${i + 1} of ${transferCount}`)
      await this.sendPacket(new DumpPartPitFilePacket(i))

      const receivePitPartResponse = await this.receivePacket(ReceiveFilePartPacket)

      // Copy all of the packet data into the buffer.
      fileData.set(receivePitPartResponse.data, offset)
      offset += receivePitPartResponse.receivedSize
    }

    await this._emptyReceive()

    try {
      await this.sendPacket(new PitFilePacket(PitFileRequest.EndTransfer))
      await this.receivePacket(PitFileResponse)
    } catch {
      console.info('getPitData: failed to fully end PIT transfer session, continuing anyways...')
    }

    const pitData = new PitData()
    pitData.unpack(fileData)

    this._devicePit = pitData
    return pitData
  }

  /**
   * Flash a file to the specified partition
   * @param {string} partitionName - the name of the partition to be flashed
   * @param {Uint8Array} fileData - the data to flash to the partition
   */
  async flashPartition(partitionName: string, fileData: Uint8Array) {
    await this.beginSession()

    if (!this._devicePit) {
      await this.getPitData()
    }

    const entry = this._devicePit?.findEntryByName(partitionName)

    if (!entry) {
      throw new Error(`flashPartition: device PIT does not have a partition named ${partitionName}`)
    }

    if (isLz4Frame(fileData)) {
      const lz4Header = parseLz4FrameHeader(fileData)
      await this.setFlashTotalSize(lz4Header.contentSize)
      await this.sendLz4File(fileData, entry.binaryType, entry.deviceType, entry.identifier)
    } else {
      await this.setFlashTotalSize(fileData.byteLength)
      await this.sendFile(fileData, entry.binaryType, entry.deviceType, entry.identifier)
    }

    await this.endSession()
  }

  /**
   * Tells Odin to erase the device's userdata.
   */
  async eraseUserdata() {
    await this.sendPacket(new EraseUserdataPacket())
    await this.receivePacket(SessionSetupResponse)
  }

  /**
   * Flash a file to a device
   * @param fileData - a byte array of the file's contents
   * @param binaryType - the partition's "binaryType" (AP or CP)
   * @param deviceType - the partition's "deviceType"
   * @param fileIdentifier - the partition ID you wish to flash to
   */
  async sendFile(
    fileData: Uint8Array,
    binaryType: number,
    deviceType: number,
    fileIdentifier: number
  ) {
    await this.sendPacket(new FileTransferPacket(FileTransferRequest.Flash))
    await this.receivePacket(FileTransferResponse)

    const fileSize = fileData.length
    const maxSequenceByteCount = this._flashSequence * this._flashPacketSize
    const sequenceCount = Math.ceil(fileSize / maxSequenceByteCount)

    for (let sequenceIndex = 0; sequenceIndex < sequenceCount; sequenceIndex++) {
      console.log(`sending sequence ${sequenceIndex + 1} of ${sequenceCount}`)

      const startOffset = sequenceIndex * maxSequenceByteCount
      const sequenceData = fileData.subarray(
        startOffset,
        Math.min(startOffset + maxSequenceByteCount, fileSize)
      )
      const isLastSequence = sequenceIndex === sequenceCount - 1

      await this._sendFileSequence(
        sequenceData,
        sequenceData.length,
        binaryType,
        deviceType,
        fileIdentifier,
        isLastSequence,
        false
      )
    }
  }

  /**
   * Flash an LZ4-compressed file to a device. If the device does not support
   * LZ4, the file is decompressed on the host and flashed uncompressed.
   * @param fileData - a byte array of the LZ4 frame's contents
   * @param binaryType - the partition's "binaryType" (AP or CP)
   * @param deviceType - the partition's "deviceType"
   * @param fileIdentifier - the partition ID you wish to flash to
   */
  async sendLz4File(
    fileData: Uint8Array,
    binaryType: number,
    deviceType: number,
    fileIdentifier: number
  ) {
    const lz4Header = parseLz4FrameHeader(fileData)
    const lz4 = this._lz4Supported

    await this.sendPacket(
      new FileTransferPacket(lz4 ? FileTransferRequest.Lz4Flash : FileTransferRequest.Flash)
    )
    await this.receivePacket(FileTransferResponse)

    const sequences = Array.from(
      lz4Sequences(fileData, lz4Header, this._flashSequence * this._flashPacketSize)
    )

    for (let sequenceIndex = 0; sequenceIndex < sequences.length; sequenceIndex++) {
      console.log(`sending sequence ${sequenceIndex + 1} of ${sequences.length}`)

      const { decompressedSize } = sequences[sequenceIndex]!
      let { data } = sequences[sequenceIndex]!
      const isLastSequence = sequenceIndex === sequences.length - 1

      if (!lz4) {
        data = decompressLz4Sequence(data, lz4Header.blockMaxSize)

        if (data.length !== decompressedSize) {
          throw new Error(
            `Expected decompressed sequence size: ${decompressedSize} Received: ${data.length}`
          )
        }
      }

      await this._sendFileSequence(
        data,
        decompressedSize,
        binaryType,
        deviceType,
        fileIdentifier,
        isLastSequence,
        lz4
      )
    }
  }

  async _sendFileSequence(
    sequenceData: Uint8Array,
    endByteCount: number,
    binaryType: number,
    deviceType: number,
    fileIdentifier: number,
    isLastSequence: boolean,
    lz4: boolean
  ) {
    await this.sendPacket(
      new FlashPartFileTransferPacket(sequenceData.length, lz4),
      this._flashTimeout
    )
    await this.receivePacket(FileTransferResponse, this._flashTimeout)

    const partCount = Math.ceil(sequenceData.length / this._flashPacketSize)

    for (let filePartIndex = 0; filePartIndex < partCount; filePartIndex++) {
      console.log(`sending part ${filePartIndex + 1} of ${partCount}`)

      const startOffset = filePartIndex * this._flashPacketSize
      const partData = sequenceData.slice(startOffset, startOffset + this._flashPacketSize)

      await this.sendPacket(
        new SendFilePartPacket(partData, this._flashPacketSize),
        this._flashTimeout
      )

      const sendFilePartResponse = await this.receivePacket(
        SendFilePartResponse,
        this._flashTimeout
      )
      const receivedPartIndex = sendFilePartResponse.partIndex

      if (receivedPartIndex !== filePartIndex) {
        throw new Error(`Expected file part index: ${filePartIndex} Received: ${receivedPartIndex}`)
      }
    }

    const endPacket =
      binaryType === EntryBinaryType.CommunicationProcessor
        ? new EndModemFileTransferPacket(endByteCount, binaryType, deviceType, isLastSequence, lz4)
        : new EndPhoneFileTransferPacket(
            endByteCount,
            binaryType,
            deviceType,
            fileIdentifier,
            isLastSequence,
            lz4
          )

    await this.sendPacket(endPacket, this._flashTimeout)
    await this.receivePacket(FileTransferResponse, this._flashTimeout)
  }

  async sendPacket(packet: OutboundPacket, timeout?: number) {
    packet.pack()

    if (this.deviceOptions.logging) console.log('sending', packet)

    return timeoutPromise(
      this.usbDevice.transferOut(this.outEndpointNum, packet.data),
      '[device] unable to send packet',
      timeout ?? this.deviceOptions.timeout
    ).then((result) => {
      if (this.deviceOptions.logging) console.log('sendPacket response', result)
      return result
    })
  }

  async receivePacket<T extends InboundPacket>(type: { new (): T }, timeout?: number): Promise<T> {
    const packet = new type()

    const data = await timeoutPromise(
      this.usbDevice.transferIn(this.inEndpointNum, packet.size),
      '[device] unable to receive packet from device',
      timeout ?? this.deviceOptions.timeout
    )
    if (this.deviceOptions.logging) console.log('received packet', packet)

    if (data.data == null || data.status !== 'ok') {
      throw new Error('receivePacket failed')
    }

    if (data.data?.byteLength !== packet.size && !packet.sizeVariable) {
      throw new Error('incorrect size received')
    }
    packet.data = new Uint8Array(data.data.buffer as ArrayBuffer)
    packet.receivedSize = data.data.byteLength

    packet.unpack()

    return packet
  }

  async _emptyReceive(timeout?: number) {
    try {
      await timeoutPromise(
        this.usbDevice.transferIn(this.inEndpointNum, 1),
        '[device] device did not respond to empty receive, continuing...',
        timeout ?? EMPTY_RECEIVE_TIMEOUT
      )
    } catch (error) {
      console.warn(error)
    }
  }
}
