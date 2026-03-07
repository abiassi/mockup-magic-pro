import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { checkApiKey, promptForApiKey, setApiKey, generateMockup, analyzeImageForPrompts, regenerateSinglePrompt, getEnvApiKey, normalizeApiKey, generateComposite, refineComposite } from './services/geminiService';
import { storageService } from './services/storageService';
import { cloudStorageService } from './services/cloudStorageService';
import { GenerationSettings, MockupResult, FrameStyle, LightingStyle, WallTexture, PrintSize, AnalysisVibe, CameraAngle, GenerationMode, ContactSheetGrid, ArtworkLibraryItem, SourcePhotoLibraryItem } from './types';
import {
  PhotoIcon,
  SparklesIcon,
  ArrowPathIcon,
  CloudArrowUpIcon,
  TrashIcon,
  AdjustmentsHorizontalIcon,
  CheckCircleIcon,
  Square2StackIcon,
  SunIcon,
  HomeModernIcon,
  XMarkIcon,
  ArrowsPointingOutIcon,
  ArrowDownTrayIcon,
  BoltIcon,
  PlayCircleIcon,
  PencilSquareIcon,
  SwatchIcon,
  ArrowUpTrayIcon,
  CircleStackIcon
} from '@heroicons/react/24/outline';

// --- Helpers ---
const detectAspectRatio = (width: number, height: number): "1:1" | "3:4" | "4:3" | "16:9" | "9:16" => {
  const ratio = width / height;
  if (ratio > 1.6) return "16:9";
  if (ratio > 1.1) return "4:3";
  if (ratio < 0.6) return "9:16";
  if (ratio < 0.9) return "3:4";
  return "1:1";
};

// --- Constants ---
const INITIAL_PRESETS = [
  "A sun-drenched industrial loft wall with harsh shadows and dust motes",
  "A moody, dimly lit art gallery with a single spotlight hitting the frame",
  "A gritty subway station wall with peeling posters and fluorescent hum"
];

const FRAME_STYLES: FrameStyle[] = [
  "Auto", "None", "Sleek Black", "Modern White", "Natural Oak", "Classic Gold", "Industrial Metal"
];

const LIGHTING_STYLES: LightingStyle[] = [
  "Auto", "Natural Daylight", "Soft Morning", "Golden Hour", "Studio Lighting", "Moody Dim"
];

const WALL_TEXTURES: WallTexture[] = [
  "Auto", "Clean Drywall", "Smooth Plaster", "Exposed Brick", "Raw Concrete", "Wooden Paneling"
];

const PRINT_SIZES: PrintSize[] = [
  "A1", "A2", "A3", "A4"
];

const ANALYSIS_VIBES: AnalysisVibe[] = [
  "Industrial & Raw", "Modern & Minimalist", "Cozy & Bohemian", "Luxury & High-end", "Public & Street", "Surprise Me"
];

const CAMERA_ANGLES: CameraAngle[] = [
  "Wide Establishing",
  "Medium Focus",
  "Close Detail",
  "Low Dramatic",
  "High Overhead",
  "Extreme Macro",
  "Side Depth",
  "Three-Quarter",
  "Corner Detail"
];

const DEFAULT_SETTINGS: GenerationSettings = {
  prompt: INITIAL_PRESETS[0],
  negativePrompt: "people, animals, text, watermark, blurry, low quality, distortion, ugly, 3d render, plastic look",
  count: 1,
  aspectRatio: "3:4",
  imageSize: "1K", // Default to Draft quality
  frameStyle: "Auto",
  lighting: "Auto",
  wallTexture: "Auto",
  printSize: "A3",
  generationMode: "batch", // NEW
  macroMode: false
};

// --- UI Components ---

const SingleSelectPills = <T extends string>({ 
  options, 
  selected, 
  onChange,
  label,
  icon: Icon,
  disabled = false
}: { 
  options: T[], 
  selected: T, 
  onChange: (newSelected: T) => void,
  label: string,
  icon: React.ElementType,
  disabled?: boolean
}) => {
  return (
    <div className="mb-4">
      <label className="text-xs text-gray-500 mb-2 flex items-center gap-1 uppercase tracking-wide">
         <Icon className="w-3 h-3" /> {label}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => {
          const isSelected = selected === opt;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              disabled={disabled}
              className={`
                text-[10px] font-medium px-2.5 py-1.5 rounded-full border transition-all
                ${isSelected 
                  ? 'bg-yellow-500 border-yellow-500 text-black shadow-md' 
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const MultiSelectPills = <T extends string>({ 
  options, 
  selected, 
  onChange,
  label,
  icon: Icon
}: { 
  options: T[], 
  selected: T[], 
  onChange: (newSelected: T[]) => void,
  label: string,
  icon: React.ElementType
}) => {
  const toggleOption = (opt: T) => {
    if (selected.includes(opt)) {
      if (selected.length === 1) return; 
      onChange(selected.filter(s => s !== opt));
    } else {
      if (opt === "Auto") {
        onChange(["Auto"] as unknown as T[]);
      } else {
        const withoutAuto = selected.filter(s => s !== "Auto");
        onChange([...withoutAuto, opt]);
      }
    }
  };

  return (
    <div className="mb-4">
      <label className="text-xs text-gray-500 mb-2 flex items-center gap-1 uppercase tracking-wide">
         <Icon className="w-3 h-3" /> {label}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => {
          const isSelected = selected.includes(opt);
          return (
            <button
              key={opt}
              onClick={() => toggleOption(opt)}
              className={`
                text-[10px] font-medium px-2.5 py-1.5 rounded-full border transition-all
                ${isSelected 
                  ? 'bg-yellow-500 border-yellow-500 text-black shadow-md' 
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                }
              `}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// --- Helpers ---
function mergeResults(cloud: MockupResult[], local: MockupResult[]): MockupResult[] {
  const map = new Map<string, MockupResult>();
  [...local, ...cloud].forEach(r => map.set(r.id, r));
  return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
}

// --- Main App ---

const TOKEN_KEY = 'site_token';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isBootstrappingAuth, setIsBootstrappingAuth] = useState(true);
  const [passwordInput, setPasswordInput] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState("");
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [hasEnvKey, setHasEnvKey] = useState<boolean>(false);
  const [isBootstrappingKey, setIsBootstrappingKey] = useState<boolean>(true);
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [styleReferenceImage, setStyleReferenceImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isDraggingStyle, setIsDraggingStyle] = useState<boolean>(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  
  // Multi-select states
  const [selectedFrames, setSelectedFrames] = useState<FrameStyle[]>(["Auto"]);
  const [selectedLighting, setSelectedLighting] = useState<LightingStyle[]>(["Auto"]);
  const [selectedTextures, setSelectedTextures] = useState<WallTexture[]>(["Auto"]);

  // Analysis Vibe State
  const [analysisVibe, setAnalysisVibe] = useState<AnalysisVibe>("Surprise Me");

  // Editable Prompt List
  const [editablePrompts, setEditablePrompts] = useState<Array<{id: string, text: string, isRegenerating?: boolean}>>([
    { id: '1', text: INITIAL_PRESETS[0] }
  ]);
  
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  
  // General settings (Size, Ratio, etc)
  const [settings, setSettings] = useState<GenerationSettings>(() => {
    const saved = localStorage.getItem('mockupSettings');
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  });

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [upscaleModel, setUpscaleModel] = useState<'Real-ESRGAN' | 'Clarity AI'>('Real-ESRGAN');
  const [upscalingId, setUpscalingId] = useState<string | null>(null);
  const [generatingContactSheetId, setGeneratingContactSheetId] = useState<string | null>(null);
  const [results, setResults] = useState<MockupResult[]>([]);
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  const [storageInitialized, setStorageInitialized] = useState<boolean>(false);

  // Tab navigation
  const [activeTab, setActiveTab] = useState<"mockups" | "composite">("mockups");

  // Composite mode state
  const [compositeArtwork, setCompositeArtwork] = useState<string | null>(null);
  const [compositeArtworkRatio, setCompositeArtworkRatio] = useState<number | undefined>(undefined);
  const [compositeInstructions, setCompositeInstructions] = useState<string>("");
  const [compositeAspectRatio, setCompositeAspectRatio] = useState<"1:1" | "3:4" | "4:3" | "16:9" | "9:16">("1:1");
  const [isCompositing, setIsCompositing] = useState<boolean>(false);
  const [compositeResults, setCompositeResults] = useState<MockupResult[]>([]);
  const [isDraggingBase, setIsDraggingBase] = useState<boolean>(false);
  const [isDraggingArtwork, setIsDraggingArtwork] = useState<boolean>(false);

  // Artwork library state
  const [artworkLibrary, setArtworkLibrary] = useState<ArtworkLibraryItem[]>([]);
  const [selectedLibraryArtworks, setSelectedLibraryArtworks] = useState<Set<string>>(new Set());

  // Source photo library state
  const [sourcePhotoLibrary, setSourcePhotoLibrary] = useState<SourcePhotoLibraryItem[]>([]);
  const [selectedLibrarySourcePhotos, setSelectedLibrarySourcePhotos] = useState<Set<string>>(new Set());

  // Multi-base queue state
  const [compositeBaseQueue, setCompositeBaseQueue] = useState<Array<{id: string, imageUrl: string, fileName: string}>>([]);

  // Batch composite state
  const [isBatchCompositing, setIsBatchCompositing] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number}>({current: 0, total: 0});

  // Per-result refinement state
  const [expandedRefinement, setExpandedRefinement] = useState<string | null>(null);
  const [refinementText, setRefinementText] = useState<string>("");
  const [refiningId, setRefiningId] = useState<string | null>(null);

  // Deduplicated base URLs from queue + selected library source photos
  const deduplicatedBaseUrls = useMemo((): string[] => {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const b of compositeBaseQueue) {
      if (!seen.has(b.imageUrl)) {
        seen.add(b.imageUrl);
        urls.push(b.imageUrl);
      }
    }
    for (const p of sourcePhotoLibrary) {
      if (selectedLibrarySourcePhotos.has(p.id) && !seen.has(p.imageUrl)) {
        seen.add(p.imageUrl);
        urls.push(p.imageUrl);
      }
    }
    return urls;
  }, [compositeBaseQueue, sourcePhotoLibrary, selectedLibrarySourcePhotos]);

  // Persist settings (only basic ones)
  useEffect(() => {
    localStorage.setItem('mockupSettings', JSON.stringify(settings));
  }, [settings]);

  // Auto-save results to IndexedDB whenever they change
  useEffect(() => {
    if (storageInitialized && results.length > 0) {
      // Only save new/modified results to avoid full writes
      // For now, we'll do a simple approach and save all
      storageService.saveResults(results).catch(err => {
        console.error('Failed to save results to storage:', err);
      });
    }
  }, [results, storageInitialized]);

  useEffect(() => {
    const init = async () => {
      // Step 0: Check existing JWT (client-side expiry check)
      const raw = localStorage.getItem(TOKEN_KEY);
      let authed = false;
      if (raw) {
        try {
          const b64 = raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(atob(b64));
          if (payload.exp * 1000 > Date.now()) {
            authed = true;
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem(TOKEN_KEY);
          }
        } catch {
          localStorage.removeItem(TOKEN_KEY);
        }
      }
      setIsBootstrappingAuth(false);

      try {
        // Check if environment variables exist and are non-placeholder
        const envKey = getEnvApiKey();
        const hasEnv = !!envKey;
        setHasEnvKey(hasEnv);

        // Check if any API key is available (env, AI Studio, or localStorage)
        const authorized = await checkApiKey();
        setHasKey(authorized);

        // Initialize storage and load saved results
        try {
          await storageService.init();
          const savedResults = await storageService.loadAllResults();
          if (savedResults.length > 0) {
            console.log(`Loaded ${savedResults.length} saved results from storage`);
            setResults(savedResults);
            setCompositeResults(savedResults.filter(r => r.variantType === "composite"));
          }
          // Load artwork library
          const savedArtwork = await storageService.loadAllArtwork();
          if (savedArtwork.length > 0) {
            console.log(`Loaded ${savedArtwork.length} artworks from library`);
            setArtworkLibrary(savedArtwork);
          }
          // Load source photo library
          const savedSourcePhotos = await storageService.loadAllSourcePhotos();
          if (savedSourcePhotos.length > 0) {
            console.log(`Loaded ${savedSourcePhotos.length} source photos from library`);
            setSourcePhotoLibrary(savedSourcePhotos);
          }
          setStorageInitialized(true);

          // Step: Fetch from cloud and merge (cloud wins on conflicts)
          if (authed) {
            try {
              const cloudResults = await cloudStorageService.fetchAll();
              if (cloudResults.length > 0) {
                console.log(`Loaded ${cloudResults.length} results from cloud`);
                setResults(prev => mergeResults(cloudResults, prev));
                setCompositeResults(prev => {
                  const merged = mergeResults(cloudResults.filter(r => r.variantType === "composite"), prev);
                  return merged.filter(r => r.variantType === "composite");
                });
              }
            } catch (cloudError) {
              console.warn('Cloud sync failed, using local results:', cloudError);
            }
          }
        } catch (storageError) {
          console.error('Failed to initialize storage:', storageError);
          // Continue without storage - app still works
        }
      } finally {
        setIsBootstrappingKey(false);
      }
    };
    init();
  }, []);

  // --- Password Gate ---
  const handlePasswordSubmit = async () => {
    if (!passwordInput.trim()) return;
    setIsAuthenticating(true);
    setAuthError("");
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      if (!res.ok) {
        setAuthError("Invalid password. Please try again.");
        return;
      }
      const { token } = await res.json();
      localStorage.setItem(TOKEN_KEY, token);
      setIsAuthenticated(true);
    } catch (e) {
      setAuthError("Connection error. Please try again.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Basic API key validation
  const validateApiKey = (key: string): string | null => {
    const normalized = normalizeApiKey(key);
    if (!normalized) {
      setKeyError(key.trim() ? "Please enter your actual Gemini API key (not the placeholder)." : "API key cannot be empty");
      return null;
    }
    if (normalized.length < 10) {
      setKeyError("API key appears to be invalid (too short)");
      return null;
    }
    setKeyError("");
    return normalized;
  };

  const handleConnect = async () => {
    // If environment variables exist, use AI Studio prompt
    if (hasEnvKey) {
      await promptForApiKey();
      const authorized = await checkApiKey();
      setHasKey(authorized);
      return;
    }

    // Otherwise, handle manual key entry
    const normalizedKey = validateApiKey(apiKeyInput);
    if (!normalizedKey) return;

    setIsConnecting(true);
    setKeyError("");

    try {
      // Save the key to localStorage
      setApiKey(normalizedKey);
      
      // Verify the key works by checking again
      const authorized = await checkApiKey();
      if (authorized) {
        setHasKey(true);
        setApiKeyInput("");
      } else {
        setKeyError("Failed to validate API key. Please check and try again.");
      }
    } catch (error) {
      setKeyError("An error occurred while saving the API key. Please try again.");
      console.error(error);
    } finally {
      setIsConnecting(false);
    }
  };

  // --- Magic Analysis ---
  const handleMagicAnalysis = async (imageOverride?: string, vibeOverride?: AnalysisVibe) => {
    const imgToUse = imageOverride || sourceImage;
    if (!imgToUse) return;
    const vibeToUse = vibeOverride || analysisVibe;
    
    setIsAnalyzing(true);
    setEditablePrompts([{ id: 'loading', text: `✨ Analyzing for "${vibeToUse}" vibe...` }]);
    try {
      const suggestions = await analyzeImageForPrompts(imgToUse, vibeToUse);
      if (suggestions.length > 0) {
        const newPrompts = suggestions.map(s => ({ id: crypto.randomUUID(), text: s }));
        setEditablePrompts(newPrompts);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  // Helper to re-roll just one prompt without re-doing the whole set
  const handleRegenerateSinglePrompt = async (id: string) => {
    if (!sourceImage) return;

    setEditablePrompts(prev => prev.map(p => p.id === id ? {...p, isRegenerating: true} : p));

    try {
      // Collect the other prompts to avoid duplicates
      const otherPrompts = editablePrompts
        .filter(p => p.id !== id)
        .map(p => p.text);

      const newText = await regenerateSinglePrompt(sourceImage, analysisVibe, otherPrompts);
      setEditablePrompts(prev => prev.map(p => p.id === id ? {...p, text: newText, isRegenerating: false} : p));
    } catch (e) {
      console.error(e);
      setEditablePrompts(prev => prev.map(p => p.id === id ? {...p, isRegenerating: false} : p));
    }
  };

  // --- Drag & Drop ---
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    processFile(file);
  }, []);
  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processFile(file);
  };
  const processFile = (file: File) => {
    if (!file) return;
    if (file.type !== 'image/jpeg' && file.type !== 'image/jpg') {
      alert("Please upload a JPEG image.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setSourceImage(result);

      const img = new Image();
      img.onload = () => {
        setSettings(prev => ({
          ...prev,
          aspectRatio: detectAspectRatio(img.width, img.height),
          artworkAspectRatio: img.width / img.height
        }));
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  // --- Style Reference Upload ---
  const handleStyleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDraggingStyle(true); }, []);
  const handleStyleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDraggingStyle(false); }, []);
  const handleStyleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingStyle(false);
    const file = e.dataTransfer.files[0];
    processStyleFile(file);
  }, []);
  const handleStyleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processStyleFile(file);
  };
  const processStyleFile = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert("Please upload an image file (JPEG, PNG, etc.).");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setStyleReferenceImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // --- Generation Helpers ---
  const handleGenerateBatch = async () => {
    if (!sourceImage) return;
    if (editablePrompts.length === 0) return;

    setIsGenerating(true);
    
    try {
        const batchPromises = editablePrompts.map(async (promptObj, index) => {
            // Update loading message to show progress
            setLoadingMessage(`Generating variation ${index + 1} of ${editablePrompts.length}...`);
            
            // Stagger requests
            if (index > 0) {
               await new Promise(resolve => setTimeout(resolve, 2500));
            }

            // LOGIC: Round-robin through user selected constraints
            const frame = selectedFrames[index % selectedFrames.length];
            const light = selectedLighting[index % selectedLighting.length];
            const texture = selectedTextures[index % selectedTextures.length];

            const baseSettings: GenerationSettings = {
                ...settings,
                prompt: promptObj.text,
                count: 1,
                frameStyle: frame,
                lighting: light,
                wallTexture: texture,
                analysisVibe: analysisVibe,
                styleReferenceImage: styleReferenceImage || undefined
            };

            const promptResults: MockupResult[] = [];
            
            // Standard shot
            try {
                const images = await generateMockup(sourceImage, baseSettings);
                promptResults.push(
                  ...images.map(img => ({
                    id: crypto.randomUUID(),
                    imageUrl: img,
                    prompt: promptObj.text,
                    createdAt: Date.now(),
                    isHighRes: baseSettings.imageSize === '4K',
                    variantType: "standard" as const,
                    aspectRatio: baseSettings.aspectRatio
                  }))
                );
            } catch (e) {
                console.error(`Failed prompt: ${promptObj.text}`, e);
            }
            return promptResults;
        });

        // We use Promise.all to wait for the staggered executions to finish
        const batchResults = await Promise.all(batchPromises);
        const allResults: MockupResult[] = batchResults.flat();

        // Global macro add-on: exactly +2 macro shots total (not per prompt)
        if (settings.macroMode && editablePrompts.length > 0) {
          const macroPrompt = editablePrompts[0].text;
          const macroImageSize = settings.imageSize === "1K" ? "2K" : settings.imageSize;
          const macroSettings: GenerationSettings = {
            ...settings,
            prompt: macroPrompt,
            count: 2,
            imageSize: macroImageSize,
            frameStyle: selectedFrames[0] ?? settings.frameStyle,
            lighting: selectedLighting[0] ?? settings.lighting,
            wallTexture: selectedTextures[0] ?? settings.wallTexture,
            analysisVibe: analysisVibe,
            styleReferenceImage: styleReferenceImage || undefined
          };

          setLoadingMessage("Generating +2 macro detail shots...");

          try {
            const macroImages = await generateMockup(sourceImage, macroSettings, { macro: true });
            allResults.push(
              ...macroImages.map(img => ({
                id: crypto.randomUUID(),
                imageUrl: img,
                prompt: `${macroPrompt} (Macro)`,
                createdAt: Date.now(),
                isHighRes: macroSettings.imageSize === '4K',
                variantType: "macro" as const,
                aspectRatio: macroSettings.aspectRatio
              }))
            );
          } catch (macroError) {
            console.error("Macro generation failed", macroError);
          }
        }

        if (allResults.length === 0) throw new Error("Batch generation yielded no results.");
        setResults(prev => [...allResults, ...prev]);
        allResults.forEach(r => cloudStorageService.saveResult(r).catch(e => console.warn('Cloud save failed:', e)));
    } catch (e) {
        console.error(e);
        alert("Batch generation encountered errors.");
    } finally {
        setIsGenerating(false);
        setLoadingMessage("");
    }
  };

  const handleUpscale = async (result: MockupResult) => {
    setUpscalingId(result.id);
    try {
      const token = localStorage.getItem('site_token');
      const res = await fetch('/api/upscale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          imageUrl: result.imageUrl,
          model: upscaleModel === 'Clarity AI' ? 'clarity' : 'real-esrgan',
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upscale failed');
      const { upscaledUrl } = await res.json();
      const newResult: MockupResult = {
        id: crypto.randomUUID(),
        imageUrl: upscaledUrl,
        prompt: result.prompt,
        createdAt: Date.now(),
        isHighRes: true,
        variantType: result.variantType || 'standard',
        aspectRatio: result.aspectRatio || settings.aspectRatio,
      };
      setResults(prev => [newResult, ...prev]);
      cloudStorageService.saveResult(newResult).catch(e => console.warn('Cloud save failed:', e));
    } catch (e) {
      console.error(e);
      alert('Upscale failed.');
    } finally {
      setUpscalingId(null);
    }
  };

  const handleUpscaleContactSheet = async (result: MockupResult) => {
    if (!sourceImage) { alert("Source missing."); return; }
    if (!result.isContactSheet) { alert("Can only upgrade contact sheets."); return; }

    setUpscalingId(result.id);
    setLoadingMessage("Upgrading contact sheet to 4K...");

    try {
      // Use same angles as original
      const defaultAngles: CameraAngle[] = [
        "Wide Establishing",
        "Medium Focus",
        "Close Detail",
        "Low Dramatic",
        "High Overhead",
        "Side Depth"
      ];

      const upscaleSettings: GenerationSettings = {
        ...settings,
        prompt: result.prompt,
        generationMode: "batch",
        imageSize: "4K", // Upgrade to 4K
        analysisVibe: analysisVibe
      };

      const { generateContactSheet, extractContactSheetFrames } = await import('./services/geminiService');

      // Generate 4K contact sheet
      const contactSheetUrl = await generateContactSheet(
        sourceImage,
        upscaleSettings,
        defaultAngles
      );

      // Extract frames
      const extractedFrames = await extractContactSheetFrames(
        contactSheetUrl,
        "2x3",
        defaultAngles
      );

      // Create high-res contact sheet result
      const contactSheetResult: MockupResult = {
        id: crypto.randomUUID(),
        imageUrl: contactSheetUrl,
        prompt: result.prompt,
        createdAt: Date.now(),
        isHighRes: true,
        isContactSheet: true,
        variantType: result.variantType,
        aspectRatio: upscaleSettings.aspectRatio
      };

      // Create high-res extracted frame results
      const frameResults: MockupResult[] = extractedFrames.map(frame => ({
        id: crypto.randomUUID(),
        imageUrl: frame.imageUrl,
        prompt: result.prompt,
        createdAt: Date.now(),
        isHighRes: true,
        extractedFrom: contactSheetResult.id,
        cameraAngle: frame.cameraAngle,
        variantType: result.variantType,
        aspectRatio: upscaleSettings.aspectRatio
      }));

      // Add all results to gallery
      setResults(prev => [contactSheetResult, ...frameResults, ...prev]);
      cloudStorageService.saveResult(contactSheetResult).catch(e => console.warn('Cloud save failed:', e));
      frameResults.forEach(r => cloudStorageService.saveResult(r).catch(e => console.warn('Cloud save failed:', e)));

    } catch (e) {
      console.error(e);
      alert("Contact sheet upgrade failed.");
    } finally {
      setUpscalingId(null);
      setLoadingMessage("");
    }
  };

  // --- Helper Functions ---
  const updatePrompt = (id: string, newText: string) => {
    setEditablePrompts(prev => prev.map(p => p.id === id ? {...p, text: newText} : p));
  };
  const removePrompt = (id: string) => {
    if (editablePrompts.length > 1) {
      setEditablePrompts(prev => prev.filter(p => p.id !== id));
    }
  };
  const addEmptyPrompt = () => {
    setEditablePrompts(prev => [...prev, { id: crypto.randomUUID(), text: "Describe a new environment..." }]);
  };
  
  const deleteResult = async (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
    if (storageInitialized) {
      try {
        await storageService.deleteResult(id);
      } catch (err) {
        console.error('Failed to delete from storage:', err);
      }
    }
    cloudStorageService.deleteResult(id).catch(e => console.warn('Cloud delete failed:', e));
  };

  const clearHistory = async () => {
    if(confirm("Clear all results? This cannot be undone.")) {
      setResults([]);
      if (storageInitialized) {
        try {
          await storageService.clearAll();
        } catch (err) {
          console.error('Failed to clear storage:', err);
        }
      }
    }
  };

  const handleGenerateContactSheetFromResult = async (result: MockupResult) => {
    if (!sourceImage) {
      alert("Source image is missing. Cannot generate contact sheet.");
      return;
    }

    setGeneratingContactSheetId(result.id);
    setLoadingMessage("Generating contact sheet with 6 camera angles...");

    try {
      // Fixed 2x3 grid with 6 default camera angles
      const defaultAngles: CameraAngle[] = [
        "Wide Establishing",
        "Medium Focus",
        "Close Detail",
        "Low Dramatic",
        "High Overhead",
        "Side Depth"
      ];

      // Build settings based on the result's prompt and current settings
      const contactSheetSettings: GenerationSettings = {
        ...settings,
        prompt: result.prompt,
        generationMode: "batch", // Not used in prompt building, but required by type
        imageSize: "1K", // Generate at 1K for speed, can upgrade to 4K later
        analysisVibe: analysisVibe
      };

      // Step 1: Generate contact sheet
      const { generateContactSheet, extractContactSheetFrames } = await import('./services/geminiService');

      console.log("Generating contact sheet from result:", {
        resultId: result.id,
        prompt: result.prompt,
        angles: defaultAngles.length
      });

      const contactSheetUrl = await generateContactSheet(
        sourceImage,
        contactSheetSettings,
        defaultAngles
      );

      // Add contact sheet to gallery
      const contactSheetId = `cs-${Date.now()}`;
      const contactSheetResult: MockupResult = {
        id: contactSheetId,
        imageUrl: contactSheetUrl,
        prompt: `Contact Sheet: ${result.prompt}`,
        createdAt: Date.now(),
        isHighRes: true,
        isContactSheet: true,
        variantType: result.variantType,
        aspectRatio: contactSheetSettings.aspectRatio
      };

      setResults(prev => [contactSheetResult, ...prev]);
      cloudStorageService.saveResult(contactSheetResult).catch(e => console.warn('Cloud save failed:', e));
      setLoadingMessage("Extracting 6 individual frames...");

      // Step 2: Extract frames
      console.log("Extracting frames from contact sheet...");
      const extractedFrames = await extractContactSheetFrames(
        contactSheetUrl,
        "2x3",
        defaultAngles
      );

      console.log("Extraction complete:", { frameCount: extractedFrames.length });

      // Step 3: Add extracted frames to gallery
      const extractedResults: MockupResult[] = extractedFrames.map((frame, idx) => ({
        id: `${contactSheetId}-frame-${idx}`,
        imageUrl: frame.imageUrl,
        prompt: `${result.prompt} (${frame.cameraAngle})`,
        createdAt: Date.now() + idx + 1,
        isHighRes: true,
        extractedFrom: contactSheetId,
        cameraAngle: frame.cameraAngle,
        variantType: result.variantType,
        aspectRatio: contactSheetSettings.aspectRatio
      }));

      console.log("Adding extracted frames to gallery:", extractedResults.length);
      setResults(prev => [...extractedResults, ...prev]);
      extractedResults.forEach(r => cloudStorageService.saveResult(r).catch(e => console.warn('Cloud save failed:', e)));
      setLoadingMessage("");

      alert(`✅ Contact sheet generated! ${extractedFrames.length} frames extracted.`);
    } catch (error) {
      console.error("Contact sheet generation failed:", error);
      alert(`❌ Error: ${error instanceof Error ? error.message : "Contact sheet generation failed"}`);
      setLoadingMessage("");
    } finally {
      setGeneratingContactSheetId(null);
    }
  };

  const downloadImage = (dataUrl: string, id: string) => {
    const link = document.createElement('a'); link.href = dataUrl; link.download = `mockup-${id}.png`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const downloadAll = () => {
    if (results.length === 0) return;
    if (!confirm("Download all?")) return;
    results.forEach((result, index) => setTimeout(() => downloadImage(result.imageUrl, result.id), index * 300));
  };

  const handleExportData = async () => {
    if (!storageInitialized) {
      alert("Storage not initialized");
      return;
    }
    try {
      const jsonData = await storageService.exportToJSON();
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mockup-magic-backup-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      alert(`Exported ${results.length} results successfully!`);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export data');
    }
  };

  const handleImportData = () => {
    if (!storageInitialized) {
      alert("Storage not initialized");
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const count = await storageService.importFromJSON(text);
        // Reload results from storage
        const savedResults = await storageService.loadAllResults();
        setResults(savedResults);
        alert(`Successfully imported ${count} results!`);
      } catch (err) {
        console.error('Import failed:', err);
        alert('Failed to import data. Please check the file format.');
      }
    };
    input.click();
  };

  // --- Composite Mode Handlers ---
  const processCompositeFile = (file: File, setter: (val: string) => void, shouldDetectAspectRatio?: boolean) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert("Please upload an image file (JPEG or PNG).");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setter(result);
      // Detect aspect ratio for base scene photos
      if (shouldDetectAspectRatio) {
        const img = new Image();
        img.onload = () => {
          setCompositeAspectRatio(detectAspectRatio(img.width, img.height));
        };
        img.src = result;
      }
      // If this is the artwork setter, detect artwork aspect ratio
      if (setter === setCompositeArtwork) {
        const img = new Image();
        img.onload = () => {
          setCompositeArtworkRatio(img.width / img.height);
        };
        img.src = result;
      }
    };
    reader.readAsDataURL(file);
  };

  const processMultipleBaseFiles = (files: FileList) => {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setCompositeBaseQueue(prev => [...prev, {
          id: crypto.randomUUID(),
          imageUrl: result,
          fileName: file.name
        }]);
        // Auto-detect aspect ratio from first file
        if (compositeBaseQueue.length === 0) {
          const img = new Image();
          img.onload = () => {
            setCompositeAspectRatio(detectAspectRatio(img.width, img.height));
          };
          img.src = result;
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSaveToLibrary = async () => {
    if (!compositeArtwork) return;
    const name = prompt("Name this artwork:") || `Artwork ${artworkLibrary.length + 1}`;
    const item: ArtworkLibraryItem = {
      id: crypto.randomUUID(),
      name,
      imageUrl: compositeArtwork,
      createdAt: Date.now()
    };
    setArtworkLibrary(prev => [item, ...prev]);
    if (storageInitialized) {
      try {
        await storageService.saveArtwork(item);
      } catch (err) {
        console.error('Failed to save artwork:', err);
      }
    }
  };

  const handleDeleteLibraryArtwork = async (id: string) => {
    setArtworkLibrary(prev => prev.filter(a => a.id !== id));
    setSelectedLibraryArtworks(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (storageInitialized) {
      try {
        await storageService.deleteArtwork(id);
      } catch (err) {
        console.error('Failed to delete artwork:', err);
      }
    }
  };

  const toggleLibraryArtworkSelection = (id: string) => {
    setSelectedLibraryArtworks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // --- Source Photo Library Handlers ---

  const handleSaveSourcePhotoToLibrary = async () => {
    if (compositeBaseQueue.length === 0) return;
    const items: SourcePhotoLibraryItem[] = [];
    for (const queueItem of compositeBaseQueue) {
      // Skip if already in library (by imageUrl)
      if (sourcePhotoLibrary.some(s => s.imageUrl === queueItem.imageUrl)) continue;
      const name = compositeBaseQueue.length === 1
        ? (prompt("Name this source photo:") || `Source Photo ${sourcePhotoLibrary.length + items.length + 1}`)
        : (queueItem.fileName || `Source Photo ${sourcePhotoLibrary.length + items.length + 1}`);
      const item: SourcePhotoLibraryItem = {
        id: crypto.randomUUID(),
        name,
        imageUrl: queueItem.imageUrl,
        createdAt: Date.now()
      };
      items.push(item);
    }
    if (items.length === 0) return;
    setSourcePhotoLibrary(prev => [...items, ...prev]);
    if (storageInitialized) {
      for (const item of items) {
        try {
          await storageService.saveSourcePhoto(item);
        } catch (err) {
          console.error('Failed to save source photo:', err);
        }
      }
    }
  };

  const handleDeleteLibrarySourcePhoto = async (id: string) => {
    setSourcePhotoLibrary(prev => prev.filter(p => p.id !== id));
    setSelectedLibrarySourcePhotos(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (storageInitialized) {
      try {
        await storageService.deleteSourcePhoto(id);
      } catch (err) {
        console.error('Failed to delete source photo:', err);
      }
    }
  };

  const toggleLibrarySourcePhotoSelection = (id: string) => {
    setSelectedLibrarySourcePhotos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCompositeGenerate = async () => {
    // Determine base images to use
    const bases = compositeBaseQueue.length > 0
      ? compositeBaseQueue.map(b => b.imageUrl)
      : [];

    if (bases.length === 0) {
      alert("Please upload at least one interior scene photo.");
      return;
    }
    if (!compositeArtwork) {
      alert("Please upload artwork.");
      return;
    }

    setIsCompositing(true);
    try {
      const images = await generateComposite(
        bases[0],
        compositeArtwork,
        compositeInstructions,
        compositeAspectRatio,
        "1K",
        compositeArtworkRatio
      );
      const newResults: MockupResult[] = images.map(img => ({
        id: crypto.randomUUID(),
        imageUrl: img,
        prompt: compositeInstructions || "Interior scene composite",
        createdAt: Date.now(),
        variantType: "composite" as const,
        aspectRatio: compositeAspectRatio,
        compositeBaseUrl: bases[0],
        compositeArtworkUrl: compositeArtwork
      }));
      setCompositeResults(prev => [...newResults, ...prev]);
      setResults(prev => [...newResults, ...prev]);
      newResults.forEach(r => cloudStorageService.saveResult(r).catch(e => console.warn('Cloud save failed:', e)));
    } catch (e) {
      console.error("Composite generation failed:", e);
      alert(`Composite generation failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsCompositing(false);
    }
  };

  const handleBatchComposite = async () => {
    const bases = deduplicatedBaseUrls;

    if (bases.length === 0) {
      alert("Please upload at least one interior scene photo or select from the library.");
      return;
    }

    // Gather artworks to use: selected library items + current artwork
    const artworks: string[] = [];
    if (selectedLibraryArtworks.size > 0) {
      artworkLibrary.forEach(a => {
        if (selectedLibraryArtworks.has(a.id)) artworks.push(a.imageUrl);
      });
    }
    if (compositeArtwork && artworks.length === 0) {
      artworks.push(compositeArtwork);
    }
    if (artworks.length === 0) {
      alert("Please select artwork from the library or upload artwork.");
      return;
    }

    const totalJobs = bases.length * artworks.length;
    setIsBatchCompositing(true);
    setBatchProgress({ current: 0, total: totalJobs });

    let jobIndex = 0;
    for (const base of bases) {
      for (const artwork of artworks) {
        jobIndex++;
        setBatchProgress({ current: jobIndex, total: totalJobs });
        try {
          if (jobIndex > 1) await new Promise(r => setTimeout(r, 2500));
          const images = await generateComposite(
            base,
            artwork,
            compositeInstructions,
            compositeAspectRatio,
            "1K",
            compositeArtworkRatio
          );
          const newResults: MockupResult[] = images.map(img => ({
            id: crypto.randomUUID(),
            imageUrl: img,
            prompt: compositeInstructions || "Interior scene composite",
            createdAt: Date.now(),
            variantType: "composite" as const,
            aspectRatio: compositeAspectRatio,
            compositeBaseUrl: base,
            compositeArtworkUrl: artwork
          }));
          setCompositeResults(prev => [...newResults, ...prev]);
          setResults(prev => [...newResults, ...prev]);
          newResults.forEach(r => cloudStorageService.saveResult(r).catch(e => console.warn('Cloud save failed:', e)));
        } catch (e) {
          console.error(`Batch job ${jobIndex}/${totalJobs} failed:`, e);
        }
      }
    }

    setIsBatchCompositing(false);
    setBatchProgress({ current: 0, total: 0 });
  };

  const handleCompositeUpscale = async (result: MockupResult) => {
    if (!result.compositeBaseUrl || !result.compositeArtworkUrl) {
      alert("Cannot upscale: missing source images. Re-generate instead.");
      return;
    }
    setUpscalingId(result.id);
    try {
      const images = await generateComposite(
        result.compositeBaseUrl,
        result.compositeArtworkUrl,
        result.prompt,
        result.aspectRatio || compositeAspectRatio,
        "4K",
        compositeArtworkRatio
      );
      const newResult: MockupResult = {
        id: crypto.randomUUID(),
        imageUrl: images[0],
        prompt: result.prompt,
        createdAt: Date.now(),
        isHighRes: true,
        variantType: "composite",
        aspectRatio: result.aspectRatio || compositeAspectRatio,
        compositeBaseUrl: result.compositeBaseUrl,
        compositeArtworkUrl: result.compositeArtworkUrl
      };
      setCompositeResults(prev => [newResult, ...prev]);
      setResults(prev => [newResult, ...prev]);
      cloudStorageService.saveResult(newResult).catch(e => console.warn('Cloud save failed:', e));
    } catch (e) {
      console.error("Upscale failed:", e);
      alert("Upscale failed.");
    } finally {
      setUpscalingId(null);
    }
  };

  const handleCompositeRefine = async (result: MockupResult) => {
    if (!refinementText.trim()) return;
    if (!result.compositeArtworkUrl) {
      alert("Cannot refine: missing artwork reference.");
      return;
    }
    setRefiningId(result.id);
    try {
      const images = await refineComposite(
        result.imageUrl,
        result.compositeArtworkUrl,
        refinementText,
        result.aspectRatio || compositeAspectRatio,
        "1K"
      );
      const newResult: MockupResult = {
        id: crypto.randomUUID(),
        imageUrl: images[0],
        prompt: `Refined: ${refinementText}`,
        createdAt: Date.now(),
        variantType: "composite",
        aspectRatio: result.aspectRatio || compositeAspectRatio,
        refinedFrom: result.id,
        compositeBaseUrl: result.compositeBaseUrl,
        compositeArtworkUrl: result.compositeArtworkUrl
      };
      setCompositeResults(prev => [newResult, ...prev]);
      setResults(prev => [newResult, ...prev]);
      cloudStorageService.saveResult(newResult).catch(e => console.warn('Cloud save failed:', e));
      setRefinementText("");
      setExpandedRefinement(null);
    } catch (e) {
      console.error("Refinement failed:", e);
      alert("Refinement failed.");
    } finally {
      setRefiningId(null);
    }
  };

  const deleteCompositeResult = async (id: string) => {
    setCompositeResults(prev => prev.filter(r => r.id !== id));
    setResults(prev => prev.filter(r => r.id !== id));
    if (storageInitialized) {
      try {
        await storageService.deleteResult(id);
      } catch (err) {
        console.error('Failed to delete from storage:', err);
      }
    }
    cloudStorageService.deleteResult(id).catch(e => console.warn('Cloud delete failed:', e));
  };

  const handleShowStorageStats = async () => {
    if (!storageInitialized) {
      alert("Storage not initialized");
      return;
    }
    try {
      const stats = await storageService.getStorageStats();
      alert(`Storage Stats:\n\n` +
            `Results: ${stats.count}\n` +
            `Estimated Size: ${(stats.estimatedSizeKB / 1024).toFixed(2)} MB\n\n` +
            `Tip: Export your data regularly as a backup!`);
    } catch (err) {
      console.error('Failed to get stats:', err);
      alert('Failed to get storage statistics');
    }
  };

  // Auto-resize textarea
  const TextAreaAuto = ({ value, onChange, disabled, className }: any) => {
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
      if (textAreaRef.current) {
        textAreaRef.current.style.height = "auto";
        textAreaRef.current.style.height = textAreaRef.current.scrollHeight + "px";
      }
    }, [value]);
    return (
      <textarea
        ref={textAreaRef}
        className={className}
        value={value}
        onChange={onChange}
        disabled={disabled}
        rows={2}
      />
    );
  }

  // --- Render ---
  if (isBootstrappingAuth) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl px-6 py-5 flex items-center gap-3 shadow-2xl">
          <ArrowPathIcon className="w-6 h-6 text-yellow-400 animate-spin" />
          <div>
            <p className="text-sm font-semibold text-white">Loading...</p>
            <p className="text-xs text-gray-400">Checking session...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-gray-800 rounded-2xl shadow-2xl p-8 border border-gray-700">
          <div className="text-center mb-6">
            <SparklesIcon className="w-16 h-16 text-yellow-400 mx-auto mb-6" />
            <h1 className="text-3xl font-bold text-white mb-2">Art Mockup Pro</h1>
            <p className="text-sm text-gray-400">Enter the site password to continue</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wide">Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => { setPasswordInput(e.target.value); setAuthError(""); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isAuthenticating) handlePasswordSubmit(); }}
                placeholder="Enter site password"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20"
                disabled={isAuthenticating}
              />
              {authError && <p className="mt-2 text-xs text-red-400">{authError}</p>}
            </div>
            <button
              onClick={handlePasswordSubmit}
              disabled={isAuthenticating || !passwordInput.trim()}
              className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 px-6 rounded-lg transition-colors"
            >
              {isAuthenticating ? "Unlocking..." : "Unlock"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isBootstrappingKey) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl px-6 py-5 flex items-center gap-3 shadow-2xl">
          <ArrowPathIcon className="w-6 h-6 text-yellow-400 animate-spin" />
          <div>
            <p className="text-sm font-semibold text-white">Checking for API key...</p>
            <p className="text-xs text-gray-400">Looking for environment or saved keys so you can start right away.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasKey) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-gray-800 rounded-2xl shadow-2xl p-8 border border-gray-700">
          <div className="text-center mb-6">
            <SparklesIcon className="w-16 h-16 text-yellow-400 mx-auto mb-6" />
            <h1 className="text-3xl font-bold text-white mb-2">Art Mockup Pro</h1>
            <p className="text-sm text-gray-400">Enter your Gemini API key to get started</p>
          </div>
          
          {!hasEnvKey ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wide">API Key</label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => {
                    setApiKeyInput(e.target.value);
                    setKeyError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isConnecting) {
                      handleConnect();
                    }
                  }}
                  placeholder="Enter your Gemini API key"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20"
                  disabled={isConnecting}
                />
                {keyError && (
                  <p className="mt-2 text-xs text-red-400">{keyError}</p>
                )}
                <p className="mt-2 text-xs text-gray-500">
                  Your API key is stored locally in your browser and never sent to our servers.
                </p>
              </div>
              <button
                onClick={handleConnect}
                disabled={isConnecting || !apiKeyInput.trim()}
                className="w-full py-3 px-6 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-black font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isConnecting ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  "Save & Continue"
                )}
              </button>
              <p className="text-xs text-gray-500 text-center mt-4">
                Don't have an API key?{" "}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-yellow-500 hover:text-yellow-400 underline"
                >
                  Get one from Google AI Studio
                </a>
              </p>
            </div>
          ) : (
            <button
              onClick={handleConnect}
              className="w-full py-3 px-6 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg transition-colors"
            >
              Connect API Key
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      {/* Tab Bar */}
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3 mr-6">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
            <PhotoIcon className="w-5 h-5 text-black" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Art Mockup Pro</h1>
        </div>
        <div className="flex gap-1 bg-gray-800 rounded-full p-1">
          <button
            onClick={() => setActiveTab("mockups")}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === "mockups"
                ? "bg-yellow-500 text-black shadow-md"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Mockup Generator
          </button>
          <button
            onClick={() => setActiveTab("composite")}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === "composite"
                ? "bg-yellow-500 text-black shadow-md"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Composite
          </button>
        </div>
      </nav>

      {activeTab === "mockups" ? (
      <div className="flex-1 flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-[420px] bg-gray-900 border-r border-gray-800 p-6 flex flex-col gap-6 overflow-y-auto lg:h-[calc(100vh-56px)] sticky top-[56px] scrollbar-thin z-10">

        {/* 1. Upload */}
        <div className="space-y-3">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">1. Source Art & Vibe</label>
          <div 
            className={`relative group transition-all duration-200 ease-in-out ${isDragging ? 'scale-105 ring-2 ring-yellow-500' : ''}`}
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
          >
            <input type="file" accept="image/jpeg, image/jpg" onChange={handleFileInput} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className={`border-2 border-dashed rounded-xl p-4 text-center transition-colors h-32 flex flex-col items-center justify-center ${sourceImage ? 'border-green-500 bg-green-500/10' : 'border-gray-700 bg-gray-800'}`}>
              {sourceImage ? (
                <div className="flex flex-col items-center">
                  <img src={sourceImage} alt="Source" className="h-16 object-contain rounded shadow-sm mb-2" />
                  <div className="flex items-center gap-1 text-green-400 text-xs font-bold"><CheckCircleIcon className="w-4 h-4" /> LOADED</div>
                </div>
              ) : (
                <>
                  <CloudArrowUpIcon className="w-8 h-8 mb-2 text-gray-500" />
                  <span className="text-xs text-gray-400">Drag & Drop Art (JPEG)</span>
                </>
              )}
            </div>
          </div>
          
          {/* Vibe Selector */}
          <SingleSelectPills
            label="Analysis Vibe"
            icon={SwatchIcon}
            options={ANALYSIS_VIBES}
            selected={analysisVibe}
            onChange={(v) => setAnalysisVibe(v)}
            disabled={!sourceImage || isAnalyzing}
          />

          {/* Manual Analyze Button */}
          <button
            onClick={() => handleMagicAnalysis()}
            disabled={!sourceImage || isAnalyzing}
            className={`w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              !sourceImage || isAnalyzing
                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-500 text-white'
            }`}
          >
            {isAnalyzing ? (
              <><ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> Analyzing...</>
            ) : (
              <><SparklesIcon className="w-3.5 h-3.5" /> Auto-Generate Prompts</>
            )}
          </button>
        </div>

        {/* Style Reference */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <PhotoIcon className="w-4 h-4" /> Style Reference <span className="text-gray-600 font-normal normal-case">(optional)</span>
          </label>
          <div
            className={`relative group transition-all duration-200 ease-in-out ${isDraggingStyle ? 'scale-105 ring-2 ring-purple-500' : ''}`}
            onDragOver={handleStyleDragOver} onDragLeave={handleStyleDragLeave} onDrop={handleStyleDrop}
          >
            <input type="file" accept="image/*" onChange={handleStyleFileInput} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className={`border-2 border-dashed rounded-xl p-3 text-center transition-colors flex items-center justify-center gap-3 ${styleReferenceImage ? 'border-purple-500 bg-purple-500/10 h-auto' : 'border-gray-700 bg-gray-800 h-20'}`}>
              {styleReferenceImage ? (
                <div className="flex items-center gap-3 w-full">
                  <img src={styleReferenceImage} alt="Style ref" className="h-14 object-contain rounded shadow-sm" />
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-1 text-purple-400 text-xs font-bold"><CheckCircleIcon className="w-3.5 h-3.5" /> STYLE REF</div>
                    <p className="text-[10px] text-gray-500 mt-0.5">Will influence mockup aesthetic</p>
                  </div>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStyleReferenceImage(null); }}
                    className="text-gray-500 hover:text-red-400 p-1 z-20 relative"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <PhotoIcon className="w-6 h-6 mb-1 text-gray-500" />
                  <span className="text-[10px] text-gray-400">Drop a style reference image</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Constraints */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <AdjustmentsHorizontalIcon className="w-4 h-4" /> 2. Constraints
            </label>
            <span className="text-[10px] text-gray-600">Select multiple for variety</span>
          </div>
          
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-800">
            {/* Print Size - Single Select */}
            <SingleSelectPills 
              label="Print Size (Physical)" 
              icon={ArrowsPointingOutIcon} 
              options={PRINT_SIZES} 
              selected={settings.printSize} 
              onChange={(val) => setSettings(prev => ({...prev, printSize: val}))} 
            />
            
            <div className="h-px bg-gray-700/50 my-3"></div>

            <MultiSelectPills 
              label="Frame Styles" 
              icon={Square2StackIcon}
              options={FRAME_STYLES} 
              selected={selectedFrames} 
              onChange={setSelectedFrames} 
            />
            <MultiSelectPills 
              label="Lighting" 
              icon={SunIcon}
              options={LIGHTING_STYLES} 
              selected={selectedLighting} 
              onChange={setSelectedLighting} 
            />
            <MultiSelectPills
              label="Wall Texture"
              icon={HomeModernIcon}
              options={WALL_TEXTURES}
              selected={selectedTextures}
              onChange={setSelectedTextures}
            />

            <div className="h-px bg-gray-700/50 my-3"></div>

            <SingleSelectPills
              label="Upscale Model"
              icon={BoltIcon}
              options={['Real-ESRGAN', 'Clarity AI']}
              selected={upscaleModel}
              onChange={setUpscaleModel}
            />
          </div>
        </div>

        {/* 3. Prompts Editor */}
        <div className="flex-1 flex flex-col min-h-[200px]">
          <div className="flex justify-between items-center mb-2">
             <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
               <PencilSquareIcon className="w-4 h-4" /> 3. Prompts ({editablePrompts.length})
             </label>
             <button onClick={addEmptyPrompt} className="text-[10px] text-yellow-500 hover:text-yellow-400">+ Add Prompt</button>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 space-y-3 max-h-[300px] scrollbar-thin">
            {editablePrompts.map((prompt, idx) => (
              <div key={prompt.id} className={`group relative transition-all ${isAnalyzing ? 'animate-pulse opacity-50' : ''}`}>
                <span className="absolute top-2 left-2 text-[10px] text-gray-500 bg-gray-900/80 px-1.5 rounded z-10">#{idx+1}</span>
                
                <TextAreaAuto
                  className={`w-full bg-gray-800 border border-gray-700 rounded-lg p-3 pl-8 text-xs text-gray-200 focus:border-yellow-500 focus:outline-none min-h-[70px] resize-none leading-relaxed scrollbar-none ${prompt.isRegenerating ? 'animate-pulse bg-gray-800/50' : ''}`}
                  value={prompt.isRegenerating ? "Regenerating..." : prompt.text}
                  disabled={isAnalyzing || prompt.isRegenerating}
                  onChange={(e: any) => updatePrompt(prompt.id, e.target.value)}
                />
                
                {!isAnalyzing && !prompt.isRegenerating && (
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                     <button 
                      onClick={() => handleRegenerateSinglePrompt(prompt.id)}
                      className="text-gray-500 hover:text-yellow-400 p-1 bg-gray-800 rounded"
                      title="Re-roll this prompt with current vibe"
                    >
                      <ArrowPathIcon className="w-3 h-3" />
                    </button>
                    {editablePrompts.length > 1 && (
                      <button 
                        onClick={() => removePrompt(prompt.id)}
                        className="text-gray-500 hover:text-red-400 p-1 bg-gray-800 rounded"
                        title="Remove"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Global Settings */}
        <div className="border-t border-gray-800 pt-4">
           <div className="flex items-center justify-between mb-3">
              <div>
                <label className="block text-[10px] text-gray-500 uppercase">Macro Mode</label>
                <p className="text-[10px] text-gray-600">Adds +2 macro detail shots per prompt</p>
              </div>
              <button
                onClick={() => setSettings(prev => ({...prev, macroMode: !prev.macroMode}))}
                className={`text-[11px] px-3 py-1.5 rounded-full border transition-all ${
                  settings.macroMode 
                    ? 'bg-yellow-500 text-black border-yellow-500 shadow-md' 
                    : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'
                }`}
              >
                {settings.macroMode ? "On" : "Off"}
              </button>
           </div>
           <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase">Output Aspect Ratio</label>
              <select className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-xs" value={settings.aspectRatio} onChange={e => setSettings({...settings, aspectRatio: e.target.value as any})}>
                <option value="3:4">Portrait (3:4)</option>
                <option value="1:1">Square (1:1)</option>
                <option value="4:3">Landscape (4:3)</option>
                <option value="16:9">Wide (16:9)</option>
                <option value="9:16">Vertical (9:16)</option>
              </select>
           </div>
        </div>
        
        {/* Action Button */}
        <div>
          <button
            onClick={handleGenerateBatch}
            disabled={!sourceImage || isGenerating || isAnalyzing}
            className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all
              ${!sourceImage || isAnalyzing
                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                : isGenerating
                  ? 'bg-gray-700 text-white cursor-wait'
                  : 'bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-black transform hover:-translate-y-0.5'
              }`}
          >
            {isGenerating ? (
              <>
                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <PlayCircleIcon className="w-5 h-5" />
                Run Batch ({editablePrompts.length + (settings.macroMode ? 2 : 0)} Images)
              </>
            )}
          </button>
          {isGenerating && (
            <div className="mt-2 text-center">
              <p className="text-xs text-yellow-500 animate-pulse font-mono">{loadingMessage}</p>
            </div>
          )}
        </div>

      </aside>

      {/* Gallery */}
      <main className="flex-1 p-6 bg-gray-950 overflow-y-auto h-[calc(100vh-56px)]">
        <header className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Gallery <span className="text-base font-normal text-gray-500 ml-2">{results.length} results</span></h2>
          {results.length > 0 && (
             <div className="flex gap-2">
               <button onClick={handleShowStorageStats} className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors" title="Storage Statistics"><CircleStackIcon className="w-3 h-3" /> Stats</button>
               <button onClick={handleExportData} className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors" title="Export all results as JSON backup"><ArrowUpTrayIcon className="w-3 h-3" /> Export</button>
               <button onClick={handleImportData} className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors" title="Import results from JSON backup"><ArrowDownTrayIcon className="w-3 h-3" /> Import</button>
               <button onClick={downloadAll} className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors"><ArrowDownTrayIcon className="w-3 h-3" /> Download All</button>
               <button onClick={clearHistory} className="text-xs bg-gray-800 hover:bg-red-900/30 text-red-400 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors"><TrashIcon className="w-3 h-3" /> Clear</button>
             </div>
          )}
        </header>

        {results.filter(r => r.variantType !== "composite").length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center border-2 border-dashed border-gray-800 rounded-2xl bg-gray-900/30 text-center p-8">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <SparklesIcon className="w-8 h-8 text-yellow-500" />
            </div>
            <h3 className="text-lg font-medium text-white">Start your workflow</h3>
            <p className="text-sm text-gray-500 max-w-md mt-2">1. Upload Art <br/> 2. Use "Auto-Suggest" to get ideas <br/> 3. Tweak constraints & prompts <br/> 4. Run Batch</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-12">
            {results.filter(r => r.variantType !== "composite").map(result => (
              <div key={result.id} className="group bg-gray-900 rounded-xl overflow-hidden border border-gray-800 shadow-lg hover:shadow-2xl hover:border-gray-600 transition-all">
                <div
                  className="relative cursor-pointer"
                  style={{ aspectRatio: result.aspectRatio ? result.aspectRatio.replace(":", " / ") : "1 / 1" }}
                  onClick={() => setLightboxImage(result.imageUrl)}
                >
                  <img src={result.imageUrl} alt="Result" className="w-full h-full object-cover" />
                  {/* Status Badges */}
                  <div className="absolute top-2 left-2 flex flex-col gap-1">
                    <span className="px-1.5 py-0.5 bg-black/60 backdrop-blur rounded text-[10px] font-bold border border-white/10 uppercase">
                      {result.isHighRes ? '4K Final' : '1K Draft'}
                    </span>
                    {result.variantType === "macro" && (
                      <span className="px-1.5 py-0.5 bg-amber-400/90 text-black rounded text-[9px] font-bold border border-amber-200/60 uppercase">
                        🔍 Macro
                      </span>
                    )}
                    {result.isContactSheet && (
                      <span className="px-1.5 py-0.5 bg-indigo-600/90 backdrop-blur rounded text-[9px] font-bold border border-indigo-400/30 uppercase">
                        📸 CONTACT SHEET
                      </span>
                    )}
                    {result.extractedFrom && (
                      <span className="px-1.5 py-0.5 bg-green-600/90 backdrop-blur rounded text-[9px] font-bold border border-green-400/30 uppercase">
                        🎞️ {result.cameraAngle || "Extracted"}
                      </span>
                    )}
                  </div>
                  {/* Hover Actions */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                     {/* Upgrade button - different handlers for contact sheets vs regular mockups */}
                     {!result.isHighRes && result.isContactSheet && (
                       <button onClick={(e) => { e.stopPropagation(); handleUpscaleContactSheet(result); }} className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-full shadow-lg" title="Upgrade Contact Sheet to 4K"><BoltIcon className="w-5 h-5" /></button>
                     )}
                     {!result.isHighRes && !result.isContactSheet && !result.extractedFrom && (
                       <button onClick={(e) => { e.stopPropagation(); handleUpscale(result); }} className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-full shadow-lg" title="Upscale to 4K"><BoltIcon className="w-5 h-5" /></button>
                     )}
                     <button onClick={(e) => { e.stopPropagation(); downloadImage(result.imageUrl, result.id); }} className="bg-white text-black p-2 rounded-full shadow-lg hover:bg-gray-200" title="Download"><ArrowDownTrayIcon className="w-5 h-5" /></button>
                     <button onClick={(e) => { e.stopPropagation(); deleteResult(result.id); }} className="bg-red-600 text-white p-2 rounded-full shadow-lg hover:bg-red-500" title="Delete"><TrashIcon className="w-5 h-5" /></button>
                     {/* Generate Contact Sheet Button */}
                     {!result.isContactSheet && !result.extractedFrom && (
                       <button
                         onClick={(e) => {
                           e.stopPropagation();
                           handleGenerateContactSheetFromResult(result);
                         }}
                         disabled={generatingContactSheetId === result.id}
                         className={`p-2 rounded-full shadow-lg ${
                           generatingContactSheetId === result.id
                             ? 'bg-purple-400 cursor-wait'
                             : 'bg-purple-600 hover:bg-purple-500'
                         } text-white`}
                         title="Generate Contact Sheet (6 angles)"
                       >
                         {generatingContactSheetId === result.id ? (
                           <ArrowPathIcon className="w-5 h-5 animate-spin" />
                         ) : (
                           <Square2StackIcon className="w-5 h-5" />
                         )}
                       </button>
                     )}
                  </div>
                  {upscalingId === result.id && (
                    <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10">
                       <ArrowPathIcon className="w-8 h-8 text-yellow-500 animate-spin" />
                       <span className="text-[10px] font-bold text-yellow-500 mt-2 tracking-widest">UPSCALING...</span>
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-[10px] text-gray-400 line-clamp-2 mb-2">{result.prompt}</p>
                  <div className="flex justify-between items-center text-[9px] text-gray-600 uppercase font-mono">
                    <span>{new Date(result.createdAt).toLocaleTimeString()}</span>
                    <span>Gemini Pro</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      </div>
      ) : (
      /* ========== COMPOSITE TAB — Interior Scene Compositor ========== */
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Composite Sidebar */}
        <aside className="w-full lg:w-[420px] bg-gray-900 border-r border-gray-800 p-6 flex flex-col gap-6 overflow-y-auto lg:h-[calc(100vh-56px)] sticky top-[56px] scrollbar-thin z-10">

          {/* 1. Interior Scene Photo(s) */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">1. Interior Scene Photo(s)</label>
            <div
              className={`relative group transition-all duration-200 ease-in-out ${isDraggingBase ? 'scale-105 ring-2 ring-yellow-500' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingBase(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDraggingBase(false); }}
              onDrop={(e) => { e.preventDefault(); setIsDraggingBase(false); processMultipleBaseFiles(e.dataTransfer.files); }}
            >
              <input type="file" accept="image/jpeg,image/png,image/jpg" multiple onChange={(e) => { if (e.target.files) processMultipleBaseFiles(e.target.files); }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className={`border-2 border-dashed rounded-xl p-4 text-center transition-colors h-24 flex flex-col items-center justify-center ${compositeBaseQueue.length > 0 ? 'border-green-500 bg-green-500/10' : 'border-gray-700 bg-gray-800'}`}>
                {compositeBaseQueue.length > 0 ? (
                  <div className="flex items-center gap-2 text-green-400 text-xs font-bold">
                    <CheckCircleIcon className="w-4 h-4" /> {compositeBaseQueue.length} photo{compositeBaseQueue.length > 1 ? 's' : ''} loaded
                  </div>
                ) : (
                  <>
                    <CloudArrowUpIcon className="w-6 h-6 mb-1 text-gray-500" />
                    <span className="text-xs text-gray-400">Drop interior scene photo(s)</span>
                  </>
                )}
              </div>
            </div>
            {/* Queue thumbnails */}
            {compositeBaseQueue.length > 0 && (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  {compositeBaseQueue.map(item => (
                    <div key={item.id} className="relative group/thumb">
                      <img src={item.imageUrl} alt={item.fileName} className="w-full h-16 object-cover rounded border border-gray-700" />
                      <button
                        onClick={() => setCompositeBaseQueue(prev => prev.filter(b => b.id !== item.id))}
                        className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCompositeBaseQueue([])}
                    className="text-[10px] text-red-400 hover:text-red-300"
                  >
                    Clear Queue
                  </button>
                  <button
                    onClick={handleSaveSourcePhotoToLibrary}
                    className="text-[10px] text-yellow-500 hover:text-yellow-400"
                  >
                    + Save to Library
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Source Photo Library */}
          {sourcePhotoLibrary.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <CircleStackIcon className="w-3.5 h-3.5" /> Source Photo Library ({sourcePhotoLibrary.length})
              </label>
              <div className="grid grid-cols-4 gap-2 max-h-[120px] overflow-y-auto scrollbar-thin">
                {sourcePhotoLibrary.map(photo => {
                  const isInQueue = compositeBaseQueue.some(b => b.imageUrl === photo.imageUrl);
                  return (
                    <div key={photo.id} className="relative group/lib">
                      <button
                        onClick={() => {
                          if (!isInQueue) {
                            setCompositeBaseQueue(prev => [...prev, {
                              id: crypto.randomUUID(),
                              imageUrl: photo.imageUrl,
                              fileName: photo.name
                            }]);
                          }
                        }}
                        className={`w-full border-2 rounded overflow-hidden transition-all ${
                          isInQueue ? 'border-yellow-500' : 'border-gray-700 hover:border-gray-500'
                        }`}
                      >
                        <img src={photo.imageUrl} alt={photo.name} className="w-full h-14 object-cover" />
                      </button>
                      {/* Checkbox for batch selection */}
                      <label className="absolute top-0.5 left-0.5 z-10 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedLibrarySourcePhotos.has(photo.id)}
                          onChange={() => toggleLibrarySourcePhotoSelection(photo.id)}
                          className="w-3 h-3 accent-yellow-500"
                        />
                      </label>
                      <button
                        onClick={() => handleDeleteLibrarySourcePhoto(photo.id)}
                        className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover/lib:opacity-100 transition-opacity"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                      <p className="text-[8px] text-gray-500 truncate text-center mt-0.5">{photo.name}</p>
                    </div>
                  );
                })}
              </div>
              {selectedLibrarySourcePhotos.size > 0 && (
                <p className="text-[10px] text-yellow-500">{selectedLibrarySourcePhotos.size} selected for batch</p>
              )}
            </div>
          )}

          {/* 2. Artwork / Design */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">2. Artwork / Design</label>
            <div
              className={`relative group transition-all duration-200 ease-in-out ${isDraggingArtwork ? 'scale-105 ring-2 ring-yellow-500' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingArtwork(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDraggingArtwork(false); }}
              onDrop={(e) => { e.preventDefault(); setIsDraggingArtwork(false); const file = e.dataTransfer.files[0]; processCompositeFile(file, setCompositeArtwork); }}
            >
              <input type="file" accept="image/jpeg,image/png,image/jpg" onChange={(e) => { const file = e.target.files?.[0]; if (file) processCompositeFile(file, setCompositeArtwork); }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className={`border-2 border-dashed rounded-xl p-4 text-center transition-colors h-24 flex flex-col items-center justify-center ${compositeArtwork ? 'border-green-500 bg-green-500/10' : 'border-gray-700 bg-gray-800'}`}>
                {compositeArtwork ? (
                  <div className="flex flex-col items-center">
                    <img src={compositeArtwork} alt="Artwork" className="h-12 object-contain rounded shadow-sm mb-1" />
                    <div className="flex items-center gap-1 text-green-400 text-[10px] font-bold"><CheckCircleIcon className="w-3 h-3" /> LOADED</div>
                  </div>
                ) : (
                  <>
                    <CloudArrowUpIcon className="w-6 h-6 mb-1 text-gray-500" />
                    <span className="text-xs text-gray-400">Drop your artwork / design</span>
                  </>
                )}
              </div>
            </div>
            {compositeArtwork && (
              <button
                onClick={handleSaveToLibrary}
                className="w-full text-[10px] text-yellow-500 hover:text-yellow-400 border border-yellow-500/30 rounded-lg py-1.5 transition-colors"
              >
                + Save to Library
              </button>
            )}
          </div>

          {/* Artwork Library */}
          {artworkLibrary.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <CircleStackIcon className="w-3.5 h-3.5" /> Artwork Library ({artworkLibrary.length})
              </label>
              <div className="grid grid-cols-4 gap-2 max-h-[120px] overflow-y-auto scrollbar-thin">
                {artworkLibrary.map(artwork => (
                  <div key={artwork.id} className="relative group/lib">
                    <button
                      onClick={() => {
                        setCompositeArtwork(artwork.imageUrl);
                        const img = new Image();
                        img.onload = () => setCompositeArtworkRatio(img.width / img.height);
                        img.src = artwork.imageUrl;
                      }}
                      className={`w-full border-2 rounded overflow-hidden transition-all ${
                        compositeArtwork === artwork.imageUrl ? 'border-yellow-500' : 'border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      <img src={artwork.imageUrl} alt={artwork.name} className="w-full h-14 object-cover" />
                    </button>
                    {/* Checkbox for batch selection */}
                    <label className="absolute top-0.5 left-0.5 z-10 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedLibraryArtworks.has(artwork.id)}
                        onChange={() => toggleLibraryArtworkSelection(artwork.id)}
                        className="w-3 h-3 accent-yellow-500"
                      />
                    </label>
                    <button
                      onClick={() => handleDeleteLibraryArtwork(artwork.id)}
                      className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover/lib:opacity-100 transition-opacity"
                    >
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                    <p className="text-[8px] text-gray-500 truncate text-center mt-0.5">{artwork.name}</p>
                  </div>
                ))}
              </div>
              {selectedLibraryArtworks.size > 0 && (
                <p className="text-[10px] text-yellow-500">{selectedLibraryArtworks.size} selected for batch</p>
              )}
            </div>
          )}

          {/* 3. Instructions */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">3. Instructions (optional)</label>
            <textarea
              value={compositeInstructions}
              onChange={(e) => setCompositeInstructions(e.target.value)}
              placeholder="e.g. Place on the wall above the sofa"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs text-gray-200 focus:border-yellow-500 focus:outline-none min-h-[60px] resize-none leading-relaxed"
              disabled={isCompositing || isBatchCompositing}
            />
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1 uppercase">Output Aspect Ratio</label>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-xs"
              value={compositeAspectRatio}
              onChange={e => setCompositeAspectRatio(e.target.value as any)}
              disabled={isCompositing || isBatchCompositing}
            >
              <option value="1:1">Square (1:1)</option>
              <option value="3:4">Portrait (3:4)</option>
              <option value="4:3">Landscape (4:3)</option>
              <option value="16:9">Wide (16:9)</option>
              <option value="9:16">Vertical (9:16)</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2">
            {/* Generate Now (single) */}
            <button
              onClick={handleCompositeGenerate}
              disabled={compositeBaseQueue.length === 0 || !compositeArtwork || isCompositing || isBatchCompositing}
              className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all
                ${compositeBaseQueue.length === 0 || !compositeArtwork
                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  : isCompositing
                    ? 'bg-gray-700 text-white cursor-wait'
                    : 'bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-black transform hover:-translate-y-0.5'
                }`}
            >
              {isCompositing ? (
                <>
                  <ArrowPathIcon className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <SparklesIcon className="w-5 h-5" />
                  Generate Now
                </>
              )}
            </button>

            {/* Run Batch */}
            {(() => {
              const totalUniqueBases = deduplicatedBaseUrls.length;
              const totalArtworks = Math.max(selectedLibraryArtworks.size, compositeArtwork ? 1 : 0);
              const showBatch = totalUniqueBases > 1 || selectedLibraryArtworks.size > 0 || selectedLibrarySourcePhotos.size > 0;
              if (!showBatch) return null;
              return (
              <button
                onClick={handleBatchComposite}
                disabled={(totalUniqueBases === 0) || isCompositing || isBatchCompositing}
                className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all
                  ${isBatchCompositing
                    ? 'bg-gray-700 text-white cursor-wait'
                    : 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white transform hover:-translate-y-0.5'
                  }`}
              >
                {isBatchCompositing ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    Processing {batchProgress.current}/{batchProgress.total}...
                  </>
                ) : (
                  <>
                    <PlayCircleIcon className="w-5 h-5" />
                    Run Batch ({totalUniqueBases * totalArtworks} drafts)
                  </>
                )}
              </button>
              );
            })()}
          </div>
        </aside>

        {/* Composite Gallery */}
        <main className="flex-1 p-6 bg-gray-950 overflow-y-auto h-[calc(100vh-56px)]">
          <header className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold">Composite Results <span className="text-base font-normal text-gray-500 ml-2">{compositeResults.length} results</span></h2>
            {compositeResults.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => { compositeResults.forEach((r, i) => setTimeout(() => downloadImage(r.imageUrl, r.id), i * 300)); }}
                  className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors"
                >
                  <ArrowDownTrayIcon className="w-3 h-3" /> Download All
                </button>
                <button
                  onClick={() => { if (confirm("Clear all composite results?")) setCompositeResults([]); }}
                  className="text-xs bg-gray-800 hover:bg-red-900/30 text-red-400 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors"
                >
                  <TrashIcon className="w-3 h-3" /> Clear
                </button>
              </div>
            )}
          </header>

          {compositeResults.length === 0 ? (
            <div className="h-[60vh] flex flex-col items-center justify-center border-2 border-dashed border-gray-800 rounded-2xl bg-gray-900/30 text-center p-8">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <SparklesIcon className="w-8 h-8 text-yellow-500" />
              </div>
              <h3 className="text-lg font-medium text-white">Interior Scene Compositor</h3>
              <p className="text-sm text-gray-500 max-w-md mt-2">1. Upload interior scene photo(s) <br/> 2. Upload your artwork / design <br/> 3. Add optional instructions <br/> 4. Generate to place your art in the scene</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-12">
              {compositeResults.map(result => (
                <div key={result.id} className="group bg-gray-900 rounded-xl overflow-hidden border border-gray-800 shadow-lg hover:shadow-2xl hover:border-gray-600 transition-all">
                  <div
                    className="relative cursor-pointer"
                    style={{ aspectRatio: result.aspectRatio ? result.aspectRatio.replace(":", " / ") : "1 / 1" }}
                    onClick={() => setLightboxImage(result.imageUrl)}
                  >
                    <img src={result.imageUrl} alt="Composite Result" className="w-full h-full object-cover" />
                    {/* Status Badges */}
                    <div className="absolute top-2 left-2 flex flex-col gap-1">
                      <span className={`px-1.5 py-0.5 backdrop-blur rounded text-[9px] font-bold border uppercase ${
                        result.isHighRes
                          ? 'bg-yellow-500/90 text-black border-yellow-300/60'
                          : 'bg-black/60 text-white border-white/10'
                      }`}>
                        {result.isHighRes ? '4K Final' : '1K Draft'}
                      </span>
                      {result.refinedFrom && (
                        <span className="px-1.5 py-0.5 bg-purple-600/90 backdrop-blur rounded text-[9px] font-bold border border-purple-400/30 uppercase">
                          Refined
                        </span>
                      )}
                    </div>
                    {/* Hover Actions */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      {/* Upscale button */}
                      {!result.isHighRes && result.compositeBaseUrl && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCompositeUpscale(result); }}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-full shadow-lg"
                          title="Upscale to 4K"
                        >
                          <BoltIcon className="w-5 h-5" />
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); downloadImage(result.imageUrl, result.id); }} className="bg-white text-black p-2 rounded-full shadow-lg hover:bg-gray-200" title="Download"><ArrowDownTrayIcon className="w-5 h-5" /></button>
                      <button onClick={(e) => { e.stopPropagation(); deleteCompositeResult(result.id); }} className="bg-red-600 text-white p-2 rounded-full shadow-lg hover:bg-red-500" title="Delete"><TrashIcon className="w-5 h-5" /></button>
                    </div>
                    {/* Upscaling overlay */}
                    {upscalingId === result.id && (
                      <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10">
                        <ArrowPathIcon className="w-8 h-8 text-yellow-500 animate-spin" />
                        <span className="text-[10px] font-bold text-yellow-500 mt-2 tracking-widest">UPSCALING...</span>
                      </div>
                    )}
                    {/* Refining overlay */}
                    {refiningId === result.id && (
                      <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10">
                        <ArrowPathIcon className="w-8 h-8 text-purple-400 animate-spin" />
                        <span className="text-[10px] font-bold text-purple-400 mt-2 tracking-widest">REFINING...</span>
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-[10px] text-gray-400 line-clamp-2 mb-2">{result.prompt}</p>
                    <div className="flex justify-between items-center text-[9px] text-gray-600 uppercase font-mono mb-2">
                      <span>{new Date(result.createdAt).toLocaleTimeString()}</span>
                      <span>Gemini Pro</span>
                    </div>
                    {/* Refine toggle */}
                    {result.compositeArtworkUrl && (
                      <div>
                        <button
                          onClick={() => {
                            setExpandedRefinement(expandedRefinement === result.id ? null : result.id);
                            setRefinementText("");
                          }}
                          className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1"
                        >
                          <PencilSquareIcon className="w-3 h-3" />
                          {expandedRefinement === result.id ? 'Cancel' : 'Refine'}
                        </button>
                        {expandedRefinement === result.id && (
                          <div className="mt-2 space-y-2">
                            <input
                              type="text"
                              value={refinementText}
                              onChange={(e) => setRefinementText(e.target.value)}
                              placeholder="e.g. Make the frame larger, add warmer lighting..."
                              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-[10px] text-gray-200 focus:border-purple-500 focus:outline-none"
                              onKeyDown={(e) => { if (e.key === 'Enter') handleCompositeRefine(result); }}
                            />
                            <button
                              onClick={() => handleCompositeRefine(result)}
                              disabled={!refinementText.trim() || refiningId === result.id}
                              className="w-full py-1.5 rounded text-[10px] font-bold bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors"
                            >
                              {refiningId === result.id ? 'Refining...' : 'Refine'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
      )}

      {/* Lightbox */}
      {lightboxImage && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur flex items-center justify-center p-4" onClick={() => setLightboxImage(null)}>
           <button className="absolute top-4 right-4 text-gray-400 hover:text-white"><XMarkIcon className="w-8 h-8" /></button>
           <img src={lightboxImage} className="max-w-full max-h-full object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
};

export default App;
