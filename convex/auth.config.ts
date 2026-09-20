/// <reference types="node" />
import type { AuthConfig } from "convex/server";

const local = process.env.THINK_WIDE_MODE === "local-demo";
// Convex evaluates bundles with NODE_ENV=production even on the local backend.
// Local trust is an explicit deployment setting; the Node issuer independently
// refuses production and can send tokens only to a literal loopback backend.
if (local && !process.env.THINK_WIDE_LOCAL_JWKS?.startsWith("data:text/plain;charset=utf-8;base64,")) {
 throw new Error("Local identity requires its public JWKS data URI");
}
export default {
 providers: local ? [{
  type: "customJwt",
  applicationID: "think-wide-local",
  issuer: "http://127.0.0.1/think-wide-local",
  jwks: process.env.THINK_WIDE_LOCAL_JWKS!,
  algorithm: "RS256",
 }] : [],
} satisfies AuthConfig;
