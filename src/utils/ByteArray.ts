export const ByteArray = {
  /**
   * Encodes a string into a {@link Uint8Array} with a given size
   * @param message - the provided message
   * @param length - the size to make the byte array
   */
  fromString(message: string, length?: number) {
    const encoded = new TextEncoder().encode(message)
    const size = length ?? encoded.byteLength

    const byteArray = new Uint8Array(size)
    // truncate on encoded bytes, never overflow the destination
    byteArray.set(encoded.subarray(0, size))
    return byteArray
  },

  /**
   * Decodes a provided null-terminated string byte array into a string
   * @param byteData - the provided byte array
   */
  toString(byteData: Uint8Array) {
    const end = byteData.indexOf(0)
    const slice = byteData.subarray(0, end === -1 ? byteData.length : end)
    return new TextDecoder().decode(slice)
  }
}
