# @red-cup-engineering/internet-archive-services-section

Credential-blind Internet Archive Wayback client for asking when a URL was
first captured and asking the Archive to capture it now. It is seated beside
`buttondown-services-section` under `web2-platform-services-section`, where the
external web platform capability already belongs.

This section exists to support the provenance rule in “Republishing dated work
on the web,” section 3: an Internet Archive timestamp is an outside witness that
the author cannot set, the earliest capture bounds a claimed first date from
above, and republished work should carry that witness so readers can check it.

Zero dependencies. `src/internet-archive.mjs` exports `captureUrl`,
`captureDate`, `captures`, `earliestCapture`, `savePageNow`, `status`, and
`witness`. Every network operation takes `fetch` explicitly. Credentials are
accepted only as call parameters; the library never reads `process.env`.
`scripts/save-page-now.mjs` is the environment boundary that reads
`IA_ACCESS_KEY` and `IA_SECRET_KEY` and passes them through.

## Verified facts (from Internet Archive documentation)

Fetched 2026-09-27. The facts below record what each fetched page stated.
Anything the pages did not confirm is labeled as inference.

- **Wayback API index:** https://archive.org/help/wayback_api.php states that
  the CDX Server API supports complex querying, filtering, and analysis of
  Wayback capture data, and points to the Internet Archive `wayback`
  repository as its latest CDX documentation.
- **CDX request and rows:**
  https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server
  states that the deployed server accepts GET queries at
  `web.archive.org/cdx/search/cdx`; `url` is the only required parameter;
  `output=json` returns a JSON array whose first row names the CDX fields; and
  public fields include `timestamp`, `original`, `mimetype`, `statuscode`, and
  `digest`. It also documents `fl` for selecting fields.
- **CDX bounds and selection:** the same CDX page states that `from` and `to`
  are inclusive 1–14 digit Wayback timestamps; `matchType` admits `exact`
  (the default), `prefix`, `host`, and `domain`; positive `limit=N` returns the
  first N results; and filters use `filter=field:regex`, including
  `statuscode:200`. The page says CDX records are usually sorted by URL and
  date. Therefore `earliestCapture` uses an exact query with `limit=1` and, by
  default, the documented 200-status filter.
- **Replay URL and timestamp:** the Save Page Now 2 public API document at
  https://docs.google.com/document/d/1Nsv52MvSjbLb2PCpHlat0gkzw0EvtSgpKHu4mk0MnrA/edit
  defines a timestamp as `YYYYMMDDHHMMSS` and documents the replay pattern
  `https://web.archive.org/web/<timestamp>/<original_url>`.
- **Authenticated Save Page Now:** the same SPN2 document states that the API
  runs at `https://web.archive.org/save`, prefers S3 API keys from
  https://archive.org/account/s3.php, uses
  `Authorization: LOW <access-key>:<secret-key>`, and accepts a form-encoded
  POST with `url=<target>`. Its example response contains `url` and `job_id`.
- **Job status:** the SPN2 document gives
  `GET https://web.archive.org/save/status/<job_id>` and documents pending,
  success, and error response examples. A successful response includes
  `timestamp` and `original_url`.
- **Anonymous capture:** the SPN2 document explicitly gives limits for
  anonymous API users (six concurrent captures and 4,000 daily captures) and
  documents GET capture requests in the form
  `https://web.archive.org/save/<target-url>`. Its concrete GET example also
  supplies login cookies, while its limits establish that anonymous API use
  exists. **Inference:** omitting both cookies and the authorization header is
  the anonymous form. The response headers and immediate replay URL shape are
  not specified by the fetched document, so the client defensively accepts a
  Wayback `/web/` URL from `Content-Location`, `Location`, the final response
  URL, or documented `timestamp` plus `original_url`; otherwise it returns
  `null`.

The SPN2 document was not directly renderable by the fetcher used during this
work. Its text was checked through the linked public mirror at
https://gist.github.com/regstuff/82e690db2f1d91ba59f6681c1abad6cf,
which identifies the source document, author (Internet Archive's Vangelis
Banos), and 2022-04-05 update date. That access limitation is disclosed rather
than treating the mirror as a separate authority.

## Usage

```js
import { earliestCapture, savePageNow, status, witness } from "@red-cup-engineering/internet-archive-services-section";

const earliest = await earliestCapture("https://example.com/essay", { fetch });
const provenance = await witness("https://example.com/essay", { fetch });

const job = await savePageNow("https://example.com/essay", {
  fetch,
  accessKey,
  secretKey,
});
const progress = await status(job.jobId, { fetch, accessKey, secretKey });
```

```sh
node scripts/earliest-capture.mjs https://example.com/essay
IA_ACCESS_KEY=... IA_SECRET_KEY=... node scripts/save-page-now.mjs https://example.com/essay
```

Both scripts print one JSON line per input URL. Without both key variables, the
save script makes the anonymous request.

## Tests

`node --test test/*.test.mjs` uses only faked fetch capabilities and
documentation-derived fixtures; it performs no network requests.
