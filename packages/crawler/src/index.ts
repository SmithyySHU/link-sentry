import { runScanForSite } from "./scanService.js";

async function main(): Promise<void> {
  const siteId = "85efa142-35dc-4b06-93ee-fb7180ab28fd";
  const url = "https://twiddlefood.co.uk";

  await runScanForSite(siteId, url);
}

await main();
