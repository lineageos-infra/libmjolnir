import { listenForDisconnect, timeoutPromise } from '../utils/helpers'
import { OdinTransport } from './OdinTransport'

// CDC-ACM ignores the baud rate, but Web Serial requires one.
const BAUD_RATE = 115200
const READ_BUFFER_SIZE = 4096

/**
 * Drives an Odin device over the Web Serial API. Unlike WebUSB, this talks to
 * the OS serial driver (`usbser.sys` / `cdc_acm`), so it needs no driver swap
 * (e.g. Zadig/WinUSB) on Windows.
 */
export class WebSerialTransport implements OdinTransport {
  readonly port: SerialPort

  private _reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  private _writer: WritableStreamDefaultWriter<Uint8Array> | undefined

  // Received-but-unconsumed bytes, kept as a queue so appending a chunk is O(1)
  // and the residual tail is never re-copied on each receive.
  private _chunks: Uint8Array[] = []
  private _chunkOffset = 0
  private _available = 0

  // A read() left pending by a timed-out receive; the next read must await it
  // rather than start a new one, or the chunk it resolves with is lost.
  private _pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined

  constructor(port: SerialPort) {
    this.port = port
  }

  async connect(timeout: number) {
    await timeoutPromise(
      this.port.open({ baudRate: BAUD_RATE, bufferSize: READ_BUFFER_SIZE }),
      '[connect] unable to open serial port',
      timeout
    )

    // CDC-ACM devices expect DTR asserted before they will talk; best-effort
    // since not every platform implements setSignals.
    try {
      await this.port.setSignals({ dataTerminalReady: true })
    } catch {
      // ignore
    }

    if (!this.port.readable || !this.port.writable) {
      throw new Error('serial port did not expose readable/writable streams')
    }

    this._reader = this.port.readable.getReader()
    this._writer = this.port.writable.getWriter()
  }

  async send(data: Uint8Array<ArrayBuffer>, timeout: number) {
    if (!this._writer) {
      throw new Error('serial port is not open')
    }
    await timeoutPromise(this._writer.write(data), '[device] unable to send packet', timeout)
  }

  async receive(length: number, timeout: number) {
    while (this._available < length) {
      this._append(await this._readChunk(timeout))
    }

    const out = new Uint8Array(length)
    let written = 0
    while (written < length) {
      const head = this._chunks[0]!
      const available = head.length - this._chunkOffset
      const take = Math.min(available, length - written)
      out.set(head.subarray(this._chunkOffset, this._chunkOffset + take), written)
      written += take

      if (take === available) {
        this._chunks.shift()
        this._chunkOffset = 0
      } else {
        this._chunkOffset += take
      }
    }
    this._available -= length
    return out
  }

  async emptyReceive(_length: number, timeout: number) {
    // Best-effort drain: a timed-out read leaves a pending read for the next
    // receive (see _readChunk), so swallow the timeout rather than reject.
    try {
      this._append(await this._readChunk(timeout))
    } catch {
      // drain abandoned
    }
  }

  reset(): Promise<void> {
    // No serial equivalent of a USB port reset; download mode does not need one.
    return Promise.resolve()
  }

  async close(timeout: number) {
    if (this._reader) {
      try {
        await this._reader.cancel()
      } catch {
        // ignore
      }
      this._reader.releaseLock()
      this._reader = undefined
    }

    if (this._writer) {
      try {
        this._writer.releaseLock()
      } catch {
        // ignore
      }
      this._writer = undefined
    }

    this._pendingRead = undefined
    this._chunks = []
    this._chunkOffset = 0
    this._available = 0

    await timeoutPromise(this.port.close(), '[close] unable to close serial port', timeout)
  }

  onDisconnect(callback: () => void) {
    listenForDisconnect(navigator.serial, (event) => event.target === this.port, callback)
  }

  private async _readChunk(timeout: number): Promise<Uint8Array> {
    if (!this._reader) {
      throw new Error('serial port is not open')
    }

    const read = this._pendingRead ?? this._reader.read()
    this._pendingRead = read

    const result = await timeoutPromise(read, '[device] timed out waiting for serial data', timeout)
    this._pendingRead = undefined

    if (result.done) {
      throw new Error('serial stream closed')
    }
    return result.value
  }

  private _append(chunk: Uint8Array) {
    if (chunk.length === 0) {
      return
    }
    this._chunks.push(chunk)
    this._available += chunk.length
  }
}
