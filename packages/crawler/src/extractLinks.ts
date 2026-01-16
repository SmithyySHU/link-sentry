import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export default function extractLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a").each((_: number, element: AnyNode) => {
    const link = $(element).attr("href");
    if (link) {
      links.push(link);
    }
  });
  return links;
}
