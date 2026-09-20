import type { FunctionReference } from "convex/server";
import { ConvexError, type Value } from "convex/values";
import { api } from "../../../convex/_generated/api";
import { OPERATION_LIMITS } from "../../../core/limits";
import { canonicalArguments } from "../../../core/receipts";
import {
	OPERATION_HANDLERS,
	OPERATIONS,
	type OperationId,
	type OperationResponseMap,
} from "../../../generated/operations";
import type { OperationError } from "../../../generated/types";
import * as validators from "../../../generated/validators.js";
import { convexClient } from "../convex-client";

/** The registry supplies all bindings and shapes. Policy executes in Convex. */
export async function dispatch(
	operationId: string,
	request: unknown,
	token: string,
): Promise<OperationResponseMap[OperationId] | OperationError> {
	const definition = OPERATIONS.find((op) => op.operationId === operationId);
	if (!definition) {
		return { code: "capability_disabled", message: "Operation unavailable" };
	}
	let encoded: string;
	try {
		encoded = canonicalArguments(request);
		if (Buffer.byteLength(encoded) > OPERATION_LIMITS.requestBytes) {
			throw new Error();
		}
	} catch {
		return {
			code: "invalid_request",
			message: "Invalid JSON request",
			details: [
				{
					path: "/request",
					problem: "Request exceeds JSON, depth or size limits",
				},
			],
		};
	}
	const validator = validators[definition.requestType];
	if (!validator(request)) {
		return {
			code: "invalid_request",
			message: "Invalid request",
			details: [
				{
					path: (validator.errors?.[0]?.instancePath ?? "").slice(0, 256),
					problem: (validator.errors?.[0]?.message ?? "Invalid value").slice(
						0,
						256,
					),
				},
			],
		};
	}
	const handlers: Readonly<Partial<Record<string, string>>> =
		OPERATION_HANDLERS;
	const binding = handlers[definition.operationId];
	if (!binding) {
		return { code: "capability_disabled", message: "Operation unavailable" };
	}
	if (!token) {
		return { code: "unauthenticated", message: "Authentication required" };
	}
	try {
		const client = convexClient(token);
		// The generated API proxy is indexed only by generated bindings. The registry's
		// effect is checked against real registrations by operation-handlers.test.ts.
		const [module, name] = binding.split(":");
		const publicApi: Record<
			string,
			Record<
				string,
				FunctionReference<
					"query" | "mutation",
					"public",
					{ request: unknown },
					unknown
				>
			>
		> = api;
		const reference = publicApi[module][name];
		const args = { request: JSON.parse(encoded) as Value };
		const response =
			definition.effect === "read"
				? await client.query(
						reference as FunctionReference<
							"query",
							"public",
							typeof args,
							unknown
						>,
						args,
					)
				: await client.mutation(
						reference as FunctionReference<
							"mutation",
							"public",
							typeof args,
							unknown
						>,
						args,
					);
		if (!validators[definition.responseType](response)) {
			throw new Error("Invalid operation response");
		}
		return response as OperationResponseMap[OperationId];
	} catch (error) {
		if (error instanceof ConvexError) {
			let data: unknown = error.data;
			if (typeof data === "string") {
				try {
					data = JSON.parse(data);
				} catch {
					data = null;
				}
			}
			if (validators.OperationError(data)) {
				return data as OperationError;
			}
		}
		// Transport messages can contain stack paths or provider details. Never expose them.
		return { code: "internal", message: "Operation failed" };
	}
}
