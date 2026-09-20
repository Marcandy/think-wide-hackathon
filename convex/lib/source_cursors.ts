import { fail } from "./validation";

const encoder = new TextEncoder();
export function hex(bytes: ArrayBuffer) {
	return Array.from(new Uint8Array(bytes), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function digest(
	bytes: Uint8Array<ArrayBuffer>,
	algorithm = "SHA-256",
) {
	return hex(await crypto.subtle.digest(algorithm, bytes));
}

export async function gitBlobDigest(
	bytes: Uint8Array<ArrayBuffer>,
	algorithm: "sha1" | "sha256",
) {
	const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
	const object = new Uint8Array(header.length + bytes.length);
	object.set(header);
	object.set(bytes, header.length);
	return digest(object, algorithm === "sha1" ? "SHA-1" : "SHA-256");
}

export async function sourceCursor(secret: string, scope: readonly unknown[]) {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
	const message = (position: string) =>
		encoder.encode(JSON.stringify([...scope, position]));
	return {
		async encode(position: string) {
			const signature = hex(
				await crypto.subtle.sign("HMAC", key, message(position)),
			);
			return `${position}:${signature}`;
		},
		async decode(cursor: string | undefined) {
			if (!cursor) {
				return "";
			}
			const split = cursor.lastIndexOf(":");
			const position = cursor.slice(0, split);
			const signature = cursor.slice(split + 1);
			if (
				split < 1 ||
				!/^[A-Za-z0-9_:.-]{1,128}$/.test(position) ||
				!/^[0-9a-f]{64}$/.test(signature)
			) {
				return fail("cursor_invalid", "Invalid cursor");
			}
			const bytes = Uint8Array.from(signature.match(/../g) ?? [], (part) =>
				Number.parseInt(part, 16),
			);
			if (
				!(await crypto.subtle.verify("HMAC", key, bytes, message(position)))
			) {
				return fail("cursor_invalid", "Invalid cursor");
			}
			return position;
		},
	};
}
