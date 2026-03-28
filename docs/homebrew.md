# Homebrew Tap

To install lazyhub via Homebrew, the tap repo `saketh-kowtha/homebrew-tap` must exist.

## Formula: Formula/lazyhub.rb

```ruby
class Ghui < Formula
  desc "A lazygit-style GitHub TUI — every GitHub action without leaving your terminal"
  homepage "https://saketh-kowtha.github.io/lazyhub"
  url "https://registry.npmjs.org/lazyhub/-/lazyhub-0.1.0.tgz"
  sha256 "REPLACE_WITH_ACTUAL_SHA256"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "lazyhub", shell_output("#{bin}/lazyhub --version 2>&1", 1)
  end
end
```

## Setup steps

1. Create repo `saketh-kowtha/homebrew-tap` on GitHub
2. Create `Formula/lazyhub.rb` with the above content
3. Update `url` and `sha256` after each npm release
4. Users install with: `brew install saketh-kowtha/tap/lazyhub`

## Auto-updating the formula on release

Add to `.github/workflows/release.yml` after npm publish:
```yaml
- name: Update Homebrew tap
  if: steps.prepare.outputs.version != ''
  env:
    GH_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
  run: |
    VERSION="${{ steps.prepare.outputs.version }}"
    TARBALL="https://registry.npmjs.org/lazyhub/-/lazyhub-${VERSION}.tgz"
    SHA=$(curl -sL "$TARBALL" | shasum -a 256 | cut -d' ' -f1)
    gh api repos/saketh-kowtha/homebrew-tap/contents/Formula/lazyhub.rb \
      --method PUT \
      -f message="chore: bump lazyhub to v${VERSION}" \
      -f content="$(ruby -e "puts Base64.encode64(File.read('Formula/lazyhub.rb').gsub(/url .+/, \"url \\\"$TARBALL\\\"\").gsub(/sha256 .+/, \"sha256 \\\"$SHA\\\"\"))")"
```
