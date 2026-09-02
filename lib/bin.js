#!/usr/bin/env node
import { C as workbuddyOwnAuthPath, d as WorkBuddyUpstreamClient, h as FALLBACK_WORKBUDDY_MODELS, i as isHeartbeatProcessAlive, l as WORKBUDDY_CONNECT_VERSION, o as readHostHeartbeat, s as workbuddyHostHeartbeatPath, t as startStandaloneWorkBuddyServer, y as WorkBuddyCredentialStore } from "./standalone-6etu3hrI.js";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
//#region src/bin.ts
/** Standalone status/diagnostics CLI for the dsh-workbuddy-connect bundle. */
const JSON_SCHEMA_VERSION = 1;
const WORKBUDDY_PROXY_API_KEY_ENV = "WORKBUDDY_PROXY_API_KEY";
function parsePort(value) {
	if (!/^\d+$/u.test(value)) throw new Error(`invalid --port: ${JSON.stringify(value)}`);
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid --port: ${JSON.stringify(value)}; expected 1-65535`);
	return port;
}
function parseServeCliOptions(flags) {
	let port = 7863;
	let apiKey;
	for (let index = 0; index < flags.length; index += 1) {
		const flag = flags[index];
		if (flag === "--port") {
			const value = flags[index + 1];
			if (value === void 0) throw new Error("missing value for --port");
			port = parsePort(value);
			index += 1;
			continue;
		}
		if (flag === "--api-key") {
			const value = flags[index + 1];
			if (value === void 0 || value.trim() === "") throw new Error("missing value for --api-key");
			apiKey = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown serve option: ${JSON.stringify(flag)}`);
	}
	return apiKey === void 0 ? { port } : {
		port,
		apiKey
	};
}
function resolveProxyApiKey(explicit, env) {
	if (explicit !== void 0) return {
		value: explicit,
		source: "flag"
	};
	const fromEnv = env[WORKBUDDY_PROXY_API_KEY_ENV]?.trim();
	if (fromEnv !== void 0 && fromEnv !== "") return {
		value: fromEnv,
		source: "env"
	};
	return {
		value: randomBytes(32).toString("base64url"),
		source: "generated"
	};
}
/** Remove token-like strings from an unexpected diagnostic message. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]");
}
function printHelp() {
	process.stdout.write([
		"Usage: dsh-workbuddy-connect <doctor|status|logout|serve> [options]",
		"",
		"  doctor   secret-free sign-in and environment diagnostics",
		"  status   sign-in state, remaining WorkBuddy credit, and host-bundle health",
		"  logout   remove the plugin-owned credential copy (the desktop app keeps its sign-in)",
		"  --json   emit one secret-free JSON document (doctor/status only)",
		"",
		"serve options:",
		"  --port <1-65535>  loopback port (default: 7863)",
		"  --api-key <key>   bearer for local OpenAI clients",
		`                    preferred persistent source: ${WORKBUDDY_PROXY_API_KEY_ENV}`,
		"",
		"PowerShell:",
		`  $env:${WORKBUDDY_PROXY_API_KEY_ENV} = "sk-local-workbuddy"`,
		"  dsh-workbuddy-connect serve",
		""
	].join("\n"));
}
function printJson(value) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}
function makeStore() {
	const client = new WorkBuddyUpstreamClient();
	return new WorkBuddyCredentialStore({ refresh: (credential) => client.refreshToken(credential) });
}
async function doctor(jsonOutput) {
	const store = makeStore();
	const status = await store.status();
	const desktopPresent = await store.desktopFilePresent();
	const heartbeat = await readHostHeartbeat();
	const hostAlive = heartbeat !== void 0 && isHeartbeatProcessAlive(heartbeat);
	const report = {
		schemaVersion: JSON_SCHEMA_VERSION,
		package: "dsh-workbuddy-connect",
		version: WORKBUDDY_CONNECT_VERSION,
		node: process.version,
		desktopAuthFile: {
			path: store.desktopAuthPath() ?? "(no platform default; set WORKBUDDY_AUTH_FILE)",
			present: desktopPresent
		},
		ownAuthFile: workbuddyOwnAuthPath(),
		hostHeartbeat: {
			path: workbuddyHostHeartbeatPath(),
			present: heartbeat !== void 0,
			...heartbeat === void 0 ? {} : {
				registeredAt: heartbeat.registeredAt,
				pid: heartbeat.pid
			},
			processAlive: hostAlive
		},
		signIn: status.state,
		fallbackModels: FALLBACK_WORKBUDDY_MODELS.length,
		hints: [
			...status.state === "signed-in" ? [] : ["Sign in once in the WorkBuddy desktop app, then run status again."],
			...desktopPresent ? [] : [`No WorkBuddy desktop auth file at the expected path; set WORKBUDDY_AUTH_FILE if it lives elsewhere.`],
			...hostAlive ? [] : ["Host bundle not running in this DSH profile (or the process exited). The browser card and provider are unavailable until DSH starts the plugin."]
		]
	};
	if (jsonOutput) printJson(report);
	else process.stdout.write([
		`WorkBuddy Connect ${WORKBUDDY_CONNECT_VERSION} on ${process.version}`,
		`Desktop auth file: ${report.desktopAuthFile.present ? "present" : "missing"} (${report.desktopAuthFile.path})`,
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : heartbeat !== void 0 ? "stale heartbeat (process exited)" : "not started"}`,
		`Sign-in state: ${report.signIn}`,
		`Static fallback models: ${report.fallbackModels}`,
		...report.hints.map((hint) => `Hint: ${hint}`),
		""
	].join("\n"));
	return status.state === "signed-in" && desktopPresent ? 0 : 1;
}
async function status(jsonOutput) {
	const store = makeStore();
	const client = new WorkBuddyUpstreamClient();
	const authStatus = await store.status();
	const heartbeat = await readHostHeartbeat();
	const hostAlive = heartbeat !== void 0 && isHeartbeatProcessAlive(heartbeat);
	const hostState = hostAlive ? "running" : heartbeat !== void 0 ? "stale" : "not-started";
	if (authStatus.state !== "signed-in") {
		if (jsonOutput) printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect",
			version: WORKBUDDY_CONNECT_VERSION,
			status: "signed-out",
			hostBundle: hostState
		});
		else process.stdout.write(`WorkBuddy Connect: signed out\nHost bundle: ${hostState}\n`);
		return 1;
	}
	let credits;
	try {
		const credential = await store.current();
		if (credential !== void 0) credits = { total: (await client.fetchCredits(credential)).total };
	} catch (error) {
		credits = {
			total: 0,
			error: safeMessage(error)
		};
	}
	const expiresAt = authStatus.expiresAtMs !== void 0 ? new Date(authStatus.expiresAtMs).toISOString() : void 0;
	if (jsonOutput) {
		printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect",
			version: WORKBUDDY_CONNECT_VERSION,
			status: "signed-in",
			...expiresAt === void 0 ? {} : { accessTokenExpires: expiresAt },
			...authStatus.nickname === void 0 ? {} : { nickname: authStatus.nickname },
			...authStatus.domain === void 0 || authStatus.domain === "" ? {} : { domain: authStatus.domain },
			source: authStatus.source,
			credits: credits?.total,
			...credits?.error === void 0 ? {} : { creditsError: credits.error },
			hostBundle: hostState
		});
		return 0;
	}
	process.stdout.write([
		`WorkBuddy Connect: signed in${authStatus.nickname === void 0 ? "" : ` as ${authStatus.nickname}`}`,
		...expiresAt === void 0 ? [] : [`Access token expires ${expiresAt} (refresh is automatic)`],
		credits?.error === void 0 ? `Remaining credit: ${credits?.total ?? "unknown"}` : `Remaining credit: unavailable (${credits.error})`,
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : hostState === "stale" ? "stale heartbeat (DSH process exited)" : "not started in this profile"}`,
		"Client card: load failures are logged to the browser console only; the host provider is unaffected.",
		""
	].join("\n"));
	return 0;
}
function waitForShutdownSignal() {
	return new Promise((resolve) => {
		const done = () => {
			process.off("SIGINT", done);
			process.off("SIGTERM", done);
			resolve();
		};
		process.once("SIGINT", done);
		process.once("SIGTERM", done);
	});
}
async function serve(flags) {
	const parsed = parseServeCliOptions(flags);
	const key = resolveProxyApiKey(parsed.apiKey, process.env);
	const server = await startStandaloneWorkBuddyServer({
		port: parsed.port,
		apiKey: key.value,
		logger: {
			warn: (...args) => console.warn(...args.map(safeMessage)),
			error: (...args) => console.error(...args.map(safeMessage))
		}
	});
	process.stdout.write([
		"WorkBuddy OpenAI proxy is running",
		`Base URL: ${server.baseUrl}`,
		key.source === "generated" ? `API Key: ${key.value}` : `API Key: configured via ${key.source === "env" ? WORKBUDDY_PROXY_API_KEY_ENV : "--api-key"}`,
		"Bind: 127.0.0.1 only",
		"Press Ctrl+C to stop.",
		""
	].join("\n"));
	await waitForShutdownSignal();
	await server.close();
	return 0;
}
/** Execute one boot-free command. */
async function run(argv) {
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printHelp();
		return 0;
	}
	const [rawAction, ...flags] = argv;
	if (![
		"doctor",
		"logout",
		"serve",
		"status"
	].includes(rawAction)) {
		process.stderr.write(`dsh-workbuddy-connect: expected doctor, logout, serve, or status; got ${JSON.stringify(rawAction)}\n`);
		return 1;
	}
	const action = rawAction;
	if (action === "serve" && flags.includes("--json")) {
		process.stderr.write(`dsh-workbuddy-connect: invalid options for serve: ${flags.join(" ")}\n`);
		return 1;
	}
	const jsonOutput = flags.includes("--json");
	const unknown = flags.filter((flag) => flag !== "--json");
	if (action !== "serve" && (unknown.length > 0 || jsonOutput && action === "logout")) {
		process.stderr.write(`dsh-workbuddy-connect: invalid options for ${action}: ${flags.join(" ")}\n`);
		return 1;
	}
	try {
		switch (action) {
			case "doctor": return await doctor(jsonOutput);
			case "status": return await status(jsonOutput);
			case "serve": return await serve(flags);
			case "logout":
				await makeStore().logout();
				process.stdout.write(`WorkBuddy Connect: removed ${workbuddyOwnAuthPath()}; the desktop app's sign-in is untouched\n`);
				return 0;
		}
	} catch (error) {
		process.stderr.write(`dsh-workbuddy-connect: ${action} failed: ${safeMessage(error)}\n`);
		return 1;
	}
}
if (process.argv[1] !== void 0 && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exitCode = await run(process.argv.slice(2));
//#endregion
export { WORKBUDDY_PROXY_API_KEY_ENV, parseServeCliOptions, resolveProxyApiKey, run };
