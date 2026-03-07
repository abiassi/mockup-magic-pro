import type { VercelRequest, VercelResponse } from '@vercel/node';
import { jwtVerify } from 'jose';
import { neon } from '@neondatabase/serverless';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

async function verifyToken(req: VercelRequest): Promise<boolean> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await verifyToken(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.DATABASE_URL!);

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT
        id,
        image_url AS "imageUrl",
        prompt,
        created_at AS "createdAt",
        is_high_res AS "isHighRes",
        is_contact_sheet AS "isContactSheet",
        extracted_from AS "extractedFrom",
        camera_angle AS "cameraAngle",
        variant_type AS "variantType",
        aspect_ratio AS "aspectRatio",
        refined_from AS "refinedFrom",
        composite_base_url AS "compositeBaseUrl",
        composite_artwork_url AS "compositeArtworkUrl"
      FROM mockup_results
      ORDER BY created_at DESC
    `;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const r = req.body as {
      id: string;
      imageUrl: string;
      prompt: string;
      createdAt: number;
      isHighRes?: boolean;
      isContactSheet?: boolean;
      extractedFrom?: string;
      cameraAngle?: string;
      variantType?: string;
      aspectRatio?: string;
      refinedFrom?: string;
      compositeBaseUrl?: string;
      compositeArtworkUrl?: string;
    };
    await sql`
      INSERT INTO mockup_results (
        id, image_url, prompt, created_at,
        is_high_res, is_contact_sheet, extracted_from, camera_angle,
        variant_type, aspect_ratio, refined_from,
        composite_base_url, composite_artwork_url
      ) VALUES (
        ${r.id}, ${r.imageUrl}, ${r.prompt}, ${r.createdAt},
        ${r.isHighRes ?? null}, ${r.isContactSheet ?? null}, ${r.extractedFrom ?? null}, ${r.cameraAngle ?? null},
        ${r.variantType ?? null}, ${r.aspectRatio ?? null}, ${r.refinedFrom ?? null},
        ${r.compositeBaseUrl ?? null}, ${r.compositeArtworkUrl ?? null}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    return res.status(201).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query as { id?: string };
    if (!id) return res.status(400).json({ error: 'Missing id' });
    await sql`DELETE FROM mockup_results WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
