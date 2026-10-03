# Pi Agent Switcher — Rodrigo's version

Switch the main Pi conversation to a specialist from a searchable popup. Delegate a separate task with `@agent task` while keeping the main conversation's profile.

Derived from `pi-agent-switcher@0.2.1` by `byack`, maintained in [KunCheng-He/kk-ai](https://github.com/KunCheng-He/kk-ai/tree/main/pi-extensions/common/pi-agent-switcher). [Upstream provenance](UPSTREAM.md) and [all changes](CHANGES.md) are recorded separately.

## Install

Requires Pi 1.0.0 or newer. For delegation, use [Rodrigo's Pi Subagent](https://github.com/rodrigojager/pi-subagent) `v0.12.4-rodrigo.2` or newer.

```sh
pi install https://github.com/rodrigojager/pi-agent-switcher@v0.3.0-rodrigo.2
```

If Pi is already open, use `/reload` after active work finishes. The package does not reload Pi or stop existing jobs automatically. Enable one agent-switcher implementation at a time, since `/agent` and `Alt+A` are shared command/shortcut names.

## Usage

| Action                               | Command or key                               |
| ------------------------------------ | -------------------------------------------- |
| Open the searchable main-agent popup | **Alt+A** or `/agent`                        |
| Activate a main profile directly     | `/agent <name>`                              |
| Restore the original Pi profile      | `/agent reset`                               |
| List profiles and descriptions       | `/agents`                                    |
| Select a specialist and enter a task | `/delegate`                                  |
| Delegate directly                    | `/delegate <name> <task>`                    |
| Delegate from the chat               | `@scout Find the files that implement login` |

The popup displays **bold agent names** followed by descriptions. Type to filter by either field; multi-word searches and accents work. Use ↑/↓, Enter, and Esc. Numbers remain searchable characters. The active profile is marked, and `Pi default` restores the original session settings. `Ctrl+A` and `Ctrl+P` retain their Pi functions.

`@` completion adds specialist suggestions alongside Pi's file suggestions. Completing an agent inserts the explicit `@agent:<name>` form, avoiding file-name ambiguity. A bare `@<name>` works at the start of a message when a matching agent exists and there is no file with that name. `@README.md`, path references, and mentions elsewhere in a sentence keep normal Pi behavior.

## Agent definitions

Existing definitions work without copying them:

- Global shared agents: `~/.pi/agent/agents/*.md`
- Project shared agents: nearest ancestor `.pi/agents/*.md`
- Global main-only profiles: `~/.pi/agent/k-priagent/**/*.md`
- Project main-only profiles: nearest ancestor `.pi/k-priagent/**/*.md`

Project definitions override global definitions. Within a scope, an explicit `k-priagent` profile overrides a shared definition with the same name. Delegation uses the `agents` definitions consumed by the existing subagent runtime, independently of a main-only override.

```yaml
---
name: planner
description: Plan implementation and delegate focused research
provider: openai-codex
model: YOUR_MODEL_ID
thinking: high
tools: read, bash, subagent
skills: false
mode: both
---
Produce an actionable plan. Delegate bounded research to the appropriate specialist.
```

Only `name`, `description`, and a nonempty prompt body are required. Agent names must contain letters, numbers, `_`, `.`, or `-`; `reset`, `default`, and `off` are reserved. Fields:

| Field      | Behavior                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `model`    | `provider/model-id` or a bare ID. Bare IDs prefer the original session provider, then an unambiguous available model.       |
| `provider` | Optional provider for a bare model ID.                                                                                      |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. `thinkingLevel` is an alias. Pi can clamp unsupported levels. |
| `tools`    | Comma-separated or YAML array of configured tool names. `[]` activates no tools.                                            |
| `skills`   | Omitted: inherit Pi's loaded catalog. `false`/`[]`: advertise no skills. List: advertise only those loaded names.           |
| `context`  | `false` omits context files such as `AGENTS.md` from the active profile's system prompt.                                    |
| `mode`     | `primary`, `subagent`, or `both`. Shared agents default to `both`; `k-priagent` profiles default to `primary`.              |

Omitted model, tools, or thinking inherit the session baseline captured before the first activation, preventing restrictions or model choices from a previous specialist leaking into another. Reset restores that baseline. The selected profile and baseline are persisted on the session branch; the user's session name is preserved. Re-select a profile after editing its definition to apply changes.

An agent's `model` and `thinking` are defaults. After activation, use Pi's `/model` selector or `Ctrl+P` to change the model, and `Shift+Tab` to cycle thinking levels. Manual selections are remembered for that profile on the current session branch, including switching away and back, reload/resume, and tree navigation. They do not rewrite agent definitions or change other sessions. A new session starts with the definition's defaults. Supported thinking levels depend on the selected model; any model registered and authenticated in Pi can be selected, without editing this extension.

Delegated children still use their agent definition's settings. Changing the main profile's model or thinking does not change a separately delegated child.

## Skills and context

Profiles modify Pi 1.0's structured system prompt and skill catalog without flattening other extensions' prompt sections. Unknown named skills are reported and omitted. Selection does not install skills or change their files.

Skill filtering changes prompt visibility. It does not erase earlier conversation messages, revoke filesystem access, or prevent a user from explicitly invoking a skill. Existing context already read into the conversation remains there. Switching a main profile keeps the conversation history; delegation receives a separate task and its specialist prompt.

Extensions remain loaded in the main Pi process. An agent's `extensions` field belongs to the child runtime; the main picker uses `tools` to select from tools already configured in the session. The picker does not restart or unload extensions when changing profiles.

## Delegation

The event-bus bridge routes requests through the existing `startSubagentJob` lifecycle: project-agent confirmation, isolated child context, numbered progress cards, `/jobs`, and cancellation. The main model is not called merely to dispatch a manually addressed task. Completion returns through the existing result cards. Include all relevant context or file paths in the task.

Image attachments are refused because this runtime's task interface accepts text. A failed request is restored in the editor for retry. Without the compatible bridge, the picker still switches main profiles and reports how to enable delegation; existing `/run` continues working.

## Development and validation

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

Tests cover discovery/precedence, real input filtering, bold names, terminal width/height, immediate switching and reset, skill catalog visibility, branch restoration, mentions, file completion, and an end-to-end SDK session with an actual child process. The end-to-end provider is offline: it produces deterministic responses and makes no network or paid model requests.

License: MIT.
