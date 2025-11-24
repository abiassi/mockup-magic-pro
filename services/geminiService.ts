import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { GenerationSettings, AnalysisVibe } from "../types";

// The model requested is "nano banana pro", which maps to 'gemini-3-pro-image-preview'
const MODEL_NAME = 'gemini-3-pro-image-preview';
const ANALYSIS_MODEL = 'gemini-2.5-flash'; // Fast model for analyzing the image

// Basic helper to sanitize API keys and ignore placeholders
export const normalizeApiKey = (key?: string | null): string | null => {
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed || trimmed === 'your_gemini_api_key_here') return null;
  return trimmed;
};

// Exported for UI so it can tell whether we shipped an env key
export const getEnvApiKey = (): string | null => {
  const envKey = (process.env.API_KEY || process.env.GEMINI_API_KEY) as string | undefined;
  return normalizeApiKey(envKey);
};

// Helper for exponential backoff
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Wrapper to retry API calls on transient errors (503, 429)
async function retry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 2000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const isLast = i === retries - 1;
      const errorStr = e.toString() + (JSON.stringify(e) || "");
      // Check for 503 Unavailable or 429 Too Many Requests
      const isTransient = errorStr.includes('503') || errorStr.includes('overloaded') || errorStr.includes('UNAVAILABLE') || errorStr.includes('429');
      
      if (!isTransient || isLast) throw e;
      
      const delay = baseDelay * Math.pow(2, i);
      console.warn(`Gemini API busy (Attempt ${i+1}/${retries}). Retrying in ${delay}ms...`);
      await wait(delay);
    }
  }
  throw new Error("Max retries reached");
}

/**
 * Helper to build the system prompt based on Vibe
 */
const getSystemPromptForVibe = (vibe: AnalysisVibe) => {
  let vibeContext = "";
  
  switch (vibe) {
    case "Industrial & Raw":
      vibeContext = "Focus on: Industrial lofts, concrete walls, abandoned factories, exposed brick, brutalist architecture, dramatic shadows.";
      break;
    case "Modern & Minimalist":
      vibeContext = "Focus on: Clean white gallery spaces, scandinavian interiors, negative space, polished concrete floors, museum settings.";
      break;
    case "Cozy & Bohemian":
      vibeContext = "Focus on: Warm living rooms with plants, wooden shelves, coffee shops, soft morning light, messy but aesthetic desks.";
      break;
    case "Luxury & High-end":
      vibeContext = "Focus on: Expensive hotel lobbies, marble walls, gold accents, dark moody office spaces, architectural digest style.";
      break;
    case "Public & Street":
      vibeContext = "Focus on: Subway stations, wheatpasted street walls, bus stops, urban textures, cafe windows.";
      break;
    case "Surprise Me":
    default:
      vibeContext = "Focus on: A mix of unexpected locations - from industrial factories to minimalist museums to gritty street corners.";
      break;
  }

  return `
    Analyze this artwork. Identify its style, color palette, and mood.
    Based on this analysis, suggest distinct, high-quality, editorial-style settings where this art would look amazing.
    
    THEME: ${vibeContext}
    
    Output strictly a JSON array of strings. 
    Example: ["A raw concrete industrial wall with dramatic shadow", "A minimalist art gallery with polished floors"]
  `;
};

/**
 * Analyzes the uploaded artwork and suggests environment prompts.
 */
export const analyzeImageForPrompts = async (base64Image: string, vibe: AnalysisVibe = "Surprise Me"): Promise<string[]> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key not found. Please set GEMINI_API_KEY environment variable.");

  const ai = new GoogleGenAI({ apiKey });
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
  
  const prompt = `
    ${getSystemPromptForVibe(vibe)}
    Generate exactly 4 suggestions.
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
        responseMimeType: "application/json"
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

/**
 * Regenerates a single prompt suggestion based on the image and vibe.
 */
export const regenerateSinglePrompt = async (base64Image: string, vibe: AnalysisVibe): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key not found. Please set GEMINI_API_KEY environment variable.");

  const ai = new GoogleGenAI({ apiKey });
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
  
  const prompt = `
    ${getSystemPromptForVibe(vibe)}
    Generate exactly 1 unique, creative suggestion that is different from generic ones.
    Output strictly a JSON array with one string.
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
        responseMimeType: "application/json"
      }
    }));

    const text = response.text || "[]";
    const suggestions = JSON.parse(text);
    return Array.isArray(suggestions) && suggestions.length > 0 ? suggestions[0] : "A creative environment for this art.";
  } catch (e) {
    return "A creative environment suitable for this artwork.";
  }
};

/**
 * Generates a mockup based on an uploaded image and a text prompt.
 */
export const generateMockup = async (
  base64Image: string,
  settings: GenerationSettings
): Promise<string[]> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("API Key not found. Please set GEMINI_API_KEY environment variable.");
  }

  const ai = new GoogleGenAI({ apiKey });

  // Clean the base64 string if it contains the header
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

  // Enhanced quality prefix for Unsplash/Film style
  const qualityPrefix = `
    Award-winning editorial photography, shot on 35mm film, Kodak Portra 400 aesthetic.
    Features: Heavy natural film grain, slight chromatic aberration, organic color grading, imperfect lens characteristics.
    The final image must look like a raw, unpolished photograph, not a 3D render.
    8k resolution, hyperrealistic, detailed texture.
  `;
  
  let frameContext = "";
  // Inject sizing context to ensure correct scale relative to the room
  const sizeContext = settings.printSize ? settings.printSize : "A3";

  // Instruction for physical interaction (shadows/reflections)
  const physicalInteraction = "Ensure the environment's lighting interacts with the artwork. Cast realistic shadows ONTO the print surface. If there is glass, show subtle reflections OVER the artwork.";

  // Handle Frame Style
  if (settings.frameStyle === "None") {
    frameContext = `The attached image is taped or pasted directly onto the wall as a ${sizeContext} poster. Show paper texture, slight curling at corners, and surface shadows falling across the image.`;
  } else if (settings.frameStyle === "Auto") {
    frameContext = `The attached image is professionally framed in a style that perfectly matches the environment's aesthetic (${sizeContext} size). Include realistic glass reflections and frame shadows.`;
  } else {
    frameContext = `The attached image is physically framed in a ${settings.frameStyle} frame (${sizeContext} size) hanging on the wall. Include realistic glass reflections and frame shadows.`;
  }

  // Handle Environment Context (Lighting/Texture)
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

  // Combine: Quality + User Scene + Env details + Frame/Physics + Color Grading instruction
  let finalPrompt = `
    ${qualityPrefix} 
    SCENE: ${settings.prompt}. 
    DETAILS: ${envContext} 
    PLACEMENT: ${frameContext} 
    PHYSICS: ${physicalInteraction}
    COLOR: Apply a cohesive cinematic color grade that warps the colors of the inserted artwork slightly to match the ambient light temperature of the room. The artwork should not look like a digital overlay.
  `;
  
  // Add negative constraints if present
  if (settings.negativePrompt && settings.negativePrompt.trim().length > 0) {
    finalPrompt += ` Do NOT include: ${settings.negativePrompt}.`;
  }

  // Create an array of promises for parallel execution
  const promises = Array.from({ length: settings.count }).map(async (_, index) => {
    try {
      const response = await retry<GenerateContentResponse>(() => ai.models.generateContent({
        model: MODEL_NAME,
        contents: {
          parts: [
            {
              text: finalPrompt,
            },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: cleanBase64,
              },
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: settings.aspectRatio,
            imageSize: settings.imageSize,
          },
        },
      }));

      if (response.candidates && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
      return null;
    } catch (error) {
      console.error(`Error generating image ${index + 1}:`, error);
      return null;
    }
  });

  // Wait for all generations to complete
  const results = await Promise.all(promises);
  
  // Filter out any failed attempts
  const generatedImages = results.filter((img): img is string => img !== null);

  if (generatedImages.length === 0) {
    throw new Error("No images were generated. Please try a different prompt or image.");
  }

  return generatedImages;
};

// Helper to get API key from environment, AI Studio, or localStorage
const getApiKey = (): string | null => {
  // First check environment variable (for Vercel/standalone deployment)
  const envKey = getEnvApiKey();
  if (envKey) return envKey;
  
  // Fallback to AI Studio if available
  const win = window as any;
  if (win.aistudio && win.aistudio.getApiKey) {
    const studioKey = normalizeApiKey(win.aistudio.getApiKey());
    if (studioKey) return studioKey;
  }
  
  // Final fallback to localStorage (user-entered key)
  if (typeof window !== 'undefined' && window.localStorage) {
    const storedKey = normalizeApiKey(localStorage.getItem('gemini_api_key'));
    if (storedKey) return storedKey;
  }
  
  return null;
};

export const checkApiKey = async (): Promise<boolean> => {
  // Check environment variable first
  const envKey = getEnvApiKey();
  if (envKey) return true;
  
  // Fallback to AI Studio
  const win = window as any;
  if (win.aistudio && win.aistudio.hasSelectedApiKey) {
    const hasStudioKey = await win.aistudio.hasSelectedApiKey();
    if (hasStudioKey) return true;
  }
  
  // Final fallback to localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    const storedKey = normalizeApiKey(localStorage.getItem('gemini_api_key'));
    if (storedKey) return true;
  }
  
  return false;
};

export const setApiKey = (key: string): void => {
  if (typeof window !== 'undefined' && window.localStorage) {
    const normalized = normalizeApiKey(key);
    if (normalized) {
      localStorage.setItem('gemini_api_key', normalized);
    } else {
      localStorage.removeItem('gemini_api_key');
    }
  }
};

export const clearApiKey = (): void => {
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.removeItem('gemini_api_key');
  }
};

export const promptForApiKey = async (): Promise<void> => {
  const win = window as any;
  if (win.aistudio && win.aistudio.openSelectKey) {
    await win.aistudio.openSelectKey();
  } else {
    // For standalone deployment, show instructions
    alert("Please set GEMINI_API_KEY environment variable. For local development, create a .env.local file with: GEMINI_API_KEY=your_key_here");
  }
};
