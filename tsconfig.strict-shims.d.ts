// Used only by tsconfig.strict.json: react ships no types here, and noImplicitAny
// would otherwise flag every `import ... from 'react'` in the strict directories (#489).
declare module 'react'
