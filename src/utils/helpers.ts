/**
 * Initiate a promise, but reject if it takes too long
 * @param promise - the promise to start
 * @param reason - the error message to use in case of failure
 * @param ms - the number of milliseconds to wait before reporting failure
 */
export const timeoutPromise = <T>(promise: Promise<T>, reason: string, ms: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(reason)), ms)
    })
  ])
}

/**
 * Register a one-shot `disconnect` listener that fires `callback` only for the
 * matching device, then removes itself.
 * @param target - the event target to listen on (e.g. `navigator.usb`)
 * @param matches - predicate identifying this transport's own disconnect event
 * @param callback - invoked once when the matching device disconnects
 */
export function listenForDisconnect(
  target: EventTarget,
  matches: (event: Event) => boolean,
  callback: () => void
): void {
  const handler = (event: Event) => {
    if (matches(event)) {
      callback()
      target.removeEventListener('disconnect', handler)
    }
  }
  target.addEventListener('disconnect', handler)
}
