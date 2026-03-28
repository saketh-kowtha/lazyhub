# Homebrew Tap

To install ghui via Homebrew, the tap repo `saketh-kowtha/homebrew-tap` must exist.

## Formula: Formula/ghui.rb

```ruby
class Ghui < Formula
  desc "A lazygit-style GitHub TUI — every GitHub action without leaving your terminal"
  homepage "https://saketh-kowtha.github.io/lgh"
  url "https://registry.npmjs.org/ghui/-/ghui-0.1.0.tgz"
  sha256 "REPLACE_WITH_ACTUAL_SHA256"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "ghui", shell_output("#{bin}/ghui --version 2>&1", 1)
  end
end
```

## Setup steps

1. Create repo `saketh-kowtha/homebrew-tap` on GitHub
2. Create `Formula/ghui.rb` with the above content
3. Update `url` and `sha256` after each npm release
4. Users install with: `brew install saketh-kowtha/tap/ghui`

## Auto-updating the formula on release

Add to `.github/workflows/release.yml` after npm publish:
```yaml
- name: Update Homebrew tap
  if: steps.prepare.outputs.version != ''
  env:
    GH_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
  run: |
    VERSION="${{ steps.prepare.outputs.version }}"
    TARBALL="https://registry.npmjs.org/ghui/-/ghui-${VERSION}.tgz"
    SHA=$(curl -sL "$TARBALL" | shasum -a 256 | cut -d' ' -f1)
    gh api repos/saketh-kowtha/homebrew-tap/contents/Formula/ghui.rb \
      --method PUT \
      -f message="chore: bump ghui to v${VERSION}" \
      -f content="$(ruby -e "puts Base64.encode64(File.read('Formula/ghui.rb').gsub(/url .+/, \"url \\\"$TARBALL\\\"\").gsub(/sha256 .+/, \"sha256 \\\"$SHA\\\"\"))")"
```
