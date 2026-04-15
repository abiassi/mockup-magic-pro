import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Mock jose before importing handler
vi.mock('jose', () => ({
  jwtVerify: vi.fn().mockResolvedValue({}),
}));

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
    body: { imageUrl: 'https://example.com/image.png', model: 'real-esrgan' },
    ...overrides,
  } as unknown as VercelRequest;
}

function makeRes() {
  const res = { _status: 200, _body: {} } as any;
  res.status = (code: number) => { res._status = code; return res; };
  res.json = (body: any) => { res._body = body; return res; };
  return res as VercelResponse & { _status: number; _body: any };
}

describe('POST /api/upscale', () => {
  let handler: typeof import('./upscale').default;
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv, REPLICATE_API_TOKEN: 'test-token' };
    // Re-mock jose after resetModules
    vi.mock('jose', () => ({ jwtVerify: vi.fn().mockResolvedValue({}) }));
    handler = (await import('./upscale')).default;
  });

  it('returns 405 for non-POST methods', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res._status).toBe(405);
  });

  it('returns 400 when imageUrl is missing', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { model: 'real-esrgan' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/imageUrl/i);
  });

  it('returns 500 when REPLICATE_API_TOKEN is not set', async () => {
    process.env = { ...originalEnv };
    delete process.env.REPLICATE_API_TOKEN;
    vi.resetModules();
    vi.mock('jose', () => ({ jwtVerify: vi.fn().mockResolvedValue({}) }));
    handler = (await import('./upscale')).default;
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/REPLICATE_API_TOKEN/i);
  });

  it('returns Replicate URL directly (no server-side image download)', async () => {
    const replicateUrl = 'https://replicate.delivery/output/image.png';
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-123', status: 'succeeded', output: replicateUrl }),
      }) as any;

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(200);
    expect(res._body.upscaledUrl).toBe(replicateUrl);
    // fetch should have been called exactly once (to create the prediction)
    // NOT called again to download the image
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it('handles array output from Replicate', async () => {
    const replicateUrl = 'https://replicate.delivery/output/image.png';
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-123', status: 'succeeded', output: [replicateUrl] }),
      }) as any;

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(200);
    expect(res._body.upscaledUrl).toBe(replicateUrl);
  });

  it('polls until prediction succeeds and returns URL', async () => {
    vi.useFakeTimers();
    const replicateUrl = 'https://replicate.delivery/output/image.png';
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-123', status: 'processing' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-123', status: 'succeeded', output: replicateUrl }),
      }) as any;

    const handlerPromise = handler(makeReq(), makeRes());
    await vi.runAllTimersAsync();
    const res = makeRes();
    // Run handler fresh so we can capture the response
    vi.useRealTimers();

    // Simpler: just re-run with real timers but fetch already mocked
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-123', status: 'processing' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-123', status: 'succeeded', output: replicateUrl }),
      }) as any;

    // Use fake timers to skip the 3s sleep
    vi.useFakeTimers();
    const p = handler(makeReq(), res);
    await vi.runAllTimersAsync();
    await p;
    vi.useRealTimers();

    expect(res._status).toBe(200);
    expect(res._body.upscaledUrl).toBe(replicateUrl);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
  });

  it('propagates Replicate billing/error messages to client', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'insufficient credit' }),
      }) as any;

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(500);
    expect(res._body.error).toContain('insufficient credit');
  });

  it('returns 500 if prediction fails', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-123', status: 'failed', error: 'Model error' }),
      }) as any;

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(500);
    expect(res._body.error).toContain('Model error');
  });
});
