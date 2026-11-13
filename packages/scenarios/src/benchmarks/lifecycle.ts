import type { EventEmitter } from "node:events"

export type Message = {
  type: string
  name: string
  library?: string
  ms?: number
  warmup?: boolean
  repetition?: number
}

/** A terminal failure rejects both pending and future reads, even if no exit follows. */
export const workerMessages = (child: EventEmitter, role: string) => {
  const queue: Array<Message> = []
  let waiter: { resolve: (message: Message) => void; reject: (error: Error) => void } | undefined
  let failure: Error | undefined
  let caseName = ""
  const fail = (error: Error) => {
    failure ??= error
    waiter?.reject(failure)
    waiter = undefined
  }
  const receive = (message: Message) => {
    if (failure) return
    if (waiter) {
      waiter.resolve(message)
      waiter = undefined
    } else queue.push(message)
  }
  child.on("message", (message: Message) => {
    if (message.type === "case") {
      caseName = message.name
      return
    }
    receive(message.name === "benchmark" ? { ...message, name: caseName } : message)
  })
  child.on("error", fail)
  child.on("exit", (code: number | null) => {
    if (code !== 0) fail(new Error(`${role} worker failed (${code}); see worker.log`))
    else receive({ type: "exit", name: String(code) })
  })
  return {
    fail,
    next: async (): Promise<Message> => {
      if (failure) throw failure
      return queue.shift() ?? await new Promise<Message>((resolve, reject) => {
        waiter = { resolve, reject }
      })
    }
  }
}

/** Keep the original cause when shutdown generates secondary child errors. */
export const comparisonDeadline = (abort: (error: Error) => void) => {
  let cause: unknown
  const failure = (error: unknown) => cause ??= error
  const timer = setTimeout(() => {
    const error = new Error("Comparison exceeded 90 minutes")
    failure(error)
    abort(error)
  }, 90 * 60 * 1000)
  return { failure, close: () => clearTimeout(timer) }
}
