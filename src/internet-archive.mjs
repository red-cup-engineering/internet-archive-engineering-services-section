const WAYBACK_ORIGIN = "https://web.archive.org";
const CDX_ENDPOINT = `${WAYBACK_ORIGIN}/cdx/search/cdx`;
const SAVE_ENDPOINT = `${WAYBACK_ORIGIN}/save`;
const CDX_FIELDS = Object.freeze(["timestamp", "original", "statuscode", "mimetype", "digest"]);
const MATCH_TYPES = Object.freeze(["exact", "prefix", "host", "domain"]);
const MAX_RESPONSE_BYTES = 5_000_000;

function capability(fetchImpl, operation) {
  if (typeof fetchImpl !== "function") throw new TypeError(`${operation} requires an injected fetch capability`);
  return fetchImpl;
}

function httpUrl(value, name = "URL") {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a nonempty HTTP(S) URL`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${name} must be a valid HTTP(S) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new TypeError(`${name} must use HTTP or HTTPS`);
  return parsed.href;
}

function timestamp(value, { partial = false, name = "timestamp" } = {}) {
  const pattern = partial ? /^\d{1,14}$/u : /^\d{14}$/u;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${name} must contain ${partial ? "1 to 14" : "14"} digits`);
  }
  return value;
}

function credentials(accessKey, secretKey) {
  const hasAccessKey = typeof accessKey === "string" && accessKey.length > 0;
  const hasSecretKey = typeof secretKey === "string" && secretKey.length > 0;
  if (hasAccessKey !== hasSecretKey) throw new TypeError("Save Page Now requires both accessKey and secretKey, or neither");
  return hasAccessKey ? `LOW ${accessKey}:${secretKey}` : null;
}

async function responseText(response, operation, { redirectsAreOk = false } = {}) {
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new TypeError(`${operation} response exceeds the bounded response limit`);
  if (!response.ok && !(redirectsAreOk && response.status >= 300 && response.status < 400)) {
    throw new Error(`${operation} ${response.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

async function responseJson(response, operation) {
  const text = await responseText(response, operation);
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`${operation} returned malformed JSON`);
  }
}

function captureLocation(value) {
  if (typeof value !== "string" || !value) return null;
  let parsed;
  try {
    parsed = new URL(value, WAYBACK_ORIGIN);
  } catch {
    return null;
  }
  return parsed.origin === WAYBACK_ORIGIN && parsed.pathname.startsWith("/web/") ? parsed.href : null;
}

/** Build the documented Wayback replay URL for one 14-digit capture timestamp. */
export function captureUrl(captureTimestamp, url) {
  timestamp(captureTimestamp);
  httpUrl(url);
  return `${WAYBACK_ORIGIN}/web/${captureTimestamp}/${url}`;
}

/** Convert a Wayback YYYYMMDDhhmmss timestamp to a UTC ISO timestamp. */
export function captureDate(captureTimestamp) {
  timestamp(captureTimestamp);
  const parts = [
    Number(captureTimestamp.slice(0, 4)),
    Number(captureTimestamp.slice(4, 6)),
    Number(captureTimestamp.slice(6, 8)),
    Number(captureTimestamp.slice(8, 10)),
    Number(captureTimestamp.slice(10, 12)),
    Number(captureTimestamp.slice(12, 14)),
  ];
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  const observed = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()];
  if (parts.some((part, index) => part !== observed[index])) throw new TypeError("timestamp is not a valid UTC calendar date");
  return date.toISOString();
}

/**
 * List Wayback captures through the CDX Server JSON API.
 * Verified against https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server.
 */
export async function captures(url, { fetch: fetchImpl, from, to, limit, matchType, onlyOk = false } = {}) {
  const call = capability(fetchImpl, "captures");
  const target = httpUrl(url);
  const query = new URLSearchParams({ url: target, output: "json", fl: CDX_FIELDS.join(",") });
  if (from !== undefined) query.set("from", timestamp(from, { partial: true, name: "from" }));
  if (to !== undefined) query.set("to", timestamp(to, { partial: true, name: "to" }));
  if (limit !== undefined) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("limit must be a positive safe integer");
    query.set("limit", String(limit));
  }
  if (matchType !== undefined) {
    if (!MATCH_TYPES.includes(matchType)) throw new TypeError(`matchType must be one of ${MATCH_TYPES.join(", ")}`);
    query.set("matchType", matchType);
  }
  if (onlyOk) query.set("filter", "statuscode:200");

  const payload = await responseJson(await call(`${CDX_ENDPOINT}?${query}`, {
    method: "GET",
    headers: { accept: "application/json" },
  }), "CDX search");

  if (!Array.isArray(payload) || payload.length === 0) return [];
  const [header, ...rows] = payload;
  if (!Array.isArray(header)) throw new TypeError("CDX JSON response has no header row");
  const positions = new Map(header.map((field, index) => [field, index]));
  for (const field of CDX_FIELDS) {
    if (!positions.has(field)) throw new TypeError(`CDX JSON response header omits ${field}`);
  }

  return rows.filter((row) => Array.isArray(row)).map((row) => {
    const captureTimestamp = row[positions.get("timestamp")];
    const original = row[positions.get("original")];
    const statusCode = row[positions.get("statuscode")];
    if (typeof original !== "string") throw new TypeError("CDX row carries no original URL");
    return {
      timestamp: captureTimestamp,
      date: captureDate(captureTimestamp),
      original,
      statusCode,
      mimeType: row[positions.get("mimetype")],
      digest: row[positions.get("digest")],
      capture: captureUrl(captureTimestamp, original),
    };
  }).filter((capture) => !onlyOk || capture.statusCode === "200");
}

/** Return the earliest successful capture by default, or null when none exists. */
export async function earliestCapture(url, { fetch: fetchImpl, onlyOk = true } = {}) {
  const [earliest] = await captures(url, { fetch: fetchImpl, limit: 1, onlyOk });
  return earliest ?? null;
}

/**
 * Read an SPN2 job. Credentials are explicit and optional because the public
 * documentation's example polling loop omits authentication.
 */
export async function status(jobId, { fetch: fetchImpl, accessKey, secretKey } = {}) {
  if (typeof jobId !== "string" || !jobId.trim()) throw new TypeError("status requires a nonempty jobId");
  const call = capability(fetchImpl, "status");
  const authorization = credentials(accessKey, secretKey);
  const headers = { accept: "application/json" };
  if (authorization) headers.authorization = authorization;
  return responseJson(await call(`${SAVE_ENDPOINT}/status/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers,
  }), "Save Page Now status");
}

/**
 * Ask Internet Archive to capture an HTTP(S) page.
 * Authenticated requests return an SPN2 job reference. Anonymous requests use
 * the documented GET form and return a replay URL when the response supplies one.
 */
export async function savePageNow(url, { fetch: fetchImpl, accessKey, secretKey } = {}) {
  const call = capability(fetchImpl, "savePageNow");
  const target = httpUrl(url);
  const authorization = credentials(accessKey, secretKey);

  if (authorization) {
    const body = new URLSearchParams({ url: target });
    const payload = await responseJson(await call(SAVE_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    }), "Save Page Now capture");
    if (typeof payload?.job_id !== "string" || !payload.job_id) throw new TypeError("Save Page Now response carries no job_id");
    return { jobId: payload.job_id, url: typeof payload.url === "string" ? payload.url : target, response: payload };
  }

  const response = await call(`${SAVE_ENDPOINT}/${target}`, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "application/json, text/html;q=0.9" },
  });
  const text = await responseText(response, "anonymous Save Page Now capture", { redirectsAreOk: true });
  const fromHeader = captureLocation(response.headers?.get?.("content-location"))
    ?? captureLocation(response.headers?.get?.("location"))
    ?? captureLocation(response.url);
  if (fromHeader) return fromHeader;
  if (!text) return null;
  try {
    const payload = JSON.parse(text);
    if (typeof payload?.timestamp === "string" && typeof payload?.original_url === "string") {
      return captureUrl(payload.timestamp, payload.original_url);
    }
    return captureLocation(payload?.capture) ?? captureLocation(payload?.url);
  } catch {
    return null;
  }
}

/** Produce a provenance observation without storing it or reading ambient state. */
export async function witness(url, { fetch: fetchImpl } = {}) {
  const target = httpUrl(url);
  const earliest = await earliestCapture(target, { fetch: fetchImpl });
  return { url: target, earliest, checkedAt: new Date().toISOString() };
}
