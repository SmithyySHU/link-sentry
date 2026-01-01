import * as cheerio from 'cheerio';

export default function extractLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $('a').each((_, element) => {
    const link = $(element).attr('href');
    if (link) {
      links.push(link);
    }
  });
  return links;
}
