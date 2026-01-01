import fetchUrl from './fetchUrl.js';
import extractLinks from './extractLinks.js';

async function crawlPage(url: string) {
  try {
    
    const html = await fetchUrl(url);
    if (!html) {
      console.error('Failed to fetch the page.');
      return;
    }

    const links = extractLinks(html);
    console.log(`Found ${links.length} links on ${url}`);

    

  } catch (error) {
    console.error(`Error crawling ${url}:`, error);
  }
}

// Example usage
crawlPage('https://example.com');
