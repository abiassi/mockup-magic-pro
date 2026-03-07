import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SignJWT } from 'jose';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body as { password?: string };
  const expected = (process.env.SITE_PASSWORD || '').trim();
  if (!password || password !== expected) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(secret);

  return res.status(200).json({ token });
}
