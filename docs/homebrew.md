# Homebrew Tap

Lazyhub is available via the `saketh-kowtha/homebrew-tap` tap.

## Installation

```bash
brew install saketh-kowtha/tap/lazyhub
```

## Formula: Formula/lazyhub.rb

```ruby
class Lazyhub < Formula
  desc "Lazygit-style GitHub TUI — keyboard-driven terminal UI for GitHub"
  homepage "https://github.com/saketh-kowtha/lazyhub"
  url "https://registry.npmjs.org/lazyhub/-/lazyhub-0.2.1.tgz"
  sha256 "..."
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

## Auto-updating the formula on release

The formula is automatically updated via the `.github/workflows/release.yml` workflow after a successful npm publish. It uses the `TAP_TOKEN` secret to push changes to the `homebrew-tap` repository.

```yaml
- name: Push formula to homebrew-tap
  if: steps.prepare.outputs.version != ''
  uses: actions/github-script@v7
  env:
    VERSION: ${{ steps.prepare.outputs.version }}
    SHA256:  ${{ steps.sha.outputs.sha }}
    URL:     ${{ steps.sha.outputs.url }}
  with:
    github-token: ${{ secrets.TAP_TOKEN }}
    script: |
      // ... (see release.yml for full script)
```
