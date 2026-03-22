import { describe, it, expect } from 'vitest';

// ─── Test helpers that mirror src/index.ts logic ────────────────

// Reimplement buildPrompt transport handling (the key change we're testing)
function formatTransport(transport: string | string[]): string {
  return Array.isArray(transport) ? transport.join(', ') : transport;
}

// Reimplement the activity validation mapper
function mapActivity(a: any, i: number) {
  return {
    id: a.id || 'test-id',
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
  };
}

// Timeline helpers (mirror trip.html JS)
function toMin(t: string): number {
  const [h, m] = (t || '9:00').split(':').map(Number);
  let mins = h * 60 + (m || 0);
  if (h < 6) mins += 1440; // 00:xx-05:xx treated as next day
  return mins;
}

function computeAxisHours(activities: { time_end: string }[]): number[] {
  let maxHour = 22;
  for (const a of activities) {
    const endMin = toMin(a.time_end);
    const endHour = Math.ceil(endMin / 60);
    if (endHour > maxHour) maxHour = Math.min(endHour, 24);
  }
  const hours = [];
  for (let h = 8; h <= maxHour; h++) hours.push(h);
  return hours;
}

function getTypesPresent(activities: { type: string }[]): string[] {
  return [...new Set(activities.map(a => a.type))].filter(Boolean);
}

function transportIcon(mode: string): string {
  const icons: Record<string, string> = {
    walking: '\uD83D\uDEB6', public_transport: '\uD83D\uDE87', car: '\uD83D\uDE97',
    bike: '\uD83D\uDEB4', taxi: '\uD83D\uDE95',
  };
  return icons[(mode || '').toLowerCase()] || '\uD83D\uDEB6';
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Transport formatting (buildPrompt)', () => {
  it('formats array transport as comma-separated', () => {
    expect(formatTransport(['walking', 'public_transport'])).toBe('walking, public_transport');
  });

  it('formats single array element', () => {
    expect(formatTransport(['car'])).toBe('car');
  });

  it('passes through string transport (backward compat)', () => {
    expect(formatTransport('walking')).toBe('walking');
  });

  it('handles empty array', () => {
    expect(formatTransport([])).toBe('');
  });
});

describe('Activity mapper — travel_to_next', () => {
  it('preserves travel_to_next when present', () => {
    const raw = {
      name: 'Colosseum',
      type: 'attraction',
      time_start: '09:00',
      time_end: '11:00',
      lat: 41.89,
      lng: 12.49,
      description: 'Visit',
      travel_to_next: { mode: 'walking', duration_min: 15, distance_km: 1.2 },
    };
    const mapped = mapActivity(raw, 0);
    expect(mapped.travel_to_next).toEqual({ mode: 'walking', duration_min: 15, distance_km: 1.2 });
  });

  it('omits travel_to_next when not present', () => {
    const raw = { name: 'Last Activity', type: 'restaurant', time_start: '20:00', time_end: '22:00', lat: 41.89, lng: 12.49, description: 'Dinner' };
    const mapped = mapActivity(raw, 0);
    expect(mapped).not.toHaveProperty('travel_to_next');
  });

  it('preserves travel_to_next without distance_km', () => {
    const raw = {
      name: 'Cafe',
      type: 'cafe',
      time_start: '10:00',
      time_end: '11:00',
      lat: 41.89,
      lng: 12.49,
      description: 'Coffee',
      travel_to_next: { mode: 'public_transport', duration_min: 20 },
    };
    const mapped = mapActivity(raw, 0);
    expect(mapped.travel_to_next).toEqual({ mode: 'public_transport', duration_min: 20 });
  });
});

describe('Timeline — toMin() with midnight crossover', () => {
  it('converts normal time', () => {
    expect(toMin('09:00')).toBe(540);
    expect(toMin('14:30')).toBe(870);
    expect(toMin('22:00')).toBe(1320);
  });

  it('handles midnight crossover (00:00-05:59 = next day)', () => {
    expect(toMin('00:00')).toBe(1440); // midnight = 24*60
    expect(toMin('00:30')).toBe(1470);
    expect(toMin('01:00')).toBe(1500);
    expect(toMin('05:59')).toBe(1799);
  });

  it('does NOT offset 06:00+', () => {
    expect(toMin('06:00')).toBe(360);
    expect(toMin('07:00')).toBe(420);
  });
});

describe('Timeline — dynamic axis hours', () => {
  it('returns 8-22 for normal activities', () => {
    const acts = [
      { time_end: '11:00' },
      { time_end: '14:00' },
      { time_end: '21:30' },
    ];
    const hours = computeAxisHours(acts);
    expect(hours[0]).toBe(8);
    expect(hours[hours.length - 1]).toBe(22);
  });

  it('extends to 23 when activity ends at 22:30', () => {
    const acts = [
      { time_end: '10:00' },
      { time_end: '22:30' },
    ];
    const hours = computeAxisHours(acts);
    expect(hours[hours.length - 1]).toBe(23);
  });

  it('extends to 24 (00:00) when activity ends at midnight', () => {
    const acts = [
      { time_end: '10:00' },
      { time_end: '00:00' }, // midnight = 1440min → ceil(1440/60) = 24
    ];
    const hours = computeAxisHours(acts);
    expect(hours[hours.length - 1]).toBe(24);
  });

  it('caps at 24 for late activities', () => {
    const acts = [
      { time_end: '01:00' }, // 1500min → ceil = 25 → capped at 24
    ];
    const hours = computeAxisHours(acts);
    expect(hours[hours.length - 1]).toBe(24);
  });
});

describe('Timeline — tlTypesPresent', () => {
  it('returns unique types', () => {
    const acts = [
      { type: 'restaurant' },
      { type: 'museum' },
      { type: 'restaurant' },
      { type: 'cafe' },
    ];
    const types = getTypesPresent(acts);
    expect(types).toHaveLength(3);
    expect(types).toContain('restaurant');
    expect(types).toContain('museum');
    expect(types).toContain('cafe');
  });

  it('filters empty types', () => {
    const acts = [{ type: '' }, { type: 'park' }];
    expect(getTypesPresent(acts)).toEqual(['park']);
  });
});

describe('Transport icon lookup', () => {
  it('returns correct emoji for known modes', () => {
    expect(transportIcon('walking')).toBe('\uD83D\uDEB6');
    expect(transportIcon('car')).toBe('\uD83D\uDE97');
    expect(transportIcon('public_transport')).toBe('\uD83D\uDE87');
    expect(transportIcon('bike')).toBe('\uD83D\uDEB4');
  });

  it('defaults to walking emoji for unknown mode', () => {
    expect(transportIcon('skateboard')).toBe('\uD83D\uDEB6');
    expect(transportIcon('')).toBe('\uD83D\uDEB6');
  });
});
