export function json(data, maxAge = 0) {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (maxAge > 0) headers['cache-control'] = `public, max-age=${maxAge}`;
  return new Response(JSON.stringify(data), { headers });
}
