# lazyhub Design References

## Consistency Rules

- Use one border style app-wide; variants choose the style, implementation does not mix styles within a screen.
- Keep 1-cell horizontal padding inside bordered panes.
- Use `accent.primary` in no more than three places per screen: active pane, focused row, primary action.
- Dim inactive panes with `fg.subtle`; do not hide them unless the viewport forces collapse.
- Use tokens from `src/theme/tokens.js` only; design annotations use token paths such as `border.default`.

## lazygit

Borrow: dense split-pane structure, persistent footer hints, focused-pane borders, and compact row metadata. lazyhub should feel similarly fast to scan, with `border.default`, `border.focused`, `fg.muted`, and `fg.subtle` doing the structural work.

Do not borrow: layout shifts on row focus, mixed border weights, or a file-tree mental model for PRs and issues.

## k9s

Borrow: header/breadcrumb discipline and terse status markers. The app chrome variants use k9s-style top context lines with `fg.muted` separators and `status.*` health color.

Do not borrow: cluster/resource jargon density, column overload, or modal command surfaces that obscure the primary list.

## gh-dash

Borrow: PR table columns that keep number, title, checks, review, author, and age visible in one row. PR and issue list variants use this as the source for column ordering.

Do not borrow: wide-screen-only assumptions. Every list has an 80-column layout that degrades by truncating secondary metadata first.

## Charm Apps

Borrow: restrained accent usage, calm empty states, and text-first command palettes. Overlay and help variants use `bg.overlay`, `accent.secondary`, and `fg.inverse` as sparse highlights.

Do not borrow: large decorative whitespace or playful branding inside work screens. lazyhub is a repeated-use review tool, not a landing page.
