# Changes from upstream pi-agent-switcher 0.2.1

## 0.4.0-rodrigo.7

- Disable all automatic skill metadata in the provided profiles and explicit children, including the previous small initial catalog.
- Add global on-demand discovery mode for Pi default/reset and remove old system catalog patches from outgoing context.
- Keep profile-specific local skill_catalog/skill_load access without moving shared libraries or changing other clients.
- Explicitly include the shared .agents/skills library in local lookup so Superbuild and Blender remain discoverable when native metadata discovery is disabled.
- Resolve Pi skill junctions to physical paths for family permissions and relative references, keeping flattened aliases usable without leaking other families.
- Omit stale skill discovery results after switching profiles. Preserve explicitly loaded instructions needed by the current task.
- Add an upgrade installer that preserves agent prompts, models, thinking defaults and the configured new-session default.
- Capture real offline SDK requests to verify zero automatic catalogs, permitted on-demand loading, denied cross-profile loading and reset behavior.

## 0.4.0-rodrigo.6

- Add nine dedicated profiles: separate Astra planner and Sol orchestrator, Luna executor/reviewer/operators, user-only scout, and adjustable Higgsfield/Blender specialists.
- Add bounded, on-demand skill and delegate catalogs with profile allowlists and trusted project skill discovery. Exclude review staging from discovery.
- Scope MCP schemas/calls to the active specialist and preserve images. Remove unrelated MCP metadata and obsolete profile resource declarations from outgoing requests, without editing saved history.
- Restore explicit child resources and the existing account-pool provider; preserve Open Video Animator ownership contracts in English.
- Add opt-in new-session default configuration, backed-up profile installer and /agent-config for durable main/child model-effort defaults.
- Validate real offline Pi contexts and child execution, plus a live Windows-MCP Snapshot through the new gateway; no paid inference or desktop interaction.

## 0.4.0-rodrigo.5

- Restore the role category next to the bold name, separated by a dot and rendered in muted color without bold.
- Preserve two-line cards, blank spacing, hidden IDs/User labels, category search and Project markers.

## 0.4.0-rodrigo.4

- Highlight the active agent and role with separate theme colors and bold names; dim labels and inactive defaults. Keep RPC status text plain.
- Add Alt+R to the existing role picker, sharing command behavior and popup guards with Alt+A.
- Bundle the native Alt+M model-selector keybinding example, retaining Ctrl+L; document configuration and reload.

## 0.4.0-rodrigo.3

- Separate role entries with a blank line in the picker and `/roles` output.
- Account for spacing in the viewport budget so the selected role stays visible in small overlays.

## 0.4.0-rodrigo.2

- Display roles as two-line entries, with the name above the description.
- Hide role IDs, categories, and the User scope label from role rows; retain ID/category search and Project markers.
- Show the active role's name and simplify `/roles` output without changing selection IDs, agent picker layout, or role execution.

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
# 0.4.0-rodrigo.1

- Share the pure production roles core with pi-subagent 0.13.0-rodrigo.1.
- Add branch-aware Pi-default role selection and read-only named-agent browsing.
- Add invocation role parsing, completions, a fresh Default delegation picker and v2 bridge.
- Preserve structured prompt sections, native file mentions, execution settings and task retry behavior.
