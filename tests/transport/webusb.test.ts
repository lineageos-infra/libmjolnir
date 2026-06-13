import { describe, expect, test, vi } from 'vitest'
import { WebUsbTransport } from '../../src/transport/WebUsbTransport'

const USB_CLASS_CDC_DATA = 0x0a

function makeDataView(bytes: number[]) {
  return new DataView(new Uint8Array(bytes).buffer)
}

function createFakeUsbDevice(configuration?: unknown) {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    selectConfiguration: vi.fn().mockResolvedValue(undefined),
    claimInterface: vi.fn().mockResolvedValue(undefined),
    selectAlternateInterface: vi.fn().mockResolvedValue(undefined),
    transferOut: vi.fn().mockResolvedValue({ status: 'ok' }),
    transferIn: vi.fn(),
    reset: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    configuration
  }
}

/** A configuration whose sole interface exposes a matching Odin bulk endpoint pair. */
function cdcConfig(interfaceNumber: number, alternateSetting: number) {
  return {
    interfaces: [
      {
        interfaceNumber,
        alternates: [
          {
            alternateSetting,
            interfaceClass: USB_CLASS_CDC_DATA,
            endpoints: [
              { direction: 'out', endpointNumber: 1 },
              { direction: 'in', endpointNumber: 2 }
            ]
          }
        ]
      }
    ]
  }
}

describe('WebUsbTransport.connect', () => {
  test('selects the interface by descriptor number, not array index', async () => {
    // matching interface sits at array index 0 but reports interfaceNumber 2 /
    // alternateSetting 1 — the old index-based code would have used 0 / 0.
    const device = createFakeUsbDevice(cdcConfig(2, 1))
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await transport.connect(1000)

    expect(device.claimInterface).toHaveBeenCalledWith(2)
    expect(device.selectAlternateInterface).toHaveBeenCalledWith(2, 1)
    expect(transport.outEndpointNum).toBe(1)
    expect(transport.inEndpointNum).toBe(2)
  })

  test('skips selectAlternateInterface when the alternate setting is 0', async () => {
    const device = createFakeUsbDevice(cdcConfig(0, 0))
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await transport.connect(1000)

    expect(device.claimInterface).toHaveBeenCalledWith(0)
    expect(device.selectAlternateInterface).not.toHaveBeenCalled()
  })

  test('selects configuration 1 when none is active', async () => {
    const device = createFakeUsbDevice(undefined)
    device.selectConfiguration.mockImplementation(async () => {
      device.configuration = cdcConfig(0, 0)
    })
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await transport.connect(1000)

    expect(device.selectConfiguration).toHaveBeenCalledWith(1)
  })

  test('throws when no configuration can be selected', async () => {
    // selectConfiguration resolves but never assigns a configuration
    const device = createFakeUsbDevice(undefined)
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await expect(transport.connect(1000)).rejects.toThrow(
      'Unable to select the proper configuration'
    )
  })

  test('throws when no bulk command endpoints are found', async () => {
    const device = createFakeUsbDevice({
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [{ alternateSetting: 0, interfaceClass: 0x02, endpoints: [] }]
        }
      ]
    })
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await expect(transport.connect(1000)).rejects.toThrow(
      'Unable to locate the bulk command endpoints'
    )
  })
})

describe('WebUsbTransport.send', () => {
  test('transfers data to the out endpoint and resolves on ok status', async () => {
    const device = createFakeUsbDevice()
    const transport = new WebUsbTransport(device as unknown as USBDevice)
    transport.outEndpointNum = 3

    const data = new Uint8Array([9, 8, 7])
    await transport.send(data, 1000)

    expect(device.transferOut).toHaveBeenCalledWith(3, data)
  })

  test('throws on a non-ok transfer status', async () => {
    const device = createFakeUsbDevice()
    device.transferOut.mockResolvedValueOnce({ status: 'babble' })
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await expect(transport.send(new Uint8Array([1]), 1000)).rejects.toThrow(
      'transmit status babble'
    )
  })
})

describe('WebUsbTransport.receive', () => {
  test('returns the transferred bytes', async () => {
    const device = createFakeUsbDevice()
    device.transferIn.mockResolvedValueOnce({ status: 'ok', data: makeDataView([1, 2, 3, 4]) })
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    expect([...(await transport.receive(4, 1000))]).toEqual([1, 2, 3, 4])
  })

  test('throws on a non-ok transfer status', async () => {
    const device = createFakeUsbDevice()
    device.transferIn.mockResolvedValueOnce({ status: 'stall', data: null })
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await expect(transport.receive(4, 1000)).rejects.toThrow()
  })
})

describe('WebUsbTransport.emptyReceive', () => {
  test('resolves once the transfer completes', async () => {
    const device = createFakeUsbDevice()
    device.transferIn.mockResolvedValueOnce({ status: 'ok', data: makeDataView([]) })
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await expect(transport.emptyReceive(1024, 1000)).resolves.toBeUndefined()
  })

  test('orphans a timed-out transfer for the next receive to consume', async () => {
    const device = createFakeUsbDevice()
    let resolveTransfer!: (result: unknown) => void
    device.transferIn.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTransfer = resolve
      })
    )
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await expect(transport.emptyReceive(1024, 10)).rejects.toThrow()
    expect(device.transferIn).toHaveBeenCalledTimes(1)

    // the drain response arrives late; the next receive consumes it without a new transfer
    resolveTransfer({ status: 'ok', data: makeDataView([7, 8]) })

    expect([...(await transport.receive(2, 1000))]).toEqual([7, 8])
    expect(device.transferIn).toHaveBeenCalledTimes(1)
  })

  test('keeps the orphan stashed when the next receive also times out', async () => {
    const device = createFakeUsbDevice()
    device.transferIn.mockReturnValueOnce(new Promise(() => {})) // never resolves
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await expect(transport.emptyReceive(1024, 10)).rejects.toThrow()
    await expect(transport.receive(2, 10)).rejects.toThrow()

    // the orphan is re-stashed rather than dropped, so no new transfer is issued
    expect(device.transferIn).toHaveBeenCalledTimes(1)
  })
})

describe('WebUsbTransport.onDisconnect', () => {
  test('fires the callback only when its own device disconnects', () => {
    const device = createFakeUsbDevice()
    let handler!: (event: { device: unknown }) => void
    const usb = {
      addEventListener: vi.fn((_type, listener) => {
        handler = listener
      }),
      removeEventListener: vi.fn()
    }
    vi.stubGlobal('navigator', { usb })

    const transport = new WebUsbTransport(device as unknown as USBDevice)
    const callback = vi.fn()
    transport.onDisconnect(callback)

    handler({ device: {} }) // a different device
    expect(callback).not.toHaveBeenCalled()

    handler({ device })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(usb.removeEventListener).toHaveBeenCalled()
  })
})

describe('WebUsbTransport reset/close', () => {
  test('reset delegates to the device', async () => {
    const device = createFakeUsbDevice()
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await transport.reset(1000)
    expect(device.reset).toHaveBeenCalled()
  })

  test('close delegates to the device', async () => {
    const device = createFakeUsbDevice()
    const transport = new WebUsbTransport(device as unknown as USBDevice)

    await transport.close(1000)
    expect(device.close).toHaveBeenCalled()
  })
})
