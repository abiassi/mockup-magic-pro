export interface MockupResult {
  id: string;
  imageUrl: string;
  prompt: string;
  createdAt: number;
  isHighRes?: boolean; // New field to track if this is a draft or final
}

export type FrameStyle = "Auto" | "None" | "Sleek Black" | "Modern White" | "Natural Oak" | "Classic Gold" | "Industrial Metal";

export type LightingStyle = "Auto" | "Natural Daylight" | "Soft Morning" | "Golden Hour" | "Studio Lighting" | "Moody Dim";

export type WallTexture = "Auto" | "Clean Drywall" | "Exposed Brick" | "Raw Concrete" | "Smooth Plaster" | "Wooden Paneling";

export type PrintSize = "A1" | "A2" | "A3" | "A4";

export type AnalysisVibe = "Industrial & Raw" | "Modern & Minimalist" | "Cozy & Bohemian" | "Luxury & High-end" | "Public & Street" | "Surprise Me";

export interface GenerationSettings {
  prompt: string;
  negativePrompt: string;
  count: number;
  aspectRatio: "1:1" | "3:4" | "4:3" | "16:9" | "9:16";
  imageSize: "1K" | "2K" | "4K";
  frameStyle: FrameStyle;
  lighting: LightingStyle;
  wallTexture: WallTexture;
  printSize: PrintSize;
}