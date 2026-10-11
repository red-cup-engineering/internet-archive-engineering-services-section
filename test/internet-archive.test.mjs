import assert from "node:assert/strict";
import test from "node:test";
import {
  captureDate,
  captureUrl,
  captures,
  earliestCapture,
  savePageNow,
  status,
} from "../src/internet-archive.mjs";

const CDX_FIXTURE = [
  ["timestamp", "original", "statuscode", "mimetype", "digest"],
  ["20210202030405", "https://example.com/", "200", "text/html", "ABC123"],
  ["20210304050607", "https://example.com/", "302", "text/html", "DEF456"],
];

test("capture URL and date use the documented 14-digit timestamp", () => {
  assert.equal(captureUrl("20210202030405", "https://example.com/"), "https://web.archive.org/web/20210202030405/https://example.com/");
  assert.equal(captureDate("20210202030405"), "2021-02-02T03:04:05.000Z");
  assert.throws(() => captureDate("20210230030405"), /valid UTC calendar date/u);
});

test("captures requests CDX JSON and maps its header row", async () => {
  let seen;
  const result = await captures("https://example.com/", {
    fetch: async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify(CDX_FIXTURE), { status: 200 });
    },
    from: "2020",
    to: "2022",
    limit: 2,
    matchType: "exact",
    onlyOk: true,
  });
  const request = new URL(seen.url);
  assert.equal(request.origin + request.pathname, "https://web.archive.org/cdx/search/cdx");
  assert.equal(request.searchParams.get("url"), "https://example.com/");
  assert.equal(request.searchParams.get("output"), "json");
  assert.equal(request.searchParams.get("fl"), "timestamp,original,statuscode,mimetype,digest");
  assert.equal(request.searchParams.get("filter"), "statuscode:200");
  assert.equal(seen.init.method, "GET");
  assert.deepEqual(result, [{
    timestamp: "20210202030405",
    date: "2021-02-02T03:04:05.000Z",
    original: "https://example.com/",
    statusCode: "200",
    mimeType: "text/html",
    digest: "ABC123",
    capture: "https://web.archive.org/web/20210202030405/https://example.com/",
  }]);
});

test("captures accepts an empty CDX result", async () => {
  assert.deepEqual(await captures("https://example.com/", {
    fetch: async () => new Response("[]", { status: 200 }),
  }), []);
});

test("earliestCapture returns null when the CDX header has no rows", async () => {
  const result = await earliestCapture("https://example.com/", {
    fetch: async () => new Response(JSON.stringify([CDX_FIXTURE[0]]), { status: 200 }),
  });
  assert.equal(result, null);
});

test("authenticated Save Page Now uses the documented POST request shape", async () => {
  let seen;
  const result = await savePageNow("https://example.com/essay", {
    accessKey: "access",
    secretKey: "secret",
    fetch: async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ url: "https://example.com/essay", job_id: "job-123" }), { status: 200 });
    },
  });
  assert.equal(seen.url, "https://web.archive.org/save");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.authorization, "LOW access:secret");
  assert.equal(seen.init.headers["content-type"], "application/x-www-form-urlencoded;charset=UTF-8");
  assert.equal(new URLSearchParams(seen.init.body).get("url"), "https://example.com/essay");
  assert.equal(result.jobId, "job-123");
});

test("status uses the documented job endpoint and explicit credentials", async () => {
  let seen;
  const result = await status("job-123", {
    accessKey: "access",
    secretKey: "secret",
    fetch: async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ status: "pending", job_id: "job-123" }), { status: 200 });
    },
  });
  assert.equal(seen.url, "https://web.archive.org/save/status/job-123");
  assert.equal(seen.init.headers.authorization, "LOW access:secret");
  assert.equal(result.status, "pending");
});

test("anonymous Save Page Now returns a capture URL supplied by the response", async () => {
  let seen;
  const result = await savePageNow("https://example.com/essay", {
    fetch: async (url, init) => {
      seen = { url: String(url), init };
      return new Response("", { status: 302, headers: { location: "/web/20260927010203/https://example.com/essay" } });
    },
  });
  assert.equal(seen.url, "https://web.archive.org/save/https://example.com/essay");
  assert.equal(seen.init.method, "GET");
  assert.equal(result, "https://web.archive.org/web/20260927010203/https://example.com/essay");
});

test("Save Page Now refuses non-HTTP URLs and partial credentials", async () => {
  const refusingFetch = async () => { throw new Error("must not fetch"); };
  await assert.rejects(savePageNow("file:///tmp/work", { fetch: refusingFetch }), /HTTP or HTTPS/u);
  await assert.rejects(savePageNow("https://example.com/", { fetch: refusingFetch, accessKey: "access" }), /both accessKey and secretKey/u);
});
