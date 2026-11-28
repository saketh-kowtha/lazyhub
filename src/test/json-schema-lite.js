/**
 * The JSON Schema subset src/review-tools/schemas.js uses: type, const, enum, anyOf,
 * properties, required, items. Returns a list of "path: problem" strings (empty when valid).
 */

/**
 * @param {any} value
 * @param {any} schema
 * @param {string} [path]
 * @returns {string[]}
 */
export function validateSchema(value, schema, path = '$') {
  if (!schema || typeof schema !== 'object') return []
  if ('const' in schema) return value === schema.const ? [] : [`${path}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`]
  if (schema.enum) return schema.enum.includes(value) ? [] : [`${path}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`]
  if (schema.anyOf) {
    const results = schema.anyOf.map((/** @type {any} */ s) => validateSchema(value, s, path))
    return results.some((/** @type {string[]} */ r) => r.length === 0) ? [] : results[0]
  }
  if (schema.type) {
    const ok = {
      string: typeof value === 'string',
      boolean: typeof value === 'boolean',
      integer: Number.isInteger(value),
      number: typeof value === 'number',
      null: value === null,
      array: Array.isArray(value),
      object: value !== null && typeof value === 'object' && !Array.isArray(value),
    }[/** @type {string} */ (schema.type)]
    if (!ok) return [`${path}: expected ${schema.type}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`]
  }
  /** @type {string[]} */
  const out = []
  if (schema.type === 'object' && schema.properties) {
    for (const key of schema.required || []) if (!(key in value)) out.push(`${path}.${key}: missing`)
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in value) out.push(...validateSchema(value[key], sub, `${path}.${key}`))
    }
  }
  if (schema.type === 'array' && schema.items) value.forEach((/** @type {any} */ v, /** @type {number} */ i) => out.push(...validateSchema(v, schema.items, `${path}[${i}]`)))
  return out
}
