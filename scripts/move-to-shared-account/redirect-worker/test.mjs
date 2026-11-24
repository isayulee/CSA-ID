// node scripts/move-to-shared-account/redirect-worker/test.mjs (rehearse.sh runs it)
import assert from "node:assert/strict";
import worker from "./index.mjs";

const OLD = "https://csa-id.yuanmiguelrubio.workers.dev";
const NEW = "https://csa-id.team.workers.dev";

const cases = [
  ["/id/ana-reyes", "/id/ana-reyes"],
  ["/", "/"],
  ["/login/google/callback?code=abc&state=xyz", "/login/google/callback?code=abc&state=xyz"],
  ["/media/img/p1/avatar/1.webp", "/media/img/p1/avatar/1.webp"],
  // A protocol-relative path must not send anyone to another host.
  ["//elsewhere.example/phish", "//elsewhere.example/phish"],
];

for (const [path, expected] of cases) {
  for (const origin of [NEW, `${NEW}/`]) {
    const response = await worker.fetch(new Request(`${OLD}${path}`), { TARGET_ORIGIN: origin });
    assert.equal(response.status, 302, path);
    const location = response.headers.get("location");
    assert.equal(location, `${NEW}${expected}`, path);
    assert.equal(new URL(location).host, new URL(NEW).host, path);
  }
}

const unset = await worker.fetch(new Request(`${OLD}/id/ana-reyes`), {});
assert.equal(unset.status, 500, "an unset TARGET_ORIGIN fails loudly instead of redirecting nowhere");

console.log(`redirect worker: ${cases.length * 2 + 1} checks pass`);
