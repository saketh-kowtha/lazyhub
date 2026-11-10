/**
 * Declared writes for the Branches view (V2a, #597).
 * Only deleting a remote branch is a gh write: its row leaves the cached list at once (the selection
 * follows by id) and nothing is refetched. Push, checkout and create run local git in the checkout, so
 * they change no GitHub read and declare no invalidation.
 */

import { defineMutation } from './core.js'
import { deleteBranch } from '../../executor.js'
import { push as gitPush, checkout as gitCheckout, createBranch } from '../../services/git.js'

/**
 * @param {string} repo
 * @param {unknown[]} listKey  the key `useGh(listBranches, [repo])` reads under
 */
export function deleteBranchMutation(repo, listKey) {
  return defineMutation({
    name: 'branches.delete',
    run: (/** @type {{ name: string }} */ { name }) => deleteBranch(repo, name),
    label: ({ display }) => `Deleting ${display}`,
    success: (_r, { display }) => `Deleted ${display}`,
    optimistic: ({ name }) => [{
      key: listKey,
      update: (/** @type {any} */ prev) => (Array.isArray(prev) ? prev.filter(b => b.name !== name) : prev),
    }],
    invalidates: () => [],
  })
}

/** args: `{ dir, remote }` of the local checkout */
export const pushBranchMutation = defineMutation({
  name: 'branches.push',
  run: ({ dir, remote }) => gitPush(dir, remote, 'HEAD'),
  label: 'Pushing',
  success: 'Pushed',
})

/** args: `{ local, name, display }` (`local` is the checkout, `display` the sanitized name) */
export const checkoutBranchMutation = defineMutation({
  name: 'branches.checkout',
  run: ({ local, name }) => gitCheckout(local, name),
  label: ({ display }) => `Checking out ${display}`,
  success: (_r, { display }) => `✓ Checked out ${display}`,
})

/** args: `{ dir, name }` */
export const createBranchMutation = defineMutation({
  name: 'branches.create',
  run: ({ dir, name }) => createBranch(dir, name),
  label: ({ name }) => `Creating ${name}`,
  success: (_r, { name }) => `✓ Created and checked out ${name}`,
})
