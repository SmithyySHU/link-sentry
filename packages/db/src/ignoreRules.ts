import { ensureConnected } from "./client.js";

export type IgnoreRuleType =
  | "contains"
  | "regex"
  | "exact"
  | "status_code"
  | "classification"
  | "domain"
  | "path_prefix";

export interface IgnoreRule {
  id: string;
  site_id: string | null;
  rule_type: IgnoreRuleType;
  pattern: string;
  is_enabled: boolean;
  created_at: Date;
}

export async function listIgnoreRulesForSite(
  siteId: string,
  opts?: { enabledOnly?: boolean },
): Promise<IgnoreRule[]> {
  const client = await ensureConnected();
  const enabledOnly = opts?.enabledOnly ?? false;
  const res = await client.query<IgnoreRule>(
    `
      SELECT id, site_id, rule_type, pattern, is_enabled, created_at
      FROM ignore_rules
      WHERE site_id = $1 ${enabledOnly ? "AND is_enabled = true" : ""}
      ORDER BY created_at DESC
    `,
    [siteId],
  );
  return res.rows;
}

export async function getIgnoreRulesForSite(
  siteId: string,
  opts?: { enabledOnly?: boolean },
): Promise<IgnoreRule[]> {
  return listIgnoreRulesForSite(siteId, opts);
}

export async function listIgnoreRules(
  siteId?: string,
  opts?: { enabledOnly?: boolean },
): Promise<IgnoreRule[]> {
  const client = await ensureConnected();
  const enabledOnly = opts?.enabledOnly ?? false;
  if (!siteId) {
    const res = await client.query<IgnoreRule>(
      `SELECT id, site_id, rule_type, pattern, is_enabled, created_at FROM ignore_rules ${
        enabledOnly ? "WHERE is_enabled = true" : ""
      } ORDER BY created_at DESC`,
    );
    return res.rows;
  }

  const res = await client.query<IgnoreRule>(
    `
      SELECT id, site_id, rule_type, pattern, is_enabled, created_at
      FROM ignore_rules
      WHERE (site_id = $1 OR site_id IS NULL) ${enabledOnly ? "AND is_enabled = true" : ""}
      ORDER BY created_at DESC
    `,
    [siteId],
  );
  return res.rows;
}

export function findMatchingIgnoreRule(
  siteId: string | null,
  linkUrl: string,
  statusCode: number | null,
  rules: IgnoreRule[],
): IgnoreRule | null {
  let host = "";
  let path = "";
  try {
    const url = new URL(linkUrl);
    host = url.hostname.toLowerCase();
    path = url.pathname;
  } catch {
    return null;
  }

  const normalizeDomainPattern = (pattern: string) => {
    const trimmed = pattern.trim();
    try {
      const url = new URL(trimmed);
      return url.hostname.toLowerCase();
    } catch {
      const withoutProtocol = trimmed.replace(/^https?:\/\//i, "");
      const hostOnly = withoutProtocol.split("/")[0];
      return hostOnly.toLowerCase();
    }
  };

  const normalizePathPattern = (pattern: string) => {
    const trimmed = pattern.trim();
    try {
      const url = new URL(trimmed);
      return url.pathname;
    } catch {
      const slashIndex = trimmed.indexOf("/");
      if (slashIndex >= 0) return trimmed.slice(slashIndex);
      return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    }
  };

  for (const rule of rules) {
    if (!rule.is_enabled) continue;
    if (rule.site_id && siteId && rule.site_id !== siteId) continue;
    if (rule.rule_type === "domain") {
      const pattern = normalizeDomainPattern(rule.pattern);
      if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(2);
        if (host === suffix || host.endsWith(`.${suffix}`)) return rule;
      } else if (pattern.startsWith(".")) {
        const suffix = pattern.slice(1);
        if (host === suffix || host.endsWith(`.${suffix}`)) return rule;
      } else if (host === pattern) {
        return rule;
      }
    }
    if (rule.rule_type === "path_prefix") {
      const pattern = normalizePathPattern(rule.pattern);
      if (path.startsWith(pattern)) return rule;
    }
    if (rule.rule_type === "exact" && linkUrl === rule.pattern) return rule;
    if (rule.rule_type === "contains" && linkUrl.includes(rule.pattern))
      return rule;
    if (rule.rule_type === "regex") {
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(linkUrl)) return rule;
      } catch {}
    }
    if (rule.rule_type === "status_code") {
      const code = Number(rule.pattern);
      if (!Number.isNaN(code) && statusCode === code) return rule;
    }
  }
  return null;
}

export async function createIgnoreRule(
  siteId: string | null,
  ruleType: IgnoreRuleType,
  pattern: string,
): Promise<IgnoreRule> {
  const client = await ensureConnected();
  const res = await client.query<IgnoreRule>(
    `
      INSERT INTO ignore_rules (site_id, rule_type, pattern)
      VALUES ($1, $2, $3)
      RETURNING id, site_id, rule_type, pattern, is_enabled, created_at
    `,
    [siteId, ruleType, pattern],
  );
  return res.rows[0];
}

export async function deleteIgnoreRule(ruleId: string): Promise<void> {
  const client = await ensureConnected();
  await client.query(`DELETE FROM ignore_rules WHERE id = $1`, [ruleId]);
}

export async function setIgnoreRuleEnabled(
  ruleId: string,
  enabled: boolean,
): Promise<IgnoreRule | null> {
  const client = await ensureConnected();
  const res = await client.query<IgnoreRule>(
    `
      UPDATE ignore_rules
      SET is_enabled = $2
      WHERE id = $1
      RETURNING id, site_id, rule_type, pattern, is_enabled, created_at
    `,
    [ruleId, enabled],
  );
  return res.rows[0] ?? null;
}

export function matchesIgnoreRules(
  input: { url: string; statusCode: number | null; classification: string },
  rules: IgnoreRule[],
): boolean {
  for (const rule of rules) {
    if (!rule.is_enabled) continue;
    if (rule.rule_type === "contains" && input.url.includes(rule.pattern)) {
      return true;
    }
    if (rule.rule_type === "exact" && input.url === rule.pattern) {
      return true;
    }
    if (rule.rule_type === "regex") {
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(input.url)) return true;
      } catch {
        // Invalid regex should not crash or match.
      }
    }
    if (rule.rule_type === "status_code") {
      const code = Number(rule.pattern);
      if (!Number.isNaN(code) && input.statusCode === code) return true;
    }
    if (
      rule.rule_type === "classification" &&
      input.classification === rule.pattern
    ) {
      return true;
    }
  }
  return false;
}
