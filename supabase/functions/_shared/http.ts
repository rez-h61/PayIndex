export function cors(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim());
  return { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
}
export function json(req: Request, data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } }); }
