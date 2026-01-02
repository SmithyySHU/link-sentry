import { Client } from "pg";
import { DATABASE_URL } from "./env.js";

let client: Client | null = null;
let connecting: Promise<Client> | null = null;

export async function ensureConnected(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  const url = DATABASE_URL;

  const c = new Client({ connectionString: url });

  connecting = c
    .connect()
    .then(() => {
      client = c;
      return c;
    })
    .finally(() => {
      connecting = null;
    });

  return connecting;
}

export async function closeConnection(): Promise<void> {
  if (!client) return;
  await client.end();
  client = null;
}
