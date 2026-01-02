import fetchUrl from "./fetchUrl.js";
import extractLinks from "./extractLinks.js";
import validateLink from "./validateLink.js";
import { classifyStatus } from "./classifyStatus.js";
import { normaliseLink } from "./normaliseLink.js";

async function crawlPage(url: string) {
  const html = await fetchUrl(url);
  if (!html) {
    console.error("Failed to fetch the page.");
    return;
  }

  const rawLinks = extractLinks(html);
  console.log(`Found ${rawLinks.length} links on ${url}`);
  
  const uniqueRawLinks = Array.from(new Set(rawLinks));
  console.log(`Found ${rawLinks.length} links on ${url} (${uniqueRawLinks.length} unique)`);



  let checked = 0;
  let skipped = 0;

  for (const rawHref of uniqueRawLinks) {
    const normalised = normaliseLink(rawHref, url);

    if (normalised.kind === "skip") {
      skipped++;
      continue;
    }

    checked++;

    const result = await validateLink(normalised.url);
    const verdict = classifyStatus(normalised.url, result.status ?? undefined);


    if (verdict === "ok") {
      console.log(`OK    ${result.status} ${normalised.url}`);
    } else if (verdict === "blocked") {
      console.log(`BLKD  ${result.status ?? ""} ${normalised.url}`);
    } else {
      const errMsg = result.ok ? "" : result.error ?? "";
      console.log(
        `BAD   ${result.status ?? ""} ${normalised.url} ${errMsg}`.trim()
      );
    }
  }

  console.log(`Checked: ${checked}, Skipped: ${skipped}`);
}

await crawlPage("https://example.com");
