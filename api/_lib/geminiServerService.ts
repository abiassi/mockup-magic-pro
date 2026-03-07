import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { GenerationSettings, AnalysisVibe, ShotContext } from "../../types";
import {
  getLensSpecsForContext,
  getEnvironmentalDetails,
  getPhysicalInteractionDetails,
  getAtmosphericAndCameraBehavior,
  getContextualNegativePrompts,
} from "../../services/geminiService";

const MODEL_NAME = 'gemini-3.1-flash-image-preview';
const ANALYSIS_MODEL = 'gemini-3.1-flash-preview';

// --- Private helpers (re-implemented to avoid browser deps) ---

const stripBase64Header = (base64: string): string =>
  base64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

const extractImageFromResponse = (response: GenerateContentResponse): string | null => {
  if (response.candidates && response.candidates[0].content.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData && part.inlineData.data) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }
  return null;
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 2000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const isLast = i === retries - 1;
      const errorStr = e.toString() + (JSON.stringify(e) || "");
      const isTransient = errorStr.includes('503') || errorStr.includes('overloaded') || errorStr.includes('UNAVAILABLE') || errorStr.includes('429');

      if (!isTransient || isLast) throw e;

      const delay = baseDelay * Math.pow(2, i);
      console.warn(`Gemini API busy (Attempt ${i+1}/${retries}). Retrying in ${delay}ms...`);
      await wait(delay);
    }
  }
  throw new Error("Max retries reached");
}

const describeArtworkRatio = (ratio?: number): string => {
  if (!ratio) return "";
  const orientation = ratio > 1.05 ? "landscape (wider than tall)" : ratio < 0.95 ? "portrait (taller than wide)" : "square";
  const commonRatios: [number, string][] = [
    [1, "1:1"], [4/3, "4:3"], [3/2, "3:2"], [16/9, "16:9"], [2/1, "2:1"],
    [3/4, "3:4"], [2/3, "2:3"], [9/16, "9:16"], [1/2, "1:2"],
    [5/4, "5:4"], [4/5, "4:5"], [7/5, "7:5"], [5/7, "5:7"]
  ];
  let closestName = `${ratio.toFixed(2)}:1`;
  let closestDist = Infinity;
  for (const [r, name] of commonRatios) {
    const dist = Math.abs(ratio - r);
    if (dist < closestDist) { closestDist = dist; closestName = name; }
  }
  return `The artwork is ${orientation}, with approximately ${closestName} proportions (exact ratio: ${ratio.toFixed(3)}). The frame MUST match this shape — a ${orientation} frame.`;
};

const buildMacroStyleInstructions = () => `
  MACRO MODE (override):
  - CRITICAL: Extreme close-up, 1:1 macro magnification with camera 6-12 inches from print surface.
  - The print surface must fill 80-90% of the frame - show ONLY a corner/edge of the artwork, NOT the full frame or wall.
  - NO environmental context visible - no room, no wall texture, no surrounding objects.
  - Background must be completely out of focus (creamy bokeh, abstract color blobs, unrecognizable).
  - Razor-thin depth of field (2-3mm sharp plane) - only the print corner/edge is in focus.
  - Frame composition: Corner of print filling most of frame, diagonal composition, background melted into bokeh.
  - PRINT MATERIAL DETAIL: Semi-matte fine art paper with visible tooth/texture at macro distance, paper fibers visible, ink sits slightly raised on surface creating micro-relief, subtle directional light reflections (not glossy), individual paper grain texture visible.
  - Emphasize: paper texture, ink micro-relief, fiber detail, grain structure, gentle specular highlights on semi-matte surface.
  - This is NOT a detail shot or close-up - this is MACRO (1:1 magnification showing surface texture as primary subject).
`;

const getSystemPromptForVibe = (vibe: AnalysisVibe) => {
  let vibeContext = "";

  switch (vibe) {
    case "Industrial & Raw":
      vibeContext = "Focus on: Industrial lofts, concrete walls, abandoned factories, exposed brick, brutalist architecture, dramatic shadows. Be creative with specific details - rusty metal textures, peeling paint layers, weathered wood, harsh fluorescent tubes, architectural decay.";
      break;
    case "Modern & Minimalist":
      vibeContext = "Focus on: Clean white gallery spaces, scandinavian interiors, negative space, polished concrete floors, museum settings. Think specific - Bauhaus architecture, Japanese minimalism, sculptural furniture edges, geometric shadows, monochromatic palettes.";
      break;
    case "Cozy & Bohemian":
      vibeContext = "Focus on: Warm living rooms with plants, wooden shelves, coffee shops, soft morning light, messy but aesthetic desks. Get specific - vintage rugs, macramé details, ceramic collections, trailing ivy, golden hour through linen curtains.";
      break;
    case "Luxury & High-end":
      vibeContext = "Focus on: Expensive hotel lobbies, marble walls, gold accents, dark moody office spaces, architectural digest style. Think high-end details - Carrara marble veining, brass fixtures with patina, walnut paneling, designer lighting fixtures, leather upholstery.";
      break;
    case "Public & Street":
      vibeContext = "Focus on: Subway stations, wheatpasted street walls, bus stops, urban textures, cafe windows. Be specific - tile patterns, graffiti layers, chain-link fences, neon signage reflections, rain-slicked pavement, transit infrastructure.";
      break;
    case "Surprise Me":
    default:
      vibeContext = "Focus on: A mix of unexpected locations - from industrial factories to minimalist museums to gritty street corners. Be bold and creative - think film sets, art installations, architectural experiments, unusual cultural spaces, unexpected juxtapositions.";
      break;
  }

  return `
    Analyze this artwork. Identify its style, color palette, and mood.
    Based on this analysis, suggest DISTINCT, CREATIVE, HIGH-QUALITY, editorial-style settings where this art would look amazing.

    THEME: ${vibeContext}

    IMPORTANT: Be specific and unique. Avoid generic descriptions like "modern gallery wall" or "cozy bedroom".
    Instead, include distinctive details that make each suggestion memorable and different from others.
    Think like an editorial photographer choosing interesting, unexpected locations.

    Output strictly a JSON array of strings.
    Example: ["A raw concrete industrial wall with dramatic shadow", "A minimalist art gallery with polished floors"]
  `;
};

// --- Server-side API key ---

const getServerApiKey = (): string => {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !key.trim()) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  }
  return key.trim();
};

// --- Exported server functions ---

/**
 * Server-side mockup generation. Same logic as client generateMockup.
 */
export const serverGenerateMockup = async (
  artworkBase64: string,
  settings: GenerationSettings,
  options?: { macro?: boolean }
): Promise<string[]> => {
  const apiKey = getServerApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const cleanBase64 = stripBase64Header(artworkBase64);

  const isMacro = options?.macro === true;
  const resolvedImageSize = isMacro && settings.imageSize === "1K" ? "2K" : settings.imageSize;

  const shotContext: ShotContext = {
    cameraAngle: undefined,
    isMacro: isMacro,
    shotType: isMacro ? "macro" : "standard"
  };

  // 1. Quality prefix
  const qualityPrefix = `
    Award-winning editorial photography, shot on 35mm film, Kodak Portra 400 aesthetic.
    Features: Slight chromatic aberration, organic color grading, imperfect lens characteristics.
    The final image must look like a raw, unpolished photograph, not a 3D render.
    8k resolution, hyperrealistic, detailed texture.

    FILM GRAIN (MANDATORY):
    - Apply authentic analog film grain throughout the ENTIRE image — this is non-negotiable.
    - The grain should be organic, irregular, and vary in density across shadows vs highlights (denser grain in shadows, finer grain in highlights), like real Kodak Portra 400 pushed one stop.
    - Grain should be SUBTLE but clearly VISIBLE at full resolution — it should feel embedded in the image, not overlaid on top.
    - Do NOT shift or alter the color palette to achieve the grain. Preserve the scene's natural colors. The grain is luminance-based (monochromatic grain), not color noise.
    - The grain should make the image feel analog and tactile, like a real film photograph scanned from a negative.
  `;

  // 2. Lens specifications
  const lensSpecs = getLensSpecsForContext(shotContext);
  const lensInstructions = `
    CAMERA TECHNICAL SPECS:
    - Lens: ${lensSpecs.focalLength}
    - Aperture: ${lensSpecs.aperture}
    - Distance: ${lensSpecs.distanceFromSubject}
    - Depth of Field: ${lensSpecs.depthOfField}
    - Lens Behavior: ${lensSpecs.lensCharacteristics}
    - Perspective: ${lensSpecs.perspective}
  `;

  // 3. Environmental realism
  const environmentalDetails = getEnvironmentalDetails(settings.analysisVibe || "Surprise Me");
  const environmentalRealism = `
    ENVIRONMENTAL REALISM (${environmentalDetails.realismLevel.toUpperCase()}):
    ${environmentalDetails.ambientDetails}

    Surface Imperfections: ${environmentalDetails.imperfections.slice(0, 3).join("; ")}.
    Atmospheric Elements: ${environmentalDetails.atmospheric.slice(0, 3).join("; ")}.
    Scene Context: ${isMacro ? "No scene dressing (macro shot)" : environmentalDetails.sceneDressing.slice(0, 2).join("; ")}.
  `;

  // 4. Frame context
  let frameContext = "";
  const sizeContext = settings.printSize ? settings.printSize : "A3";

  if (settings.frameStyle === "None") {
    frameContext = `The attached image is taped or pasted directly onto the wall as a ${sizeContext} poster. Show paper texture, slight curling at corners, and surface shadows falling across the image.`;
  } else if (settings.frameStyle === "Auto") {
    frameContext = `The attached image is professionally framed in a style that perfectly matches the environment's aesthetic (${sizeContext} size). Include realistic glass reflections and frame shadows.`;
  } else {
    frameContext = `The attached image is physically framed in a ${settings.frameStyle} frame (${sizeContext} size) hanging on the wall. Include realistic glass reflections and frame shadows.`;
  }

  // 5. Environment context
  let envContext = "";
  if (settings.lighting !== "Auto") {
    envContext += `Lighting Condition: ${settings.lighting}. `;
  }
  if (settings.wallTexture !== "Auto") {
    envContext += `Wall Material: ${settings.wallTexture}. `;
  }
  if (!envContext) {
    envContext = "Lighting and Wall Material should be inferred naturally from the scene description.";
  }

  // 6. Physical interaction
  const physicalInteraction = getPhysicalInteractionDetails(settings.frameStyle, settings.lighting);

  // 7. Atmospheric and camera behavior
  const atmosphericBehavior = getAtmosphericAndCameraBehavior(shotContext);

  // 8. Assemble final prompt
  let finalPrompt = `
    ${qualityPrefix}

    ${lensInstructions}

    CRITICAL INSTRUCTION - SUBJECT HIERARCHY:
    1. PRIMARY SUBJECT: The attached image is the artwork/photograph to be displayed INSIDE the frame on the wall.
    2. ENVIRONMENT/LOCATION: The frame is located in this setting: ${settings.prompt}
    3. ENVIRONMENTAL ENHANCEMENTS: Subtle realistic details are added to enhance authenticity (described below).

    ARTWORK ASPECT RATIO PRESERVATION (CRITICAL):
    - NEVER crop, stretch, or distort the artwork. The artwork's original aspect ratio MUST be preserved exactly.
    - ${describeArtworkRatio(settings.artworkAspectRatio)}
    - The frame shape and proportions MUST match the artwork's aspect ratio. If the artwork is landscape, the frame MUST be landscape. If portrait, the frame MUST be portrait. Do NOT force the artwork into a square or differently-proportioned frame.
    - ADJUST THE FRAME dimensions to fit the artwork — never the other way around.
    - The entire artwork must be visible inside the frame with no parts cut off or hidden.

    PLACEMENT: ${frameContext}

    LIGHTING & MATERIALS CONTEXT: ${envContext}

    ${environmentalRealism}
    Important: Environmental details are SUBTLE BACKGROUND ELEMENTS that exist in the location, not part of the framed artwork itself.

    PHYSICS & MATERIALS:
    ${physicalInteraction}

    ATMOSPHERE & CAMERA:
    ${atmosphericBehavior}

    COLOR & LIGHT ON PRINT: The artwork is a physical print LIT BY room light, not a self-illuminated screen. Tint the artwork's colors to match the room's ambient light temperature (warm room = warm tint on print, cool daylight = cool tint). The print's brightness and contrast should match what the room lighting would produce — dimmer in moody rooms, brighter near light sources, with natural light falloff across the surface. The artwork should sit within the room's tonal range, never appearing unnaturally vivid or glowing.
  `;

  // Style reference image instructions
  if (settings.styleReferenceImage) {
    finalPrompt += `

    STYLE REFERENCE (CRITICAL):
    A second image is provided as a STYLE REFERENCE. Match the overall visual style, mood, color grading,
    lighting atmosphere, and aesthetic feel of this reference image. The reference dictates the photographic
    style and tone — apply its look to the generated scene. Do NOT reproduce the reference image's content
    or composition; only absorb its style, palette, and mood.
    `;
  }

  // Macro override
  if (isMacro) {
    finalPrompt += buildMacroStyleInstructions();
  }

  // Enhanced contextual negatives
  const contextNegatives = getContextualNegativePrompts(shotContext, settings.analysisVibe || "Surprise Me");
  const negativeClauses: string[] = [...contextNegatives];

  if (settings.negativePrompt && settings.negativePrompt.trim().length > 0) {
    negativeClauses.push(settings.negativePrompt.trim());
  }

  if (negativeClauses.length > 0) {
    finalPrompt += ` Do NOT include: ${negativeClauses.join(", ")}.`;
  }

  // Build content parts
  const contentParts: Array<{text: string} | {inlineData: {mimeType: string, data: string}}> = [
    { text: finalPrompt },
    { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } },
  ];

  if (settings.styleReferenceImage) {
    const cleanStyleBase64 = stripBase64Header(settings.styleReferenceImage);
    const styleMime = settings.styleReferenceImage.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    contentParts.push({ inlineData: { mimeType: styleMime, data: cleanStyleBase64 } });
  }

  // Parallel generation
  const promises = Array.from({ length: settings.count }).map(async (_, index) => {
    try {
      const response = await retry<GenerateContentResponse>(() => ai.models.generateContent({
        model: MODEL_NAME,
        contents: { parts: contentParts },
        config: {
          imageConfig: {
            aspectRatio: settings.aspectRatio,
            imageSize: resolvedImageSize,
          },
        },
      }));

      return extractImageFromResponse(response);
    } catch (error) {
      console.error(`Error generating image ${index + 1}:`, error);
      return null;
    }
  });

  const results = await Promise.all(promises);
  const generatedImages = results.filter((img): img is string => img !== null);

  if (generatedImages.length === 0) {
    throw new Error("No images were generated. Please try a different prompt or image.");
  }

  return generatedImages;
};

/**
 * Server-side composite generation. Same logic as client generateComposite.
 */
export const serverGenerateComposite = async (
  baseImageBase64: string,
  artworkBase64: string,
  instructions: string,
  aspectRatio: string,
  imageSize: string,
  artworkAspectRatio?: number
): Promise<string[]> => {
  const apiKey = getServerApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const cleanBase = stripBase64Header(baseImageBase64);
  const cleanArtwork = stripBase64Header(artworkBase64);

  const userGuidance = instructions.trim()
    ? `USER INSTRUCTIONS: ${instructions.trim()}`
    : "Place the artwork as a framed print on the wall in this interior scene.";

  const artworkRatioDesc = describeArtworkRatio(artworkAspectRatio);

  const prompt = `
    You are a professional interior scene compositor. Your task is to place the provided ARTWORK (second image) into the INTERIOR SCENE PHOTO (first image) as a framed print on the wall.

    ############################################################
    # RULE #1 — FRAME MUST MATCH ARTWORK SHAPE (NON-NEGOTIABLE) #
    ############################################################
    ${artworkRatioDesc}
    The frame in the output image MUST have the SAME proportions as the artwork.
    - If the artwork is PORTRAIT (tall), the frame MUST be PORTRAIT (tall). A portrait artwork must NEVER appear in a landscape or square frame.
    - If the artwork is LANDSCAPE (wide), the frame MUST be LANDSCAPE (wide). A landscape artwork must NEVER appear in a portrait or square frame.
    - If the artwork is SQUARE, the frame must be square.
    - NEVER crop, stretch, squash, or distort the artwork to fit a differently-shaped frame.
    - If the scene already has a frame with different proportions, you MUST CHANGE the frame shape to match the artwork. Remove the old frame and create a new one with correct proportions.
    - The ENTIRE artwork must be visible inside the frame — nothing cut off, no letterboxing, no padding.
    ############################################################

    ${userGuidance}

    SCENE ANALYSIS:
    1. If the scene already has a frame, picture, or artwork on the wall:
       - REPLACE the existing artwork with the provided artwork
       - Keep the same approximate wall POSITION (centered above bed, above sofa, etc.)
       - Keep a similar frame STYLE (material, color) if it suits the room
       - BUT CHANGE THE FRAME SHAPE/PROPORTIONS to match the new artwork (see Rule #1 above). Do NOT keep the old frame shape if it doesn't match.
    2. If the scene has NO existing frame or artwork:
       - Find the most natural wall spot for hanging art
       - ADD a frame that matches the room's aesthetic and the artwork's proportions
       - Size the frame proportionally to the wall space

    OTHER REQUIREMENTS:
    1. PERSPECTIVE: Match the wall's vanishing point and angle precisely
       - If the wall is at an angle, the frame and artwork must follow that angle
       - Apply correct perspective transformation so the frame looks physically mounted on the wall

    2. COLOR & LIGHT INTEGRATION (CRITICAL FOR REALISM):
       A print on a wall is NOT self-illuminated — it is LIT BY the room's ambient light. This means:
       - The artwork's colors must be TINTED by the room's light color temperature:
         * Warm room light (tungsten, golden hour, candles) → artwork gains a warm wash (shift toward orange/amber)
         * Cool daylight → artwork shifts slightly cool/blue
         * Mixed lighting → artwork shows warm/cool zones matching nearby light sources
       - The artwork's BRIGHTNESS must match what a real print would show:
         * In a dim/moody room, the print appears darker and lower-contrast
         * In a bright room, the print appears vivid but not glowing
         * Light falloff across the print surface if light comes from one side (brighter on the side nearest the light source, slightly darker on the far side)
       - Glass surface effects:
         * Subtle environmental reflections (15-25% opacity) — room lights, windows, ceiling
         * Glass slightly reduces contrast and adds a faint cool shift
         * Specular highlight from the main light source (small, bright accent)
       - The print must NEVER look like a backlit screen or digital overlay. It should look like ink on paper reflecting room light.
       - Overall, the print's tonal range should sit WITHIN the room's tonal range — it should not be the brightest or most saturated element unless the room lighting specifically spotlights it.

    3. PHYSICAL REALISM:
       - Frame casts a realistic shadow on the wall based on light direction and frame depth
       - Frame material shows appropriate texture (wood grain, metal brushing, etc.)
       - The artwork surface should look like semi-matte fine art paper behind glass, with subtle texture

    4. PRESERVE everything else in the photo exactly as-is:
       - Room furniture, objects, lighting setup, wall texture, architectural elements
       - Only add/replace the framed artwork

    QUALITY: Professional interior photography quality. The result should look like a real photo of a room with this artwork hanging on the wall.
    OUTPUT: Generate exactly ONE high-quality composited image.
  `.trim();

  try {
    const response = await retry<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: cleanBase } },
          { inlineData: { mimeType: "image/jpeg", data: cleanArtwork } }
        ]
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio as any,
          imageSize: imageSize as any,
        }
      }
    }));

    const imageUrl = extractImageFromResponse(response);
    if (!imageUrl) throw new Error("No image data in composite response");
    return [imageUrl];
  } catch (error) {
    console.error("Error generating composite:", error);
    throw error;
  }
};

/**
 * Server-side artwork analysis. Same logic as client analyzeImageForPrompts.
 */
export const serverAnalyzeArtwork = async (
  artworkBase64: string,
  vibe: AnalysisVibe = "Surprise Me"
): Promise<string[]> => {
  const apiKey = getServerApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const cleanBase64 = stripBase64Header(artworkBase64);

  const prompt = `
    ${getSystemPromptForVibe(vibe)}
    Generate exactly 4 UNIQUE, CREATIVE, and VARIED suggestions.
    Each suggestion should be specific, unexpected, and avoid generic descriptions.
    Think outside the box - surprise the user with interesting, editorial-quality locations.
    Consider unusual angles, specific details, unique lighting scenarios.

    Current timestamp: ${Date.now()} (use this to inspire fresh perspectives)
  `;

  try {
    const response = await retry<GenerateContentResponse>(() => ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } }
        ]
      },
      config: {
        responseMimeType: "application/json",
        temperature: 1.2
      }
    }));

    const text = response.text || "[]";
    const suggestions = JSON.parse(text);
    return Array.isArray(suggestions) ? suggestions.slice(0, 4) : [];
  } catch (e) {
    console.error("Analysis failed", e);
    return [
      "A modern gallery wall with spot lighting",
      "A cozy bohemian bedroom with plants",
      "A professional office space with sleek furniture",
      "An industrial loft with exposed brick"
    ];
  }
};
