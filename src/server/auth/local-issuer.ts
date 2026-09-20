import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";
import { serverConfig } from "../config";

export const LOCAL_ISSUER = "http://127.0.0.1/think-wide-local";
export const LOCAL_AUDIENCE = "think-wide-local";
const keyDirectory = fileURLToPath(
	new URL("../../../infra/.data/local-identity/", import.meta.url),
);
const keyPath = `${keyDirectory}/signing-key.json`;

/** No listener, HTTP endpoint, configurable subject, or caller-supplied claims. */
export async function localIssuer() {
	if (
		serverConfig().mode !== "local-demo" ||
		process.env.NODE_ENV === "production"
	) {
		throw new Error(
			"The development issuer requires non-production local-demo mode",
		);
	}
	await mkdir(keyDirectory, { recursive: true, mode: 0o700 });
	const directory = await lstat(keyDirectory);
	if (
		!directory.isDirectory() ||
		directory.isSymbolicLink() ||
		(directory.mode & 0o077) !== 0
	) {
		throw new Error("Local identity directory must be private (0700)");
	}
	try {
		await lstat(keyPath);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			error.code !== "ENOENT"
		) {
			throw error;
		}
		const pair = await generateKeyPair("RS256", { extractable: true });
		const temporary = `${keyPath}.${crypto.randomUUID()}.tmp`;
		const file = await open(
			temporary,
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_EXCL |
				constants.O_NOFOLLOW,
			0o600,
		);
		try {
			try {
				await file.writeFile(
					JSON.stringify({
						...(await exportJWK(pair.privateKey)),
						kid: "local-v1",
						alg: "RS256",
						use: "sig",
					}),
				);
				await file.sync();
			} finally {
				await file.close();
			}
			// Publish only a complete key and never replace a key another process won.
			try {
				await link(temporary, keyPath);
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!("code" in error) ||
					error.code !== "EEXIST"
				) {
					throw error;
				}
			}
		} finally {
			await unlink(temporary);
		}
	}

	const reader = await open(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
	let key: JWK;
	try {
		const stat = await reader.stat();
		if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
			throw new Error("Local signing key must be private (0600)");
		}
		key = JSON.parse(await reader.readFile("utf8"));
	} finally {
		await reader.close();
	}
	if (
		key.kty !== "RSA" ||
		!key.d ||
		!key.n ||
		!key.e ||
		key.kid !== "local-v1"
	) {
		throw new Error("Invalid local signing key");
	}
	const privateKey = await importJWK(key, "RS256");
	const jwks = {
		keys: [
			{
				kty: "RSA",
				n: key.n,
				e: key.e,
				kid: key.kid,
				alg: "RS256",
				use: "sig",
			},
		],
	};
	return {
		jwksDataUri: `data:text/plain;charset=utf-8;base64,${Buffer.from(JSON.stringify(jwks)).toString("base64")}`,
		mint: () =>
			new SignJWT({})
				.setProtectedHeader({ alg: "RS256", typ: "JWT", kid: key.kid })
				.setIssuer(LOCAL_ISSUER)
				.setAudience(LOCAL_AUDIENCE)
				.setSubject("local-developer")
				.setIssuedAt()
				.setExpirationTime("5m")
				.sign(privateKey),
	};
}
