# mise / asdf Plugin

This directory is a seed for a standalone `mise`/`asdf` plugin repository. Copy
it to `mise-lazyhub` or `asdf-lazyhub` when publishing the plugin.

## Install Locally

```bash
mise plugin install lazyhub ./packaging/mise
mise install lazyhub@latest
```

## Release Updates

`bin/latest-stable` reads npm's `latest` dist-tag. `bin/install` downloads the
matching npm tarball, unpacks it, runs `npm install --omit=dev`, and links the
published `lazyhub` binary into the mise install directory.
