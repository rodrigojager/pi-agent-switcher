Fully on-demand skill discovery for dedicated Pi profiles.

- Separate GPT-6 Astra/high planner from GPT-6.1 Sol/medium orchestrator. Planner writes durable vertical-slice plans and task contracts; orchestrator coordinates verified implementation.
- Use GPT-6 Luna for executor/reviewer and low-effort browser/desktop operators. Keep workspace-scout user-only, with automatic delegation blocked.
- Keep Higgsfield and Blender specialists adjustable, with scoped MCP access and on-demand skill families. Add /agent-config to save model/effort for future main and child runs.
- Advertise no automatic skill catalogs, including Pi default/reset. Discover and load only explicitly requested permitted skills through local tools; omit old system catalog patches and other profiles' discovery results.
- Restore the existing Codex account-pool provider for explicitly configured children. Retain Open Video Animator ownership contracts in English.

Validation: TypeScript and runtime tests verify zero automatic skill catalogs across all nine profiles, permitted on-demand Superbuild loading, denied cross-profile loading, profile switching and Pi default/reset. A clean production installation also checks real offline child execution. No paid model requests were used for these checks.

Profiles, installation instructions and all fork changes are included in the repository. Use /reload when Pi is idle; running sessions/jobs are not restarted automatically. Blender CLI is installed, but a Blender MCP connection is not configured. Higgsfield execution still requires service authentication.
