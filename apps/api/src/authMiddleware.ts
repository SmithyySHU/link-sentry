import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import {
  backfillSitesUserId,
  createUser,
  getUserByEmail,
  getUserById,
} from "@link-sentry/db";
import { getSessionUserId } from "./auth";

type AuthUser = {
  id: string;
  email: string;
  name?: string;
};

const DEV_BYPASS_AUTH = process.env.DEV_BYPASS_AUTH === "true";
const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL || "demo@scanlark.local";
const API_INTERNAL_TOKEN = process.env.API_INTERNAL_TOKEN;

let demoUserPromise: Promise<AuthUser> | null = null;
let demoLogged = false;

async function ensureDemoUser(): Promise<AuthUser> {
  if (!demoUserPromise) {
    demoUserPromise = (async () => {
      const existing = await getUserByEmail(DEMO_USER_EMAIL);
      if (existing) {
        await backfillSitesUserId(existing.id);
        return {
          id: existing.id,
          email: existing.email,
          name: "Demo User",
        };
      }
      const password = crypto.randomBytes(24).toString("base64url");
      const created = await createUser(DEMO_USER_EMAIL, password);
      await backfillSitesUserId(created.id);
      return {
        id: created.id,
        email: created.email,
        name: "Demo User",
      };
    })();
  }
  return demoUserPromise;
}

export async function initDemoAuth(): Promise<void> {
  if (!DEV_BYPASS_AUTH) return;
  try {
    const demoUser = await ensureDemoUser();
    if (!demoLogged) {
      demoLogged = true;
      console.log(`DEV_BYPASS_AUTH enabled as ${demoUser.email}`);
    }
  } catch (err) {
    console.error("Failed to initialize demo user", err);
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const internalToken =
    typeof req.headers["x-internal-token"] === "string"
      ? req.headers["x-internal-token"]
      : "";
  if (
    API_INTERNAL_TOKEN &&
    internalToken === API_INTERNAL_TOKEN &&
    req.path.startsWith("/scan-runs/") &&
    req.path.endsWith("/notify")
  ) {
    return next();
  }

  // TODO: Replace with a managed auth provider before public launch.
  if (DEV_BYPASS_AUTH) {
    try {
      const demoUser = await ensureDemoUser();
      req.user = demoUser;
      if (!demoLogged) {
        demoLogged = true;
        console.log(`DEV_BYPASS_AUTH enabled as ${demoUser.email}`);
      }
      return next();
    } catch (err) {
      console.error("Failed to initialize demo user", err);
      return res.status(500).json({ error: "auth_init_failed" });
    }
  }

  try {
    const sessionUserId = getSessionUserId(req);
    if (!sessionUserId) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const user = await getUserById(sessionUserId);
    if (!user) {
      return res.status(401).json({ error: "unauthorized" });
    }
    req.user = { id: user.id, email: user.email };
    return next();
  } catch (err) {
    console.error("Auth lookup failed", err);
    return res.status(500).json({ error: "auth_lookup_failed" });
  }
}
