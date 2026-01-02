import { Client } from "pg";
let client = null;
let connecting = null;
export async function ensureConnected() {
    if (client)
        return client;
    if (connecting)
        return connecting;
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error("Missing DATABASE_URL in environment.");
    }
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
