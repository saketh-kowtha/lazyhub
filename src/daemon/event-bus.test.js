import { describe, expect, it } from 'vitest'
import { EventBus } from './event-bus.js'

describe('daemon event bus', () => {
  it('publishes events to subscribers and supports unsubscribe', () => {
    const bus = new EventBus()
    const writes = []
    const sink = { write: msg => writes.push(msg) }
    const unsubscribe = bus.subscribe('mutation', sink)
    bus.publish('mutation', { repo: 'owner/repo' })
    unsubscribe()
    bus.publish('mutation', { repo: 'owner/repo' })
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0])).toMatchObject({ type: 'event', event: 'mutation' })
  })
})
