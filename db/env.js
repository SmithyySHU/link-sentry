import "dotenv/config";
export function mustGetEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing ${name} in environment.`);
    return v;
}
export const DATABASE_URL = mustGetEnv("DATABASE_URL");
