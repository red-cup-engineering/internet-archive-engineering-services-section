import assert from "node:assert/strict";
import test from "node:test";
import { captureDate, captureUrl } from "@red-cup-engineering/internet-archive-engineering-services-section";

test("INTERNET-ARCHIVE-SERVICES-SECTION-QUICKSTART", () => {
  assert.equal(captureUrl("20210202030405", "https://example.com/"), "https://web.archive.org/web/20210202030405/https://example.com/");
  assert.equal(captureDate("20210202030405"), "2021-02-02T03:04:05.000Z");
  assert.throws(() => captureDate("20210230030405"), /valid UTC calendar date/u);
});
