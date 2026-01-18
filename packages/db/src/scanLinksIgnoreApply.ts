import { createHash } from "crypto";
import { ensureConnected } from "./client";
import type { IgnoreRule } from "./ignoreRules";

const RULE_SORT = (a: IgnoreRule, b: IgnoreRule) => {
  if (a.rule_type !== b.rule_type)
    return a.rule_type.localeCompare(b.rule_type);
  if (a.pattern !== b.pattern) return a.pattern.localeCompare(b.pattern);
  return a.id.localeCompare(b.id);
};

function hashRules(rules: IgnoreRule[]): string {
  const stable = [...rules]
    .sort(RULE_SORT)
    .map((r) => ({ type: r.rule_type, pattern: r.pattern }));
  const json = JSON.stringify(stable);
  return createHash("sha256").update(json).digest("hex");
}

function ignoreReason(rule: IgnoreRule) {
  return `Ignored by rule: ${rule.rule_type} ${rule.pattern}`;
}

export async function applyIgnoreRulesForScanRun(
  scanRunId: string,
  opts?: { force?: boolean },
): Promise<{ applied: boolean; ignoredCount: number; rulesHash: string }> {
  const client = await ensureConnected();

  const lock = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock(hashtext($1)) as locked`,
    [scanRunId],
  );
  if (!lock.rows[0]?.locked) {
    return { applied: false, ignoredCount: 0, rulesHash: "" };
  }

  try {
    const runRes = await client.query<{ site_id: string; user_id: string }>(
      `
        SELECT r.site_id, s.user_id
        FROM scan_runs r
        JOIN sites s ON s.id = r.site_id
        WHERE r.id = $1
      `,
      [scanRunId],
    );
    const siteId = runRes.rows[0]?.site_id;
    const userId = runRes.rows[0]?.user_id;
    if (!siteId || !userId) {
      return { applied: false, ignoredCount: 0, rulesHash: "" };
    }

    const rulesRes = await client.query<IgnoreRule>(
      `
        SELECT id, user_id, site_id, rule_type, pattern, is_enabled, created_at
        FROM ignore_rules
        WHERE user_id = $2
          AND (site_id = $1 OR site_id IS NULL)
          AND is_enabled = true
      `,
      [siteId, userId],
    );

    const rules = rulesRes.rows;
    const rulesHash = hashRules(rules);

    if (!opts?.force) {
      const stateRes = await client.query<{ rules_hash: string }>(
        `SELECT rules_hash FROM scan_ignore_apply_state WHERE scan_run_id = $1`,
        [scanRunId],
      );
      const existingHash = stateRes.rows[0]?.rules_hash;
      if (existingHash && existingHash === rulesHash) {
        return { applied: false, ignoredCount: 0, rulesHash };
      }
    }

    await client.query(
      `
        UPDATE scan_links
        SET ignored = false,
            ignored_by_rule_id = null,
            ignored_at = null,
            ignore_reason = null,
            ignored_source = 'none'
        WHERE scan_run_id = $1 AND ignored_source = 'rule'
      `,
      [scanRunId],
    );

    let ignoredCount = 0;

    const nonRegex = rules.filter((rule) => rule.rule_type !== "regex");
    for (const rule of nonRegex) {
      const reason = ignoreReason(rule);
      if (rule.rule_type === "exact") {
        const res = await client.query(
          `
            UPDATE scan_links
            SET ignored = true,
                ignored_source = 'rule',
                ignored_by_rule_id = $2,
                ignored_at = now(),
                ignore_reason = $3
            WHERE scan_run_id = $1
              AND ignored_source != 'manual'
              AND link_url = $4
          `,
          [scanRunId, rule.id, reason, rule.pattern],
        );
        ignoredCount += res.rowCount ?? 0;
      }
      if (rule.rule_type === "contains") {
        const res = await client.query(
          `
            UPDATE scan_links
            SET ignored = true,
                ignored_source = 'rule',
                ignored_by_rule_id = $2,
                ignored_at = now(),
                ignore_reason = $3
            WHERE scan_run_id = $1
              AND ignored_source != 'manual'
              AND link_url ILIKE '%' || $4 || '%'
          `,
          [scanRunId, rule.id, reason, rule.pattern],
        );
        ignoredCount += res.rowCount ?? 0;
      }
      if (rule.rule_type === "status_code") {
        const code = Number(rule.pattern);
        if (!Number.isNaN(code)) {
          const res = await client.query(
            `
              UPDATE scan_links
              SET ignored = true,
                  ignored_source = 'rule',
                  ignored_by_rule_id = $2,
                  ignored_at = now(),
                  ignore_reason = $3
              WHERE scan_run_id = $1
                AND ignored_source != 'manual'
                AND status_code = $4
            `,
            [scanRunId, rule.id, reason, code],
          );
          ignoredCount += res.rowCount ?? 0;
        }
      }
      if (rule.rule_type === "classification") {
        const res = await client.query(
          `
            UPDATE scan_links
            SET ignored = true,
                ignored_source = 'rule',
                ignored_by_rule_id = $2,
                ignored_at = now(),
                ignore_reason = $3
            WHERE scan_run_id = $1
              AND ignored_source != 'manual'
              AND classification = $4
          `,
          [scanRunId, rule.id, reason, rule.pattern],
        );
        ignoredCount += res.rowCount ?? 0;
      }
    }

    const regexRules = rules
      .filter((rule) => rule.rule_type === "regex")
      .map((rule) => {
        try {
          return { rule, regex: new RegExp(rule.pattern) };
        } catch {
          return null;
        }
      })
      .filter(
        (entry): entry is { rule: IgnoreRule; regex: RegExp } => entry !== null,
      );

    if (regexRules.length > 0) {
      const candidates = await client.query<{ id: string; link_url: string }>(
        `
          SELECT id, link_url
          FROM scan_links
          WHERE scan_run_id = $1 AND ignored_source != 'manual' AND ignored = false
        `,
        [scanRunId],
      );

      const idsByRule = new Map<string, string[]>();
      for (const entry of regexRules) {
        idsByRule.set(entry.rule.id, []);
      }

      for (const row of candidates.rows) {
        for (const entry of regexRules) {
          if (entry.regex.test(row.link_url)) {
            idsByRule.get(entry.rule.id)?.push(row.id);
            break;
          }
        }
      }

      for (const entry of regexRules) {
        const ids = idsByRule.get(entry.rule.id) ?? [];
        if (ids.length === 0) continue;
        const res = await client.query(
          `
            UPDATE scan_links
            SET ignored = true,
                ignored_source = 'rule',
                ignored_by_rule_id = $2,
                ignored_at = now(),
                ignore_reason = $3
            WHERE id = ANY($1::uuid[])
          `,
          [ids, entry.rule.id, ignoreReason(entry.rule)],
        );
        ignoredCount += res.rowCount ?? 0;
      }
    }

    await client.query(
      `
        INSERT INTO scan_ignore_apply_state (scan_run_id, last_applied_at, rules_hash)
        VALUES ($1, now(), $2)
        ON CONFLICT (scan_run_id)
        DO UPDATE SET last_applied_at = excluded.last_applied_at, rules_hash = excluded.rules_hash
      `,
      [scanRunId, rulesHash],
    );

    return { applied: true, ignoredCount, rulesHash };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [scanRunId]);
  }
}
