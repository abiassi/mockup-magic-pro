export type GenerationMode = "batch" | "contactSheet";

export type ContactSheetGrid = "2x3" | "3x3";

export type CameraAngle =
  | "Wide Establishing"
  | "Medium Focus"
  | "Close Detail"
  | "Low Dramatic"
  | "High Overhead"
  | "Extreme Macro"
  | "Side Depth"
  | "Three-Quarter"
  | "Corner Detail";

export interface ContactSheetSettings {
  gridSize: ContactSheetGrid;
  cameraAngles: CameraAngle[];
}

export interface MockupResult {
  id: string;
  imageUrl: string;
  prompt: string;
  createdAt: number;
  isHighRes?: boolean;
  isContactSheet?: boolean;
  extractedFrom?: string;
  cameraAngle?: CameraAngle;
  variantType?: "standard" | "macro" | "composite";
  aspectRatio?: "1:1" | "3:4" | "4:3" | "16:9" | "9:16";
  refinedFrom?: string;
  compositeBaseUrl?: string;
  compositeArtworkUrl?: string;
}

export interface ArtworkLibraryItem {
  id: string;
  name: string;
  imageUrl: string;
  createdAt: number;
}

export interface SourcePhotoLibraryItem {
  id: string;
  name: string;
  imageUrl: string;
  createdAt: number;
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
  generationMode: GenerationMode;
  contactSheetSettings?: ContactSheetSettings;
  macroMode?: boolean;
  analysisVibe?: AnalysisVibe;
  /** Original artwork width/height ratio (e.g. 1.5 for 3:2 landscape) */
  artworkAspectRatio?: number;
  /** Base64 data URL of an optional style reference image */
  styleReferenceImage?: string;
}

// Realism enhancement types
export interface LensSpec {
  focalLength: string;
  aperture: string;
  distanceFromSubject: string;
  depthOfField: string;
  lensCharacteristics: string;
  perspective: string;
}

export type ShotContext = {
  cameraAngle?: CameraAngle;
  isMacro: boolean;
  shotType: "standard" | "contactSheet" | "macro";
};

export interface EnvironmentalDetails {
  imperfections: string[];
  atmospheric: string[];
  sceneDressing: string[];
  realismLevel: "pristine" | "lived-in" | "worn" | "gritty";
  ambientDetails: string;
}