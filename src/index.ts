import { requestDevice, requestSerialDevice } from './helpers'
import * as libpit from './libpit'
import { consoleLogger, Logger, LogLevel } from './logger'
import { DeviceOptions, OdinDevice } from './OdinDevice'
import { OdinTransport, WebSerialTransport, WebUsbTransport } from './transport'

export {
  OdinDevice,
  libpit,
  type DeviceOptions,
  type OdinTransport,
  type Logger,
  type LogLevel,
  consoleLogger,
  WebUsbTransport,
  WebSerialTransport
}

export default {
  requestDevice,
  requestSerialDevice
}
