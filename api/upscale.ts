import type { VercelRequest, VercelResponse } from '@vercel/node';
import { jwtVerify } from 'jose';

export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } },
  maxDuration: 300,
};

async function verifyToken(req: VercelRequest): Promise<boolean> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    await jwtVerify(auth.slice(7), secret);
    return true;
  } catch { return false; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await verifyToken(req))) return res.status(401).json({ error: 'Unauthorized' });

  const { imageUrl, model = 'real-esrgan' } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'REPLICATE_API_TOKEN not configured' });

  const isClarity = model === 'clarity';
  const endpoint = isClarity
    ? 'https://api.replicate.com/v1/models/philz1337x/clarity-upscaler/predictions'
    : 'https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions';

  const input = isClarity
    ? { image: imageUrl, scale_factor: 2, creativity: 0.15, resemblance: 0.9,
        prompt: 'high resolution, sharp details, professional photography',
        negative_prompt: 'blurry, artifacts, noise' }
    : { image: imageUrl, scale: 4, face_enhance: false };

  const createRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=55',
    },
    body: JSON.stringify({ input }),
  });

  const prediction = await createRes.json();
  if (!createRes.ok) return res.status(500).json({ error: prediction.detail || 'Replicate error' });

  let result = prediction;
  // Poll up to ~220s (55s Prefer wait + 60×3s) — stays within maxDuration: 300
  for (let i = 0; i < 60 && result.status !== 'succeeded' && result.status !== 'failed'; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    result = await poll.json();
  }

  if (result.status !== 'succeeded') {
    return res.status(500).json({ error: result.error || 'Upscale timed out' });
  }

  const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;

  // Return the Replicate URL directly — the client downloads and converts to a
  // persistent data URL in the browser. Avoids loading 80MB+ images into lambda memory.
  return res.status(200).json({ upscaledUrl: outputUrl });
}
