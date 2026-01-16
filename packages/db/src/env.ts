import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../../..", ".env"),
});

const url = process.env.DATABASE_URL;

if (!url || typeof url !== "string") {
  throw new Error(
    `DATABASE_URL must be set in the root .env (currently: ${url ?? "undefined"})`,
  );
}

export const DATABASE_URL: string = url;
