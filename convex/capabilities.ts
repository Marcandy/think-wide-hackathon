import { OPERATION_LIMITS, SEARCH_CAPS } from "../core/limits";
import { CONTRACT_VERSION } from "../generated/operations";
import { operation } from "./lib/operation";
import { fail } from "./lib/validation";

export const getCapabilities = operation.query("getCapabilities", async () => {
 // Connected identity profiles are owned by I01. Do not guess which provider ran.
 if (process.env.THINK_WIDE_MODE !== "local-demo") {
  return fail("capability_disabled", "Connected capabilities are not configured");
 }
 return {
  contractVersion: CONTRACT_VERSION,
  mode: "local-demo",
  authProfile: "local-fixed-principal",
  searchModes: [],
  limits: {
   searchHitsPerPage: SEARCH_CAPS.hitsPerPage,
   treeChildrenPerPage: OPERATION_LIMITS.treeChildrenPerPage,
   resultTextBytes: OPERATION_LIMITS.resultBytes,
   exactWindowBytes: OPERATION_LIMITS.exactWindowBytes,
   scanMaxFiles: SEARCH_CAPS.maxFiles,
   scanMaxBytes: SEARCH_CAPS.maxScanBytes,
   scanMaxMs: SEARCH_CAPS.wallClockMs,
  },
  integrations: {
   hostedIdentity: "not_run", remoteMcp: "not_run", githubApp: "not_run",
   issuePublish: "disabled", backendReasoning: "disabled", outcomeIngestion: "disabled",
  },
 };
});
