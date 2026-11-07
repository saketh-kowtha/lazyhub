/**
 * Child process used by store.test.js to prove that two processes approving the
 * same context at once yield exactly one record. Not imported by product code.
 * argv: <store dir> <JSON context> <fixed ISO time> <random fill byte>
 */
import { openApprovalStore } from '../store.js'

const [dir, contextJson, iso, fill] = process.argv.slice(2)
const context = JSON.parse(contextJson)
const store = openApprovalStore({
  dir,
  now: () => new Date(iso),
  random: n => Buffer.alloc(n, Number(fill)),
})

let message
try {
  const out = store.createApprovalRecord({
    context,
    decision: 'approve',
    evidence: { digest: '3'.repeat(64), observed_at: iso },
    coverageClass: 'advisory',
  })
  message = { ok: true, requestId: out.requestId }
} catch (err) {
  message = { ok: false, code: err.code || 'UNKNOWN', message: String(err.message) }
}
process.send(message, () => process.exit(0))
