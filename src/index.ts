import { requestDevice, requestSerialDevice } from './helpers'
import * as libpit from './libpit'
import { DeviceOptions, OdinDevice } from './OdinDevice'
import { OdinTransport, WebSerialTransport, WebUsbTransport } from './transport'

export {
  OdinDevice,
  libpit,
  type DeviceOptions,
  type OdinTransport,
  WebUsbTransport,
  WebSerialTransport
}

export default {
  requestDevice,
  requestSerialDevice
}
