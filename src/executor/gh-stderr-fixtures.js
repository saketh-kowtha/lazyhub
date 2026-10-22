/**
 * Realistic gh stderr/exit shapes for the day-one failures (#313). `confirmed: true`
 * means verified against cli/cli source (gh-authored text) or captured from gh 2.89.0.
 * `confirmed: false` marks GitHub-server message text that gh passes through verbatim
 * and that cannot be reproduced without hitting a real rate-limited/SSO account
 * (GraphQL SAML wording, GraphQL/search rate-limit wording, Go dial errors). Shared by the classifier test and the PTY gh stub.
 */

export const GH_STDERR = {
  not_signed_in: {
    args: ['api', 'graphql'], exitCode: 4, confirmed: true,
    stderr: 'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n',
  },
  not_signed_in_http401: {
    // gh prints "Try authenticating with:" on any HTTP 401 (internal/ghcmd/cmd.go, api.go).
    args: ['api', 'user'], exitCode: 1, confirmed: true,
    stderr: 'gh: Bad credentials (HTTP 401)\n',
  },
  not_signed_in_ghes: {
    args: ['auth', 'token', '--hostname', 'ghe.acme.io'], exitCode: 1, confirmed: true, // captured from gh 2.89.0
    stderr: 'no oauth token found for ghe.acme.io\n',
  },
  sso_rest: {
    args: ['api', 'repos/acme/billing/pulls'], exitCode: 1, confirmed: true,
    stderr: 'gh: Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization. (HTTP 403)\n',
  },
  sso_graphql: {
    args: ['api', 'graphql', '-f', 'owner=acme', '-f', 'name=billing', '-f', 'query=query { repository { id } }'], exitCode: 1, confirmed: false,
    stderr: 'GraphQL: Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization. (organization.repository)\n',
  },
  sso_header_url: {
    args: ['api', 'orgs/acme/repos'], exitCode: 1, confirmed: true,
    // gh never prints the X-GitHub-SSO header; it prints its url= value after "Authorize in your web
    // browser:" (pkg/cmd/api/api.go, factory.SSOURL). That one-time URL must never be echoed.
    stderr: 'gh: Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization. (HTTP 403)\nAuthorize in your web browser: https://github.com/orgs/acme/sso?authorization_request=A1B2C3D4E5F6A7B8C9\n',
  },
  scope_graphql: {
    args: ['api', 'graphql'], exitCode: 1, confirmed: true,
    stderr: "GraphQL: Your token has not been granted the required scopes to execute this query. The 'name' field requires one of the following scopes: ['read:org'], but your token has only been granted the: ['repo'] scopes. Please modify your token's scopes at: https://github.com/settings/tokens.\n",
  },
  scope_gh_refresh: {
    args: ['project', 'list'], exitCode: 1, confirmed: true, // pkg/cmd/project/shared/queries
    stderr: 'error: your authentication token is missing required scopes [read:org]\nTo request it, run:  gh auth refresh -s read:org\n',
  },
  scope_rest_suggestion: {
    args: ['api', 'orgs/acme/teams'], exitCode: 1, confirmed: true, // api.ScopesSuggestion
    stderr: 'gh: Resource not accessible by personal access token (HTTP 403)\ngh: This API operation needs the "read:org" scope. To request it, run:  gh auth refresh -h github.com -s read:org\n',
  },
  scope_unnamed: {
    args: ['api', 'repos/acme/billing/hooks'], exitCode: 1, confirmed: true,
    stderr: 'gh: Resource not accessible by personal access token (HTTP 403)\n',
  },
  rate_core: {
    args: ['api', 'repos/acme/billing/pulls'], exitCode: 1, confirmed: true,
    stderr: 'gh: API rate limit exceeded for user ID 1234567. If you reach out to GitHub Support for help, please include the request ID ABCD:1234 and timestamp 2026-10-22 14:26:01 UTC. (HTTP 403)\n',
  },
  rate_graphql: {
    args: ['api', 'graphql'], exitCode: 1, confirmed: false,
    stderr: 'GraphQL: API rate limit already exceeded for user ID 1234567. (graphql)\n',
  },
  rate_search: {
    args: ['api', 'search/issues?q=is:pr'], exitCode: 1, confirmed: false,
    stderr: 'gh: API rate limit exceeded for user ID 1234567. (HTTP 403)\n',
  },
  rate_secondary: {
    args: ['api', 'graphql'], exitCode: 1, confirmed: true,
    stderr: 'gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID 1234:ABCD. (HTTP 403)\n',
  },
  repo_not_found_graphql: {
    args: ['api', 'graphql', '-f', 'owner=acme', '-f', 'name=legacy'], exitCode: 1, confirmed: true,
    stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/legacy'. (repository)\n",
  },
  repo_not_found_rest: {
    args: ['api', 'repos/acme/legacy'], exitCode: 1, confirmed: true,
    stderr: 'gh: Not Found (HTTP 404)\n',
  },
  offline: {
    args: ['api', 'graphql'], exitCode: 1, confirmed: true,
    stderr: 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n',
  },
  offline_dial: {
    args: ['api', 'user'], exitCode: 1, confirmed: false,
    stderr: 'Get "https://api.github.com/user": dial tcp: lookup api.github.com: no such host\n',
  },
  gh_too_old: {
    args: ['pr', 'list', '--json', 'mergeStateStatus'], exitCode: 1, confirmed: true, // pkg/cmdutil/json_flags.go
    stderr: 'Unknown JSON field: "mergeStateStatus"\n',
  },
  gh_too_old_flag: {
    args: ['auth', 'token', '--hostname', 'x'], exitCode: 1, confirmed: true, // cobra, captured from gh 2.89.0
    stderr: 'unknown flag: --hostname\n\nUsage:  gh auth token [flags]\n',
  },
  gh_missing: {
    args: ['--version'], exitCode: 1, confirmed: true, code: 'ENOENT',
    message: 'Command failed with ENOENT: gh --version\nspawn gh ENOENT', stderr: '',
  },
}
