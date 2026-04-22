import {
	type ChildProcessWithoutNullStreams,
	execFileSync,
	spawn,
} from "node:child_process";
import { createRequire } from "node:module";

import { StringEnum } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { formatReviewPrompt } from "local-pr-review-server/review-prompt.js";

const require = createRequire(import.meta.url);
const reviewServerPath = require.resolve("local-pr-review-server/server.cjs");

const TOOL_NAME = "local_pr_review";
const TOOL_LABEL = "Local PR Review";
const TOOL_ACTIONS = ["start", "stop", "status"] as const;
const DEFAULT_START_MESSAGE = "Review delivered to the active pi session";

type ReviewAction = (typeof TOOL_ACTIONS)[number];

type ReviewSubmittedEvent = {
	type: "review-submitted";
	requestId: string;
	payload: unknown;
};

type ServerStartedEvent = {
	type: "server-started";
	port: number;
	url: string;
	token: string;
};

type ServerEvent = ReviewSubmittedEvent | ServerStartedEvent;

type ReviewBridge = {
	child: ChildProcessWithoutNullStreams;
	sessionId: string;
	repo: string;
	baseRef: string;
	url: string;
	stderrBuffer: string;
};

function resolveBaseRef(cwd: string, explicitBaseRef?: string | null) {
	if (explicitBaseRef) return explicitBaseRef;

	try {
		const originHead = execFileSync(
			"git",
			["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();
		if (originHead) return originHead;
	} catch {}

	try {
		execFileSync("git", ["rev-parse", "--verify", "main"], {
			cwd,
			stdio: "ignore",
		});
		return "main";
	} catch {}

	return "master";
}

function isBridgeAlive(bridge: ReviewBridge | null) {
	return (
		!!bridge &&
		bridge.child.exitCode === null &&
		bridge.child.signalCode === null
	);
}

function lastStderrLine(stderrBuffer: string) {
	const lines = stderrBuffer.trim().split("\n").filter(Boolean);
	return lines[lines.length - 1] || "";
}

function writeSubmissionAck(
	bridge: ReviewBridge,
	requestId: string,
	ack: { ok: true; message: string } | { ok: false; error: string },
) {
	if (bridge.child.stdin.destroyed) {
		throw new Error("review server stdin is closed");
	}

	const payload = {
		type: "review-ack",
		requestId,
		ok: ack.ok,
		...(ack.ok ? { message: ack.message } : { error: ack.error }),
	};
	bridge.child.stdin.write(`${JSON.stringify(payload)}\n`);
}

async function stopBridge(bridge: ReviewBridge | null) {
	if (!bridge) return false;
	if (!isBridgeAlive(bridge)) return false;

	await new Promise<void>((resolve) => {
		const finish = () => {
			clearTimeout(timeout);
			resolve();
		};

		const timeout = setTimeout(() => {
			if (!isBridgeAlive(bridge)) {
				finish();
				return;
			}

			bridge.child.kill("SIGKILL");
		}, 250);

		bridge.child.once("exit", finish);
		bridge.child.kill("SIGTERM");
	});

	return true;
}

function startBridge(handlers: {
	sessionId: string;
	repo: string;
	baseRef: string;
	onEvent: (event: ServerEvent) => void;
	onExit: (bridge: ReviewBridge) => void;
}) {
	const child = spawn(process.execPath, [reviewServerPath], {
		cwd: handlers.repo,
		env: {
			...process.env,
			LOCAL_PR_REVIEW_CONTEXT_ID: handlers.sessionId,
			LOCAL_PR_REVIEW_REPO: handlers.repo,
			LOCAL_PR_REVIEW_BASE: handlers.baseRef,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});

	let bridge: ReviewBridge | null = null;
	let buffer = "";
	let settled = false;

	const started = new Promise<ReviewBridge>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("timed out waiting for review server to start"));
		}, 5000);

		const finish = (
			fn: typeof resolve | typeof reject,
			value: ReviewBridge | Error,
		) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			fn(value as never);
		};

		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString();

			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);

				if (line) {
					try {
						const event = JSON.parse(line) as ServerEvent;

						if (event.type === "server-started") {
							bridge = {
								child,
								sessionId: handlers.sessionId,
								repo: handlers.repo,
								baseRef: handlers.baseRef,
								url: event.url,
								stderrBuffer: "",
							};
							handlers.onEvent(event);
							finish(resolve, bridge);
						} else if (event.type === "review-submitted") {
							handlers.onEvent(event);
						}
					} catch {}
				}

				newlineIndex = buffer.indexOf("\n");
			}
		});

		child.stderr.on("data", (chunk) => {
			const text = chunk.toString();
			if (bridge) {
				bridge.stderrBuffer = `${bridge.stderrBuffer}${text}`;
				if (bridge.stderrBuffer.length > 4096) {
					bridge.stderrBuffer = bridge.stderrBuffer.slice(-4096);
				}
			}
		});

		child.once("error", (error) =>
			finish(reject, error instanceof Error ? error : new Error(String(error))),
		);
		child.once("exit", (code, signal) => {
			if (bridge) handlers.onExit(bridge);
			if (!settled) {
				let detail = ` (${code ?? "unknown"})`;
				if (bridge?.stderrBuffer) {
					detail = `: ${lastStderrLine(bridge.stderrBuffer)}`;
				} else if (signal) {
					detail = ` (${signal})`;
				}
				finish(
					reject,
					new Error(`review server exited before startup${detail}`),
				);
			}
		});
	});

	return started;
}

function toolText(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

export default function (pi: ExtensionAPI) {
	let bridge: ReviewBridge | null = null;
	let isIdle = true;

	async function ensureStarted(
		ctx: ExtensionContext,
		explicitBaseRef?: string | null,
	): Promise<ReviewBridge> {
		const sessionId = ctx.sessionManager.getSessionId();
		const repo = ctx.cwd;
		const baseRef = resolveBaseRef(repo, explicitBaseRef);

		const runningBridge = isBridgeAlive(bridge) ? bridge : null;
		if (runningBridge) {
			if (
				runningBridge.sessionId === sessionId &&
				runningBridge.baseRef === baseRef
			) {
				return runningBridge;
			}

			await stopBridge(runningBridge);
			bridge = null;
		}

		const nextBridge = await startBridge({
			sessionId,
			repo,
			baseRef,
			onEvent: (event) => {
				if (event.type !== "review-submitted") return;

				const activeBridge = bridge;
				if (!activeBridge) return;

				const reviewPrompt = formatReviewPrompt(event.payload);

				try {
					if (isIdle) {
						pi.sendUserMessage(reviewPrompt);
					} else {
						pi.sendUserMessage(reviewPrompt, { deliverAs: "followUp" });
					}

					writeSubmissionAck(activeBridge, event.requestId, {
						ok: true,
						message: isIdle
							? DEFAULT_START_MESSAGE
							: `${DEFAULT_START_MESSAGE} (queued as follow-up)`,
					});
				} catch (error) {
					writeSubmissionAck(activeBridge, event.requestId, {
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			},
			onExit: (exitedBridge) => {
				if (bridge === exitedBridge) {
					bridge = null;
				}
			},
		});

		bridge = nextBridge;
		return nextBridge;
	}

	async function stopCurrentBridge() {
		const activeBridge = bridge;
		const stopped = await stopBridge(activeBridge);
		bridge = null;
		return stopped;
	}

	function currentBridgeStatus(): ReviewBridge | null {
		const activeBridge = isBridgeAlive(bridge) ? bridge : null;
		if (!activeBridge) {
			bridge = null;
			return null;
		}

		return activeBridge;
	}

	async function handleAction(
		action: ReviewAction,
		ctx: ExtensionContext,
		explicitBaseRef?: string | null,
	): Promise<{
		text: string;
		url?: string;
		running: boolean;
		variant: "info" | "warning";
	}> {
		switch (action) {
			case "start": {
				const runningBridge = await ensureStarted(ctx, explicitBaseRef);
				return {
					text: `Local PR review ready: ${runningBridge.url}`,
					url: runningBridge.url,
					running: true,
					variant: "info",
				};
			}
			case "stop": {
				const stopped = await stopCurrentBridge();
				return {
					text: stopped
						? "Stopped local PR review"
						: "No local PR review server is running",
					running: false,
					variant: stopped ? "info" : "warning",
				};
			}
			case "status": {
				const runningBridge = currentBridgeStatus();
				return runningBridge
					? {
							text: `Local PR review is running: ${runningBridge.url}`,
							url: runningBridge.url,
							running: true,
							variant: "info",
						}
					: {
							text: "No local PR review server is running",
							running: false,
							variant: "warning",
						};
			}
		}
	}

	async function runCommand(
		action: ReviewAction,
		args: string,
		ctx: ExtensionCommandContext,
	) {
		const baseRef = args.trim() || null;
		const result = await handleAction(action, ctx, baseRef);
		ctx.ui.notify(result.text, result.variant);
	}

	pi.on("session_start", async () => {
		isIdle = true;
	});

	pi.on("agent_start", async () => {
		isIdle = false;
	});

	pi.on("agent_end", async () => {
		isIdle = true;
	});

	pi.on("session_shutdown", async () => {
		await stopCurrentBridge();
	});

	pi.registerCommand("review-start", {
		description: "Start the browser-based local PR review UI for this session",
		handler: async (args, ctx) => {
			await runCommand("start", args, ctx);
		},
	});

	pi.registerCommand("review-stop", {
		description: "Stop the browser-based local PR review UI for this session",
		handler: async (_args, ctx) => {
			await runCommand("stop", "", ctx);
		},
	});

	pi.registerCommand("review-status", {
		description: "Show the status of the local PR review UI for this session",
		handler: async (_args, ctx) => {
			await runCommand("status", "", ctx);
		},
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: TOOL_LABEL,
		description:
			"Start, stop, or inspect the browser-based local PR review UI bound to the current pi session.",
		promptSnippet:
			"Start, stop, or inspect the local PR-style browser review UI for the current session.",
		promptGuidelines: [
			"Use this tool when the user wants to open, stop, or inspect a browser-based local branch review UI.",
			"Use action=start when the user asks for PR-style local review or wants to review the current branch in the browser.",
		],
		parameters: Type.Object({
			action: StringEnum(TOOL_ACTIONS),
			baseRef: Type.Optional(
				Type.String({
					description:
						"Git base ref to diff against when action=start. Defaults to origin/HEAD, then main, then master.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await handleAction(
				params.action,
				ctx,
				params.baseRef || null,
			);
			return toolText(result.text);
		},
	});
}
