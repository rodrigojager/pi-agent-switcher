Dedicated Pi agent profiles and lazy resource discovery.

- Separate GPT-6 Astra/high planner from GPT-6.1 Sol/medium orchestrator. Planner writes durable vertical-slice plans and task contracts; orchestrator coordinates verified implementation.
- Use GPT-6 Luna for executor/reviewer and low-effort browser/desktop operators. Keep workspace-scout user-only, with automatic delegation blocked.
- Keep Higgsfield and Blender specialists adjustable, with scoped MCP access and on-demand skill families. Add /agent-config to save model/effort for future main and child runs.
- Advertise only small profile-specific skill catalogs. Load additional permitted skills, delegates and MCP schemas on demand; omit obsolete resource declarations from outgoing requests without altering saved history.
- Restore the existing Codex account-pool provider for explicitly configured children. Retain Open Video Animator ownership contracts in English.

Validation: TypeScript check and 35 tests passed; clean production installation passed nine checks, including real offline child execution. The native Pi MCP gateway completed a real Windows-MCP Snapshot and preserved the screenshot, without paid model requests, clicks or typing. Installed global and explicit-child profile discovery passed.

Profiles, installation instructions and all fork changes are included in the repository. Use /reload when Pi is idle; running sessions/jobs are not restarted automatically. Blender CLI is installed, but a Blender MCP connection is not configured. Higgsfield execution still requires service authentication.
