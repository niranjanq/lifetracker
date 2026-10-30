interface Env {
  BACKEND_URL: string;
}

const handler = async (
  request: Request,
  env: Env
): Promise<Response> => {
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

export const onRequest = handler;
