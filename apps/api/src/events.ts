import type { Application, Request, Response } from "express";
import { Client } from "pg";
import { SCAN_EVENT_CHANNEL } from "@scanlark/db";

type EventPayload = {
  type: string;
  user_id: string;
  site_id?: string;
  scan_run_id?: string;
};

type ClientEntry = {
  res: Response;
  pingTimer: NodeJS.Timeout;
};

const clientsByUser = new Map<string, Set<ClientEntry>>();
let relayStarted = false;

function writeEvent(res: Response, event: string, payload: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addClient(userId: string, res: Response) {
  const pingTimer = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 20000);

  const entry = { res, pingTimer };
  const set = clientsByUser.get(userId) ?? new Set<ClientEntry>();
  set.add(entry);
  clientsByUser.set(userId, set);

  res.on("close", () => {
    clearInterval(pingTimer);
    const current = clientsByUser.get(userId);
    if (!current) return;
    current.delete(entry);
    if (current.size === 0) {
      clientsByUser.delete(userId);
    }
  });
}

function broadcastToUser(userId: string, event: string, payload: unknown) {
  const set = clientsByUser.get(userId);
  if (!set) return;
  for (const entry of set) {
    try {
      writeEvent(entry.res, event, payload);
    } catch {}
  }
}

export function mountEventStream(app: Application) {
  app.get("/events/stream", (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    writeEvent(res, "connected", { ok: true });
    addClient(userId, res);
  });
}

export async function initEventRelay() {
  if (relayStarted) return;
  relayStarted = true;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for event relay");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`LISTEN ${SCAN_EVENT_CHANNEL}`);

  client.on("notification", (msg) => {
    if (!msg.payload) return;
    let payload: EventPayload;
    try {
      payload = JSON.parse(msg.payload) as EventPayload;
    } catch {
      return;
    }
    if (!payload.user_id || !payload.type) return;
    broadcastToUser(payload.user_id, payload.type, payload);
  });

  client.on("error", (err) => {
    console.error("Event relay error", err);
  });
}
