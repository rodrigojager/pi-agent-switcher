import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import codexAccountPool from "../git/github.com/rodrigojager/pi-codex-account-pool/src/index.ts";

// Explicit child extension lists disable automatic package loading. Keep the
// user's existing Codex account provider available, without exposing its tools.
export default function profileProvider(pi: ExtensionAPI) {
  if (Number(process.env.PI_SUBAGENT_DEPTH ?? "0") > 0) return codexAccountPool(pi);
}
