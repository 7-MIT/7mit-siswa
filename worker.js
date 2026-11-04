// Menyajikan halaman invoice untuk /invoice/[nomor-struk]; semua path lain tetap dari aset statis.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (/^\/invoice\/[^/]+\/?$/.test(url.pathname) && (request.method === "GET" || request.method === "HEAD")) {
      const res = await env.ASSETS.fetch(new Request(new URL("/invoice-view/", url), { method: request.method, headers: request.headers }));
      const headers = new Headers(res.headers);
      headers.set("cache-control", "no-store");
      headers.set("x-robots-tag", "noindex, nofollow");
      headers.set("referrer-policy", "no-referrer");
      return new Response(res.body, { status: res.status, headers });
    }
    return env.ASSETS.fetch(request);
  },
};
