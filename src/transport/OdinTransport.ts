/**
 * A bidirectional byte transport for the Odin protocol.
 *
 * Odin traffic is strictly half-duplex request/response, so a transport only
 * needs to open the connection, send a packet, and receive a fixed number of
 * bytes. This lets {@link OdinDevice} run unchanged over either WebUSB or the
 * Web Serial API.
 */
export interface OdinTransport {
  /** Open the underlying connection and prepare it for Odin traffic. */
  connect(timeout: number): Promise<void>

  /** Send a packet to the device. Rejects if the transfer fails. */
  send(data: Uint8Array<ArrayBuffer>, timeout: number): Promise<void>

  /** Receive exactly `length` bytes from the device. */
  receive(length: number, timeout: number): Promise<Uint8Array<ArrayBuffer>>

  /**
   * Best-effort drain of a trailing/empty response. Always resolves; if the
   * device does not respond in time the drain is abandoned and any in-flight
   * read is buffered for the next {@link receive}.
   */
  emptyReceive(length: number, timeout: number): Promise<void>

  /** Reset the device, if the transport supports it (a no-op otherwise). */
  reset(timeout: number): Promise<void>

  /** Close the connection and release any held resources. */
  close(timeout: number): Promise<void>

  /** Register a callback fired when this device disconnects. */
  onDisconnect(callback: () => void): void
}
