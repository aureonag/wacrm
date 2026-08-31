import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 }),
  ),
}));

import { GET } from './route';

function fakeSupabase(rows: unknown[]) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return { from: vi.fn(() => query) };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
});

describe('GET /api/ai/usage', () => {
  it('aggregates a prospecting-mode row without throwing (regression: by_mode used to hardcode only auto_reply/draft)', async () => {
    const supabase = fakeSupabase([
      {
        created_at: new Date().toISOString(),
        mode: 'prospecting',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
      },
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'account-1' });

    const response = await GET(new Request('http://localhost/api/ai/usage?days=30'));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.by_mode.prospecting).toEqual({ calls: 1, tokens: 120 });
    expect(json.by_mode.auto_reply).toEqual({ calls: 0, tokens: 0 });
    expect(json.totals.total_tokens).toBe(120);
  });

  it('still aggregates the existing auto_reply/draft modes correctly', async () => {
    const supabase = fakeSupabase([
      {
        created_at: new Date().toISOString(),
        mode: 'auto_reply',
        provider: 'anthropic',
        model: 'claude-x',
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
      {
        created_at: new Date().toISOString(),
        mode: 'draft',
        provider: 'openai',
        model: 'gpt-x',
        prompt_tokens: 3,
        completion_tokens: 1,
        total_tokens: 4,
      },
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'account-1' });

    const response = await GET(new Request('http://localhost/api/ai/usage'));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.by_mode.auto_reply).toEqual({ calls: 1, tokens: 15 });
    expect(json.by_mode.draft).toEqual({ calls: 1, tokens: 4 });
    expect(json.by_mode.prospecting).toEqual({ calls: 0, tokens: 0 });
  });
});
