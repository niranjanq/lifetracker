
interface Env {
  BACKEND_URL: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

export const onRequest = async ({
  request,
  env,
}: PagesContext): Promise<Response> => {
  if (!env?.BACKEND_URL) {
    return Response.json(
      { detail: "BACKEND_URL is not configured" },
      { status: 500 }
    );
  }

  const backend = env.BACKEND_URL.replace(/\/+$/, "");
  const incoming = new URL(request.url);

  const target = new URL(
    `${incoming.pathname}${incoming.search}`,
    `${backend}/`
  );

  const headers = new Headers(request.headers);
  headers.delete("host");

  const upstreamRequest = new Request(target, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
  });

  const upstream = await fetch(upstreamRequest);

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("access-control-allow-origin");
  responseHeaders.delete("access-control-allow-credentials");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
