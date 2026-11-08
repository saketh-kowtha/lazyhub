import { runGh } from './core.js'

/**
 * View raw content of a gist.
 * @param id
 */
export async function getGist(/** @type {any} */ id) {
  return runGh(['gist', 'view', id, '--raw'])
}

/**
 * Delete a gist by ID.
 * @param id
 */
export async function deleteGist(/** @type {any} */ id) {
  return runGh(['gist', 'delete', id, '--yes'])
}
