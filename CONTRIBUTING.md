# Contributing

Thanks for helping improve lazyhub. Contributions that strengthen review fixtures, documentation, terminal compatibility, tests and carefully reviewed TOML examples are especially useful. The project does not load community plugins or execute arbitrary commands from contribution examples.

## Set up and validate

You need Node.js 20 or later. Clone the repository, install its locked dependencies and build the CLI:

```sh
git clone https://github.com/saketh-kowtha/lazyhub.git
cd lazyhub
npm ci
npm run build
```

Run the required gate before opening a pull request:

```sh
npm run lint && npm test && npm run build
```

`npm run typecheck` is not yet part of the required gate (see AGENTS.md) but is cheap to run and worth checking.

The test suite uses mocked GitHub CLI calls and temporary configuration. It should not access your real GitHub repositories or modify `~/.config/lazyhub`. To exercise terminal flows, run `npm run test:pty`; those flows use a fixture `gh` and a throwaway home directory. Optional portability checks are available through `npm run test:portability`.

## Find work that fits

Read [the current roadmap](docs/ROADMAP.md) and the issue's complete spec before starting. Check the existing implementation and nearby docs first so the change fits the current behavior. Issues marked `good first issue` or `help wanted` are the best place to start; bounded improvements to fixtures, docs, test coverage and compatibility reports are good first contributions. Security, credentials, authorization, release integrity and policy changes need an experienced reviewer.

Follow the applicable workflow in [AGENTS.md](AGENTS.md): UI changes need a committed mockup first, bug fixes need a reproducing test, and feature changes must verify the running behavior. Keep changes within the files an issue assigns. If the issue does not cover a needed file, explain the dependency in the issue or pull request instead of making an unrelated change.

## Fixtures and examples

Use the deterministic fixtures under `test/pty/fixtures.js` or the demo setup in [docs/demo/README.md](docs/demo/README.md). Demo recordings use fictional repository data and a fixture-only `gh`. Never put access tokens, private repository content, real user names or private payloads into fixtures, screenshots or recordings.

Configuration examples must use TOML and keys supported by the current schema. They must not contain shell commands that run arbitrary code or imply that configuration grants write permission. See [the configuration reference](docs/CONFIG_REFERENCE.md).

## Pull requests and security

Keep a pull request focused. Describe the user-visible result, behavior change, validation run, docs updates and any follow-up work. Report only commands that completed successfully; do not claim a manual run or contributor trial that did not happen. Maintainer reviews happen as availability allows, with no fixed response-time promise.

For a vulnerability or a security-sensitive report, follow the private disclosure instructions in [SECURITY.md](SECURITY.md). Do not open a public issue containing credentials, exploit details or private data. See [the threat model](docs/THREAT_MODEL.md) for the project's security boundaries.

If you try this contributor path, voluntary feedback about setup friction is welcome in the related issue or pull request. Lazyhub does not collect contributor analytics or send telemetry.
