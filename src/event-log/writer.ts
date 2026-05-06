/**
 * Durable-write queue for event persistence.
 *
 * Each session gets a bounded async queue (capacity 256) drained by a
 * background writer that pushes events to `SessionStore.appendEvent`.
 *
 * `enqueue` is non-blocking unless the queue is full, in which case it
 * backpressures (awaits a slot). `drain(sessionId)` resolves only after
 * every queued event for that session has been acknowledged by the
 * adapter — the framework calls this at the `turn:end` boundary so a
 * caller never sees `turn:end` before its preceding events are durable
 * (best-effort within the turn boundary).
 *
 * Adapter throws are wrapped as `EventStoreWriteError` and propagated to
 * the caller (no silent loss).
 */

import type { Event, EventEnvelope, SessionStore } from "../types.js"
import { EventStoreWriteError } from "../errors.js"

const QUEUE_CAPACITY = 256

interface PendingWrite {
  envelope: EventEnvelope
  resolve: () => void
  reject: (err: Error) => void
}

interface SessionQueue {
  buffer: PendingWrite[]
  drainResolvers: Array<() => void>
  drainRejecters: Array<(err: Error) => void>
  active: boolean
  ord: number
  /** First fatal error during background drain — kept so future enqueue/drain calls fail fast. */
  failed: Error | null
}

/**
 * Per-store writer. One Writer instance manages the queues for every
 * session that uses the same SessionStore — typically there's a single
 * writer per agent (since agents have a single SessionStore).
 */
export class Writer {
  private readonly store: SessionStore
  private readonly queues = new Map<string, SessionQueue>()

  constructor(store: SessionStore) {
    this.store = store
  }

  /** Build an envelope for a freshly-emitted event and enqueue it for durable write. */
  enqueue(sessionId: string, event: Event): Promise<void> {
    let queue = this.queues.get(sessionId)
    if (!queue) {
      queue = {
        buffer: [],
        drainResolvers: [],
        drainRejecters: [],
        active: false,
        ord: 0,
        failed: null,
      }
      this.queues.set(sessionId, queue)
    }

    if (queue.failed) {
      return Promise.reject(queue.failed)
    }

    const envelope: EventEnvelope = {
      sessionId,
      eventId: event.id,
      ord: queue.ord++,
      ts: event.ts,
      type: event.type,
      schemaVersion: event.schemaVersion,
      payload: event.payload,
    }

    return new Promise<void>((resolve, reject) => {
      const enqueueOne = (): void => {
        queue.buffer.push({ envelope, resolve, reject })
        if (!queue.active) {
          queue.active = true
          void this.drainLoop(sessionId, queue)
        }
      }

      // Backpressure: if full, await a slot.
      if (queue.buffer.length < QUEUE_CAPACITY) {
        enqueueOne()
      } else {
        // Poll for a slot. Cheap because consumer drains aggressively.
        const wait = (): void => {
          if (queue.failed) {
            reject(queue.failed)
            return
          }
          if (queue.buffer.length < QUEUE_CAPACITY) {
            enqueueOne()
          } else {
            setImmediate(wait)
          }
        }
        wait()
      }
    })
  }

  /**
   * Block until the per-session queue is empty. Resolves when every
   * already-enqueued write has acknowledged or rejects on the first
   * adapter failure.
   */
  drain(sessionId: string): Promise<void> {
    const queue = this.queues.get(sessionId)
    if (!queue) return Promise.resolve()
    if (queue.failed) return Promise.reject(queue.failed)
    if (!queue.active && queue.buffer.length === 0) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      queue.drainResolvers.push(resolve)
      queue.drainRejecters.push(reject)
    })
  }

  /** Drop the per-session queue (e.g., session deleted). */
  forget(sessionId: string): void {
    this.queues.delete(sessionId)
  }

  private async drainLoop(sessionId: string, queue: SessionQueue): Promise<void> {
    while (queue.buffer.length > 0) {
      const next = queue.buffer.shift()!
      try {
        await this.store.appendEvent(sessionId, next.envelope)
        next.resolve()
      } catch (cause) {
        const err = new EventStoreWriteError(
          sessionId,
          next.envelope.eventId,
          next.envelope.type,
          cause instanceof Error ? cause : new Error(String(cause)),
        )
        queue.failed = err
        next.reject(err)
        // Reject every pending write and every waiting drain.
        for (const w of queue.buffer) w.reject(err)
        queue.buffer.length = 0
        for (const r of queue.drainRejecters) r(err)
        queue.drainResolvers.length = 0
        queue.drainRejecters.length = 0
        queue.active = false
        return
      }
    }
    queue.active = false
    // Wake all drain awaiters
    for (const r of queue.drainResolvers) r()
    queue.drainResolvers.length = 0
    queue.drainRejecters.length = 0
  }
}
