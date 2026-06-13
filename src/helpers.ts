import constants from './constants'
import { DeviceOptions, OdinDevice } from './OdinDevice'
import { WebSerialTransport } from './transport/WebSerialTransport'

/**
 * Attempts to connect to a device in Odin mode via WebUSB
 * @param options - configuration options which will get passed to the returned device
 */
export const requestDevice = async function (options?: Partial<DeviceOptions>) {
  if (!navigator.usb) {
    return Promise.reject('Browser missing WebUSB feature')
  }
  return navigator.usb
    .requestDevice({ filters: constants.UsbConstants.DeviceFilters })
    .then((device) => {
      return new OdinDevice(device, options)
    })
}

/**
 * Attempts to connect to a device in Odin mode via the Web Serial API. Unlike
 * WebUSB, this works on Windows without replacing the device driver.
 * @param options - configuration options which will get passed to the returned device
 */
export const requestSerialDevice = async function (options?: Partial<DeviceOptions>) {
  if (!navigator.serial) {
    return Promise.reject('Browser missing Web Serial feature')
  }
  const port = await navigator.serial.requestPort({
    filters: constants.SerialConstants.PortFilters
  })
  return new OdinDevice(new WebSerialTransport(port), options)
}
