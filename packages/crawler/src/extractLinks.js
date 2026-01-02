import * as cheerio from 'cheerio';
export default function extractLinks(html) {
    const $ = cheerio.load(html);
    const links = [];
    $('a').each((_, element) => {
        const link = $(element).attr('href');
        if (link) {
            links.push(link);
        }
    });
    return links;
}
