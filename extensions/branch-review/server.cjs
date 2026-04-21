const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const token = crypto.randomBytes(16).toString("hex");
const submitBodyLimit = 64 * 1024;
const idleTimeoutMs = Number.parseInt(
	process.env.PI_LOCAL_PR_REVIEW_IDLE_TIMEOUT_MS || "3600000",
	10,
);
const pendingSubmissions = new Map();
const allowedModuleNames = new Set([
	"review-comments.js",
	"review-file-tree.js",
	"review-draft-panel.js",
	"review-selection.js",
	"review-theme.js",
]);

const submissionReader = readline.createInterface({ input: process.stdin });
let submissionShutdownRequested = false;
let lastActivityAt = Date.now();
const staticAssetCache = new Map();

function touchActivity() {
	lastActivityAt = Date.now();
}

function closeSubmissionServer() {
	if (submissionShutdownRequested) return;
	submissionShutdownRequested = true;

	try {
		submissionReader.close();
	} catch {}

	if (!server || typeof server.close !== "function") return;

	try {
		server.close();
	} catch {}
}

function registerSubmissionAck(requestId) {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			settlePendingSubmission(
				requestId,
				"reject",
				new Error(`review launcher ack timeout after ${idleTimeoutMs}ms`),
			);
		}, idleTimeoutMs);

		pendingSubmissions.set(requestId, { resolve, reject, timeout });
	});
}

function settlePendingSubmission(requestId, settle, value) {
	const pending = pendingSubmissions.get(requestId);
	if (!pending) return false;

	pendingSubmissions.delete(requestId);
	clearTimeout(pending.timeout);
	pending[settle](value);
	return true;
}

function settleSubmissionAck(event) {
	return settlePendingSubmission(event.requestId, "resolve", event);
}

function rejectPendingSubmissions(message) {
	if (pendingSubmissions.size === 0) return;

	const error = new Error(message);
	for (const requestId of pendingSubmissions.keys()) {
		settlePendingSubmission(requestId, "reject", error);
	}
}

submissionReader.on("line", (line) => {
	let event;

	try {
		event = JSON.parse(line);
	} catch {
		return;
	}

	if (event?.type !== "review-ack" || !event.requestId) return;
	settleSubmissionAck(event);
});

submissionReader.on("close", () => {
	rejectPendingSubmissions(
		"review launcher closed before acknowledging submission",
	);
});

function requireConfiguredSession() {
	const session = process.env.PI_LOCAL_PR_REVIEW_SESSION;
	if (session) return session;

	// Hard product constraint: this review server only exists to send review
	// feedback back into a live pi session. Do not relax this into a
	// standalone local diff viewer without an explicit product decision.
	process.stderr.write("PI_LOCAL_PR_REVIEW_SESSION is required\n");
	process.exit(1);
}

const session = requireConfiguredSession();

function git(args) {
	return execFileSync("git", args, {
		cwd: process.env.PI_LOCAL_PR_REVIEW_REPO,
		encoding: "utf8",
	});
}

function loadRepoRefs() {
	const base = process.env.PI_LOCAL_PR_REVIEW_BASE;
	const headRef = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();

	return {
		base,
		head:
			headRef === "HEAD"
				? git(["rev-parse", "--short", "HEAD"]).trim()
				: headRef,
	};
}

function loadDiffSnapshot(includeFiles = true) {
	const { base, head } = loadRepoRefs();
	const mergeBase = git(["merge-base", base, "HEAD"]).trim();
	const patch = git(["diff", "--unified=3", mergeBase]);
	const snapshot = { base, head, patch };

	if (!includeFiles) return snapshot;

	return {
		...snapshot,
		files: git(["diff", "--name-only", mergeBase])
			.trim()
			.split("\n")
			.filter(Boolean),
	};
}

function loadReviewStatus() {
	const { base, head, patch } = loadDiffSnapshot(false);

	return {
		fingerprint: crypto.createHash("sha256").update(patch).digest("hex"),
		base,
		head,
	};
}

function loadDiff() {
	const { files, patch } = loadDiffSnapshot();
	return { files, patch };
}

function loadBootstrap() {
	const { base, head } = loadRepoRefs();
	return {
		repo: process.env.PI_LOCAL_PR_REVIEW_REPO,
		base,
		head,
		token,
		session,
	};
}

function readCachedText(filePath) {
	const cached = staticAssetCache.get(filePath);

	try {
		const stat = fs.statSync(filePath);
		if (
			cached &&
			cached.mtimeMs === stat.mtimeMs &&
			cached.size === stat.size
		) {
			return cached.text;
		}

		const text = fs.readFileSync(filePath, "utf8");
		staticAssetCache.set(filePath, {
			mtimeMs: stat.mtimeMs,
			size: stat.size,
			text,
		});
		return text;
	} catch (error) {
		staticAssetCache.delete(filePath);
		throw error;
	}
}

function readTemplate() {
	return readCachedText(path.join(__dirname, "review-template.html"));
}

function readClient() {
	return readCachedText(path.join(__dirname, "review-client.js"));
}

function readModule(name) {
	if (!allowedModuleNames.has(name)) {
		throw new Error(`unsupported module name: ${name}`);
	}

	return readCachedText(path.join(__dirname, name));
}

function readStyles() {
	return readCachedText(path.join(__dirname, "review-styles.css"));
}

function readPromptHelpers() {
	return readCachedText(path.join(__dirname, "review-prompt.js"));
}

function escapeBootstrapJson(value) {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

function parseRequestUrl(req) {
	return new URL(req.url, "http://127.0.0.1");
}

function requireReviewSession(url) {
	const session = url.searchParams.get("session");
	if (session === process.env.PI_LOCAL_PR_REVIEW_SESSION) return null;

	return {
		statusCode: 400,
		body: JSON.stringify({ error: "session is required" }),
	};
}

function rejectInvalidToken(req, res) {
	if (req.headers["x-review-token"] === token) return false;

	res.writeHead(403, { "content-type": "application/json" });
	res.end(JSON.stringify({ error: "invalid token" }));
	return true;
}

function readBody(req, limit) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let settled = false;
		let bytes = 0;

		function finish(fn, value) {
			if (settled) return;
			settled = true;
			fn(value);
		}

		req.on("data", (chunk) => {
			bytes += chunk.length;
			if (bytes > limit) {
				const error = new Error("request body too large");
				error.statusCode = 413;
				finish(reject, error);
				return;
			}

			chunks.push(chunk);
		});
		req.on("end", () =>
			finish(resolve, Buffer.concat(chunks).toString("utf8")),
		);
		req.on("error", (error) => finish(reject, error));
	});
}

function sendSubmitResponse(res, statusCode, payload) {
	res.once("finish", closeSubmissionServer);
	res.once("close", closeSubmissionServer);
	res.writeHead(statusCode, { "content-type": "application/json" });
	res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
	try {
		touchActivity();
		const url = parseRequestUrl(req);

		if (url.pathname === "/api/submit" && req.method === "POST") {
			if (rejectInvalidToken(req, res)) {
				return;
			}

			const raw = await readBody(req, submitBodyLimit);
			let body = raw;
			try {
				body = JSON.parse(raw);
			} catch {}

			const requestId = crypto.randomUUID();
			const ack = registerSubmissionAck(requestId);

			process.stdout.write(
				JSON.stringify({ type: "review-submitted", requestId, payload: body }) +
					"\n",
			);

			try {
				const result = await ack;

				if (result?.ok === false) {
					sendSubmitResponse(res, 502, {
						ok: false,
						error: result.error || result.message || "review handoff failed",
					});
					return;
				}

				sendSubmitResponse(res, 200, {
					ok: true,
					message: result?.message || "Review delivered to pi",
				});
				return;
			} catch (error) {
				sendSubmitResponse(res, 502, {
					ok: false,
					error:
						error instanceof Error
							? error.message
							: "review launcher closed before acknowledging submission",
				});
				return;
			}
		}

		if (url.pathname === "/health") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		if (url.pathname === "/api/diff") {
			if (rejectInvalidToken(req, res)) {
				return;
			}

			const diff = loadDiff();
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(diff));
			return;
		}

		if (url.pathname === "/api/review-status") {
			if (rejectInvalidToken(req, res)) {
				return;
			}

			const status = loadReviewStatus();
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(status));
			return;
		}

		if (url.pathname === "/review-client.js") {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.end(readClient());
			return;
		}

		if (url.pathname === "/review-file-tree.js") {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.end(readModule("review-file-tree.js"));
			return;
		}

		if (url.pathname === "/review-comments.js") {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.end(readModule("review-comments.js"));
			return;
		}

		if (url.pathname === "/review-draft-panel.js") {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.end(readModule("review-draft-panel.js"));
			return;
		}

		if (url.pathname === "/review-selection.js") {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.end(readModule("review-selection.js"));
			return;
		}

		if (url.pathname === "/review-theme.js") {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.end(readModule("review-theme.js"));
			return;
		}

		if (url.pathname === "/review-styles.css") {
			res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
			res.end(readStyles());
			return;
		}

		if (url.pathname === "/review-prompt.js") {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.end(readPromptHelpers());
			return;
		}

		if (url.pathname === "/") {
			const sessionError = requireReviewSession(url);
			if (sessionError) {
				res.writeHead(sessionError.statusCode, {
					"content-type": "application/json",
				});
				res.end(sessionError.body);
				return;
			}

			const html = readTemplate().replace(
				"{{BOOTSTRAP_JSON}}",
				escapeBootstrapJson(loadBootstrap()),
			);
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(html);
			return;
		}

		res.writeHead(404);
		res.end();
	} catch (error) {
		if (error && error.statusCode === 413 && !res.headersSent) {
			res.writeHead(413, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "request body too large" }));
			return;
		}

		if (!res.headersSent) {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "internal server error" }));
			return;
		}

		res.destroy(error);
	}
});

const idleCheckMs = Math.max(
	25,
	Math.min(Math.floor(idleTimeoutMs / 2) || 25, 1000),
);
const idleTimer = setInterval(() => {
	if (Date.now() - lastActivityAt < idleTimeoutMs) return;

	clearInterval(idleTimer);
	rejectPendingSubmissions(
		"review launcher closed before acknowledging submission",
	);
	closeSubmissionServer();
	setImmediate(() => process.exit(0));
}, idleCheckMs);

idleTimer.unref?.();

server.listen(0, "127.0.0.1", () => {
	const address = server.address();
	const base = process.env.PI_LOCAL_PR_REVIEW_BASE;
	const url = new URL(`http://127.0.0.1:${address.port}/`);

	if (session) url.searchParams.set("session", session);
	if (base) url.searchParams.set("base", base);

	process.stdout.write(
		`${JSON.stringify({
			type: "server-started",
			port: address.port,
			url: url.toString(),
			token,
		})}\n`,
	);
});
