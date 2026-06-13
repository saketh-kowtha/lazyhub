/**
 * Small in-daemon event bus for IPC/MCP/TUI subscribers.
 *
 * @property {Map<string, Set<{write:Function}>>} subscribers
 */
export class EventBus {
  /**
   * Create an empty event bus.
   */
  constructor() {
    this.subscribers = new Map()
  }

  /**
   * Subscribe a socket-like sink to an event name.
   *
   * @param {string} event
   * @param {{write:Function}} sink
   */
  subscribe(event, sink) {
    if (!this.subscribers.has(event)) this.subscribers.set(event, new Set())
    this.subscribers.get(event).add(sink)
    return () => this.unsubscribe(event, sink)
  }

  /**
   * Remove a sink from an event.
   *
   * @param {string} event
   * @param {{write:Function}} sink
   */
  unsubscribe(event, sink) {
    this.subscribers.get(event)?.delete(sink)
  }

  /**
   * Publish an event to subscribers.
   *
   * @param {string} event
   * @param {unknown} payload
   */
  publish(event, payload) {
    const message = JSON.stringify({ type: 'event', event, payload }) + '\n'
    for (const sink of this.subscribers.get(event) || []) {
      try { sink.write(message) } catch { this.unsubscribe(event, sink) }
    }
  }
}
