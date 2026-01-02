export function normaliseLink(rawHref, baseUrl) {
    const href = rawHref.trim();
    if (!href)
        return { kind: "skip", reason: "empty" };
    if (href.startsWith("#"))
        return { kind: "skip", reason: "fragment" };
    const lower = href.toLowerCase();
    if (lower.startsWith("mailto:"))
        return { kind: "skip", reason: "mailto" };
    if (lower.startsWith("tel:"))
        return { kind: "skip", reason: "tel" };
    if (lower.startsWith("javascript:"))
        return { kind: "skip", reason: "javascript" };
    try {
        const url = new URL(href, baseUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return { kind: "skip", reason: "unsupported" };
        }
        // Remove fragments so the same URL doesn't appear as multiple variants
        url.hash = "";
        return { kind: "http", url: url.toString() };
    }
    catch {
        return { kind: "skip", reason: "unsupported" };
    }
}
