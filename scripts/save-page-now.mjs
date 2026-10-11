import { savePageNow } from "../src/internet-archive.mjs";

export async function savePages(urls, { fetch: fetchImpl = fetch, env = process.env, output = process.stdout } = {}) {
  if (!Array.isArray(urls) || urls.length === 0) throw new Error("usage: save-page-now.mjs <url...>");
  const accessKey = env.IA_ACCESS_KEY;
  const secretKey = env.IA_SECRET_KEY;
  for (const url of urls) {
    const capture = await savePageNow(url, { fetch: fetchImpl, accessKey, secretKey });
    output.write(`${JSON.stringify({ url, capture })}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await savePages(process.argv.slice(2));
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 1;
  }
}
