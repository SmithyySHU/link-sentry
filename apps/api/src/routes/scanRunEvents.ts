import { Application, Request, Response } from "express";
import { getScanRunById } from "../../../../packages/db/src/scans";
import { serializeScanRun } from "../serializers";

export function mountScanRunEvents(app: Application) {
  app.get(
    "/scan-runs/:scanRunId/events",
    async (req: Request, res: Response) => {
      const { scanRunId } = req.params;

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Access-Control-Allow-Origin", "*");

      // helps with proxies + express buffering
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Tell EventSource how long to wait before reconnects (ms)
      res.write(`retry: 1500\n\n`);

      let lastJson = "";
      let closed = false;

      const tick = async () => {
        const run = await getScanRunById(scanRunId);

        if (!run) {
          send("error", { message: "scan_run_not_found", scanRunId });
          res.end();
          return;
        }

        // Serialize to ensure Date objects are converted to ISO strings
        const serialized = serializeScanRun(run);

        const json = JSON.stringify(serialized);
        if (json !== lastJson) {
          lastJson = json;
          send("scan_run", serialized);
        }

        if (run.status !== "in_progress") {
          send("scan_run", serialized);
          send("done", { status: run.status, scanRunId: run.id });
          res.end();
        }
      };

      const interval = setInterval(() => {
        if (closed) return;
        tick().catch(() => {});
      }, 700);

      const ping = setInterval(() => {
        if (closed) return;
        res.write(`event: ping\ndata: ${Date.now()}\n\n`);
      }, 15000);

      req.on("close", () => {
        closed = true;
        clearInterval(interval);
        clearInterval(ping);
      });

      // initial push immediately
      try {
        await tick();
      } catch {}
    },
  );
}
