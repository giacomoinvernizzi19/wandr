export interface Env {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GEMINI_API_KEY: string;
}

// ─── Helpers ────────────────────────────────────────────────────────
function uuid(): string { return crypto.randomUUID(); }

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(header.split(';').map(c => {
    const [k, ...v] = c.trim().split('=');
    return [k, v.join('=')];
  }));
}

function slugify(len = 8): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}

function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

// ─── Auth ───────────────────────────────────────────────────────────
interface AuthUser {
  id: string;
  google_id: string;
  email: string;
  name: string;
  picture: string | null;
}

async function getUser(request: Request, env: Env): Promise<AuthUser | null> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const token = cookies['session'];
  if (!token) return null;
  const row = await env.DB.prepare(`
    SELECT u.id, u.google_id, u.email, u.name, u.picture
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).bind(token).first<AuthUser>();
  return row || null;
}

function sessionCookie(token: string, maxAge: number): string {
  return `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// ─── Gemini ─────────────────────────────────────────────────────────
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface Activity {
  id: string;
  order: number;
  name: string;
  type: string;
  time_start: string;
  time_end: string;
  duration_min: number;
  description: string;
  why: string;
  tip: string;
  cost_level: string;
  cost_estimate: string;
  lat: number;
  lng: number;
  address: string;
  pinned: boolean;
  website: string;
  hidden_gem_score: number;
  travel_to_next?: { mode: string; duration_min: number; distance_km?: number };
}

function buildPrompt(prefs: any, dayNum: number, totalDays: number, pinnedActivities: Activity[] = []): string {
  const budgetMap: Record<string, string> = { backpacker: 'budget-friendly', moderate: 'mid-range', luxury: 'high-end luxury' };
  const compMap: Record<string, string> = { solo: 'a solo traveler', couple: 'a couple', friends: 'a group of friends', family: 'a family with children' };

  let prompt = `You are Wandr, an expert travel planner for independent travelers who want authentic local experiences.

TRIP CONTEXT:
- Destination: ${prefs.destination}
- Day ${dayNum} of ${totalDays}
- Budget: ${budgetMap[prefs.budget] || prefs.budget}
- Traveler: ${compMap[prefs.companions] || prefs.companions}
- Intensity: ${prefs.intensity}/10 (1=very relaxed, 10=packed schedule)
- Niche level: ${prefs.niche}/10 (1=mainstream highlights, 10=hidden gems only)
- Interests: ${(prefs.interests || []).join(', ')}
- Transport: ${Array.isArray(prefs.transport) ? prefs.transport.join(', ') : prefs.transport}`;

  if (prefs.accommodation) prompt += `\n- Staying at: ${prefs.accommodation}`;
  if (prefs.notes) prompt += `\n- Special notes: ${prefs.notes}`;
  if (prefs.start_date) prompt += `\n- Date: ${prefs.start_date} + ${dayNum - 1} days`;

  if (pinnedActivities.length > 0) {
    prompt += `\n\nPINNED ACTIVITIES (keep these exactly, fill gaps around them):\n`;
    pinnedActivities.forEach(a => {
      prompt += `- ${a.time_start}-${a.time_end}: "${a.name}" at [${a.lat}, ${a.lng}]\n`;
    });
  }

  const activityCount = Math.max(3, Math.min(8, Math.round(prefs.intensity * 0.8)));

  prompt += `\n\nGENERATE exactly ${activityCount} activities for this day.
${pinnedActivities.length > 0 ? 'Keep pinned activities in their time slots. Fill remaining time with new suggestions.' : ''}

RULES:
- Prioritize REAL places with accurate coordinates and addresses
- Anti-tourist-trap: prefer places locals actually go to
- Logical geographic flow (minimize backtracking)
- Mix activity types: meals, sights, experiences
- Include time for walking/transit between places
- Morning activities from ~9:00, end by ~22:00
- Each activity needs real latitude/longitude coordinates for ${prefs.destination}

RESPOND WITH ONLY a valid JSON array. Each object must have these exact fields:
{
  "id": "unique-string",
  "order": 1,
  "name": "Place Name",
  "type": "attraction|restaurant|cafe|bar|market|park|museum|viewpoint|experience",
  "time_start": "09:00",
  "time_end": "10:30",
  "duration_min": 90,
  "description": "What you'll do here",
  "why": "Why this place is worth visiting",
  "tip": "Practical tip for the visitor",
  "cost_level": "free|$|$$|$$$",
  "cost_estimate": "Free or ~10-15 EUR",
  "lat": 41.9028,
  "lng": 12.4964,
  "address": "Via Example 1, City",
  "pinned": false,
  "website": "https://example.com or empty string if unknown",
  "hidden_gem_score": 7,
  "travel_to_next": { "mode": "walking", "duration_min": 15, "distance_km": 1.2 }
}

TRAVEL_TO_NEXT RULES:
- Required for all activities EXCEPT the last of the day
- mode must match user's transport preferences (${Array.isArray(prefs.transport) ? prefs.transport.join(', ') : prefs.transport})
- The gap between one activity's time_end and next activity's time_start should equal travel_to_next.duration_min
- distance_km is the approximate distance between the two places

SCORING GUIDE:
- hidden_gem_score (1-10): 1 = mainstream tourist must-see (e.g. Colosseum), 10 = only locals know about it
- website: official website URL if you know it, otherwise empty string`;

  return prompt;
}

async function callGemini(prompt: string, apiKey: string): Promise<Activity[]> {
  const resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 1.0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              order: { type: 'INTEGER' },
              name: { type: 'STRING' },
              type: { type: 'STRING' },
              time_start: { type: 'STRING' },
              time_end: { type: 'STRING' },
              duration_min: { type: 'INTEGER' },
              description: { type: 'STRING' },
              why: { type: 'STRING' },
              tip: { type: 'STRING' },
              cost_level: { type: 'STRING' },
              cost_estimate: { type: 'STRING' },
              lat: { type: 'NUMBER' },
              lng: { type: 'NUMBER' },
              address: { type: 'STRING' },
              pinned: { type: 'BOOLEAN' },
              website: { type: 'STRING' },
              hidden_gem_score: { type: 'INTEGER' },
              travel_to_next: {
                type: 'OBJECT',
                properties: {
                  mode: { type: 'STRING' },
                  duration_min: { type: 'INTEGER' },
                  distance_km: { type: 'NUMBER' },
                },
                required: ['mode', 'duration_min'],
              },
            },
            required: ['name', 'order', 'time_start', 'time_end', 'lat', 'lng', 'description', 'type'],
          },
        },
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${text.substring(0, 200)}`);
  }

  const data = await resp.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    // Log the full response for debugging
    const debugInfo = JSON.stringify({
      candidates: data.candidates?.map((c: any) => ({
        content: c.content,
        finishReason: c.finishReason,
      })),
      modelVersion: data.modelVersion,
    }).substring(0, 500);
    throw new Error(`No content in Gemini response: ${debugInfo}`);
  }

  // Try parse directly, or extract JSON from markdown code block
  let activities: Activity[];
  try {
    activities = JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      activities = JSON.parse(match[1]);
    } else {
      const arrMatch = text.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        activities = JSON.parse(arrMatch[0]);
      } else {
        throw new Error('Could not parse Gemini response as JSON');
      }
    }
  }

  if (!Array.isArray(activities)) throw new Error('Gemini response is not an array');
  if (activities.length === 0) throw new Error(`Gemini returned empty array. Raw text: ${text.substring(0, 300)}`);

  // Validate and assign IDs
  return activities.map((a: any, i: number) => ({
    id: a.id || uuid(),
    order: a.order || i + 1,
    name: a.name || 'Unknown',
    type: a.type || 'attraction',
    time_start: a.time_start || '09:00',
    time_end: a.time_end || '10:00',
    duration_min: a.duration_min || 60,
    description: a.description || '',
    why: a.why || '',
    tip: a.tip || '',
    cost_level: a.cost_level || 'free',
    cost_estimate: a.cost_estimate || '',
    lat: Number(a.lat) || 0,
    lng: Number(a.lng) || 0,
    address: a.address || '',
    pinned: a.pinned || false,
    website: a.website || '',
    hidden_gem_score: Number(a.hidden_gem_score) || 0,
    ...(a.travel_to_next ? { travel_to_next: a.travel_to_next } : {}),
  }));
}

// ─── Route Handler ─────────────────────────────────────────────────
type Handler = (req: Request, env: Env, user: AuthUser | null, params: Record<string, string>) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const patternStr = path
    .replace(/:(\w+)\*/g, (_, k) => { keys.push(k); return '(.+)'; })
    .replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  const pattern = new RegExp('^' + patternStr + '$');
  routes.push({ method, pattern, keys, handler });
}

function matchRoute(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method && r.method !== 'ALL') continue;
    const m = pathname.match(r.pattern);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => params[k] = m[i + 1]);
      return { handler: r.handler, params };
    }
  }
  return null;
}

// ═══ API Routes ═══════════════════════════════════════════════════

// ─── Auth: Google OAuth ─────────────────────────────────────────────

// GET /api/auth/google - Redirect to Google consent
route('GET', '/api/auth/google', async (req, env) => {
  const state = uuid();
  const base = getBaseUrl(req);
  const redirectUri = `${base}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
});

// GET /api/auth/google/callback - Exchange code for tokens
route('GET', '/api/auth/google/callback', async (req, env) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) return new Response(`Auth error: ${errorParam}`, { status: 400 });
  if (!code || !state) return new Response('Missing code or state', { status: 400 });

  // Verify state
  const cookies = parseCookies(req.headers.get('Cookie'));
  if (cookies['oauth_state'] !== state) return new Response('State mismatch', { status: 400 });

  const base = getBaseUrl(req);
  const redirectUri = `${base}/api/auth/google/callback`;

  // Exchange code for tokens
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    return new Response(`Token exchange failed: ${text}`, { status: 500 });
  }

  const tokens = await tokenResp.json() as { access_token: string };

  // Fetch user info
  const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userResp.ok) return new Response('Failed to get user info', { status: 500 });
  const gUser = await userResp.json() as { id: string; email: string; name: string; picture: string };

  // Find or create user
  let user = await env.DB.prepare('SELECT id FROM users WHERE google_id = ?').bind(gUser.id).first<{ id: string }>();

  if (!user) {
    const userId = uuid();
    await env.DB.prepare(
      'INSERT INTO users (id, google_id, email, name, picture) VALUES (?, ?, ?, ?, ?)'
    ).bind(userId, gUser.id, gUser.email, gUser.name, gUser.picture || null).run();
    user = { id: userId };
  } else {
    // Update profile
    await env.DB.prepare(
      'UPDATE users SET email = ?, name = ?, picture = ? WHERE google_id = ?'
    ).bind(gUser.email, gUser.name, gUser.picture || null, gUser.id).run();
  }

  // Create session (invalidate old ones first)
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  const sessionToken = uuid();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionToken, user.id, expiresAt).run();

  // Check for pending trip to claim
  const pendingTripCookie = cookies['pending_trip'];

  // Clear oauth state, set session, redirect
  const setCookies = [
    sessionCookie(sessionToken, 30 * 24 * 3600),
    'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ...(pendingTripCookie ? ['pending_trip=; Path=/; SameSite=Lax; Max-Age=0'] : []),
  ];

  const redirectTo = pendingTripCookie ? `/trip?id=${pendingTripCookie}` : '/my-trips';

  return new Response(null, {
    status: 302,
    headers: [
      ['Location', redirectTo],
      ...setCookies.map(c => ['Set-Cookie', c] as [string, string]),
    ],
  });
});

// POST /api/auth/logout
route('POST', '/api/auth/logout', async (req, env) => {
  const cookies = parseCookies(req.headers.get('Cookie'));
  if (cookies['session']) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(cookies['session']).run();
  }
  return json({ ok: true }, 200, {
    'Set-Cookie': sessionCookie('', 0),
  });
});

// GET /api/me
route('GET', '/api/me', async (req, env, user) => {
  if (!user) return json({ user: null });
  return json({ user: { id: user.id, name: user.name, email: user.email, picture: user.picture } });
});

// ─── Trips CRUD ─────────────────────────────────────────────────────

// POST /api/trips - Create trip
route('POST', '/api/trips', async (req, env, user) => {
  const body = await req.json() as any;
  if (!body.destination || !body.num_days) return err('destination and num_days required');
  if (body.num_days < 1 || body.num_days > 7) return err('num_days must be 1-7');

  const id = uuid();
  const shareSlug = slugify(8);

  await env.DB.prepare(
    `INSERT INTO trips (id, user_id, share_slug, destination, destination_lat, destination_lng, start_date, end_date, num_days, preferences_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`
  ).bind(
    id, user?.id || null, shareSlug,
    body.destination, body.destination_lat || null, body.destination_lng || null,
    body.start_date || null, body.end_date || null, body.num_days,
    JSON.stringify(body.preferences || body),
  ).run();

  return json({ id, share_slug: shareSlug }, 201);
});

// GET /api/trips - List my trips
route('GET', '/api/trips', async (req, env, user) => {
  if (!user) return err('Unauthorized', 401);
  const { results } = await env.DB.prepare(
    'SELECT id, destination, destination_lat, destination_lng, start_date, end_date, num_days, status, share_slug, created_at FROM trips WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  return json(results);
});

// GET /api/trips/:id - Get trip detail
route('GET', '/api/trips/:id', async (req, env, user, params) => {
  const trip = await env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(params.id).first();
  if (!trip) return err('Not found', 404);

  // Allow owner or public access
  const { results: days } = await env.DB.prepare(
    'SELECT * FROM trip_days WHERE trip_id = ? ORDER BY day_number'
  ).bind(params.id).all();

  return json({ ...trip, days });
});

// DELETE /api/trips/:id
route('DELETE', '/api/trips/:id', async (req, env, user, params) => {
  if (!user) return err('Unauthorized', 401);
  await env.DB.prepare('DELETE FROM trips WHERE id = ? AND user_id = ?').bind(params.id, user.id).run();
  return json({ ok: true });
});

// PUT /api/trips/:id/claim - Claim anonymous trip after login
route('PUT', '/api/trips/:id/claim', async (req, env, user, params) => {
  if (!user) return err('Unauthorized', 401);
  await env.DB.prepare(
    'UPDATE trips SET user_id = ? WHERE id = ? AND user_id IS NULL'
  ).bind(user.id, params.id).run();
  return json({ ok: true });
});

// ─── Generation ─────────────────────────────────────────────────────

// POST /api/trips/:id/generate - Generate all days
route('POST', '/api/trips/:id/generate', async (req, env, user, params) => {
  const trip = await env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(params.id).first<any>();
  if (!trip) return err('Trip not found', 404);
  if (trip.user_id && user?.id !== trip.user_id) return err('Forbidden', 403);

  const prefs = JSON.parse(trip.preferences_json);

  // Optimistic lock: only start if status is draft (or stuck generating for >60s)
  const lockResult = await env.DB.prepare(
    `UPDATE trips SET status = 'generating', updated_at = datetime('now') WHERE id = ?
     AND (status = 'draft' OR (status = 'generating' AND updated_at < datetime('now', '-60 seconds')))`
  ).bind(params.id).run();
  if (!lockResult.meta.changes) return err('Trip generation already in progress', 409);

  try {
    for (let day = 1; day <= trip.num_days; day++) {
      const prompt = buildPrompt(prefs, day, trip.num_days);
      const activities = await callGemini(prompt, env.GEMINI_API_KEY);
      const dayId = uuid();

      // Calculate date for this day
      let dateStr = null;
      if (trip.start_date) {
        const d = new Date(trip.start_date);
        d.setDate(d.getDate() + day - 1);
        dateStr = d.toISOString().substring(0, 10);
      }

      await env.DB.prepare(
        `INSERT OR REPLACE INTO trip_days (id, trip_id, day_number, date, activities_json, generated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).bind(dayId, params.id, day, dateStr, JSON.stringify(activities)).run();
    }

    await env.DB.prepare("UPDATE trips SET status = 'complete', updated_at = datetime('now') WHERE id = ?").bind(params.id).run();
    return json({ ok: true, days: trip.num_days });
  } catch (e: any) {
    await env.DB.prepare("UPDATE trips SET status = 'draft', updated_at = datetime('now') WHERE id = ?").bind(params.id).run();
    return err('Generation failed: ' + (e.message || ''), 500);
  }
});

// POST /api/trips/:id/days/:dayNum/refresh - Refresh unpinned activities
route('POST', '/api/trips/:id/days/:dayNum/refresh', async (req, env, user, params) => {
  const trip = await env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(params.id).first<any>();
  if (!trip) return err('Trip not found', 404);
  if (trip.user_id && user?.id !== trip.user_id) return err('Forbidden', 403);

  const body = await req.json() as { pinned_activities: Activity[] };
  const prefs = JSON.parse(trip.preferences_json);

  const prompt = buildPrompt(prefs, parseInt(params.dayNum), trip.num_days, body.pinned_activities || []);
  const activities = await callGemini(prompt, env.GEMINI_API_KEY);

  // Merge: keep pinned, replace unpinned
  const pinned = (body.pinned_activities || []).map(a => ({ ...a, pinned: true }));
  const unpinned = activities.filter(a => !pinned.some(p => p.id === a.id));
  const merged = [...pinned, ...unpinned].sort((a, b) => {
    const tA = a.time_start.replace(':', '');
    const tB = b.time_start.replace(':', '');
    return tA.localeCompare(tB);
  }).map((a, i) => ({ ...a, order: i + 1 }));

  // Save
  await env.DB.prepare(
    `UPDATE trip_days SET activities_json = ?, generated_at = datetime('now')
     WHERE trip_id = ? AND day_number = ?`
  ).bind(JSON.stringify(merged), params.id, parseInt(params.dayNum)).run();

  return json({ activities: merged });
});

// PUT /api/trips/:id/days/:dayNum - Save activities (pin states)
route('PUT', '/api/trips/:id/days/:dayNum', async (req, env, user, params) => {
  const trip = await env.DB.prepare('SELECT user_id FROM trips WHERE id = ?').bind(params.id).first<any>();
  if (!trip) return err('Trip not found', 404);
  if (trip.user_id && user?.id !== trip.user_id) return err('Forbidden', 403);

  const body = await req.json() as { activities: Activity[] };

  await env.DB.prepare(
    'UPDATE trip_days SET activities_json = ? WHERE trip_id = ? AND day_number = ?'
  ).bind(JSON.stringify(body.activities), params.id, parseInt(params.dayNum)).run();

  return json({ ok: true });
});

// ─── Share ──────────────────────────────────────────────────────────

// GET /api/share/:slug
route('GET', '/api/share/:slug', async (req, env, user, params) => {
  const trip = await env.DB.prepare('SELECT * FROM trips WHERE share_slug = ?').bind(params.slug).first<any>();
  if (!trip) return err('Trip not found', 404);

  const { results: days } = await env.DB.prepare(
    'SELECT * FROM trip_days WHERE trip_id = ? ORDER BY day_number'
  ).bind(trip.id).all();

  // Get creator name
  let creatorName = 'Anonymous';
  if (trip.user_id) {
    const creator = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(trip.user_id).first<{ name: string }>();
    if (creator) creatorName = creator.name;
  }

  return json({ ...trip, days, creator_name: creatorName });
});

// ─── Nominatim Proxy (avoid CORS + rate limit) ─────────────────────

route('GET', '/api/geocode', async (req, env) => {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  if (!q || q.length < 2) return json([]);

  const resp = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`,
    { headers: { 'User-Agent': 'Wandr/1.0 (travel planner)' } }
  );

  if (!resp.ok) return json([]);
  const data = await resp.json() as any[];

  return json(data.map((r: any) => ({
    display: r.display_name,
    name: r.name || r.display_name.split(',')[0],
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    country: r.address?.country,
  })));
});

// ═══ Main Handler ═══════════════════════════════════════════════════

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith('/api/')) {
      const user = await getUser(request, env);
      const match = matchRoute(request.method, pathname);
      if (match) {
        try {
          return await match.handler(request, env, user, match.params);
        } catch (e: any) {
          console.error('API error:', e);
          return json({ error: e.message || 'Internal error' }, 500);
        }
      }
      return err('Not found', 404);
    }

    return new Response('Not found', { status: 404 });
  },
};
