import type { VercelRequest, VercelResponse } from '@vercel/node';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { neon } from '@neondatabase/serverless';
import {
  serverGenerateMockup,
  serverGenerateComposite,
  serverAnalyzeArtwork,
} from './_lib/geminiServerService';
import type { GenerationSettings, AnalysisVibe } from '../types';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
  maxDuration: 60,
};

function createServer(): McpServer {
  const mcp = new McpServer({
    name: 'mockup-magic-pro',
    version: '1.0.0',
  });

  const getSql = () => neon(process.env.DATABASE_URL!);

  // --- generate_mockup ---
  // @ts-expect-error — TS2589: deep type instantiation with complex zod schemas in MCP SDK generics
  mcp.tool(
    'generate_mockup',
    'Generate AI mockup images from artwork. Returns array of {id, imageUrl}.',
    {
      artwork_base64: z.string().describe('Base64-encoded artwork image (with or without data URL prefix)'),
      prompt: z.string().describe('Description of the mockup scene'),
      aspect_ratio: z.enum(['1:1', '3:4', '4:3', '16:9', '9:16']).optional().describe('Output aspect ratio'),
      camera_angle: z.string().optional().describe('Camera angle for the mockup'),
      frame_style: z.enum(['Auto', 'None', 'Sleek Black', 'Modern White', 'Natural Oak', 'Classic Gold', 'Industrial Metal']).optional(),
      lighting: z.enum(['Auto', 'Natural Daylight', 'Soft Morning', 'Golden Hour', 'Studio Lighting', 'Moody Dim']).optional(),
      wall_texture: z.enum(['Auto', 'Clean Drywall', 'Exposed Brick', 'Raw Concrete', 'Smooth Plaster', 'Wooden Paneling']).optional(),
      count: z.number().min(1).max(4).optional().describe('Number of mockups to generate (1-4)'),
    },
    async (args) => {
      const settings: GenerationSettings = {
        prompt: args.prompt,
        negativePrompt: '',
        count: args.count ?? 1,
        aspectRatio: args.aspect_ratio ?? '3:4',
        imageSize: '2K',
        frameStyle: args.frame_style ?? 'Auto',
        lighting: args.lighting ?? 'Auto',
        wallTexture: args.wall_texture ?? 'Auto',
        printSize: 'A2',
        generationMode: 'batch',
      };

      const images = await serverGenerateMockup(args.artwork_base64, settings);
      const sql = getSql();
      const results: { id: string; imageUrl: string }[] = [];

      for (const imageUrl of images) {
        const id = crypto.randomUUID();
        const createdAt = Date.now();
        await sql`
          INSERT INTO mockup_results (id, image_url, prompt, created_at, aspect_ratio, camera_angle)
          VALUES (${id}, ${imageUrl}, ${args.prompt}, ${createdAt}, ${settings.aspectRatio}, ${args.camera_angle ?? null})
          ON CONFLICT (id) DO NOTHING
        `;
        results.push({ id, imageUrl });
      }

      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }
  );

  // --- generate_composite ---
  mcp.tool(
    'generate_composite',
    'Generate a composite mockup by placing artwork onto a base scene image.',
    {
      base_image_base64: z.string().describe('Base64-encoded base/scene image'),
      artwork_base64: z.string().describe('Base64-encoded artwork to composite'),
      instructions: z.string().describe('Instructions for how to place the artwork'),
      aspect_ratio: z.string().optional().describe('Output aspect ratio'),
    },
    async (args) => {
      const images = await serverGenerateComposite(
        args.base_image_base64,
        args.artwork_base64,
        args.instructions,
        args.aspect_ratio ?? '3:4',
        '2K'
      );
      const imageUrl = images[0];
      const sql = getSql();
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      await sql`
        INSERT INTO mockup_results (
          id, image_url, prompt, created_at, aspect_ratio,
          variant_type, composite_base_url, composite_artwork_url
        ) VALUES (
          ${id}, ${imageUrl}, ${args.instructions}, ${createdAt},
          ${args.aspect_ratio ?? null}, ${'composite'},
          ${args.base_image_base64.slice(0, 100)}, ${args.artwork_base64.slice(0, 100)}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      return { content: [{ type: 'text', text: JSON.stringify({ id, imageUrl }) }] };
    }
  );

  // --- analyze_artwork ---
  mcp.tool(
    'analyze_artwork',
    'Analyze artwork and return prompt suggestions for mockup generation.',
    {
      artwork_base64: z.string().describe('Base64-encoded artwork image'),
      vibe: z.enum([
        'Industrial & Raw',
        'Modern & Minimalist',
        'Cozy & Bohemian',
        'Luxury & High-end',
        'Public & Street',
        'Surprise Me',
      ]).optional().describe('Desired vibe/style for the suggestions'),
    },
    async (args) => {
      const suggestions = await serverAnalyzeArtwork(
        args.artwork_base64,
        args.vibe as AnalysisVibe | undefined
      );
      return { content: [{ type: 'text', text: JSON.stringify(suggestions) }] };
    }
  );

  // --- list_mockups ---
  mcp.tool(
    'list_mockups',
    'List mockup metadata (without image data) from the database.',
    {
      limit: z.number().min(1).max(100).optional().describe('Max results (default 20)'),
      offset: z.number().min(0).optional().describe('Offset for pagination (default 0)'),
    },
    async (args) => {
      const sql = getSql();
      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;
      const rows = await sql`
        SELECT
          id,
          prompt,
          created_at AS "createdAt",
          is_high_res AS "isHighRes",
          is_contact_sheet AS "isContactSheet",
          camera_angle AS "cameraAngle",
          variant_type AS "variantType",
          aspect_ratio AS "aspectRatio"
        FROM mockup_results
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    }
  );

  // --- get_mockup ---
  mcp.tool(
    'get_mockup',
    'Get a single mockup by ID, including the full image URL.',
    {
      id: z.string().describe('Mockup ID'),
    },
    async (args) => {
      const sql = getSql();
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
        WHERE id = ${args.id}
      `;
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Mockup not found' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(rows[0]) }] };
    }
  );

  // --- delete_mockup ---
  mcp.tool(
    'delete_mockup',
    'Delete a mockup by ID.',
    {
      id: z.string().describe('Mockup ID to delete'),
    },
    async (args) => {
      const sql = getSql();
      await sql`DELETE FROM mockup_results WHERE id = ${args.id}`;
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: args.id }) }] };
    }
  );

  // --- upscale_mockup ---
  // @ts-expect-error — TS2589: deep type instantiation with complex zod schemas in MCP SDK generics
  mcp.tool(
    'upscale_mockup',
    'Upscale a mockup image using AI super-resolution.',
    {
      image_base64: z.string().describe('Base64-encoded image (data URL) to upscale'),
      model: z.enum(['real-esrgan', 'clarity']).optional().describe('Upscale model (default: real-esrgan)'),
    },
    async (args) => {
      const token = process.env.REPLICATE_API_TOKEN;
      if (!token) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'REPLICATE_API_TOKEN not configured' }) }], isError: true };
      }

      const isClarity = args.model === 'clarity';
      const endpoint = isClarity
        ? 'https://api.replicate.com/v1/models/philz1337x/clarity-upscaler/predictions'
        : 'https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions';

      const input = isClarity
        ? {
            image: args.image_base64,
            scale_factor: 2,
            creativity: 0.15,
            resemblance: 0.9,
            prompt: 'high resolution, sharp details, professional photography',
            negative_prompt: 'blurry, artifacts, noise',
          }
        : { image: args.image_base64, scale: 4, face_enhance: false };

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
      if (!createRes.ok) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: prediction.detail || 'Replicate error' }) }], isError: true };
      }

      let result = prediction;
      for (let i = 0; i < 15 && result.status !== 'succeeded' && result.status !== 'failed'; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        result = await poll.json();
      }

      if (result.status !== 'succeeded') {
        return { content: [{ type: 'text', text: JSON.stringify({ error: result.error || 'Upscale timed out' }) }], isError: true };
      }

      const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
      const imgRes = await fetch(outputUrl);
      if (!imgRes.ok) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to download upscaled image' }) }], isError: true };
      }
      const buffer = await imgRes.arrayBuffer();
      const contentType = imgRes.headers.get('content-type') || 'image/png';
      const base64 = Buffer.from(buffer).toString('base64');
      const upscaledUrl = `data:${contentType};base64,${base64}`;

      return { content: [{ type: 'text', text: JSON.stringify({ upscaledUrl }) }] };
    }
  );

  return mcp;
}

// Convert Node.js IncomingMessage to Web Standard Request
function toWebRequest(req: VercelRequest): Request {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const url = `${protocol}://${host}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const init: RequestInit = { method: req.method!, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = JSON.stringify(req.body);
  }
  return new Request(url, init);
}

// Write Web Standard Response back to Node.js ServerResponse
async function writeWebResponse(webRes: Response, res: VercelResponse) {
  res.status(webRes.status);
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  if (!webRes.body) { res.end(); return; }
  const reader = webRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally { res.end(); }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.MCP_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing X-API-Key' });
  }

  const mcp = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);

  const webReq = toWebRequest(req);
  const webRes = await transport.handleRequest(webReq);
  await writeWebResponse(webRes, res);
}
