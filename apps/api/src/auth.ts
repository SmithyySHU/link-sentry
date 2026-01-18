import type { NextFunction, Request, Response } from "express";
import { getIronSession, type SessionOptions } from "iron-session";

const NODE_ENV = process.env.NODE_ENV || "development";
const DEV_BYPASS_AUTH = process.env.DEV_BYPASS_AUTH === "true";
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "ls_session";
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_TTL_DAYS = Number(process.env.AUTH_TOKEN_TTL_DAYS ?? "30");

const fallbackSessionSecret =
  "dev-bypass-only-do-not-use-in-production-32-characters";

function resolveSessionSecret(): string {
  if (!SESSION_SECRET) {
    if (!DEV_BYPASS_AUTH) {
      throw new Error(
        "SESSION_SECRET is required when DEV_BYPASS_AUTH is false",
      );
    }
    return fallbackSessionSecret;
  }
  if (SESSION_SECRET.length < 32) {
    if (!DEV_BYPASS_AUTH) {
      throw new Error("SESSION_SECRET must be at least 32 characters long");
    }
    console.warn(
      "SESSION_SECRET is too short; using a dev-only fallback because DEV_BYPASS_AUTH=true",
    );
    return fallbackSessionSecret;
  }
  return SESSION_SECRET;
}

const sessionPassword = resolveSessionSecret();

const sessionOptions: SessionOptions = {
  cookieName: AUTH_COOKIE_NAME,
  password: sessionPassword,
  ttl: Number.isFinite(SESSION_TTL_DAYS)
    ? Math.max(1, SESSION_TTL_DAYS) * 24 * 60 * 60
    : 30 * 24 * 60 * 60,
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: NODE_ENV === "production",
    path: "/",
  },
};

export async function sessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    req.session = await getIronSession(req, res, sessionOptions);
    return next();
  } catch (err) {
    return next(err);
  }
}

export async function setSession(req: Request, userId: string) {
  req.session.userId = userId;
  await req.session.save();
}

export async function clearSession(req: Request) {
  req.session.destroy();
}

export function getSessionUserId(req: Request): string | null {
  return req.session.userId ?? null;
}
