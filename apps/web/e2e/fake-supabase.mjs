// A stand-in for Supabase's Auth endpoint, for the proxy's server-side getUser only. The browser's
// own Supabase traffic (Auth and the Realtime websocket) is answered inside each test instead.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_SUPABASE_PORT ?? 3499);
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  is_anonymous: true,
  user_metadata: { display_name: 'Amna' },
  app_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url?.startsWith('/auth/v1/user')) return res.end(JSON.stringify(user));
  res.end('{}');
}).listen(port, '127.0.0.1');
