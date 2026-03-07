import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
  maxDuration: 60,
};

// All external ESM packages are dynamically imported to avoid
// Vercel ncc bundling issues with ESM-only modules.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.MCP_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing X-API-Key' });
  }

  try {
    const [{ McpServer }, { WebStandardStreamableHTTPServerTransport }, { z }, { neon }, { GoogleGenAI }] = await Promise.all([
      import('@modelcontextprotocol/sdk/server/mcp.js'),
      import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'),
      import('zod'),
      import('@neondatabase/serverless'),
      import('@google/genai'),
    ]);

    const mcp = buildServer(McpServer, z, neon, GoogleGenAI);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);

    const webReq = toWebRequest(req);
    const webRes = await transport.handleRequest(webReq);
    await writeWebResponse(webRes, res);
  } catch (err: any) {
    console.error('MCP handler error:', err);
    res.status(500).json({ error: err.message, code: err.code });
  }
}

// --- Node.js ↔ Web Standard conversion ---

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

// --- Gemini helpers (inlined to avoid _lib import issues) ---

const GENERATION_MODEL = 'gemini-3.1-flash-image-preview';
const ANALYSIS_MODEL = 'gemini-3.1-flash-preview';

function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key?.trim()) throw new Error('GEMINI_API_KEY not set');
  return key.trim();
}

const stripBase64Header = (b64: string) => b64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

function extractImage(response: any): string | null {
  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData?.data) return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
}

async function retryFn<T>(fn: () => Promise<T>, retries = 3, baseDelay = 2000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e: any) {
      if (i === retries - 1) throw e;
      const s = e.toString() + (JSON.stringify(e) || '');
      if (!(s.includes('503') || s.includes('overloaded') || s.includes('UNAVAILABLE') || s.includes('429'))) throw e;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
  }
  throw new Error('Max retries');
}

async function serverGenerateMockup(GoogleGenAI: any, artworkBase64: string, settings: any): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  const cleanBase64 = stripBase64Header(artworkBase64);

  const prompt = `
    Award-winning editorial photography, shot on 35mm film, Kodak Portra 400.
    Features: Slight chromatic aberration, organic color grading.
    8k resolution, hyperrealistic, detailed texture. Apply authentic analog film grain.

    CRITICAL: The attached image is the artwork to display INSIDE a frame on a wall.
    ENVIRONMENT: ${settings.prompt}

    Frame: ${settings.frameStyle === 'None' ? 'Unframed poster taped to wall' : settings.frameStyle === 'Auto' ? 'Frame matching environment aesthetic' : settings.frameStyle + ' frame'}.
    ${settings.lighting !== 'Auto' ? 'Lighting: ' + settings.lighting + '.' : ''}
    ${settings.wallTexture !== 'Auto' ? 'Wall: ' + settings.wallTexture + '.' : ''}

    RULES:
    - NEVER crop, stretch, or distort the artwork. Preserve its exact aspect ratio.
    - The frame shape MUST match the artwork proportions.
    - The artwork is a physical print LIT BY room light, not self-illuminated.
    - Tint colors to match ambient light temperature.
    - Include realistic glass reflections and frame shadows.

    Do NOT include: 3d render, cgi, digital art, people, animals, text, watermarks, blurry.
  `;

  const promises = Array.from({ length: settings.count }).map(async () => {
    try {
      const response = await retryFn(() => ai.models.generateContent({
        model: GENERATION_MODEL,
        contents: { parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } }] },
        config: { imageConfig: { aspectRatio: settings.aspectRatio, imageSize: settings.imageSize || '2K' } },
      }));
      return extractImage(response);
    } catch (e) { console.error('Generation error:', e); return null; }
  });

  const results = (await Promise.all(promises)).filter((img): img is string => img !== null);
  if (results.length === 0) throw new Error('No images generated');
  return results;
}

async function serverGenerateComposite(GoogleGenAI: any, baseImg: string, artworkImg: string, instructions: string, aspectRatio: string, imageSize: string): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

  const prompt = `
    Place the ARTWORK (second image) into the INTERIOR SCENE (first image) as a framed print on the wall.
    ${instructions.trim() ? 'Instructions: ' + instructions.trim() : 'Place as a framed print on the most natural wall spot.'}

    RULES:
    - Frame proportions MUST match artwork shape (portrait/landscape/square).
    - If existing frame has wrong proportions, change the frame shape.
    - Match wall vanishing point and perspective exactly.
    - Artwork colors tinted by room light temperature (warm room = warm tint).
    - Include glass reflections (15-25% opacity), frame shadow, surface texture.
    - Print should look like ink on paper reflecting room light, not a screen.
    - Preserve everything else in the photo exactly as-is.
  `;

  const response = await retryFn(() => ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: { parts: [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: stripBase64Header(baseImg) } },
      { inlineData: { mimeType: 'image/jpeg', data: stripBase64Header(artworkImg) } },
    ] },
    config: { imageConfig: { aspectRatio: aspectRatio as any, imageSize: imageSize as any } },
  }));

  const img = extractImage(response);
  if (!img) throw new Error('No image in composite response');
  return [img];
}

async function serverAnalyzeArtwork(GoogleGenAI: any, artworkBase64: string, vibe?: string): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  const v = vibe || 'Surprise Me';

  const vibeContext: Record<string, string> = {
    'Industrial & Raw': 'Industrial lofts, concrete, abandoned factories, exposed brick, brutalist architecture.',
    'Modern & Minimalist': 'Clean gallery spaces, scandinavian interiors, museum settings, polished concrete.',
    'Cozy & Bohemian': 'Warm living rooms with plants, coffee shops, soft light, vintage rugs, macramé.',
    'Luxury & High-end': 'Hotel lobbies, marble walls, gold accents, dark moody offices, designer furniture.',
    'Public & Street': 'Subway stations, wheatpasted walls, bus stops, urban textures, neon signage.',
    'Surprise Me': 'Mix of unexpected locations — film sets, art installations, unusual cultural spaces.',
  };

  const prompt = `
    Analyze this artwork. Identify style, color palette, and mood.
    Suggest 4 DISTINCT, CREATIVE settings where this art would look amazing.
    THEME: ${vibeContext[v] || vibeContext['Surprise Me']}
    Be specific and unique. Avoid generic descriptions.
    Output strictly a JSON array of 4 strings.
  `;

  try {
    const response = await retryFn(() => ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: { parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: stripBase64Header(artworkBase64) } }] },
      config: { responseMimeType: 'application/json', temperature: 1.2 },
    }));
    const suggestions = JSON.parse(response.text || '[]');
    return Array.isArray(suggestions) ? suggestions.slice(0, 4) : [];
  } catch {
    return ['A modern gallery wall with spot lighting', 'A cozy bohemian bedroom with plants', 'A professional office with sleek furniture', 'An industrial loft with exposed brick'];
  }
}

// --- MCP Server builder ---

function buildServer(McpServer: any, z: any, neon: any, GoogleGenAI: any) {
  const mcp = new McpServer({ name: 'mockup-magic-pro', version: '1.0.0' });
  const getSql = () => neon(process.env.DATABASE_URL!);

  mcp.tool('generate_mockup', 'Generate AI mockup images from artwork. Returns array of {id, imageUrl}.', {
    artwork_base64: z.string().describe('Base64-encoded artwork image'),
    prompt: z.string().describe('Description of the mockup scene'),
    aspect_ratio: z.enum(['1:1', '3:4', '4:3', '16:9', '9:16']).optional(),
    camera_angle: z.string().optional(),
    frame_style: z.enum(['Auto', 'None', 'Sleek Black', 'Modern White', 'Natural Oak', 'Classic Gold', 'Industrial Metal']).optional(),
    lighting: z.enum(['Auto', 'Natural Daylight', 'Soft Morning', 'Golden Hour', 'Studio Lighting', 'Moody Dim']).optional(),
    wall_texture: z.enum(['Auto', 'Clean Drywall', 'Exposed Brick', 'Raw Concrete', 'Smooth Plaster', 'Wooden Paneling']).optional(),
    count: z.number().min(1).max(4).optional().describe('Number of mockups (1-4)'),
  }, async (args: any) => {
    const settings = {
      prompt: args.prompt, negativePrompt: '', count: args.count ?? 1,
      aspectRatio: args.aspect_ratio ?? '3:4', imageSize: '2K',
      frameStyle: args.frame_style ?? 'Auto', lighting: args.lighting ?? 'Auto',
      wallTexture: args.wall_texture ?? 'Auto', printSize: 'A2', generationMode: 'batch',
    };
    const images = await serverGenerateMockup(GoogleGenAI, args.artwork_base64, settings);
    const sql = getSql();
    const results: { id: string; imageUrl: string }[] = [];
    for (const imageUrl of images) {
      const id = crypto.randomUUID();
      await sql`INSERT INTO mockup_results (id, image_url, prompt, created_at, aspect_ratio, camera_angle) VALUES (${id}, ${imageUrl}, ${args.prompt}, ${Date.now()}, ${settings.aspectRatio}, ${args.camera_angle ?? null}) ON CONFLICT (id) DO NOTHING`;
      results.push({ id, imageUrl });
    }
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  });

  mcp.tool('generate_composite', 'Generate a composite mockup by placing artwork onto a base scene image.', {
    base_image_base64: z.string().describe('Base64-encoded base/scene image'),
    artwork_base64: z.string().describe('Base64-encoded artwork to composite'),
    instructions: z.string().describe('Instructions for placement'),
    aspect_ratio: z.string().optional(),
  }, async (args: any) => {
    const images = await serverGenerateComposite(GoogleGenAI, args.base_image_base64, args.artwork_base64, args.instructions, args.aspect_ratio ?? '3:4', '2K');
    const sql = getSql();
    const id = crypto.randomUUID();
    await sql`INSERT INTO mockup_results (id, image_url, prompt, created_at, aspect_ratio, variant_type, composite_base_url, composite_artwork_url) VALUES (${id}, ${images[0]}, ${args.instructions}, ${Date.now()}, ${args.aspect_ratio ?? null}, ${'composite'}, ${args.base_image_base64.slice(0, 100)}, ${args.artwork_base64.slice(0, 100)}) ON CONFLICT (id) DO NOTHING`;
    return { content: [{ type: 'text', text: JSON.stringify({ id, imageUrl: images[0] }) }] };
  });

  mcp.tool('analyze_artwork', 'Analyze artwork and return prompt suggestions for mockup generation.', {
    artwork_base64: z.string().describe('Base64-encoded artwork image'),
    vibe: z.enum(['Industrial & Raw', 'Modern & Minimalist', 'Cozy & Bohemian', 'Luxury & High-end', 'Public & Street', 'Surprise Me']).optional(),
  }, async (args: any) => {
    const suggestions = await serverAnalyzeArtwork(GoogleGenAI, args.artwork_base64, args.vibe);
    return { content: [{ type: 'text', text: JSON.stringify(suggestions) }] };
  });

  mcp.tool('list_mockups', 'List mockup metadata from the database.', {
    limit: z.number().min(1).max(100).optional(),
    offset: z.number().min(0).optional(),
  }, async (args: any) => {
    const sql = getSql();
    const rows = await sql`SELECT id, prompt, created_at AS "createdAt", is_high_res AS "isHighRes", is_contact_sheet AS "isContactSheet", camera_angle AS "cameraAngle", variant_type AS "variantType", aspect_ratio AS "aspectRatio" FROM mockup_results ORDER BY created_at DESC LIMIT ${args.limit ?? 20} OFFSET ${args.offset ?? 0}`;
    return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
  });

  mcp.tool('get_mockup', 'Get a single mockup by ID with full image URL.', {
    id: z.string().describe('Mockup ID'),
  }, async (args: any) => {
    const sql = getSql();
    const rows = await sql`SELECT id, image_url AS "imageUrl", prompt, created_at AS "createdAt", is_high_res AS "isHighRes", is_contact_sheet AS "isContactSheet", extracted_from AS "extractedFrom", camera_angle AS "cameraAngle", variant_type AS "variantType", aspect_ratio AS "aspectRatio", refined_from AS "refinedFrom", composite_base_url AS "compositeBaseUrl", composite_artwork_url AS "compositeArtworkUrl" FROM mockup_results WHERE id = ${args.id}`;
    if (rows.length === 0) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not found' }) }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(rows[0]) }] };
  });

  mcp.tool('delete_mockup', 'Delete a mockup by ID.', {
    id: z.string().describe('Mockup ID to delete'),
  }, async (args: any) => {
    const sql = getSql();
    await sql`DELETE FROM mockup_results WHERE id = ${args.id}`;
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: args.id }) }] };
  });

  mcp.tool('upscale_mockup', 'Upscale a mockup image using AI super-resolution.', {
    image_base64: z.string().describe('Base64-encoded image to upscale'),
    model: z.enum(['real-esrgan', 'clarity']).optional(),
  }, async (args: any) => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return { content: [{ type: 'text', text: JSON.stringify({ error: 'REPLICATE_API_TOKEN not configured' }) }], isError: true };
    const isClarity = args.model === 'clarity';
    const endpoint = isClarity
      ? 'https://api.replicate.com/v1/models/philz1337x/clarity-upscaler/predictions'
      : 'https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions';
    const input = isClarity
      ? { image: args.image_base64, scale_factor: 2, creativity: 0.15, resemblance: 0.9, prompt: 'high resolution, sharp details', negative_prompt: 'blurry, artifacts, noise' }
      : { image: args.image_base64, scale: 4, face_enhance: false };
    const createRes = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=55' }, body: JSON.stringify({ input }) });
    const prediction = await createRes.json();
    if (!createRes.ok) return { content: [{ type: 'text', text: JSON.stringify({ error: prediction.detail || 'Replicate error' }) }], isError: true };
    let result = prediction;
    for (let i = 0; i < 15 && result.status !== 'succeeded' && result.status !== 'failed'; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, { headers: { Authorization: `Bearer ${token}` } });
      result = await poll.json();
    }
    if (result.status !== 'succeeded') return { content: [{ type: 'text', text: JSON.stringify({ error: result.error || 'Upscale timed out' }) }], isError: true };
    const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
    const imgRes = await fetch(outputUrl);
    if (!imgRes.ok) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to download upscaled image' }) }], isError: true };
    const buffer = await imgRes.arrayBuffer();
    const ct = imgRes.headers.get('content-type') || 'image/png';
    const b64 = Buffer.from(buffer).toString('base64');
    return { content: [{ type: 'text', text: JSON.stringify({ upscaledUrl: `data:${ct};base64,${b64}` }) }] };
  });

  return mcp;
}
