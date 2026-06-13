export type LogLevel = 'info' | 'debug'

/** Called for every log line. Takes extra args so packets can be logged too. */
export type Logger = (level: LogLevel, ...data: unknown[]) => void

/** Used when no logger is passed. */
export const consoleLogger: Logger = (level, ...data) => {
  if (level === 'info') console.info(...data)
  else console.log(...data)
}
