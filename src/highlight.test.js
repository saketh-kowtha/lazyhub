import { describe, it, expect } from 'vitest'
import { getHljs, HIGHLIGHT_LANGUAGES } from './highlight.js'

const SAMPLES = {
  javascript: 'const a = (x) => `v${x}` // c',
  typescript: 'interface A { b: number }\nexport const c: A = { b: 1 }',
  python: 'def f(x):\n    return "s" + str(x)  # c',
  ruby: 'def f(x)\n  puts "s#{x}"\nend',
  go: 'func main() { fmt.Println("hi") }',
  rust: 'fn main() { let x: u32 = 1; println!("{}", x); }',
  java: 'public class A { private int b = 1; }',
  kotlin: 'fun main() { val x = 1 }',
  swift: 'let x: Int = 1\nfunc f() -> Int { return x }',
  cpp: '#include <vector>\nstd::vector<int> v;',
  c: 'int main(void) { return 0; }',
  csharp: 'public class A { public int B { get; set; } }',
  php: '<?php echo "hi"; ?>',
  bash: 'if [ -f "$f" ]; then echo "$f"; fi',
  json: '{"a": [1, true, null], "b": "s"}',
  yaml: 'a:\n  - b: 1\n  - c: "d"',
  xml: '<a b="c"><d/></a>',
  css: 'a.b > c { color: #fff; margin: 0 }',
  scss: '$c: red;\n.a { .b { color: $c } }',
  less: '@c: red;\n.a { .b { color: @c } }',
  markdown: '# Title\n\n- item `code`\n[l](http://x)',
  sql: 'SELECT a, count(*) FROM t WHERE b = 1 GROUP BY a',
  graphql: 'query Q($id: ID!) { node(id: $id) { id } }',
  diff: '@@ -1 +1 @@\n-a\n+b',
  ini: '[s]\nk = v ; c',
}

describe('highlight.js core with selected languages', () => {
  it('has a sample for every registered language', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...HIGHLIGHT_LANGUAGES].sort())
  })

  it.each(HIGHLIGHT_LANGUAGES)('%s highlights to scoped spans', lang => {
    const { value } = getHljs().highlight(SAMPLES[lang], { language: lang, ignoreIllegals: true })
    expect(value).toContain('<span class="hljs-')
  })

  // Pinned from the pre-#302 `import hljs from 'highlight.js'` build: same grammar, same markup.
  it('produces the exact markup the diff view parsed before', () => {
    const { value } = getHljs().highlight('const a = 1 // c', { language: 'javascript', ignoreIllegals: true })
    expect(value).toBe('<span class="hljs-keyword">const</span> a = <span class="hljs-number">1</span> <span class="hljs-comment">// c</span>')
  })

  it('resolves the aliases the diff view and markdown fences rely on', () => {
    for (const alias of ['js', 'ts', 'tsx', 'py', 'rb', 'rs', 'kt', 'cs', 'sh', 'zsh', 'yml', 'html', 'gql', 'md']) {
      expect(getHljs().getLanguage(alias), alias).toBeTruthy()
    }
  })
})
