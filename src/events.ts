import type { StreamEvent } from "./types.js"

/**
 * Internal event bus that buffers `StreamEvent`s and exposes them
 * as an `AsyncIterable`.
 *
 * Used by `AgentRun` to bridge between the synchronous agent loop
 * (which emits events) and the asynchronous consumer (which iterates).
 *
 * Events are buffered in memory. If a consumer is already waiting,
 * it is unblocked immediately. When `close()` is called, the iterator
 * drains remaining buffered events and then returns.
 *
 * **Single-consumer only.** Each AgentRun has its own bus, designed for one
 * async iterator consumer at a time. Multiple consumers will miss events.
 */
export class EventBus {
  private buffer: StreamEvent[] = []
  private resolve: (() => void) | null = null
  private done = false

  /**
   * Emit an event. If a consumer is waiting, unblock it immediately.
   * Events emitted after `close()` are silently ignored.
   */
  emit(event: StreamEvent): void {
    if (this.done) return
    this.buffer.push(event)
    if (this.resolve) {
      this.resolve()
      this.resolve = null
    }
  }

  /**
   * Signal that no more events will be emitted.
   * The async iterator will drain any remaining buffered events and then finish.
   */
  close(): void {
    this.done = true
    if (this.resolve) {
      this.resolve()
      this.resolve = null
    }
  }

  /**
   * Async iterator that yields buffered events as they arrive.
   * Waits when the buffer is empty and the bus is still open.
   * Returns when the bus is closed and all events have been yielded.
   *
   * Consumed events are cleared from the buffer to prevent
   * unbounded memory growth in long-running sessions.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    let index = 0
    while (true) {
      if (index < this.buffer.length) {
        const event = this.buffer[index]!
        index++
        // Clear consumed events periodically to free memory
        if (index > 64) {
          this.buffer.splice(0, index)
          index = 0
        }
        yield event
      } else if (this.done) {
        // Drain complete — clear remaining buffer
        this.buffer.length = 0
        return
      } else {
        await new Promise<void>((r) => {
          this.resolve = r
        })
      }
    }
  }
}
