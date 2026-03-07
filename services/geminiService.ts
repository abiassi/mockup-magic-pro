import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { GenerationSettings, AnalysisVibe, CameraAngle, ContactSheetGrid, LensSpec, ShotContext, EnvironmentalDetails } from "../types";

// The model requested is "nano banana 2", which maps to 'gemini-3.1-flash-image-preview'
const MODEL_NAME = 'gemini-3.1-flash-image-preview';
const ANALYSIS_MODEL = 'gemini-3.1-flash-preview'; // Fast model for analyzing the image

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

// Strip data-URL header from base64 strings
const stripBase64Header = (base64: string): string =>
  base64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

// Extract the first image data URL from a Gemini API response, or null if none found
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
 * Converts a numeric width/height ratio into a human-readable description
 * so the AI knows the exact shape the frame must be.
 */
const describeArtworkRatio = (ratio?: number): string => {
  if (!ratio) return "";
  const orientation = ratio > 1.05 ? "landscape (wider than tall)" : ratio < 0.95 ? "portrait (taller than wide)" : "square";
  // Find closest common ratio name
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

// Macro prompt helpers (stronger separation from standard shots)
const MACRO_NEGATIVES = [
  "blurry",
  "out of focus",
  "soft focus",
  "halos",
  "oversharpened",
  "double edges",
  "harsh grain",
  "noise",
  "jpeg artifacts",
  "motion blur",
  // push away from wide/room views - CRITICAL for macro
  "wide shot",
  "full room",
  "distant camera",
  "full frame visible",
  "entire artwork visible",
  "whole print visible",
  "tripod wide angle",
  "flat lighting",
  "environmental context",
  "wall visible",
  "room visible",
  "background in focus",
  "everything sharp",
  "deep depth of field",
  "medium shot",
  "establishing shot",
  "scene context"
].join(", ");

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

/**
 * Returns appropriate lens/focal length specs based on camera angle and shot type.
 * CRITICAL: Macros get macro lenses (100mm), wide shots get wide lenses (24mm), etc.
 */
export const getLensSpecsForContext = (context: ShotContext): LensSpec => {
  const { cameraAngle, isMacro, shotType } = context;

  // MACRO MODE: Always returns macro lens specs regardless of angle
  if (isMacro || cameraAngle === "Extreme Macro") {
    return {
      focalLength: "100mm macro lens",
      aperture: "f/2.8",
      distanceFromSubject: "6-12 inches from subject",
      depthOfField: "razor-thin, background melted into creamy bokeh",
      lensCharacteristics: "1:1 magnification, exceptional sharpness on focused plane, extreme subject isolation",
      perspective: "compressed, macro perspective with no room context"
    };
  }

  // CONTACT SHEET MODE: Match lens to camera angle
  if (shotType === "contactSheet" && cameraAngle) {
    switch (cameraAngle) {
      case "Wide Establishing":
        return {
          focalLength: "24mm wide-angle lens",
          aperture: "f/5.6",
          distanceFromSubject: "10-15 feet back",
          depthOfField: "deep focus, entire scene sharp from foreground to background",
          lensCharacteristics: "minimal distortion, slight edge softness, natural room perspective",
          perspective: "natural spatial depth, room feels expansive"
        };

      case "Medium Focus":
        return {
          focalLength: "50mm standard lens",
          aperture: "f/4",
          distanceFromSubject: "5-6 feet from artwork",
          depthOfField: "medium depth, artwork sharp with background slightly soft",
          lensCharacteristics: "neutral perspective, classic photojournalistic feel, natural eye-level rendering",
          perspective: "natural, human eye perspective"
        };

      case "Close Detail":
        return {
          focalLength: "85mm portrait lens",
          aperture: "f/2.8",
          distanceFromSubject: "2-3 feet from artwork",
          depthOfField: "shallow, artwork surface in focus with soft background separation",
          lensCharacteristics: "gentle compression, smooth bokeh, flattering subject rendering",
          perspective: "slightly compressed, isolates subject from environment"
        };

      case "Low Dramatic":
        return {
          focalLength: "35mm wide-angle lens",
          aperture: "f/4",
          distanceFromSubject: "3-4 feet, positioned low to ground (12-18 inches high)",
          depthOfField: "deep focus with dramatic perspective",
          lensCharacteristics: "elongated vertical lines, dramatic scale exaggeration, slight barrel distortion",
          perspective: "elongated, heroic upward angle"
        };

      case "High Overhead":
        return {
          focalLength: "35mm wide-angle lens",
          aperture: "f/5.6",
          distanceFromSubject: "6-8 feet, positioned overhead (ceiling height)",
          depthOfField: "deep focus, entire scene readable",
          lensCharacteristics: "flattened perspective, architectural view, subtle wide-angle distortion at edges",
          perspective: "flattened, bird's-eye perspective"
        };

      case "Side Depth":
        return {
          focalLength: "85mm telephoto lens",
          aperture: "f/2.8",
          distanceFromSubject: "8-10 feet away, 45-60° off-axis",
          depthOfField: "shallow, emphasizes frame depth and layering",
          lensCharacteristics: "compressed perspective, strong depth compression, smooth background falloff",
          perspective: "compressed, stacks visual planes together"
        };

      case "Three-Quarter":
        return {
          focalLength: "50mm standard lens",
          aperture: "f/4",
          distanceFromSubject: "6-7 feet, 45° angle, slightly elevated",
          depthOfField: "medium depth, balanced sharpness",
          lensCharacteristics: "natural rendering, balanced perspective, editorial feel",
          perspective: "natural with dimensional depth"
        };

      case "Corner Detail":
        return {
          focalLength: "60mm macro lens",
          aperture: "f/4",
          distanceFromSubject: "1-2 feet from corner",
          depthOfField: "medium-shallow, corner sharp with gentle falloff",
          lensCharacteristics: "macro detail capability, sharp on corner with dimensional rendering",
          perspective: "close inspection perspective, shows frame construction"
        };

      default:
        // Fallback for standard shots
        return {
          focalLength: "50mm standard lens",
          aperture: "f/4",
          distanceFromSubject: "5-7 feet",
          depthOfField: "medium depth",
          lensCharacteristics: "neutral perspective, natural rendering",
          perspective: "natural human eye perspective"
        };
    }
  }

  // STANDARD MODE: Default to medium-shot specs
  return {
    focalLength: "50mm standard lens",
    aperture: "f/4",
    distanceFromSubject: "5-7 feet from artwork",
    depthOfField: "medium depth, artwork in focus with environment contextually readable",
    lensCharacteristics: "natural perspective, slight vignetting in corners, organic lens falloff",
    perspective: "natural, editorial perspective"
  };
};

/**
 * Returns environment-specific imperfections and atmospheric details based on vibe.
 * Includes realism level (pristine, lived-in, worn, gritty) and scene dressing.
 */
export const getEnvironmentalDetails = (vibe: AnalysisVibe): EnvironmentalDetails => {
  const baseDetails: Record<AnalysisVibe, EnvironmentalDetails> = {
    "Industrial & Raw": {
      imperfections: [
        "fine concrete dust on horizontal surfaces",
        "minor scuffs and wear marks on walls",
        "exposed nail holes and patch repairs",
        "subtle water staining in corners",
        "uneven paint coverage revealing underlayers"
      ],
      atmospheric: [
        "dust motes floating in harsh light beams",
        "slight haze from ventilation systems",
        "hard shadows with crisp edges",
        "directional light revealing texture"
      ],
      sceneDressing: [
        "exposed conduit or pipes in background",
        "stacked materials or equipment (out of focus)",
        "industrial lighting fixtures with visible wiring",
        "concrete floor with minor cracks and staining"
      ],
      realismLevel: "worn",
      ambientDetails: "Industrial space with authentic wear patterns, hard architectural shadows, visible construction details, and raw material textures. Environment shows use and age without looking neglected."
    },

    "Modern & Minimalist": {
      imperfections: [
        "extremely subtle finger smudges on glass surfaces",
        "faint shoe scuff marks on pristine floors",
        "microscopic dust particles visible in spotlight beams",
        "perfectly imperfect wall texture (not plastic-smooth)",
        "natural variations in white paint (warm vs cool tones)"
      ],
      atmospheric: [
        "soft diffused daylight with gentle gradients",
        "minimal haze creating atmospheric depth",
        "subtle light bounce from white surfaces",
        "gradual light falloff creating depth"
      ],
      sceneDressing: [
        "single architectural plant (monstera or fiddle leaf fig) partially visible",
        "minimal furniture edge in background (Eames chair corner, concrete bench)",
        "polished concrete or light wood floor",
        "single design object on peripheral surface (ceramic vase, art book)"
      ],
      realismLevel: "pristine",
      ambientDetails: "Gallery-quality minimalist space with museum-level cleanliness but authentic material textures. Soft architectural lighting, negative space, extremely subtle environmental traces that prevent sterile/CGI appearance."
    },

    "Cozy & Bohemian": {
      imperfections: [
        "gentle dust accumulation on plant leaves",
        "minor coffee ring stains on nearby surfaces",
        "worn book spines with creased covers",
        "soft fabric wrinkles and natural draping",
        "aged wood patina with gentle wear patterns"
      ],
      atmospheric: [
        "warm diffused light through curtains or foliage",
        "soft shadows with gentle gradients",
        "layered lighting from multiple warm sources",
        "slight haze from candles or morning sun"
      ],
      sceneDressing: [
        "trailing pothos or ivy plants with natural leaf orientation",
        "stacked vintage books with visible titles",
        "macramé or woven textile details",
        "ceramic mugs or handmade pottery in background",
        "warm wood furniture with natural grain"
      ],
      realismLevel: "lived-in",
      ambientDetails: "Warm, inhabited space with gentle lived-in quality. Natural clutter, layered textures, soft diffused lighting, and organic materials. Space feels curated but authentically used and loved."
    },

    "Luxury & High-end": {
      imperfections: [
        "faint reflections revealing room depth in polished surfaces",
        "micro-scratches on metal fixtures (shows real materials)",
        "subtle marble veining variations",
        "extremely fine dust in recessed lighting",
        "natural leather grain and subtle creasing"
      ],
      atmospheric: [
        "controlled dramatic lighting with gradients",
        "subtle rim lighting on edges",
        "atmospheric depth with layered shadows",
        "moody light gradients across walls"
      ],
      sceneDressing: [
        "designer furniture edge (Barcelona chair, Noguchi table)",
        "dark wood paneling or rich textured wallcovering",
        "brass or bronze fixtures with gentle patina",
        "architectural plants in designer planters",
        "marble or exotic stone surfaces"
      ],
      realismLevel: "pristine",
      ambientDetails: "High-end architectural space with expensive materials showing authentic luxury. Dramatic controlled lighting, rich textures, designer furniture glimpses, moody sophistication. Pristine but shows material authenticity not CGI perfection."
    },

    "Public & Street": {
      imperfections: [
        "layered poster remnants and wheat paste residue",
        "graffiti tags and marker scribbles",
        "chipped paint revealing multiple underlayers",
        "gum stains and ground-in dirt",
        "rust streaks and weathering patterns",
        "cracks in concrete or brick with organic growth"
      ],
      atmospheric: [
        "harsh fluorescent light with green-blue cast",
        "mixed color temperature (daylight + artificial)",
        "strong directional shadows",
        "slight atmospheric pollution haze"
      ],
      sceneDressing: [
        "utility boxes, meters, or transit signage",
        "chain-link fence or metal grating in background",
        "weathered wood or corrugated metal surfaces",
        "urban debris (plastic bags, crushed cans) naturally placed",
        "tile or brick patterns typical of public infrastructure"
      ],
      realismLevel: "gritty",
      ambientDetails: "Authentic urban public space with genuine street wear, layered history of use, municipal materials, and real-world grit. Mixed lighting, weathering patterns, organic urban decay, and traces of human presence."
    },

    "Surprise Me": {
      imperfections: [
        "environment-appropriate wear patterns",
        "authentic material aging",
        "subtle surface imperfections",
        "organic accumulation of dust or marks"
      ],
      atmospheric: [
        "natural or artificial light appropriate to scene",
        "atmospheric depth elements",
        "shadow complexity matching light source"
      ],
      sceneDressing: [
        "contextually appropriate background elements",
        "environment-specific materials",
        "authentic spatial depth cues"
      ],
      realismLevel: "lived-in",
      ambientDetails: "Varied environment with authentic material qualities, appropriate wear level, and natural atmospheric effects. Avoid generic or overly perfect rendering."
    }
  };

  return baseDetails[vibe];
};

/**
 * Returns enhanced physical interaction details for frame/glass/print behavior.
 */
export const getPhysicalInteractionDetails = (frameStyle: string, lighting: string): string => {
  let frameInteraction = "";

  // Frame-specific shadow and depth behavior
  switch (frameStyle) {
    case "None":
      frameInteraction = `
        UNFRAMED PRINT PHYSICS:
        - Paper directly on wall, taped or pinned at corners
        - Slight paper curl at edges (1-2mm lift from wall)
        - Soft contact shadow around entire perimeter (2-3mm wide, very soft edge)
        - Paper texture visible at edges (torn or cut edges with fiber detail)
        - Tape or pins cast tiny hard shadows
        - Paper shows subtle ripples from humidity or handling
        - Direct light creates gradient shadow ONTO print surface from environmental objects
        - PRINT MATERIAL: Semi-matte fine art paper with subtle tooth/texture, gentle directional light reflections (not glossy/not completely matte), visible paper grain at close inspection, ink absorption creates slight color depth variations.
      `;
      break;

    case "Sleek Black":
    case "Modern White":
    case "Industrial Metal":
      frameInteraction = `
        FRAMED WITH GLASS PHYSICS:
        - Frame depth: 1-2 inches, casts graduated shadow on wall (darker at base, fading outward)
        - Glass surface shows subtle environmental reflections:
          * Soft reflection of room light sources (20-30% opacity)
          * Faint reflection of opposite wall or ceiling (very subtle, 10-15% opacity)
          * Slight specular highlight from main light source (small, bright accent)
        - Glass has micro-imperfections (barely visible dust specs, slight fingerprint smudge at corner)
        - Frame edge casts crisp shadow line on artwork edge (1-2px hard shadow)
        - Corner joints show dimensional depth (mitered edges with subtle gap/shadow)
        - Glass creates slight color shift (cooler tone) and reduces contrast by ~5%
        - Viewing angle determines reflection intensity (more reflection at oblique angles)
        - PRINT MATERIAL (visible through glass): Semi-matte fine art paper with subtle surface texture, gentle light diffusion through glass onto textured paper surface, paper grain visible on close inspection.
      `;
      break;

    case "Natural Oak":
    case "Classic Gold":
      frameInteraction = `
        FRAMED WITH GLASS PHYSICS (Decorative Frame):
        - Frame depth: 2-3 inches, creates strong architectural shadow
        - Frame profile casts complex shadow with multiple edges (stepped shadow pattern)
        - Glass surface reflections:
          * Room environment softly reflected (25-35% opacity)
          * Light source reflections with natural falloff
          * Subtle color cast from frame material (warm for oak/gold)
        - Frame material shows authentic surface:
          * Wood grain or metal texture visible
          * Slight wear at corners (minor scuffs for lived-in spaces)
          * Natural material variations (oak grain, gold patina)
        - Glass protective surface with barely-visible imperfections
        - Dimensional shadow on artwork from frame lip (soft gradient, 3-5mm)
        - Frame corners show joinery quality (tight miters with natural wood/metal behavior)
        - PRINT MATERIAL (visible through glass): Semi-matte fine art paper with subtle surface texture, gentle light diffusion through glass onto textured paper surface, paper grain visible on close inspection.
      `;
      break;

    case "Auto":
    default:
      frameInteraction = `
        FRAMED PHYSICS (Style Matched to Environment):
        - Frame appropriate to scene aesthetic with authentic depth (1-3 inches)
        - Glass protection shows environmental reflections:
          * Soft room reflections (20-30% opacity)
          * Light source specular highlights
          * Subtle environmental color cast
        - Frame shadow on wall matches light direction and quality
        - Glass surface has realistic imperfections (micro-dust, slight smudge)
        - Frame material shows appropriate texture and wear level for environment
        - Dimensional shadow on artwork edge from frame lip
        - Corner construction visible with natural joinery
        - PRINT MATERIAL (visible through glass): Semi-matte fine art paper with subtle surface texture, gentle light diffusion through glass onto textured paper surface, paper grain visible on close inspection.
      `;
  }

  // Lighting-specific interaction
  let lightInteraction = "";

  switch (lighting) {
    case "Natural Daylight":
      lightInteraction = `
        NATURAL DAYLIGHT INTERACTION:
        - Directional shadows with soft penumbra (3-5x shadow core size)
        - Color temperature 5500-6500K (cool, slightly blue-tinted)
        - Gradual falloff across scene (inverse square law)
        - Window-sourced light creates rectangular light patterns on walls
        - Frame shadows more diffuse (larger light source = softer shadows)
        - Glass reflections show window shape and exterior sky color
        - Atmospheric scattering creates subtle haze in shadow areas
      `;
      break;

    case "Soft Morning":
      lightInteraction = `
        SOFT MORNING LIGHT INTERACTION:
        - Warm color temperature 3800-4500K (golden, peachy tones)
        - Very soft shadows (large diffuse source = minimal shadow edge)
        - Low angle creates elongated shadows
        - Warm light wraps around frame edges (gentle rim lighting)
        - Glass reflections show warm sunrise/morning sky colors
        - Gentle gradient lighting across scene (darker shadows, brighter highlights = high dynamic range)
        - Atmospheric glow in highlight areas
      `;
      break;

    case "Golden Hour":
      lightInteraction = `
        GOLDEN HOUR INTERACTION:
        - Warm color temperature 3000-3800K (deep orange-gold)
        - Long dramatic shadows with warm-toned penumbra
        - Strong directional light from low angle (sun near horizon)
        - Frame creates elongated shadow (3-5x frame width)
        - Glass shows warm colored reflections (orange, amber, gold)
        - High contrast between warm highlights and cool shadows
        - Light wraps around edges creating strong rim lighting effect
        - Atmospheric haze visible in shadow regions (blue-purple shadow tones)
      `;
      break;

    case "Studio Lighting":
      lightInteraction = `
        STUDIO LIGHTING INTERACTION:
        - Multiple light sources with controlled ratios
        - Key light creates main shadow (harder edge, defined direction)
        - Fill light reduces shadow density (shadows are ~30-40% density, not black)
        - Rim/separation light on frame edges (bright accent line)
        - Controlled color temperature 5000-5500K (neutral, calibrated)
        - Frame shadow has harder edge (smaller light source)
        - Glass reflections show multiple light sources (key + fill visible)
        - Even falloff across scene (managed lighting prevents hotspots)
        - Minimal atmospheric effects (controlled studio environment)
      `;
      break;

    case "Moody Dim":
      lightInteraction = `
        MOODY DIM LIGHTING INTERACTION:
        - Low overall light level with dramatic contrast
        - Warm tungsten color temperature 2700-3200K (amber-orange)
        - Deep shadows with subtle ambient fill (10-20% shadow luminance)
        - Small hard light source creates defined shadow edges
        - Frame shadow is dark and prominent
        - Glass reflections show warm point light sources (practical lights, lamps)
        - High contrast ratio (bright highlights fall off quickly to shadow)
        - Atmospheric fog or haze more visible in dim lighting (Tyndall effect)
        - Shadow areas have warm ambient color (bounce from surrounding warm surfaces)
      `;
      break;

    case "Auto":
    default:
      lightInteraction = `
        NATURAL LIGHTING INTERACTION (Scene-Appropriate):
        - Light direction and quality match environment logic
        - Shadows appropriate to light source type (hard for point/sun, soft for diffuse/window)
        - Color temperature matches scene context (cool daylight, warm interior, mixed urban)
        - Frame shadows follow light physics (direction, falloff, penumbra)
        - Glass reflections show environmental light sources accurately
        - Contrast ratio appropriate to lighting condition
        - Atmospheric effects scaled to light level and scene type
      `;
  }

  return frameInteraction + "\n" + lightInteraction;
};

/**
 * Returns atmospheric depth cues and camera behavior details.
 */
export const getAtmosphericAndCameraBehavior = (shotContext: ShotContext): string => {
  const { isMacro, cameraAngle } = shotContext;

  let depthCues = "";
  let cameraBehavior = "";

  // Atmospheric depth (varies by shot type)
  if (isMacro) {
    depthCues = `
      MACRO ATMOSPHERIC DEPTH:
      - Background completely out of focus (bokeh circles 5-10x subject size)
      - Atmospheric haze negligible (too close for significant air)
      - Focus falloff extremely rapid (sharp plane 2-3mm thick)
      - Background color melts into abstract shapes
      - No spatial context depth cues (no horizon, no room)
    `;
  } else {
    depthCues = `
      ATMOSPHERIC DEPTH CUES:
      - Aerial perspective: background elements slightly desaturated and cooler-toned
      - Contrast reduction with distance (foreground sharp, background softer)
      - Atmospheric haze increases with distance (subtle blue-gray veil on far elements)
      - Overlapping planes create spatial depth (frame → wall → background objects)
      - Size gradient: nearer objects larger than distant similar objects
      - Detail reduction: background elements less detailed than foreground
      - Color saturation: vibrant foreground, muted background
    `;
  }

  // Camera behavior (handheld vs tripod)
  if (isMacro || cameraAngle === "Close Detail" || cameraAngle === "Extreme Macro") {
    cameraBehavior = `
      CAMERA BEHAVIOR - HANDHELD CLOSE-UP:
      - Slight organic imperfection in framing (not perfectly centered, 2-3° tilt possible)
      - Micro-motion blur on extreme edges (photographer breathing)
      - Focus plane slightly off-perfect center (human focusing error)
      - Subtle lens aberrations more visible (chromatic aberration at edges)
      - Vignetting natural (not added in post)
      - Grain structure organic and irregular (film grain, not digital noise)
    `;
  } else {
    cameraBehavior = `
      CAMERA BEHAVIOR - TRIPOD/STABILIZED:
      - Precise framing with natural micro-variations (not CG-perfect)
      - Even sharpness across frame (no motion blur)
      - Subtle lens characteristics:
        * Slight vignetting in corners (1-stop light falloff)
        * Minimal chromatic aberration on high-contrast edges
        * Gentle field curvature (edges slightly softer than center)
      - Natural color rendering (film emulation color science)
      - Film grain consistent across frame (Kodak Portra 400 grain structure)
      - Exposure appropriate to scene (not HDR-flat, natural dynamic range)
    `;
  }

  return depthCues + "\n" + cameraBehavior;
};

/**
 * Returns context-specific negative prompts to push away from digital/perfect looks.
 */
export const getContextualNegativePrompts = (context: ShotContext, vibe: AnalysisVibe): string[] => {
  const baseNegatives = [
    // Digital artifacts
    "3d render", "cgi", "digital art", "photoshop composite", "artificial",
    "plastic appearance", "waxy skin tones", "digital painting",

    // Perfection indicators
    "perfectly clean", "pristine showroom", "catalog photography",
    "zero imperfections", "sterile", "too perfect",

    // Common AI tells
    "oversaturated colors", "blown out highlights", "crushed blacks",
    "artificial bokeh overlay", "lens blur filter", "gaussian blur",
    "artificial vignette", "fake film grain", "digital noise",

    // Composition issues
    "centered composition", "perfectly symmetrical", "floating objects",
    "wrong perspective", "impossible shadows", "conflicting light sources",

    // Quality issues
    "blurry", "out of focus", "soft focus", "jpeg artifacts",
    "compression artifacts", "banding", "pixelated",

    // Unwanted elements
    "people", "animals", "faces", "hands", "text", "watermarks",
    "logos", "brands", "signage with readable text"
  ];

  // Macro-specific negatives
  if (context.isMacro) {
    return [
      ...baseNegatives,
      "wide shot", "full room view", "environmental context",
      "distant camera", "entire frame visible", "wall visible",
      "flat lighting", "even depth of field", "everything in focus",
      "no bokeh", "sharp background", "tripod wide angle"
    ];
  }

  // Vibe-specific negatives
  const vibeNegatives: Record<AnalysisVibe, string[]> = {
    "Industrial & Raw": [
      "pristine clean walls", "polished surfaces", "luxury materials",
      "soft romantic lighting", "pastel colors", "decorative frames"
    ],
    "Modern & Minimalist": [
      "clutter", "ornate decoration", "warm cluttered aesthetic",
      "vintage patina", "rustic textures", "busy composition"
    ],
    "Cozy & Bohemian": [
      "stark white walls", "harsh industrial lighting", "cold materials",
      "minimalist emptiness", "sterile environment", "corporate aesthetic"
    ],
    "Luxury & High-end": [
      "cheap materials", "plastic furniture", "fluorescent lighting",
      "clutter", "DIY aesthetic", "budget fixtures"
    ],
    "Public & Street": [
      "pristine gallery walls", "luxury materials", "clean minimalist spaces",
      "perfect lighting", "staged photography", "interior design aesthetic"
    ],
    "Surprise Me": [
      "generic stock photo", "corporate stock imagery", "overused composition"
    ]
  };

  return [...baseNegatives, ...vibeNegatives[vibe]];
};

/**
 * Helper to build the system prompt based on Vibe
 */
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

/**
 * Analyzes the uploaded artwork and suggests environment prompts.
 */
export const analyzeImageForPrompts = async (base64Image: string, vibe: AnalysisVibe = "Surprise Me"): Promise<string[]> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key not found. Please set GEMINI_API_KEY environment variable.");

  const ai = new GoogleGenAI({ apiKey });
  const cleanBase64 = stripBase64Header(base64Image);

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

/**
 * Regenerates a single prompt suggestion based on the image and vibe.
 */
export const regenerateSinglePrompt = async (
  base64Image: string,
  vibe: AnalysisVibe,
  existingPrompts: string[] = []
): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key not found. Please set GEMINI_API_KEY environment variable.");

  const ai = new GoogleGenAI({ apiKey });
  const cleanBase64 = stripBase64Header(base64Image);

  const existingList = existingPrompts.length > 0
    ? `\n\nAVOID DUPLICATING THESE EXISTING SUGGESTIONS:\n${existingPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n`
    : '';

  const prompt = `
    ${getSystemPromptForVibe(vibe)}
    Generate exactly 1 UNIQUE, CREATIVE suggestion that is DIFFERENT from generic ones.
    Be specific, unexpected, and avoid clichés.
    ${existingList}
    Current timestamp: ${Date.now()} (inspire fresh perspectives)
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
        responseMimeType: "application/json",
        temperature: 1.2
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
 * Builds specialized prompt for contact sheet generation
 * Reuses exact same quality logic as regular mockups for consistency
 */
const buildContactSheetPrompt = (
  settings: GenerationSettings,
  cameraAngles: CameraAngle[]
): string => {
  const gridSize = cameraAngles.length === 6 ? '2x3' : '3x3';

  // Camera angle instructions
  const angleInstructions: Record<CameraAngle, string> = {
    "Wide Establishing": "Full wide shot showing the entire wall/room context with the framed artwork as the focal point. Camera positioned 10+ feet back, eye-level, straight-on.",
    "Medium Focus": "Medium shot centered on the framed artwork. Camera 5-6 feet away, slightly above eye level (15° down), capturing frame and immediate surroundings.",
    "Close Detail": "Close-up on the artwork surface showing print texture and frame edge. Camera 2 feet away, eye-level, straight-on.",
    "Low Dramatic": "Low-angle shot from ground level looking up at the artwork. Camera positioned low (12-18 inches from floor), angled up 30-45°, creating elongated perspective.",
    "High Overhead": "High-angle overhead view looking down at the artwork. Camera positioned above (ceiling height), angled down 60-75°.",
    "Extreme Macro": "Extreme close-up detail on corner of frame or artwork texture. Camera inches away, slight diagonal angle to show depth.",
    "Side Depth": "Side-angle profile shot emphasizing frame depth and wall shadows. Camera positioned far left or right, 45-60° off-axis, compressing perspective.",
    "Three-Quarter": "Three-quarter angle combining side and front view. Camera 45° to the left/right, slightly elevated (20° above eye level).",
    "Corner Detail": "Detail shot focusing on frame corner, mounting hardware, or texture intersection. Camera close, angled to show dimensional detail."
  };

  // Build shot list with lens specs per angle
  const shotList = cameraAngles.map((angle, idx) => {
    const shotContext: ShotContext = {
      cameraAngle: angle,
      isMacro: false,
      shotType: "contactSheet"
    };
    const lensSpecs = getLensSpecsForContext(shotContext);

    return `Frame ${idx + 1}: ${angleInstructions[angle]}
      LENS: ${lensSpecs.focalLength}, ${lensSpecs.aperture}
      DISTANCE: ${lensSpecs.distanceFromSubject}
      DOF: ${lensSpecs.depthOfField}
      CHARACTERISTICS: ${lensSpecs.lensCharacteristics}`;
  }).join('\n    ');

  // === REUSE EXACT SAME QUALITY LOGIC AS REGULAR MOCKUPS ===

  // Quality prefix
  const qualityPrefix = `
    Award-winning editorial photography, shot on 35mm film, Kodak Portra 400 aesthetic.
    Features: Slight chromatic aberration, organic color grading, imperfect lens characteristics.
    The final image must look like a raw, unpolished photograph, not a 3D render.
    8k resolution, hyperrealistic, detailed texture.

    FILM GRAIN (MANDATORY):
    - Apply authentic analog film grain throughout the ENTIRE image — this is non-negotiable.
    - Organic, irregular grain that varies in density (denser in shadows, finer in highlights), like real Kodak Portra 400 pushed one stop.
    - Subtle but clearly visible at full resolution — embedded in the image, not overlaid.
    - Luminance-based (monochromatic) grain only — do NOT shift or alter the color palette. Preserve the scene's natural colors.
    - The grain should make the image feel analog and tactile, like a real film photograph.
  `;

  // Environmental realism
  const environmentalDetails = getEnvironmentalDetails(settings.analysisVibe || "Surprise Me");
  const environmentalRealism = `
    ENVIRONMENTAL REALISM: ${environmentalDetails.ambientDetails}
    Imperfections: ${environmentalDetails.imperfections.slice(0, 3).join("; ")}.
    Atmosphere: ${environmentalDetails.atmospheric.slice(0, 2).join("; ")}.
  `;

  let frameContext = "";
  const sizeContext = settings.printSize ? settings.printSize : "A3";

  // Physical interaction - use enhanced version
  const physicalInteraction = getPhysicalInteractionDetails(settings.frameStyle, settings.lighting);

  // Handle Frame Style (copied from generateMockup lines 414-420)
  if (settings.frameStyle === "None") {
    frameContext = `The attached image is taped or pasted directly onto the wall as a ${sizeContext} poster. Show paper texture, slight curling at corners, and surface shadows falling across the image.`;
  } else if (settings.frameStyle === "Auto") {
    frameContext = `The attached image is professionally framed in a style that perfectly matches the environment's aesthetic (${sizeContext} size). Include realistic glass reflections and frame shadows.`;
  } else {
    frameContext = `The attached image is physically framed in a ${settings.frameStyle} frame (${sizeContext} size) hanging on the wall. Include realistic glass reflections and frame shadows.`;
  }

  // Handle Environment Context (copied from generateMockup lines 422-432)
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

  // === CONTACT SHEET SPECIFIC ADDITIONS ===

  return `
    ${qualityPrefix}

    CRITICAL INSTRUCTION: Generate a ${gridSize} contact sheet showing the EXACT SAME mockup scene from ${cameraAngles.length} different camera positions.

    SUBJECT HIERARCHY:
    1. PRIMARY SUBJECT: The attached image is the artwork/photograph to be displayed INSIDE the frame on the wall.
    2. ENVIRONMENT/LOCATION: The frame is located in this setting: ${settings.prompt}
    3. ENVIRONMENTAL ENHANCEMENTS: Subtle realistic details that exist in the location (described below).

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

    PHYSICS: ${physicalInteraction}
    COLOR & LIGHT ON PRINT: The artwork is a physical print LIT BY room light, not a self-illuminated screen. Tint the artwork's colors to match the room's ambient light temperature (warm room = warm tint on print, cool daylight = cool tint). The print's brightness and contrast should match what the room lighting would produce — dimmer in moody rooms, brighter near light sources, with natural light falloff across the surface. The artwork should sit within the room's tonal range, never appearing unnaturally vivid or glowing.

    CONSISTENCY ACROSS ALL ${cameraAngles.length} FRAMES:
    - The artwork/print content must be IDENTICAL in every frame
    - Frame style, lighting, wall texture, environment must remain EXACTLY the same
    - Environmental imperfections and objects stay consistent
    - Only camera angle/position/lens varies between frames

    CAMERA POSITIONS WITH LENS SPECS:
    ${shotList}

    OUTPUT FORMAT:
    - Generate a ${gridSize} grid contact sheet
    - All ${cameraAngles.length} frames must be the same aspect ratio (${settings.aspectRatio})
    - NO borders or gaps between frames - tight grid, frames directly adjacent
    - Each frame is a complete, high-quality photograph
    - No labels, numbers, or text overlays

    ${settings.negativePrompt ? `Do NOT include: ${settings.negativePrompt}.` : ''}
  `.trim();
};

/**
 * Generates a contact sheet with multiple camera angles
 */
export const generateContactSheet = async (
  base64Image: string,
  settings: GenerationSettings,
  cameraAngles: CameraAngle[]
): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("API Key not found. Please set GEMINI_API_KEY environment variable.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const cleanBase64 = stripBase64Header(base64Image);

  const prompt = buildContactSheetPrompt(settings, cameraAngles);

  try {
    const response = await retry<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } }
        ]
      },
      config: {
        imageConfig: {
          aspectRatio: settings.aspectRatio,
          imageSize: "1K"
        }
      }
    }));

    const imageUrl = extractImageFromResponse(response);
    if (!imageUrl) throw new Error("No image data in response");
    return imageUrl;
  } catch (error) {
    console.error("Error generating contact sheet:", error);
    throw error;
  }
};

/**
 * Extracts individual frames from contact sheet using simple grid division
 */
export const extractContactSheetFrames = async (
  contactSheetDataUrl: string,
  gridSize: ContactSheetGrid,
  cameraAngles: CameraAngle[]
): Promise<Array<{imageUrl: string, cameraAngle: CameraAngle}>> => {
  console.log("extractContactSheetFrames called", { gridSize, angleCount: cameraAngles.length, dataUrlLength: contactSheetDataUrl.length });
  const [rows, cols] = gridSize === "2x3" ? [2, 3] : [3, 3];

  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      console.log("Contact sheet image loaded", { width: img.width, height: img.height });
      try {
        const frameWidth = img.width / cols;
        const frameHeight = img.height / rows;
        console.log("Frame dimensions", { frameWidth, frameHeight, rows, cols });

        const frames: Array<{imageUrl: string, cameraAngle: CameraAngle}> = [];

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const canvas = document.createElement('canvas');
            canvas.width = frameWidth;
            canvas.height = frameHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error("Canvas context not available");

            ctx.drawImage(
              img,
              col * frameWidth,
              row * frameHeight,
              frameWidth,
              frameHeight,
              0,
              0,
              frameWidth,
              frameHeight
            );

            const frameIndex = row * cols + col;
            const dataUrl = canvas.toDataURL('image/png');
            frames.push({
              imageUrl: dataUrl,
              cameraAngle: cameraAngles[frameIndex] || `Frame ${frameIndex + 1}` as CameraAngle
            });
            console.log(`Extracted frame ${frameIndex + 1}/${rows * cols}`, {
              cameraAngle: cameraAngles[frameIndex],
              dataUrlLength: dataUrl.length
            });
          }
        }

        console.log("All frames extracted successfully", { totalFrames: frames.length });
        resolve(frames);
      } catch (error) {
        console.error("Error during extraction:", error);
        reject(error);
      }
    };

    img.onerror = (e) => {
      console.error("Failed to load contact sheet image", e);
      reject(new Error("Failed to load contact sheet image"));
    };
    img.src = contactSheetDataUrl;
  });
};

/**
 * Generates a mockup based on an uploaded image and a text prompt.
 */
export const generateMockup = async (
  base64Image: string,
  settings: GenerationSettings,
  options?: { macro?: boolean }
): Promise<string[]> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("API Key not found. Please set GEMINI_API_KEY environment variable.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const cleanBase64 = stripBase64Header(base64Image);

  const isMacro = options?.macro === true;
  const resolvedImageSize = isMacro && settings.imageSize === "1K" ? "2K" : settings.imageSize;

  // Create shot context for lens specs
  const shotContext: ShotContext = {
    cameraAngle: undefined,
    isMacro: isMacro,
    shotType: isMacro ? "macro" : "standard"
  };

  // 1. Enhanced quality prefix for Unsplash/Film style
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

  // 2. NEW: Lens specifications (context-aware)
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

  // 3. NEW: Environmental realism details
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

  // 5. Environment context (Lighting/Texture)
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

  // 6. NEW: Enhanced physical interaction details
  const physicalInteraction = getPhysicalInteractionDetails(settings.frameStyle, settings.lighting);

  // 7. NEW: Atmospheric and camera behavior
  const atmosphericBehavior = getAtmosphericAndCameraBehavior(shotContext);

  // 8. Assemble final prompt with clear hierarchy
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

  // 9. Macro override if needed
  if (isMacro) {
    finalPrompt += buildMacroStyleInstructions();
  }

  // 10. NEW: Enhanced contextual negatives
  const contextNegatives = getContextualNegativePrompts(shotContext, settings.analysisVibe || "Surprise Me");
  const negativeClauses: string[] = [...contextNegatives];

  if (settings.negativePrompt && settings.negativePrompt.trim().length > 0) {
    negativeClauses.push(settings.negativePrompt.trim());
  }

  if (negativeClauses.length > 0) {
    finalPrompt += ` Do NOT include: ${negativeClauses.join(", ")}.`;
  }

  // Build content parts: text prompt + artwork image + optional style reference
  const contentParts: Array<{text: string} | {inlineData: {mimeType: string, data: string}}> = [
    { text: finalPrompt },
    { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } },
  ];

  if (settings.styleReferenceImage) {
    const cleanStyleBase64 = stripBase64Header(settings.styleReferenceImage);
    const styleMime = settings.styleReferenceImage.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    contentParts.push({ inlineData: { mimeType: styleMime, data: cleanStyleBase64 } });
  }

  // Create an array of promises for parallel execution
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

  // Wait for all generations to complete
  const results = await Promise.all(promises);
  
  // Filter out any failed attempts
  const generatedImages = results.filter((img): img is string => img !== null);

  if (generatedImages.length === 0) {
    throw new Error("No images were generated. Please try a different prompt or image.");
  }

  return generatedImages;
};

/**
 * Generates a composite image by placing artwork into an interior scene photo.
 * If the photo has an existing frame/artwork, replaces it. If not, adds a frame on a natural wall spot.
 */
export const generateComposite = async (
  baseImageBase64: string,
  artworkBase64: string,
  instructions: string,
  aspectRatio: string,
  imageSize: string,
  artworkAspectRatio?: number
): Promise<string[]> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("API Key not found. Please set GEMINI_API_KEY environment variable.");
  }

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
 * Refines a previous composite output by applying specific changes while keeping everything else.
 */
export const refineComposite = async (
  previousOutputBase64: string,
  originalArtworkBase64: string,
  refinementInstructions: string,
  aspectRatio: string,
  imageSize: string
): Promise<string[]> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("API Key not found. Please set GEMINI_API_KEY environment variable.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const cleanPrevious = stripBase64Header(previousOutputBase64);
  const cleanArtwork = stripBase64Header(originalArtworkBase64);

  const prompt = `
    You are refining a previously generated interior scene composite. The first image is the PREVIOUS OUTPUT (the composited scene with artwork on the wall). The second image is the ORIGINAL ARTWORK for reference.

    REFINEMENT INSTRUCTIONS: ${refinementInstructions}

    CRITICAL: Apply ONLY the refinement described above. Keep EVERYTHING else exactly the same:
    - Same room, same wall, same furniture, same lighting
    - Same frame position and style (unless the refinement specifically asks to change it)
    - Same artwork placement (unless the refinement specifically asks to move it)
    - Same perspective, same color grading, same atmosphere

    The refinement should feel like a subtle adjustment to the existing image, not a complete regeneration.
    OUTPUT: Generate exactly ONE refined image.
  `.trim();

  try {
    const response = await retry<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: cleanPrevious } },
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
    if (!imageUrl) throw new Error("No image data in refine response");
    return [imageUrl];
  } catch (error) {
    console.error("Error refining composite:", error);
    throw error;
  }
};

/**
 * Upscales a previously generated mockup to higher resolution.
 * Passes BOTH the 1K mockup (for scene composition) and the original artwork (for maximum detail).
 */
export const upscaleMockup = async (
  lowResResultBase64: string,
  _originalArtworkBase64: string,
  settings: GenerationSettings
): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("API Key not found. Please set GEMINI_API_KEY environment variable.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const cleanLowRes = stripBase64Header(lowResResultBase64);

  const prompt = `
    TASK: Upscale this image to higher resolution. This is a PURE ENHANCEMENT — NOT a new generation.

    Your output must be a pixel-faithful, higher-resolution version of this EXACT image. Do NOT reimagine, recompose, or relocate ANY element.

    WHAT MUST STAY IDENTICAL (zero deviation allowed):
    - Frame position on the wall (same X/Y placement, same size relative to the scene)
    - Camera angle, perspective, and field of view
    - Room layout, furniture placement, every object's position
    - Lighting direction, shadows, color temperature
    - Background elements, wall texture, floor, ceiling — everything
    - Overall color grade, mood, and atmosphere

    THE ONLY CHANGE: Higher resolution with sharper details and finer textures across the entire image — walls, frame, artwork inside the frame, furniture, floor, all surfaces.

    Think of this as a super-resolution enhancement, like running an AI upscaler. The composition is LOCKED. Only resolution and detail improve.

    OUTPUT: Generate exactly ONE high-resolution image that is visually identical to the input but at 4K quality.
  `.trim();

  try {
    const response = await retry<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: cleanLowRes } }
        ]
      },
      config: {
        temperature: 0.2,
        imageConfig: {
          aspectRatio: settings.aspectRatio,
          imageSize: "4K" as any,
        }
      }
    }));

    const imageUrl = extractImageFromResponse(response);
    if (!imageUrl) throw new Error("No image data in upscale response");
    return imageUrl;
  } catch (error) {
    console.error("Error upscaling mockup:", error);
    throw error;
  }
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
