import { earliestCapture } from "../src/internet-archive.mjs";

export async function printEarliestCaptures(urls, { fetch: fetchImpl = fetch, output = process.stdout } = {}) {
  if (!Array.isArray(urls) || urls.length === 0) throw new Error("usage: earliest-capture.mjs <url...>");
  for (const url of urls) {
    const capture = await earliestCapture(url, { fetch: fetchImpl });
    output.write(`${JSON.stringify({ url, capture })}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await printEarliestCaptures(process.argv.slice(2));
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 1;
  }
}
