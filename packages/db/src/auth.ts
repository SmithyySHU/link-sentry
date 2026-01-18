import argon2 from "argon2";
import { ensureConnected } from "./client";

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
};

export type AuthUser = {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
};

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createUser(
  email: string,
  password: string,
): Promise<AuthUser> {
  const client = await ensureConnected();
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
  });
  try {
    const res = await client.query<UserRow>(
      `
        INSERT INTO users (email, password_hash)
        VALUES ($1, $2)
        RETURNING id, email, password_hash, created_at, updated_at
      `,
      [email.toLowerCase().trim(), passwordHash],
    );
    return mapUser(res.rows[0]);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      throw new Error("email_exists");
    }
    throw err;
  }
}

export async function getUserByEmail(email: string): Promise<AuthUser | null> {
  const client = await ensureConnected();
  const res = await client.query<UserRow>(
    `
      SELECT id, email, password_hash, created_at, updated_at
      FROM users
      WHERE email = $1
      LIMIT 1
    `,
    [email.toLowerCase().trim()],
  );
  const row = res.rows[0];
  if (!row) return null;
  return mapUser(row);
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const client = await ensureConnected();
  const res = await client.query<UserRow>(
    `
      SELECT id, email, password_hash, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return mapUser(row);
}

export async function verifyUser(
  email: string,
  password: string,
): Promise<AuthUser | null> {
  const client = await ensureConnected();
  const res = await client.query<UserRow>(
    `
      SELECT id, email, password_hash, created_at, updated_at
      FROM users
      WHERE email = $1
      LIMIT 1
    `,
    [email.toLowerCase().trim()],
  );
  const row = res.rows[0];
  if (!row) return null;
  let ok = false;
  try {
    ok = await argon2.verify(row.password_hash, password);
  } catch {
    return null;
  }
  if (!ok) return null;
  return mapUser(row);
}
