import { runGh } from './core.js'

/**
 * View raw content of a gist.
 * @param id
 */
export async function getGist(id) {
  return runGh(['gist', 'view', id, '--raw'])
}

/**
 * Delete a gist by ID.
 * @param id
 */
export async function deleteGist(id) {
  return runGh(['gist', 'delete', id, '--yes'])
}
