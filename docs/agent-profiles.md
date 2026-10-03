# Dedicated agent profiles

These profiles separate planning from coordination and keep unrelated skill and
role catalogs out of normal requests. Prompts and descriptions are in English;
agents answer in the user's language.

| Profile | Default model / effort | Initially advertised skills | On-demand skills and tools |
| --- | --- | --- | --- |
| planner | GPT-6 Astra / high | pi-zgrep-search | superbuild, trusted project skills; plan submission and questions when installed |
| orchestrator | GPT-6.1 Sol / medium | pi-zgrep-search | bounded agent discovery, subagents, task/goal tools; direct workspace search |
| executor | GPT-6 Luna / high | pi-zgrep-search | trusted project skills, editing and targeted validation |
| reviewer | GPT-6 Luna / high | pi-zgrep-search | trusted project skills; read-only review instructions |
| workspace-scout | GPT-6 Luna / low | pi-zgrep-search | direct local search; explicit user invocation only |
| browser-operator | GPT-6 Luna / low | agent-browser | existing browser attachment; optional web-access tools |
| desktop-operator | GPT-6 Luna / low | none | Windows-MCP schemas and calls through profile_mcp |
| higgsfield-specialist | GPT-6.1 Sol / high | higgsfield | Higgsfield family and Higgsfield MCP only |
| blender-specialist | GPT-6.1 Sol / medium | blender-director, blender-image-to-3d | Blender family; Blender MCP if configured or verified Blender CLI |

The two existing Open Video Animator profiles retain Luna/high and their file,
worktree, desktop and validation ownership contracts. They use the executor or
reviewer resource policy; their task-specific prompts are now in English.

## Install the provided definitions

The profile templates target Rodrigo's existing Pi installation: the Codex account
pool package, pi-zgrep, its `zg-subagent` child wrapper, the shared skill library,
and Windows-MCP are installed separately. They are not installed by this package.
Model IDs must exist in the current provider catalog. Missing tools cause a clear
selection error instead of silently restoring every tool.

From this package directory, run:

```sh
node scripts/install-profiles.mjs
```

The installer writes agents and child wrappers to the global Pi agent directory,
saves backups outside this repository, and creates `agent-profiles.json` with
`orchestrator` as the default for a new, unsaved main session. Saved selections are
restored. Existing jobs are not stopped or modified. Reload Pi when idle.

Explicit child extensions restore the account-pool provider without exposing its
account-management tools. The common provider wrapper assumes the pool's existing
Git installation at `~/.pi/agent/git/github.com/rodrigojager/pi-codex-account-pool`.
Adapt that wrapper and provider fields if using another installation/provider.

## Use and configure

- **Alt+A**: filter and switch the main conversation profile.
- **Alt+M** or **Ctrl+L**: select the main profile's model; **Shift+Tab** cycles effort.
  These manual choices are retained per profile on the current session branch.
- `@workspace-scout Find ...`: user-driven search without a main-model inference.
- `@executor Implement ...`: explicitly delegate a bounded task.
- `/agent-config blender-specialist codex-account-pool/gpt-6-astra high`: save
  defaults for main use and future child runs. The same command works for every
  profile and for newly registered future models. Existing children keep their
  settings. Ordinary `/model` selections do not change child definition files.

Planner writes project plans, stable task IDs, vertical-slice acceptance contracts,
dependencies and ownership. Orchestrator reads those files and coordinates bounded
deliveries. It searches directly; `workspace-scout` is excluded from automatic
agent discovery and model-issued `subagent` calls. The user-facing picker, mentions
and commands can still invoke it. Planner can be selected as the main profile or
discovered and delegated to when substantive project design is needed; its prompt
and skills are not included in ordinary orchestration requests.

## Context behavior

`skills:` lists only the small initial discovery catalog. Pi includes their names,
descriptions and paths, not full bodies. `skill_catalog` returns up to five permitted
matches by default; `skill_load` reads one permitted skill. Higgsfield and Blender
families remain in the global shared skills folder, without being advertised to
other profiles. Project skills are limited to the trusted current project's skill
folders. `under-review` and `_migration` directories are excluded.

`agent_catalog` similarly returns bounded delegate metadata; neither agent bodies
nor their roles/skills are inserted until delegation. No template specifies a
professional role. Existing role selection remains opt-in.

`profile_mcp` lists only the active specialist's MCP namespace, preserving actual
schemas and image results. Cross-service nested calls are blocked and global MCP
server metadata is omitted from scoped requests. Servers still follow Pi's normal
connection lifecycle; this is a context/tool-visibility policy, not process isolation.

When switching profiles, outgoing requests omit obsolete system catalogs, tool
definitions and skill-file results from unrelated profiles. Saved history and
ordinary conversation/task results remain intact. Explicit user-provided text,
arbitrary shell output and summaries can still contain domain knowledge; this is
not a filesystem sandbox or a guarantee of lower cost for every task.

The installed Blender executable was found at Blender 5.2; no Blender MCP is
configured in Pi. The profile can use a verified executable or a future configured
MCP connection. Higgsfield service authentication remains necessary for execution.

## Validation

The offline SDK tests capture actual outgoing Pi model contexts across all nine
profiles and launch a real child process. They verify defaults, skill/tool catalog
boundaries, preservation of selected model/effort, roles, direct user delegation,
and cancellation without paid model calls. Unit checks cover cross-service blocks,
bounded MCP schemas, images and scout gating. An optional Windows smoke test uses
the real native Pi MCP gateway and Windows-MCP Snapshot; it performs no clicks or
typing. These checks establish routing behavior, not model quality or token savings.
