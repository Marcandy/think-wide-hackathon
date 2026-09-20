import { ConvexError } from "convex/values";
import { OPERATIONS, type OperationId } from "../../generated/operations";
import type { OperationError, ResultEnvelope } from "../../generated/types";
import * as validators from "../../generated/validators.js";

export function fail(
	code: OperationError["code"],
	message: string,
	extra: Omit<OperationError, "code" | "message"> = {},
): never {
	const data = { code, message, ...extra };
	if (!validators.OperationError(data))
		throw new ConvexError({
			code: "internal",
			message: "Invalid error response",
		});
	throw new ConvexError(data);
}

export function validate<T>(
	validator: validators.Validator,
	value: unknown,
	response = false,
): T {
	if (!validator(value))
		fail(
			response ? "internal" : "invalid_request",
			response ? "Invalid operation response" : "Invalid request",
			{
				details: [
					{
						path: (validator.errors?.[0]?.instancePath ?? "").slice(0, 256),
						problem: (validator.errors?.[0]?.message ?? "Invalid value").slice(
							0,
							256,
						),
					},
				],
			},
		);
	return value as T;
}

export function operationDefinition(id: OperationId) {
	const operation = OPERATIONS.find((item) => item.operationId === id);
	if (!operation) return fail("internal", "Unregistered operation");
	return operation;
}

export function validateResponse<T>(id: OperationId, response: T): T {
	const operation = operationDefinition(id);
	validate(validators[operation.responseType], response, true);
	if ("envelopeKind" in operation) {
		const envelope = response as ResultEnvelope;
		if (envelope.kind !== operation.envelopeKind)
			fail("internal", "Invalid envelope kind");
		if (operation.entriesType)
			for (const entry of envelope.entries)
				validate(validators[operation.entriesType], entry, true);
	}
	return response;
}

export function decode<T>(validator: validators.Validator, body: string): T {
	return validate<T>(validator, JSON.parse(body), true);
}
