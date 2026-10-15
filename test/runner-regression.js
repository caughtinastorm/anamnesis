import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Run the real harness with asynchronous success and failure cases injected.
// Keep the fixture beside the suite so its relative imports remain valid.
const suiteURL = new URL("./run-tests.js", import.meta.url);
const fixtureURL = new URL(`./runner-fixture-${process.pid}.js`, import.meta.url);
const summaryMarker = 'console.log(`\\nResults:';
const source = readFileSync(suiteURL, "utf8");
assert.ok(source.includes(summaryMarker), "Suite summary marker must exist");

const cases = `
await runTest("runner regression: async success", async () => {
  await new Promise(resolve => setTimeout(resolve, 10));
});
await runTest("runner regression: async failure", async () => {
  await new Promise(resolve => setTimeout(resolve, 10));
  throw new Error("EXPECTED_ASYNC_FAILURE");
});
`;

try {
  writeFileSync(fixtureURL, source.replace(summaryMarker, cases + summaryMarker));
  const result = spawnSync(process.execPath, [fileURLToPath(fixtureURL)], {
    encoding: "utf8",
    timeout: 30_000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, "Async failure must produce a failing exit code");
  assert.ok(result.stdout.includes("✓ runner regression: async success"));
  assert.ok(!result.stdout.includes("✓ runner regression: async failure"));
  assert.ok(!result.stdout.includes("ALL TESTS PASSED SUCCESSFULLY"));
  assert.ok(result.stderr.includes("EXPECTED_ASYNC_FAILURE"));
  assert.ok(!result.stderr.includes("ENOENT"), "Suite paths must be portable");
  const summary = result.stdout.match(/Results: (\d+) passed \/ (\d+) total/);
  assert.ok(summary, "Summary must be emitted after tests finish");
  assert.equal(Number(summary[2]) - Number(summary[1]), 1);
  assert.ok(result.stdout.indexOf("runner regression: async success") < summary.index);
  console.log("✓ Runner regression: awaits async tests and reports failures correctly");
} finally {
  unlinkSync(fixtureURL);
}
