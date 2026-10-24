// @ts-nocheck
/**
 * src/features/prs/diff/tree.js — file-tree rows derived from parsed diff files.
 */

/** Preserve file order while expanding path segments into tree rows.
 * @param {Array} files parsed diff files
 * @returns {Array} directory and file rows
 */
export function buildTreeRows(files) {
  // Build tree structure
  const root = { name: '', isFile: false, addCount: 0, delCount: 0, children: new Map() }

  for (const file of files) {
    const parts = file.filename.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          isFile,
          addCount: 0,
          delCount: 0,
          filename: isFile ? file.filename : null,
          children: new Map(),
        })
      }
      const child = node.children.get(part)
      if (isFile) {
        child.addCount = file.addCount
        child.delCount = file.delCount
        child.filename = file.filename
      }
      node = child
    }
  }

  // Flatten via pre-order traversal with prefix computation
  const rows = []

  function traverse(node, depth, lastFlags) {
    const children = [...node.children.values()]
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1
      // Build prefix from parent flags
      let prefix = ''
      for (let d = 0; d < depth; d++) {
        prefix += lastFlags[d] ? '   ' : '│  '
      }
      prefix += isLast ? '└──' : '├──'

      rows.push({
        type: child.isFile ? 'file' : 'dir',
        name: child.name,
        depth,
        prefix,
        filename: child.filename,
        addCount: child.addCount,
        delCount: child.delCount,
      })

      if (!child.isFile) {
        traverse(child, depth + 1, [...lastFlags, isLast])
      }
    })
  }

  traverse(root, 0, [])
  return rows
}

