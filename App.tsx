import React, { useState, useEffect, useCallback, useRef } from 'react';
import { checkApiKey, promptForApiKey, setApiKey, generateMockup, analyzeImageForPrompts, regenerateSinglePrompt, getEnvApiKey, normalizeApiKey } from './services/geminiService';
import { GenerationSettings, MockupResult, FrameStyle, LightingStyle, WallTexture, PrintSize, AnalysisVibe } from './types';
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
  ChevronDownIcon,
  ChevronUpIcon,
  BoltIcon,
  PlayCircleIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  SwatchIcon
} from '@heroicons/react/24/outline';

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

const DEFAULT_SETTINGS: GenerationSettings = {
  prompt: INITIAL_PRESETS[0],
  negativePrompt: "people, animals, text, watermark, blurry, low quality, distortion, ugly, 3d render, plastic look",
  count: 1,
  aspectRatio: "3:4", 
  imageSize: "1K", // Default to Draft quality
  frameStyle: "Auto",
  lighting: "Auto",
  wallTexture: "Auto",
  printSize: "A3"
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

// --- Main App ---

const App: React.FC = () => {
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [hasEnvKey, setHasEnvKey] = useState<boolean>(false);
  const [isBootstrappingKey, setIsBootstrappingKey] = useState<boolean>(true);
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
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
  const [upscalingId, setUpscalingId] = useState<string | null>(null);
  const [results, setResults] = useState<MockupResult[]>([]);
  const [loadingMessage, setLoadingMessage] = useState<string>("");

  // Persist settings (only basic ones)
  useEffect(() => {
    localStorage.setItem('mockupSettings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const init = async () => {
      try {
        // Check if environment variables exist and are non-placeholder
        const envKey = getEnvApiKey();
        const hasEnv = !!envKey;
        setHasEnvKey(hasEnv);
        
        // Check if any API key is available (env, AI Studio, or localStorage)
        const authorized = await checkApiKey();
        setHasKey(authorized);
      } finally {
        setIsBootstrappingKey(false);
      }
    };
    init();
  }, []);

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
      const newText = await regenerateSinglePrompt(sourceImage, analysisVibe);
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
      
      // Auto trigger analysis with current vibe
      handleMagicAnalysis(result);

      const img = new Image();
      img.onload = () => {
        if (img.width > img.height) setSettings(prev => ({...prev, aspectRatio: "4:3"}));
        else if (img.height > img.width) setSettings(prev => ({...prev, aspectRatio: "3:4"}));
        else setSettings(prev => ({...prev, aspectRatio: "1:1"}));
      };
      img.src = result;
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

            const batchSettings: GenerationSettings = {
                ...settings,
                prompt: promptObj.text,
                count: 1,
                frameStyle: frame,
                lighting: light,
                wallTexture: texture
            };
            
            try {
                const images = await generateMockup(sourceImage, batchSettings);
                return images.map(img => ({
                    id: crypto.randomUUID(),
                    imageUrl: img,
                    prompt: promptObj.text,
                    createdAt: Date.now(),
                    isHighRes: settings.imageSize === '4K'
                }));
            } catch (e) {
                console.error(`Failed prompt: ${promptObj.text}`, e);
                return [];
            }
        });

        // We use Promise.all to wait for the staggered executions to finish
        const batchResults = await Promise.all(batchPromises);
        const flatResults = batchResults.flat();
        
        if (flatResults.length === 0) throw new Error("Batch generation yielded no results.");
        setResults(prev => [...flatResults, ...prev]);
    } catch (e) {
        console.error(e);
        alert("Batch generation encountered errors.");
    } finally {
        setIsGenerating(false);
        setLoadingMessage("");
    }
  };

  const handleUpscale = async (result: MockupResult) => {
    if (!sourceImage) { alert("Source missing."); return; }
    setUpscalingId(result.id);
    try {
      const upscaleSettings: GenerationSettings = {
        ...settings,
        prompt: result.prompt,
        count: 1,
        imageSize: "4K",
        frameStyle: "Auto", 
        lighting: "Auto",
        wallTexture: "Auto"
      };
      const images = await generateMockup(sourceImage, upscaleSettings);
      const newResult: MockupResult = {
        id: crypto.randomUUID(),
        imageUrl: images[0],
        prompt: result.prompt,
        createdAt: Date.now(),
        isHighRes: true
      };
      setResults(prev => [newResult, ...prev]);
    } catch (e) {
      console.error(e);
      alert("Upscale failed.");
    } finally {
      setUpscalingId(null);
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
  
  const deleteResult = (id: string) => setResults(prev => prev.filter(r => r.id !== id));
  const clearHistory = () => { if(confirm("Clear all?")) setResults([]); };
  const downloadImage = (dataUrl: string, id: string) => {
    const link = document.createElement('a'); link.href = dataUrl; link.download = `mockup-${id}.png`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };
  const downloadAll = () => {
    if (results.length === 0) return;
    if (!confirm("Download all?")) return;
    results.forEach((result, index) => setTimeout(() => downloadImage(result.imageUrl, result.id), index * 300));
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
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col lg:flex-row">
      
      {/* Sidebar */}
      <aside className="w-full lg:w-[420px] bg-gray-900 border-r border-gray-800 p-6 flex flex-col gap-6 overflow-y-auto lg:h-screen sticky top-0 scrollbar-thin z-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
            <PhotoIcon className="w-5 h-5 text-black" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Art Mockup Pro</h1>
        </div>

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
            onChange={(v) => {
              setAnalysisVibe(v);
              if (sourceImage) handleMagicAnalysis(sourceImage, v);
            }}
            disabled={!sourceImage || isAnalyzing}
          />
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
            {isGenerating ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <PlayCircleIcon className="w-5 h-5" />}
            {isGenerating ? "Generating..." : `Run Batch (${editablePrompts.length} Images)`}
          </button>
          {isGenerating && (
            <div className="mt-2 text-center">
              <p className="text-xs text-yellow-500 animate-pulse font-mono">{loadingMessage}</p>
            </div>
          )}
        </div>

      </aside>

      {/* Gallery */}
      <main className="flex-1 p-6 bg-gray-950 overflow-y-auto h-screen">
        <header className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Gallery <span className="text-base font-normal text-gray-500 ml-2">{results.length} results</span></h2>
          {results.length > 0 && (
             <div className="flex gap-2">
               <button onClick={downloadAll} className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors"><ArrowDownTrayIcon className="w-3 h-3" /> Download All</button>
               <button onClick={clearHistory} className="text-xs bg-gray-800 hover:bg-red-900/30 text-red-400 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors"><TrashIcon className="w-3 h-3" /> Clear</button>
             </div>
          )}
        </header>

        {results.length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center border-2 border-dashed border-gray-800 rounded-2xl bg-gray-900/30 text-center p-8">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <SparklesIcon className="w-8 h-8 text-yellow-500" />
            </div>
            <h3 className="text-lg font-medium text-white">Start your workflow</h3>
            <p className="text-sm text-gray-500 max-w-md mt-2">1. Upload Art <br/> 2. Use "Auto-Suggest" to get ideas <br/> 3. Tweak constraints & prompts <br/> 4. Run Batch</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-12">
            {results.map(result => (
              <div key={result.id} className="group bg-gray-900 rounded-xl overflow-hidden border border-gray-800 shadow-lg hover:shadow-2xl hover:border-gray-600 transition-all">
                <div className="aspect-square relative cursor-pointer" onClick={() => setLightboxImage(result.imageUrl)}>
                  <img src={result.imageUrl} alt="Result" className="w-full h-full object-cover" />
                  {/* Status Badges */}
                  <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 backdrop-blur rounded text-[10px] font-bold border border-white/10 uppercase">
                    {result.isHighRes ? '4K Final' : '1K Draft'}
                  </div>
                  {/* Hover Actions */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                     {!result.isHighRes && (
                       <button onClick={(e) => { e.stopPropagation(); handleUpscale(result); }} className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-full shadow-lg" title="Upscale to 4K"><BoltIcon className="w-5 h-5" /></button>
                     )}
                     <button onClick={(e) => { e.stopPropagation(); downloadImage(result.imageUrl, result.id); }} className="bg-white text-black p-2 rounded-full shadow-lg hover:bg-gray-200" title="Download"><ArrowDownTrayIcon className="w-5 h-5" /></button>
                     <button onClick={(e) => { e.stopPropagation(); deleteResult(result.id); }} className="bg-red-600 text-white p-2 rounded-full shadow-lg hover:bg-red-500" title="Delete"><TrashIcon className="w-5 h-5" /></button>
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
