import fetch from "node-fetch";

export default async function fetchUrl(url: string): Promise<number | null> {
  try {
    const response = await fetch(url);
    console.log(`Status for ${url}:`, response.status);
    return response.status;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return null;
  }
}
