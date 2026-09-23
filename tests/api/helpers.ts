/** Call Next.js route handlers directly (no server) with a Request and async params. */
export async function call<P>(
  handler: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>,
  url: string,
  params: P = {} as P,
  init?: RequestInit,
) {
  const res = await handler(new Request(`http://localhost${url}`, init), { params: Promise.resolve(params) });
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("application/json") ? await res.json() : type.includes("text/") ? await res.text() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body };
}
