import "express-serve-static-core";
import type { IronSession } from "iron-session";

declare module "express-serve-static-core" {
  interface Request {
    session: IronSession<{ userId?: string }>;
    user?: {
      id: string;
      email: string;
      name?: string;
    };
  }
}
