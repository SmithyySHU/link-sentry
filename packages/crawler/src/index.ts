import fetchUrl from "./fetchUrl.js";
import extractLinks from "./extractLinks.js";
import validateLink from "./validateLink.js";
import { normaliseLink } from "./normaliseLink.js";

async function crawlPage(url: string) {
  const html = await fetchUrl(url);
  if (!html) {
    console.error("Failed to fetch the page.");
    return;
  }

  const rawLinks = extractLinks(html);
  console.log(`Found ${rawLinks.length} links on ${url}`);

  let checked = 0;
  let skipped = 0;

  for (const rawHref of rawLinks) {
    const normalised = normaliseLink(rawHref, url);

    if (normalised.kind === "skip") {
      skipped++;
      continue;
    }

    checked++;
    const result = await validateLink(normalised.url);

    if (result.ok) {
      console.log(`OK   ${result.status} ${normalised.url}`);
    } else {
      console.log(`BAD  ${result.status ?? ""} ${normalised.url} ${result.error ?? ""}`.trim());
    }
  }

  console.log(`Checked: ${checked}, Skipped: ${skipped}`);
}

await crawlPage("https://example.com");
