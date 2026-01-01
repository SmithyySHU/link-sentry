import fetch from "node-fetch";

export type LinkCheckResult =
  | { ok: true; status: number }
  | { ok: false; status?: number; error?: string };

export default async function validateLink(url: string): Promise<LinkCheckResult> {
  try {
    const res = await fetch(url, { method: "HEAD" });

    
    if (res.status === 405 || res.status === 403) {
      const getRes = await fetch(url, { method: "GET" });
      return getRes.ok ? { ok: true, status: getRes.status } : { ok: false, status: getRes.status };
    }

    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
