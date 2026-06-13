import { listenForDisconnect, timeoutPromise } from '../utils/helpers'
import { OdinTransport } from './OdinTransport'

const USB_CLASS_CDC_DATA = 0x0a

/** Drives an Odin device over the WebUSB bulk transfer API. */
export class WebUsbTransport implements OdinTransport {
  readonly device: USBDevice

  outEndpointNum = -1
  inEndpointNum = -1

  /**
   * A transferIn left pending by a timed-out {@link emptyReceive}. WebUSB
   * cannot cancel transfers, so the next {@link receive} must consume it.
   */
  private _orphanedReceive: Promise<USBInTransferResult> | undefined

  constructor(device: USBDevice) {
    this.device = device
  }

  async connect(timeout: number) {
    await timeoutPromise(this.device.open(), '[connect] unable to open device handle', timeout)

    if (!this.device.configuration) {
      await timeoutPromise(
        this.device.selectConfiguration(1),
        '[connect] unable to select device configuration',
        timeout
      )
    }

    if (!this.device.configuration) {
      throw new Error('Unable to select the proper configuration')
    }

    let interfaceNum = -1
    let altInterfaceNum = -1

    for (const usbInterface of this.device.configuration.interfaces) {
      for (const altInterface of usbInterface.alternates) {
        const outEndpoint =
          altInterface.endpoints.find((endpoint) => endpoint.direction === 'out')?.endpointNumber ??
          -1
        const inEndpoint =
          altInterface.endpoints.find((endpoint) => endpoint.direction === 'in')?.endpointNumber ??
          -1

        if (
          altInterface.endpoints.length === 2 &&
          altInterface.interfaceClass === USB_CLASS_CDC_DATA &&
          outEndpoint !== -1 &&
          inEndpoint !== -1
        ) {
          altInterfaceNum = altInterface.alternateSetting
          this.outEndpointNum = outEndpoint
          this.inEndpointNum = inEndpoint
          break
        }
      }

      if (altInterfaceNum !== -1) {
        interfaceNum = usbInterface.interfaceNumber
        break
      }
    }

    if (this.outEndpointNum === -1 || this.inEndpointNum === -1) {
      throw new Error('Unable to locate the bulk command endpoints')
    }

    await timeoutPromise(
      this.device.claimInterface(interfaceNum),
      '[connect] unable to claim device interface',
      timeout
    )

    if (altInterfaceNum !== 0) {
      await timeoutPromise(
        this.device.selectAlternateInterface(interfaceNum, altInterfaceNum),
        "[connect] unable to select device's ODIN interface",
        timeout
      )
    }
  }

  async send(data: Uint8Array<ArrayBuffer>, timeout: number) {
    const result = await timeoutPromise(
      this.device.transferOut(this.outEndpointNum, data),
      '[device] unable to send packet',
      timeout
    )
    if (result.status !== 'ok') {
      throw new Error(`transmit status ${result.status}`)
    }
  }

  async receive(length: number, timeout: number) {
    const orphan = this._orphanedReceive
    if (orphan) {
      this._orphanedReceive = undefined
      let result: USBInTransferResult
      try {
        result = await timeoutPromise(
          orphan,
          '[device] unable to receive packet from device',
          timeout
        )
      } catch (error) {
        this._orphanedReceive = orphan
        throw error
      }
      if (result.data != null && result.data.byteLength > 0) {
        return toBytes(result)
      }
      // the empty receive arrived late; discard it and receive normally
    }

    const result = await timeoutPromise(
      this.device.transferIn(this.inEndpointNum, length),
      '[device] unable to receive packet from device',
      timeout
    )
    return toBytes(result)
  }

  async emptyReceive(length: number, timeout: number) {
    const transfer = this._orphanedReceive ?? this.device.transferIn(this.inEndpointNum, length)
    this._orphanedReceive = undefined

    try {
      await timeoutPromise(transfer, '[device] device did not respond to empty receive', timeout)
    } catch {
      // best-effort: stash the in-flight transfer for the next receive to consume
      this._orphanedReceive = transfer
    }
  }

  async reset(timeout: number) {
    await timeoutPromise(this.device.reset(), '[device] unable to reset device', timeout)
  }

  async close(timeout: number) {
    await timeoutPromise(this.device.close(), '[close] unable to close device', timeout)
  }

  onDisconnect(callback: () => void) {
    listenForDisconnect(
      navigator.usb,
      (event) => (event as USBConnectionEvent).device === this.device,
      callback
    )
  }
}

function toBytes(result: USBInTransferResult): Uint8Array<ArrayBuffer> {
  if (result.data == null || result.status !== 'ok') {
    throw new Error(`receive failed with status ${result.status}`)
  }
  const view = result.data
  const bytes = new Uint8Array(view.byteLength)
  bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  return bytes
}
