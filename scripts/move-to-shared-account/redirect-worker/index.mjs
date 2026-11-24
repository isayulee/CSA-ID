// The old account's csa-id Worker after the move. Every request goes to the same path on the new
// address, so NFC Cards written with the old address keep working until they are rewritten.
// 302, not 301: phones cache a 301 for good, and the target is itself a temporary workers.dev address.
const redirectWorker = {
  fetch(request, env) {
    const origin = String(env.TARGET_ORIGIN ?? "").replace(/\/+$/, "");
    if (!origin.startsWith("https://")) return new Response("TARGET_ORIGIN is not set", { status: 500 });
    const { pathname, search } = new URL(request.url);
    // Join the strings instead of resolving the path, so "//elsewhere.example" stays on the new host.
    return Response.redirect(`${origin}${pathname}${search}`, 302);
  },
};

export default redirectWorker;
