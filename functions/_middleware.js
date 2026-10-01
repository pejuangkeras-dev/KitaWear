export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.pathname.startsWith("/api/") || url.pathname === "/shipping-ui.js") {
    return context.next();
  }

  const response = await context.next();
  const type = response.headers.get("content-type") || "";

  if (!type.includes("text/html")) {
    return response;
  }

  const rewritten = new HTMLRewriter()
    .on("body", {
      element(el) {
        el.append('<script src="/shipping-ui.js" defer></script>', { html: true });
      }
    })
    .transform(response);

  const out = new Response(rewritten.body, response);
  out.headers.set("Cache-Control", "no-store");
  return out;
}
