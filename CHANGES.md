# Changes from upstream pi-agent-switcher 0.2.1

## 0.3.0-rodrigo.2

- Treat profile model and thinking as defaults: retain manual Pi model/thinking selections per profile on the session branch.
- Restore these selections when switching profiles, resuming/reloading, or navigating the session tree, without changing definition files, other profiles, or delegated children.
- Keep persisted entries immutable so subsequent selections cannot change an earlier branch's state.
- Add regression coverage for manual selections, reset, fresh sessions, earlier branches, and real SDK model/thinking events.

## 0.3.0-rodrigo.1

- Implemented actual live search by name and description, including accent-insensitive multi-word queries.
- Replaced the selector with a centered overlay: bold agent names followed by descriptions, active-profile marker, keyboard navigation, cancellation, and narrow-terminal wrapping.
- Preserved the original two-key `Alt+A` shortcut. `Ctrl+A` keeps Pi's existing behavior.
- Removed digit-to-select behavior so numbers can be typed into searches.
- Discover existing `.pi/agents` definitions as well as upstream's `k-priagent` profiles. Project definitions override global definitions. Explicit primary definitions take priority within a scope.
- Added `mode: primary | subagent | both` to control picker visibility and delegation discovery.
- Added `provider` plus bare `model` compatibility, array-valued tool/skill lists, `thinkingLevel` alias, and all Pi thinking levels.
- Apply model, tools, and thinking immediately on activation; capture and restore the original session baseline when changing to an inheriting profile or resetting.
- Persist profile and baseline on the current session branch. Restore on start, resume, reload, fork, and tree navigation.
- Use Pi 1.0's structured `agent_profile` system-prompt section instead of replacing the entire host prompt. Preserve other extensions' sections and Pi's tool/context state.
- Filter the advertised skill catalog with `skills: false` or an explicit list. `context: false` omits project context files for the active profile.
- Report missing named skills and omit them while preserving the allowlist.
- Display the active role through `setStatus`, preserving the user's session name.
- Add `/delegate`, `@name task`, and explicit `@agent:name task`, using the installed Rodrigo subagent runtime through a documented event-bus handshake.
- Add agent suggestions alongside native file suggestions with Pi's public `addAutocompleteProvider` API. Existing files win ambiguous unqualified mentions.
- Keep main-agent selection separate from child execution; delegation does not switch the main profile or call the main model to dispatch.
- Preserve failed requests in the editor for retry and refuse unsupported image forwarding.
- Guard main-agent switching during an active turn, duplicate popup requests, unavailable tools/models, and untrusted project profiles.
- Add tests for discovery, filtering, rendering, activation/reset, skills, branch restoration, mentions, file completions, and real SDK/child execution with an offline provider.

The child execution engine, progress cards, cancellation, and `/jobs` remain provided by `rodrigojager/pi-subagent`.
