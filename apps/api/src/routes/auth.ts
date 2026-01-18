import express from "express";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { createUser, verifyUser } from "@scanlark/db";
import { clearSession, setSession } from "../auth";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

// TODO: Replace memory store with Redis in production.
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many attempts" },
});

export function mountAuthRoutes(app: express.Application) {
  app.post("/auth/register", authLimiter, async (req: Request, res: Response) => {
    const emailRaw = typeof req.body?.email === "string" ? req.body.email : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    const email = normalizeEmail(emailRaw);

    if (!email || !isValidEmail(email)) {
      return res
        .status(400)
        .json({ error: "invalid_email", message: "Email is invalid" });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({
        error: "invalid_password",
        message: "Password must be at least 8 characters",
      });
    }

    try {
      const user = await createUser(email, password);
      await setSession(req, user.id);
      return res.status(201).json({ id: user.id, email: user.email });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "email_exists") {
        return res.status(409).json({
          error: "email_exists",
          message: "Email already registered",
        });
      }
      console.error("Register failed", err);
      return res.status(500).json({ error: "register_failed" });
    }
  });

  app.post("/auth/login", authLimiter, async (req: Request, res: Response) => {
    const emailRaw = typeof req.body?.email === "string" ? req.body.email : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    const email = normalizeEmail(emailRaw);

    if (!email || !isValidEmail(email)) {
      return res
        .status(400)
        .json({ error: "invalid_email", message: "Email is invalid" });
    }
    if (!password) {
      return res
        .status(400)
        .json({ error: "invalid_password", message: "Password is required" });
    }

    try {
      const user = await verifyUser(email, password);
      if (!user) {
        return res.status(401).json({
          error: "invalid_credentials",
          message: "Invalid credentials",
        });
      }
      await setSession(req, user.id);
      return res.json({ id: user.id, email: user.email });
    } catch (err) {
      console.error("Login failed", err);
      return res.status(500).json({ error: "login_failed" });
    }
  });

  app.post("/auth/logout", async (req: Request, res: Response) => {
    await clearSession(req);
    return res.json({ ok: true });
  });
}
