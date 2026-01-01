import fetchUrl from "./fetchUrl.js";  

const status = await fetchUrl("https://example.com"); // Testing the fetch function by fetching a simple website 
console.log("Returned Status:", status);