/**
 * @vibevibes/runtime — the server engine for vibevibes experiences.
 *
 * Single-room, single-experience architecture.
 * AI agents join via MCP or HTTP. Humans join via browser.
 * Tools are the only mutation path. State is server-authoritative.
 */

import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { z, ZodError } from "zod";
import { EventEmitter } from "events";
import { bundleForServer, bundleForClient, evalServerBundle, validateClientBundle } from "./bundler.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ExperienceModule, ToolDef, ToolCtx, ParticipantSlot } from "@vibevibes/sdk";

// ── Server config ─────────────────────────────────────────────
export interface ServerConfig {
  /** Absolute path to the experience project root (where manifest.json or src/index.tsx lives). */
  projectRoot: string;
  /** Port to listen on. Defaults to 4321 or PORT env var. */
  port?: number;
}

// ── Error formatting ──────────────────────────────────────────

interface JsonSchemaObject {
  properties?: Record<string, { type?: string }>;
  required?: string[];
}

function formatZodError(err: ZodError, toolName: string, tool?: ToolDef): string {
  const issues = err.issues.map((issue) => {
    const path = issue.path.length > 0 ? `'${issue.path.join(".")}'` : "input";
    const extra: string[] = [];
    const detail = issue as { expected?: string; received?: string };
    if (detail.expected) extra.push(`expected ${detail.expected}`);
    if (detail.received && detail.received !== "undefined") extra.push(`got ${detail.received}`);
    const suffix = extra.length > 0 ? ` (${extra.join(", ")})` : "";
    return `  ${path}: ${issue.message}${suffix}`;
  });
  let msg = `Invalid input for '${toolName}':\n${issues.join("\n")}`;

  if (tool?.input_schema) {
    try {
      const schema = ((tool.input_schema as any)._jsonSchema || zodToJsonSchema(tool.input_schema)) as JsonSchemaObject;
      const props = schema.properties;
      const req = schema.required || [];
      if (props) {
        const fields = Object.entries(props).map(([k, v]) => {
          const optional = !req.includes(k);
          return `${k}${optional ? "?" : ""}: ${v.type || "any"}`;
        });
        msg += `\n\nExpected schema: { ${fields.join(", ")} }`;
      }
    } catch {}
  }
  if (tool?.description) msg += `\nTool description: ${tool.description}`;
  msg += `\n\nHint: Provide all required fields with correct types.`;
  return msg;
}

function formatHandlerError(err: Error, toolName: string, tool?: ToolDef, input?: unknown): string {
  const message = err.message || String(err);
  let msg = `Tool '${toolName}' failed: ${message}`;

  if (input !== undefined) {
    try { msg += `\n\nInput provided: ${JSON.stringify(input)}`; } catch {}
  }
  if (tool?.input_schema) {
    try {
      const schema = ((tool.input_schema as any)._jsonSchema || zodToJsonSchema(tool.input_schema)) as JsonSchemaObject;
      const props = schema.properties;
      const req = schema.required || [];
      if (props) {
        const fields = Object.entries(props).map(([k, v]) => {
          const optional = !req.includes(k);
          return `${k}${optional ? "?" : ""}: ${v.type || "any"}`;
        });
        msg += `\nTool expects: { ${fields.join(", ")} }`;
      }
    } catch {}
  }

  if (message.includes("Cannot read properties of undefined") || message.includes("Cannot read property")) {
    msg += `\n\nHint: The handler accessed a property that doesn't exist on the current state. Check that initialState includes all fields your tools read from.`;
  } else if (message.includes("is not a function")) {
    msg += `\n\nHint: Something expected to be a function is not. Check for missing imports or incorrect variable types in the tool handler.`;
  } else if (message.includes("Maximum call stack")) {
    msg += `\n\nHint: Infinite recursion detected. A tool handler or function is calling itself without a base case.`;
  } else {
    msg += `\n\nHint: The tool handler threw an error. Check the handler logic and ensure the current state matches what the handler expects.`;
  }
  return msg;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function queryString(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

function queryInt(val: unknown, radix = 10): number {
  return typeof val === "string" ? (parseInt(val, radix) || 0) : 0;
}

const __runtimeDir = path.dirname(fileURLToPath(import.meta.url));

let PROJECT_ROOT = "";

// ── Custom error types ───────────────────────────────────────

class ToolNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "ToolNotFoundError"; }
}

class ToolForbiddenError extends Error {
  constructor(message: string) { super(message); this.name = "ToolForbiddenError"; }
}

// ── Types ──────────────────────────────────────────────────

interface ToolEvent {
  id: string;
  ts: number;
  actorId: string;
  owner?: string;
  role?: string;
  tool: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  observation?: Record<string, unknown>;
}

interface ServerToolCtx extends ToolCtx {
}

interface HeartbeatWebSocket extends WebSocket {
  isAlive: boolean;
}

type LoadedModule = ExperienceModule & {
  initialState?: Record<string, unknown> | ((config: Record<string, unknown>) => Record<string, unknown>);
  participants?: import("@vibevibes/sdk").ParticipantSlot[];
  agents?: Array<{ role: string; systemPrompt: string; allowedTools?: string[]; autoSpawn?: boolean; maxInstances?: number }>;
};

interface ParticipantRecord {
  type: "human" | "ai";
  joinedAt: number;
  owner: string;
  role?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  lastPollAt?: number;
  eventCursor?: number;
  metadata?: Record<string, string>;
}

// ── WebSocket message types ─────────────────────────────────

type WsPresenceUpdate = {
  type: "presence_update";
  participants: string[];
  participantDetails: Array<{ actorId: string; type: string; role?: string; owner?: string; metadata?: Record<string, string> }>;
};

type WsStateUpdate = {
  type: "shared_state_update";
  stateVersion: number;
  changedBy: string;
  state?: Record<string, unknown>;
  delta?: Record<string, unknown>;
  deletedKeys?: string[];
  event?: ToolEvent;
  tool?: string;
  observation?: Record<string, unknown>;
  stream?: string;
  tick?: unknown;
};

type WsExperienceUpdated = { type: "experience_updated" };
type WsBuildError = { type: "build_error"; error: string };

type BroadcastMessage =
  | WsPresenceUpdate
  | WsStateUpdate
  | WsExperienceUpdated
  | WsBuildError;

// ── Room ───────────────────────────────────────────────────

class Room {
  readonly id = "local";
  readonly experienceId: string;
  readonly config: Record<string, unknown> = {};
  sharedState: Record<string, unknown> = {};
  readonly participants = new Map<string, ParticipantRecord>();
  readonly events: ToolEvent[] = [];
  readonly wsConnections = new Map<WebSocket, string>();
  readonly kickedActors = new Set<string>();
  readonly kickedOwners = new Set<string>();
  private _executionQueue: Promise<void> = Promise.resolve();
  stateVersion = 0;
  private _prevState: Record<string, unknown> | null = null;

  constructor(experienceId: string, initialState?: Record<string, unknown>) {
    this.experienceId = experienceId;
    if (initialState) this.sharedState = initialState;
  }

  broadcastToAll(message: BroadcastMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.wsConnections.keys()) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(data); } catch {}
      }
    }
  }

  broadcastStateUpdate(extra: {
    changedBy: string;
    event?: ToolEvent;
    tool?: string;
    observation?: Record<string, unknown>;
    stream?: string;
    tick?: unknown;
  }, forceFullState = false): void {
    this.stateVersion++;
    const prev = this._prevState;
    this._prevState = this.sharedState;

    if (!prev || forceFullState) {
      this.broadcastToAll({
        type: "shared_state_update",
        stateVersion: this.stateVersion,
        state: this.sharedState,
        ...extra,
      });
      return;
    }

    const changed: Record<string, unknown> = {};
    const deleted: string[] = [];
    let changeCount = 0;

    for (const key of Object.keys(this.sharedState)) {
      if (this.sharedState[key] !== prev[key]) {
        changed[key] = this.sharedState[key];
        changeCount++;
      }
    }
    for (const key of Object.keys(prev)) {
      if (!(key in this.sharedState)) {
        deleted.push(key);
        changeCount++;
      }
    }

    if (changeCount === 0 && !extra.event) return;

    if (changeCount === 0) {
      this.broadcastToAll({
        type: "shared_state_update",
        stateVersion: this.stateVersion,
        delta: {},
        ...extra,
      });
    } else {
      this.broadcastToAll({
        type: "shared_state_update",
        stateVersion: this.stateVersion,
        delta: changed,
        ...(deleted.length > 0 ? { deletedKeys: deleted } : {}),
        ...extra,
      });
    }
  }

  resetDeltaTracking(): void {
    this._prevState = null;
  }

  participantList(): string[] {
    return Array.from(this.participants.keys());
  }

  participantDetails(): Array<{ actorId: string; type: string; role?: string; owner?: string; metadata?: Record<string, string> }> {
    return Array.from(this.participants.entries()).map(([actorId, p]) => {
      const detail: { actorId: string; type: string; role?: string; owner?: string; metadata?: Record<string, string> } = {
        actorId, type: p.type, role: p.role, owner: p.owner,
      };
      if (p.metadata && Object.keys(p.metadata).length > 0) detail.metadata = p.metadata;
      return detail;
    });
  }

  appendEvent(event: ToolEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  enqueueExecution<T>(fn: () => Promise<T>): Promise<T> {
    const next = this._executionQueue.then(() => fn());
    this._executionQueue = next.then(() => {}, () => {});
    return next;
  }
}

// ── Constants ─────────────────────────────────────────────

const DEFAULT_PORT = 4321;
const MAX_EVENTS = 200;
const JOIN_EVENT_HISTORY = 20;
const ROOM_STATE_EVENT_HISTORY = 50;
const EVENT_BATCH_DEBOUNCE_MS = 50;
const MAX_BATCH_CALLS = 10;
const AGENT_CONTEXT_MAX_TIMEOUT_MS = 10000;
const WS_MAX_PAYLOAD_BYTES = 1024 * 1024;
const WS_EPHEMERAL_MAX_BYTES = 65536;
const WS_HEARTBEAT_INTERVAL_MS = 30000;
const HOT_RELOAD_DEBOUNCE_MS = 300;
const WS_CLOSE_GRACE_MS = 3000;
const JSON_BODY_LIMIT = "256kb";
const TOOL_HTTP_TIMEOUT_MS = 30_000;
const ROOM_EVENTS_MAX_LISTENERS = 200;
const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 60000;

// ── Default observe ────────────────────────────────────────

function defaultObserve(state: Record<string, any>, _event: unknown, _actorId: string): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(state)) {
    if (!k.startsWith("_")) result[k] = v;
  }
  const phase = typeof state.phase === "string" ? state.phase : null;
  result.directive = phase ? `Current phase: ${phase}` : "Observe the current state and act accordingly.";
  return result;
}

// ── Global state ──────────────────────────────────────────

let PORT = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
let publicUrl: string | null = null;
let room: Room;
let _actorCounter = 0;
const roomEvents = new EventEmitter();
roomEvents.setMaxListeners(ROOM_EVENTS_MAX_LISTENERS);

// Experience (single)
let loadedExperience: { module: LoadedModule; clientBundle: string; serverCode: string; loadedAt: number; sourcePath: string } | null = null;
let experienceError: string | null = null;

// Hot-reload rebuild gate
let rebuildingResolve: (() => void) | null = null;
let rebuildingPromise: Promise<void> | null = null;

export function setPublicUrl(url: string): void {
  publicUrl = url;
}

export function getBaseUrl(): string {
  return publicUrl || `http://localhost:${PORT}`;
}

// ── Helpers ────────────────────────────────────────────────

const FORBIDDEN_MERGE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assignActorId(username: string, type: "human" | "ai", owner?: string): string {
  const base = owner || `${username}-${type}`;
  _actorCounter++;
  return `${base}-${_actorCounter}`;
}

function setNoCacheHeaders(res: express.Response): void {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

interface ToolListEntry {
  name: string;
  description: string;
  risk: string;
  input_schema: Record<string, unknown>;
}

function getToolList(mod: LoadedModule, allowedTools?: string[]): ToolListEntry[] {
  if (!mod?.tools) return [];
  let tools: ToolDef[] = mod.tools;
  if (allowedTools) tools = tools.filter((t) => allowedTools.includes(t.name));
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    risk: t.risk || "low",
    input_schema: (t.input_schema as any)?._jsonSchema
      ? (t.input_schema as any)._jsonSchema as Record<string, unknown>
      : t.input_schema ? zodToJsonSchema(t.input_schema) as Record<string, unknown> : {},
  }));
}

function getModule(): LoadedModule | undefined {
  return loadedExperience?.module;
}

function resolveInitialState(mod: LoadedModule): Record<string, unknown> {
  const init = mod?.initialState;
  if (typeof init === "function") {
    try { return init({}) || {}; } catch (err: unknown) {
      console.warn(`[resolveInitialState] initialState() threw:`, err);
      return {};
    }
  }
  if (init && typeof init === "object") return { ...init };
  const schema = mod?.stateSchema;
  if (schema && typeof schema.parse === "function") {
    try { return schema.parse({}); } catch {}
  }
  return {};
}

function broadcastPresenceUpdate(): void {
  room.broadcastToAll({
    type: "presence_update",
    participants: room.participantList(),
    participantDetails: room.participantDetails(),
  });
}

function experienceNotLoadedError(): string {
  const hint = experienceError
    ? `\nLast build error: ${experienceError}\nFix the source and save to hot-reload.`
    : `\nCheck that src/index.tsx exists and exports a valid experience.`;
  return `Experience not loaded.${hint}`;
}

// ── Experience discovery & loading ──────────────────────────

function discoverEntryPath(): string {
  const tsxPath = path.join(PROJECT_ROOT, "src", "index.tsx");
  if (fs.existsSync(tsxPath)) return tsxPath;
  const rootTsx = path.join(PROJECT_ROOT, "index.tsx");
  if (fs.existsSync(rootTsx)) return rootTsx;
  throw new Error(
    `No experience found in ${PROJECT_ROOT}. ` +
    `Create src/index.tsx (TypeScript).`
  );
}

async function loadExperience(): Promise<void> {
  const entryPath = discoverEntryPath();

  const [sCode, cCode] = await Promise.all([
    bundleForServer(entryPath),
    bundleForClient(entryPath),
  ]);

  const mod = await evalServerBundle(sCode) as LoadedModule;

  if (!mod?.manifest || !mod?.tools) {
    throw new Error(`Experience at ${entryPath} missing manifest or tools`);
  }

  const clientError = validateClientBundle(cCode);
  if (clientError) {
    throw new Error(`Client bundle validation failed for ${entryPath}: ${clientError}`);
  }

  loadedExperience = {
    module: mod,
    clientBundle: cCode,
    serverCode: sCode,
    loadedAt: Date.now(),
    sourcePath: entryPath,
  };
  experienceError = null;
}

// ── Express app ────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Idempotency-Key");
  if (_req.method === "OPTIONS") { res.sendStatus(200); return; }
  next();
});

app.get("/", (_req, res) => {
  setNoCacheHeaders(res);
  res.sendFile(path.join(__runtimeDir, "viewer", "index.html"));
});
app.use("/viewer", express.static(path.join(__runtimeDir, "viewer")));

app.get("/sdk.js", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.send(`
export function defineExperience(c) { return c; }
export function defineTool(c) { return { risk: "low", capabilities_required: [], ...c }; }
export function defineTest(c) { return c; }
export function defineStream(c) { return c; }
`);
});

// ── State endpoint ─────────────────────────────────────────

app.get("/state", (req, res) => {
  const mod = getModule();
  let observation: Record<string, unknown> | undefined;
  const observeFn = mod?.observe ?? defaultObserve;
  const observeActorId = typeof req.query.actorId === "string" ? req.query.actorId : "viewer";
  try { observation = observeFn(room.sharedState, null, observeActorId); } catch (err: unknown) { console.warn(`[observe] Error: ${toErrorMessage(err)}`); }
  res.json({
    experienceId: mod?.manifest?.id,
    sharedState: room.sharedState,
    stateVersion: room.stateVersion,
    participants: room.participantList(),
    events: room.events.slice(-ROOM_STATE_EVENT_HISTORY),
    observation,
  });
});

// ── Participants endpoint ──────────────────────────────────

app.get("/participants", (_req, res) => res.json({ participants: room.participantDetails() }));

// ── Tools list endpoint ────────────────────────────────────

app.get("/tools-list", (req, res) => {
  const mod = getModule();
  if (!mod) { res.status(500).json({ error: experienceNotLoadedError() }); return; }

  const actorId = queryString(req.query.actorId);
  let allowedTools: string[] | undefined;
  if (actorId) {
    const participant = room.participants.get(actorId);
    allowedTools = participant?.allowedTools;
  }

  const tools = getToolList(mod, allowedTools);

  res.json({
    experienceId: mod.manifest?.id,
    tools,
    toolCount: tools.length,
  });
});

// ── Join ───────────────────────────────────────────────────

app.post("/join", (req, res) => {
  const mod = getModule();
  if (!mod) { res.status(500).json({ error: experienceNotLoadedError() }); return; }

  const { username = "user", actorType: rawActorType = "human", owner, role: requestedRole, metadata: rawMetadata } = req.body;
  const actorType: "human" | "ai" = rawActorType === "ai" ? "ai" : "human";
  const resolvedOwner: string = owner || username;

  let metadata: Record<string, string> | undefined;
  if (rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)) {
    metadata = {};
    let keyCount = 0;
    for (const [k, v] of Object.entries(rawMetadata as Record<string, unknown>)) {
      if (keyCount >= 20) break;
      if (typeof k === "string" && typeof v === "string" && k.length <= 50) {
        metadata[k] = String(v).slice(0, 200);
        keyCount++;
      }
    }
    if (Object.keys(metadata).length === 0) metadata = undefined;
  }

  if (!resolvedOwner) { res.status(400).json({ error: "owner or username required" }); return; }

  // Dedup: if same owner already has a participant, reuse
  if (resolvedOwner) {
    if (room.kickedOwners.has(resolvedOwner)) {
      res.status(403).json({ error: "You have been kicked from this room." });
      return;
    }

    for (const [existingId, existingP] of room.participants.entries()) {
      if (existingP.owner === resolvedOwner) {
        if (room.kickedActors.has(existingId)) {
          res.status(403).json({ error: "You have been kicked from this room." });
          return;
        }

        existingP.joinedAt = Date.now();
        if (existingP.type === "ai" && existingP.role) {
          room.sharedState = {
            ...room.sharedState,
            _agentRoles: { ...(room.sharedState._agentRoles as Record<string, string> ?? {}), [existingId]: existingP.role },
          };
        }
        for (const [ws, wsActor] of room.wsConnections.entries()) {
          if (wsActor === existingId) {
            room.wsConnections.delete(ws);
            try { ws.close(1000, "Replaced by reconnect"); } catch {}
            break;
          }
        }

        broadcastPresenceUpdate();

        let observation: Record<string, unknown> | undefined;
        let observeError: string | undefined;
        const reconnectObserve = mod.observe ?? defaultObserve;
        try { observation = reconnectObserve(room.sharedState, null, existingId); } catch (e: unknown) {
          console.error(`[observe] Error:`, toErrorMessage(e));
          observeError = toErrorMessage(e);
        }

        res.json({
          actorId: existingId,
          owner: resolvedOwner,
          role: existingP.role,
          systemPrompt: existingP.systemPrompt,
          reconnected: true,
          observation,
          observeError,
          tools: getToolList(mod, existingP.allowedTools),
        });
        return;
      }
    }
  }

  // Participant slot matching
  const participantSlots: ParticipantSlot[] | undefined =
    mod.manifest?.participantSlots || mod.participants;
  const agentSlots = mod.agents || mod.manifest?.agentSlots;
  let slotRole: string | undefined;
  let slotAllowedTools: string[] | undefined;
  let actorIdBase: string | undefined;
  let slotSystemPrompt: string | undefined;

  if (participantSlots?.length) {
    const roleOccupancy = new Map<string, number>();
    for (const [, p] of room.participants) {
      if (p.role) roleOccupancy.set(p.role, (roleOccupancy.get(p.role) || 0) + 1);
    }

    const typeMatches = (slotType: string | undefined, joinType: string) => {
      if (!slotType || slotType === "any") return true;
      return slotType === joinType;
    };
    const hasCapacity = (slot: ParticipantSlot) => {
      const max = slot.maxInstances ?? 1;
      const current = roleOccupancy.get(slot.role) || 0;
      return current < max;
    };

    let matched: ParticipantSlot | undefined;
    if (requestedRole) {
      matched = participantSlots.find((s) => s.role === requestedRole && typeMatches(s.type, actorType) && hasCapacity(s));
    }
    if (!matched) matched = participantSlots.find((s) => s.type === actorType && hasCapacity(s));
    if (!matched) matched = participantSlots.find((s) => typeMatches(s.type, actorType) && hasCapacity(s));
    if (!matched) matched = participantSlots.find((s) => typeMatches(s.type, actorType));

    if (matched) {
      slotRole = matched.role;
      slotAllowedTools = matched.allowedTools;
      slotSystemPrompt = matched.systemPrompt;
    }
  } else if (actorType === "ai" && agentSlots && agentSlots.length > 0) {
    const occupiedRoles = new Set<string>();
    for (const [, p] of room.participants) {
      if (p.type === "ai" && p.role) occupiedRoles.add(p.role);
    }
    const slot = agentSlots.find((s) => !occupiedRoles.has(s.role)) || agentSlots[0];
    slotRole = slot.role;
    slotAllowedTools = slot.allowedTools;
    slotSystemPrompt = slot.systemPrompt;
  }

  const actorId = assignActorId(username, actorType, actorIdBase || resolvedOwner);
  const participant: ParticipantRecord = { type: actorType, joinedAt: Date.now(), owner: resolvedOwner };

  if (slotRole) participant.role = slotRole;
  if (slotAllowedTools) participant.allowedTools = slotAllowedTools;
  if (slotSystemPrompt) participant.systemPrompt = slotSystemPrompt;
  if (!slotRole && requestedRole) participant.role = requestedRole;
  if (metadata) participant.metadata = metadata;

  room.participants.set(actorId, participant);

  if (actorType === "ai" && participant.role) {
    room.sharedState = {
      ...room.sharedState,
      _agentRoles: { ...(room.sharedState._agentRoles as Record<string, string> ?? {}), [actorId]: participant.role },
    };
  }

  broadcastPresenceUpdate();

  let observation: Record<string, unknown> | undefined;
  let observeError: string | undefined;
  const joinObserve = mod.observe ?? defaultObserve;
  try { observation = joinObserve(room.sharedState, null, actorId); } catch (e: unknown) {
    console.error(`[observe] Error:`, toErrorMessage(e));
    observeError = toErrorMessage(e);
  }

  res.json({
    actorId,
    owner: resolvedOwner,
    experienceId: mod.manifest.id,
    sharedState: room.sharedState,
    participants: room.participantList(),
    events: room.events.slice(-JOIN_EVENT_HISTORY),
    tools: getToolList(mod, participant.allowedTools),
    browserUrl: getBaseUrl(),
    observation,
    role: participant.role,
    allowedTools: participant.allowedTools,
    systemPrompt: slotSystemPrompt,
  });
});

// ── Leave ──────────────────────────────────────────────────

app.post("/leave", (req, res) => {
  const { actorId } = req.body;
  if (!actorId || typeof actorId !== "string") { res.status(400).json({ error: "actorId required" }); return; }
  if (!room.participants.has(actorId)) { res.status(404).json({ error: `Participant '${actorId}' not found` }); return; }

  room.participants.delete(actorId);
  for (const [ws, wsActorId] of room.wsConnections.entries()) {
    if (wsActorId === actorId) {
      room.wsConnections.delete(ws);
      try { ws.close(); } catch {}
    }
  }
  broadcastPresenceUpdate();
  res.json({ left: true, actorId });
});

// ── Idempotency cache ────────────────────────────────────────

const idempotencyCache = new Map<string, { output: unknown; ts: number }>();
const IDEMPOTENCY_TTL = 30000;

const _idempotencyCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache) {
    if (now - entry.ts > IDEMPOTENCY_TTL) idempotencyCache.delete(key);
  }
}, IDEMPOTENCY_CLEANUP_INTERVAL_MS);

// ── Execute tool (core) ─────────────────────────────────────

interface ToolCallResult {
  tool: string;
  output?: unknown;
  observation?: Record<string, unknown>;
  error?: string;
}

async function executeTool(
  toolName: string,
  actorId: string,
  input: Record<string, unknown> = {},
  owner?: string,
  expiredFlag?: { value: boolean },
): Promise<ToolCallResult> {
  const mod = getModule();
  if (!mod) throw new Error(experienceNotLoadedError());

  let scopeKey: string | undefined;
  let resolvedToolName = toolName;
  if (toolName.includes(':')) {
    const colonIdx = toolName.indexOf(':');
    scopeKey = toolName.slice(0, colonIdx);
    resolvedToolName = toolName.slice(colonIdx + 1);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(scopeKey) || FORBIDDEN_MERGE_KEYS.has(scopeKey)) {
      throw new Error(`Invalid scope key in tool name: '${scopeKey}'`);
    }
  }

  const tool = mod.tools.find((t) => t.name === resolvedToolName);
  if (!tool) {
    const available = mod.tools.map((t) => t.name).join(", ");
    throw new ToolNotFoundError(`Tool '${resolvedToolName}' not found. Available tools: ${available}`);
  }

  const callingParticipant = room.participants.get(actorId);
  if (callingParticipant?.allowedTools &&
      !callingParticipant.allowedTools.includes(resolvedToolName) &&
      !callingParticipant.allowedTools.includes(toolName)) {
    const role = callingParticipant.role || "ai";
    const allowed = callingParticipant.allowedTools.join(", ");
    throw new ToolForbiddenError(`Tool '${resolvedToolName}' is not allowed for role '${role}'. Allowed tools: ${allowed}`);
  }

  let validatedInput = input;
  if (tool.input_schema?.parse) {
    validatedInput = tool.input_schema.parse(input);
  }

  const participant = room.participants.get(actorId);
  const resolvedOwner: string = participant?.owner || owner || actorId;
  const ctx: ServerToolCtx = {
    roomId: "local",
    actorId,
    owner: resolvedOwner,
    get state() { return room.sharedState; },
    setState: (newState: Record<string, unknown>) => {
      if (expiredFlag?.value) return;
      room.sharedState = newState;
    },
    timestamp: Date.now(),
    memory: {},
    setMemory: () => {},
  };

  if (scopeKey) {
    Object.defineProperty(ctx, 'state', {
      get() { return room.sharedState[scopeKey!] || {}; },
      configurable: true,
    });
    ctx.setState = (newState: Record<string, unknown>) => {
      if (expiredFlag?.value) return;
      room.sharedState = { ...room.sharedState, [scopeKey!]: newState };
    };
  }

  const output = await tool.handler(ctx, validatedInput);

  const callerRole = callingParticipant?.role;
  const event: ToolEvent = {
    id: `${Date.now()}-${actorId}-${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    actorId,
    owner: ctx.owner,
    role: callerRole,
    tool: toolName,
    input: validatedInput,
    output,
  };

  let observation: Record<string, unknown> | undefined;
  const toolObserve = mod.observe ?? defaultObserve;
  try {
    observation = toolObserve(room.sharedState, event, actorId);
  } catch (e: unknown) {
    console.error(`[observe] Error:`, toErrorMessage(e));
  }
  if (observation) event.observation = observation;

  room.appendEvent(event);

  room.broadcastStateUpdate({
    event,
    changedBy: actorId,
    tool: toolName,
    observation,
  });

  roomEvents.emit("room");

  return { tool: toolName, output, observation };
}

// ── Single tool HTTP endpoint ───────────────────────────────

app.post("/tools/:toolName", async (req, res) => {
  const mod = getModule();
  if (!mod) { res.status(500).json({ error: experienceNotLoadedError() }); return; }

  const toolName = req.params.toolName;
  const { actorId, input: rawInput = {}, owner } = req.body;
  const input = rawInput !== null && typeof rawInput === "object" && !Array.isArray(rawInput) ? rawInput : {};

  if (!actorId) { res.status(400).json({ error: "actorId is required" }); return; }
  if (!room.participants.has(actorId)) {
    res.status(403).json({ error: `Actor '${actorId}' is not a participant. Call /join first.` });
    return;
  }

  const rawIdempotencyKey = req.headers["x-idempotency-key"] as string | undefined;
  const idempotencyKey = (rawIdempotencyKey && rawIdempotencyKey.length <= 128) ? rawIdempotencyKey : undefined;
  if (idempotencyKey) {
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached && Date.now() - cached.ts < IDEMPOTENCY_TTL) {
      res.json({ output: cached.output, cached: true });
      return;
    }
  }

  try {
    const expiredFlag = { value: false };
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const result = await room.enqueueExecution(() =>
      Promise.race([
        executeTool(toolName, actorId, input, owner, expiredFlag),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            expiredFlag.value = true;
            reject(new Error(`Tool '${toolName}' timed out after ${TOOL_HTTP_TIMEOUT_MS}ms`));
          }, TOOL_HTTP_TIMEOUT_MS);
        }),
      ])
    );
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

    if (idempotencyKey) {
      idempotencyCache.set(idempotencyKey, { output: result.output, ts: Date.now() });
    }

    res.json({ output: result.output, observation: result.observation });
  } catch (err: unknown) {
    let statusCode = 400;
    if (err instanceof ToolNotFoundError) statusCode = 404;
    else if (err instanceof ToolForbiddenError) statusCode = 403;

    const toolForError = mod.tools.find((t: ToolDef) => t.name === toolName);
    const errorMsg = err instanceof ZodError
      ? formatZodError(err, toolName, toolForError)
      : (err instanceof Error ? formatHandlerError(err, toolName, toolForError, input) : String(err));

    const resolvedOwner = owner || room.participants.get(actorId)?.owner;
    const event: ToolEvent = {
      id: `${Date.now()}-${actorId}-${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      actorId,
      ...(resolvedOwner ? { owner: resolvedOwner } : {}),
      tool: toolName,
      input,
      error: errorMsg,
    };
    room.appendEvent(event);
    roomEvents.emit("room");
    res.status(statusCode).json({ error: errorMsg });
  }
});

// ── Batch tool endpoint ─────────────────────────────────────

app.post("/tools-batch", async (req, res) => {
  const mod = getModule();
  if (!mod) { res.status(500).json({ error: experienceNotLoadedError() }); return; }

  const { actorId, owner, calls } = req.body;

  if (!actorId) { res.status(400).json({ error: "actorId is required" }); return; }
  if (!room.participants.has(actorId)) {
    res.status(403).json({ error: `Actor '${actorId}' is not a participant. Call /join first.` });
    return;
  }
  if (!Array.isArray(calls) || calls.length === 0) {
    res.status(400).json({ error: "Missing or empty 'calls' array. Expected: [{ tool, input? }, ...]" });
    return;
  }
  if (calls.length > MAX_BATCH_CALLS) {
    res.status(400).json({ error: `Too many calls in batch (${calls.length}). Maximum is ${MAX_BATCH_CALLS}.` });
    return;
  }

  const BATCH_TOTAL_TIMEOUT_MS = 60_000;
  const batchStart = Date.now();
  const { results, lastObservation, hasError } = await room.enqueueExecution(async () => {
    const results: ToolCallResult[] = [];
    let lastObservation: Record<string, unknown> | undefined;
    let hasError = false;

    for (const call of calls) {
      if (Date.now() - batchStart > BATCH_TOTAL_TIMEOUT_MS) {
        results.push({ tool: call.tool || "?", error: `Batch total timeout exceeded (${BATCH_TOTAL_TIMEOUT_MS}ms)` });
        hasError = true;
        continue;
      }
      if (!call.tool) {
        results.push({ tool: "?", error: "Missing 'tool' field in call" });
        hasError = true;
        continue;
      }

      try {
        const batchExpiredFlag = { value: false };
        let batchTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          executeTool(call.tool, actorId, (call.input !== null && typeof call.input === 'object' && !Array.isArray(call.input)) ? call.input : {}, owner, batchExpiredFlag),
          new Promise<never>((_, reject) => {
            batchTimeoutHandle = setTimeout(() => {
              batchExpiredFlag.value = true;
              reject(new Error(`Tool '${call.tool}' timed out after ${TOOL_HTTP_TIMEOUT_MS}ms`));
            }, TOOL_HTTP_TIMEOUT_MS);
          }),
        ]);
        if (batchTimeoutHandle !== undefined) clearTimeout(batchTimeoutHandle);
        results.push(result);
        if (result.observation) lastObservation = result.observation;
      } catch (err: unknown) {
        const errorMsg = err instanceof ZodError
          ? formatZodError(err, call.tool)
          : (err instanceof Error ? err.message : String(err));

        const resolvedBatchOwner = owner || room.participants.get(actorId)?.owner;
        const event: ToolEvent = {
          id: `${Date.now()}-${actorId}-${Math.random().toString(36).slice(2, 6)}`,
          ts: Date.now(),
          actorId,
          ...(resolvedBatchOwner ? { owner: resolvedBatchOwner } : {}),
          tool: call.tool,
          input: call.input || {},
          error: errorMsg,
        };
        room.appendEvent(event);
        roomEvents.emit("room");
        results.push({ tool: call.tool, error: errorMsg });
        hasError = true;
      }
    }
    return { results, lastObservation, hasError };
  });

  res.status(hasError ? 207 : 200).json({ results, observation: lastObservation });
});

// ── Browser error capture ──────────────────────────────────

const browserErrors: { message: string; ts: number }[] = [];
const MAX_BROWSER_ERRORS = 20;
const BROWSER_ERROR_COOLDOWN_MS = 200;
let lastBrowserErrorAt = 0;

app.post("/browser-error", (req, res) => {
  const { message } = req.body || {};
  if (typeof message === "string" && message.trim()) {
    const trimmed = message.trim().slice(0, 500);
    const now = Date.now();
    browserErrors.push({ message: trimmed, ts: now });
    if (browserErrors.length > MAX_BROWSER_ERRORS) {
      browserErrors.splice(0, browserErrors.length - MAX_BROWSER_ERRORS);
    }
    if (now - lastBrowserErrorAt >= BROWSER_ERROR_COOLDOWN_MS) {
      lastBrowserErrorAt = now;
      roomEvents.emit("room");
    }
  }
  res.json({ ok: true });
});

// ── Screenshot ─────────────────────────────────────────────

const screenshotCallbacks = new Map<string, { resolve: (dataUrl: string) => void; reject: (err: Error) => void }>();

app.get("/screenshot", async (_req, res) => {
  // Find a browser WebSocket connection to request a screenshot from
  let browserWs: WebSocket | null = null;
  for (const [ws, actorId] of room.wsConnections.entries()) {
    if (ws.readyState === WebSocket.OPEN && actorId.startsWith("viewer-")) {
      browserWs = ws;
      break;
    }
  }
  // Fallback: any open connection
  if (!browserWs) {
    for (const [ws] of room.wsConnections.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        browserWs = ws;
        break;
      }
    }
  }
  if (!browserWs) {
    return res.status(503).json({ error: "No browser connected to capture screenshot" });
  }

  const id = `ss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        screenshotCallbacks.delete(id);
        reject(new Error("Screenshot timeout"));
      }, 10000);

      screenshotCallbacks.set(id, {
        resolve: (url) => { clearTimeout(timer); resolve(url); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      browserWs!.send(JSON.stringify({ type: "screenshot_request", id }));
    });

    res.json({ dataUrl });
  } catch (err: unknown) {
    res.status(500).json({ error: toErrorMessage(err) });
  }
});

// Called by WebSocket handler when browser sends screenshot_response
function handleScreenshotResponse(msg: { id: string; dataUrl?: string; error?: string }): void {
  const cb = screenshotCallbacks.get(msg.id);
  if (!cb) return;
  screenshotCallbacks.delete(msg.id);
  if (msg.error) {
    cb.reject(new Error(msg.error));
  } else if (msg.dataUrl) {
    cb.resolve(msg.dataUrl);
  } else {
    cb.reject(new Error("Empty screenshot response"));
  }
}

// ── Agent context ──────────────────────────────────────────

app.get("/agent-context", (req, res) => {
  const rawSince = queryInt(req.query.since);
  const timeout = Math.min(queryInt(req.query.timeout), AGENT_CONTEXT_MAX_TIMEOUT_MS);
  const actorId = queryString(req.query.actorId) || "unknown";

  const participantEntry = room.participants.get(actorId);
  const requestingOwner = queryString(req.query.owner) || participantEntry?.owner;

  const since = (rawSince === 0 && participantEntry?.eventCursor)
    ? participantEntry.eventCursor
    : rawSince;

  if (participantEntry) participantEntry.lastPollAt = Date.now();

  const getNewEvents = () => {
    return room.events.filter(e => {
      if (requestingOwner && e.owner === requestingOwner) return false;
      return e.ts > since;
    }).sort((a, b) => a.ts - b.ts);
  };

  const mod = getModule();

  const buildResponse = () => {
    const events = getNewEvents();

    if (room.kickedActors.has(actorId)) {
      room.kickedActors.delete(actorId);
      return { events: [], observation: { done: true, reason: "kicked" }, participants: room.participantList() };
    }

    let observation: Record<string, unknown> | undefined;
    let observeError: string | undefined;
    if (mod?.observe) {
      try {
        const lastEvent = events.length > 0 ? events[events.length - 1] : null;
        observation = mod.observe(room.sharedState, lastEvent, actorId);
      } catch (e: unknown) {
        console.error(`[observe] Error:`, toErrorMessage(e));
        observeError = toErrorMessage(e);
      }
    }

    let lastError: { tool: string; error: string } | undefined;
    for (const e of room.events) {
      if (e.ts > since && e.error && e.actorId === actorId) {
        lastError = { tool: e.tool, error: e.error };
      }
    }

    const recentBrowserErrors = browserErrors.filter(e => e.ts > since);
    if (recentBrowserErrors.length > 0) {
      // Clear reported errors
      const cutoff = since;
      while (browserErrors.length > 0 && browserErrors[0].ts <= cutoff) {
        browserErrors.shift();
      }
    }

    let eventCursor: number | undefined;
    if (events.length > 0 && participantEntry) {
      eventCursor = Math.max(participantEntry.eventCursor || 0, ...events.map(e => e.ts));
      participantEntry.eventCursor = eventCursor;
    } else if (participantEntry?.eventCursor) {
      eventCursor = participantEntry.eventCursor;
    }

    return {
      events,
      observation: observation || {},
      observeError,
      lastError,
      browserErrors: recentBrowserErrors.length > 0 ? recentBrowserErrors : undefined,
      participants: room.participantList(),
      eventCursor,
    };
  };

  let newEvents = getNewEvents();
  const pendingBrowserErrs = browserErrors.filter(e => e.ts > since);
  const isKicked = room.kickedActors.has(actorId);
  if (newEvents.length > 0 || pendingBrowserErrs.length > 0 || isKicked || timeout === 0) {
    res.json(buildResponse());
    return;
  }

  let responded = false;
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  const respond = () => {
    if (responded) return;
    responded = true;
    clearTimeout(timer);
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    roomEvents.removeListener("room", onEvent);
    res.json(buildResponse());
  };

  const timer = setTimeout(respond, timeout);

  const onEvent = () => {
    if (responded) return;
    if (batchTimer) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      if (responded) return;
      const pending = getNewEvents();
      if (pending.length > 0 || room.kickedActors.has(actorId)) respond();
    }, EVENT_BATCH_DEBOUNCE_MS);
  };

  roomEvents.on("room", onEvent);

  req.on("close", () => {
    responded = true;
    clearTimeout(timer);
    if (batchTimer) clearTimeout(batchTimer);
    roomEvents.removeListener("room", onEvent);
  });
});

// ── Serve client bundle ────────────────────────────────────

app.get("/bundle", async (_req, res) => {
  if (rebuildingPromise) await rebuildingPromise;
  res.setHeader("Content-Type", "text/javascript");
  setNoCacheHeaders(res);
  res.send(loadedExperience?.clientBundle || "");
});

// ── Catch-all: serve viewer ─────────────────────────────────

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/tools/") || req.path.startsWith("/viewer/") ||
      req.path.endsWith(".js") ||
      req.path.endsWith(".css") || req.path.endsWith(".map")) {
    next();
    return;
  }
  setNoCacheHeaders(res);
  res.sendFile(path.join(__runtimeDir, "viewer", "index.html"));
});

// ── Client bundle smoke test ──────────────────────────────

async function smokeTestClientBundle(port: number): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${port}/bundle`);
    const bundleCode = await res.text();
    if (bundleCode) {
      const error = validateClientBundle(bundleCode);
      if (error) {
        console.error(`\n  ⚠ SMOKE TEST FAILED — client bundle has errors:`);
        console.error(`    ${error}`);
        console.error(`    The viewer will fail to load. Fix the source and save to hot-reload.\n`);
      } else {
        console.log(`  Smoke test: client bundle OK`);
      }
    }
  } catch (err: unknown) {
    console.error(`\n  ⚠ SMOKE TEST FAILED — client bundle has errors:`);
    console.error(`    ${toErrorMessage(err)}`);
    console.error(`    The viewer will fail to load. Fix the source and save to hot-reload.\n`);
  }
}

// ── Start server ───────────────────────────────────────────

export async function startServer(config?: ServerConfig): Promise<import("http").Server> {
  if (config?.projectRoot) PROJECT_ROOT = config.projectRoot;
  if (config?.port) PORT = config.port;
  if (!PROJECT_ROOT) throw new Error("@vibevibes/runtime: projectRoot is required.");

  await loadExperience();

  const mod = getModule()!;
  const initialState = resolveInitialState(mod);
  room = new Room(mod.manifest.id, initialState);

  console.log(`  Experience: ${mod.manifest.id}`);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD_BYTES });
  wss.on("error", (err) => { console.error("[WSS] server error:", err.message); });

  const wsCloseTimers = new Map<string, NodeJS.Timeout>();

  wss.on("connection", (ws) => {
    const hbWs = ws as HeartbeatWebSocket;
    hbWs.isAlive = true;
    ws.on("pong", () => { hbWs.isAlive = true; });
    ws.on("error", (err) => { console.error("[WS] connection error:", (err as Error).message); });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "join") {
          const username = (msg.username || "viewer").slice(0, 100);
          const wsOwner: string = msg.owner || username;

          if (msg.actorId) {
            if (room.kickedActors.has(msg.actorId) || room.kickedOwners.has(wsOwner)) {
              ws.send(JSON.stringify({ type: "error", error: "You have been kicked from this room." }));
              return;
            }

            let staleWs: WebSocket | null = null;
            for (const [existingWs, existingId] of room.wsConnections.entries()) {
              if (existingId === msg.actorId && existingWs !== ws) { staleWs = existingWs; break; }
            }
            if (staleWs) { room.wsConnections.delete(staleWs); try { staleWs.close(); } catch {} }
            const closeTimer = wsCloseTimers.get(msg.actorId);
            if (closeTimer) { clearTimeout(closeTimer); wsCloseTimers.delete(msg.actorId); }
            if (!room.participants.has(msg.actorId)) {
              room.participants.set(msg.actorId, { type: "human", joinedAt: Date.now(), owner: wsOwner });
            }
            room.wsConnections.set(ws, msg.actorId);
          } else {
            if (room.kickedOwners.has(wsOwner)) {
              ws.send(JSON.stringify({ type: "error", error: "You have been kicked from this room." }));
              return;
            }

            let existingActorId: string | undefined;
            for (const [aid, p] of room.participants) {
              if (p.owner === wsOwner) { existingActorId = aid; break; }
            }

            let actorId: string;
            if (existingActorId) {
              actorId = existingActorId;
              for (const [existingWs, existingId] of room.wsConnections.entries()) {
                if (existingId === existingActorId && existingWs !== ws) {
                  room.wsConnections.delete(existingWs);
                  try { existingWs.close(); } catch {}
                  break;
                }
              }
            } else {
              const mod = getModule();
              const pSlots: ParticipantSlot[] | undefined = mod?.manifest?.participantSlots || mod?.participants;
              let wsSlotRole: string | undefined;

              if (pSlots?.length) {
                const roleOccupancy = new Map<string, number>();
                for (const [, p] of room.participants) {
                  if (p.role) roleOccupancy.set(p.role, (roleOccupancy.get(p.role) || 0) + 1);
                }
                const hasCapacity = (slot: ParticipantSlot) => {
                  const max = slot.maxInstances ?? 1;
                  const current = roleOccupancy.get(slot.role) || 0;
                  return current < max;
                };
                let matched: ParticipantSlot | undefined;
                if (msg.role) {
                  matched = pSlots.find((s) => s.role === msg.role && (!s.type || s.type === "human" || s.type === "any") && hasCapacity(s));
                }
                if (!matched) matched = pSlots.find((s) => s.type === "human" && hasCapacity(s));
                if (!matched) matched = pSlots.find((s) => (!s.type || s.type === "any") && hasCapacity(s));
                if (!matched) matched = pSlots.find((s) => !s.type || s.type === "human" || s.type === "any");
                if (matched) {
                  wsSlotRole = matched.role;
                  const base = matched.role.toLowerCase().replace(/\s+/g, "-");
                  actorId = assignActorId(username, "human", base);
                } else {
                  actorId = assignActorId(username, "human");
                }
              } else {
                actorId = assignActorId(username, "human");
              }
              const wsRole = wsSlotRole || msg.role || undefined;
              room.participants.set(actorId, { type: "human", joinedAt: Date.now(), owner: wsOwner, role: wsRole });
            }
            room.wsConnections.set(ws, actorId);
          }

          const actorId = room.wsConnections.get(ws)!;
          if (!room.participants.has(actorId)) {
            ws.send(JSON.stringify({ type: "error", error: "Session expired. Please rejoin the room." }));
            return;
          }

          const resolvedWsRole = room.participants.get(actorId)?.role;
          ws.send(JSON.stringify({
            type: "joined",
            actorId,
            role: resolvedWsRole,
            sharedState: room.sharedState,
            stateVersion: room.stateVersion,
            participants: room.participantList(),
            participantDetails: room.participantDetails(),
            events: room.events.slice(-JOIN_EVENT_HISTORY),
          }));

          broadcastPresenceUpdate();
        }

        if (msg.type === "ephemeral") {
          const ephPayload = JSON.stringify(msg.data);
          if (ephPayload.length > WS_EPHEMERAL_MAX_BYTES) {
            ws.send(JSON.stringify({ type: "error", error: "Ephemeral payload too large (max 64KB)" }));
            return;
          }
          const senderActorId = room.wsConnections.get(ws);
          if (senderActorId) {
            const payload = JSON.stringify({ type: "ephemeral", actorId: senderActorId, data: msg.data });
            for (const [otherWs] of room.wsConnections.entries()) {
              if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
                otherWs.send(payload);
              }
            }
          }
        }

        if (msg.type === "screenshot_response") {
          handleScreenshotResponse(msg);
        }

      } catch (err: unknown) {
        if (!(err instanceof SyntaxError)) {
          console.error("[WS] Unexpected handler error:", err instanceof Error ? err.message : String(err));
        }
      }
    });

    ws.on("close", () => {
      const actorId = room.wsConnections.get(ws);
      if (actorId) {
        room.wsConnections.delete(ws);
        const participant = room.participants.get(actorId);
        if (!participant || participant.type === "human") {
          const timer = setTimeout(() => {
            wsCloseTimers.delete(actorId);
            let reconnected = false;
            for (const [, wsActorId] of room.wsConnections) {
              if (wsActorId === actorId) { reconnected = true; break; }
            }
            if (!reconnected) {
              room.participants.delete(actorId);
              broadcastPresenceUpdate();
            }
          }, WS_CLOSE_GRACE_MS);
          const prev = wsCloseTimers.get(actorId);
          if (prev) clearTimeout(prev);
          wsCloseTimers.set(actorId, timer);
        }
      }
    });
  });

  // ── WebSocket heartbeat interval ──────────────────────────

  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if ((ws as HeartbeatWebSocket).isAlive === false) {
        const actorId = room.wsConnections.get(ws);
        if (actorId) {
          room.participants.delete(actorId);
          room.wsConnections.delete(ws);
          broadcastPresenceUpdate();
        }
        ws.terminate();
        continue;
      }
      (ws as HeartbeatWebSocket).isAlive = false;
      ws.ping();
    }
  }, WS_HEARTBEAT_INTERVAL_MS);

  // ── AI agent heartbeat sweep ──────────────────────────────

  const AI_HEARTBEAT_TIMEOUT_MS = 300_000;
  const aiHeartbeatInterval = setInterval(() => {
    const now = Date.now();
    const toEvict: string[] = [];
    for (const [actorId, p] of room.participants) {
      if (p.type !== "ai") continue;
      const lastSeen = p.lastPollAt || p.joinedAt;
      if (now - lastSeen > AI_HEARTBEAT_TIMEOUT_MS) toEvict.push(actorId);
    }
    for (const actorId of toEvict) {
      room.participants.delete(actorId);
    }
    if (toEvict.length > 0) {
      broadcastPresenceUpdate();
      roomEvents.emit("room");
    }
  }, WS_HEARTBEAT_INTERVAL_MS);

  // ── Watch src/ for changes ────────────────────────────────

  const watchDirs = [
    path.join(PROJECT_ROOT, "src"),
    path.join(PROJECT_ROOT, "experiences"),
    path.resolve(PROJECT_ROOT, "..", "experiences"),
  ].filter((d) => fs.existsSync(d));
  let debounceTimer: NodeJS.Timeout | null = null;

  function onSrcChange(filename?: string): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!rebuildingPromise) {
      rebuildingPromise = new Promise<void>((resolve) => { rebuildingResolve = resolve; });
    }
    debounceTimer = setTimeout(async () => {
      console.log(`\nFile changed${filename ? ` (${filename})` : ""}, rebuilding...`);
      try {
        await loadExperience();
        room.broadcastToAll({ type: "experience_updated" });
        smokeTestClientBundle(PORT);
        console.log("Hot reload complete.");
      } catch (err: unknown) {
        experienceError = toErrorMessage(err);
        console.error("Hot reload failed:", toErrorMessage(err));
        room.broadcastToAll({ type: "build_error", error: toErrorMessage(err) });
      } finally {
        if (rebuildingResolve) { rebuildingResolve(); rebuildingResolve = null; rebuildingPromise = null; }
      }
    }, HOT_RELOAD_DEBOUNCE_MS);
  }

  for (const watchDir of watchDirs) {
    try {
      fs.watch(watchDir, { recursive: true }, (_event, filename) => {
        if (filename && /\.(tsx?|jsx?|css|json)$/.test(filename)) {
          onSrcChange(path.join(path.relative(PROJECT_ROOT, watchDir), filename));
        }
      });
    } catch {
      function watchDirRecursive(dir: string): void {
        fs.watch(dir, (_event, filename) => {
          if (filename && /\.(tsx?|jsx?|css|json)$/.test(filename)) {
            onSrcChange(path.join(path.relative(PROJECT_ROOT, dir), filename));
          }
        });
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) watchDirRecursive(path.join(dir, entry.name));
        }
      }
      watchDirRecursive(watchDir);
    }
  }

  server.listen(PORT, async () => {
    console.log(`\n  vibe-vibe local runtime`);
    console.log(`  ───────────────────────`);
    console.log(`  Viewer:  http://localhost:${PORT}`);

    smokeTestClientBundle(PORT);
    if (publicUrl) {
      const shareUrl = getBaseUrl();
      console.log(``);
      console.log(`  ┌─────────────────────────────────────────────────┐`);
      console.log(`  │  SHARE WITH FRIENDS:                            │`);
      console.log(`  │                                                 │`);
      console.log(`  │  ${shareUrl.padEnd(47)} │`);
      console.log(`  │                                                 │`);
      console.log(`  │  Open in browser to join the room.              │`);
      console.log(`  │  AI: npx @vibevibes/mcp ${(shareUrl).padEnd(23)} │`);
      console.log(`  └─────────────────────────────────────────────────┘`);
    }
    console.log(`\n  Watching src/ for changes\n`);
  });

  server.on("close", () => {
    clearInterval(heartbeatInterval);
    clearInterval(aiHeartbeatInterval);
    clearInterval(_idempotencyCleanupTimer);
  });

  return server;
}

export function setProjectRoot(root: string): void {
  PROJECT_ROOT = root;
}
