export interface CrawlOptions {
    maxPages: number;
    timeoutMs: number;
}

export interface LinkCheckResults {
    url: string;
    stauts: number;
    sourcePage: string;

}
