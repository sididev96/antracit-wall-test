import { pipeline, env, RawImage } from "@huggingface/transformers";

// Configure transformers.js for browser usage
env.allowLocalModels = false;

// Check if we're in a secure context (Cache API requires secure context)
// localhost is always secure, but local IP addresses over HTTP are not
const isInSecureContext =
  typeof window !== "undefined" && (window.isSecureContext ?? false);
env.useBrowserCache = isInSecureContext;
console.log(
  `[Segmentation Init] Secure context: ${isInSecureContext}, useBrowserCache: ${env.useBrowserCache}`,
);

/**
 * Detect if we're running on a mobile/Android device
 * These devices often have limited WASM memory and need smaller image sizes
 */
function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    ua,
  );
}

/**
 * Detect iOS specifically - iOS Safari has severe memory issues with transformers.js v3
 */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iOS detection - includes iPhone, iPad, iPod
  // Also detect iPadOS 13+ which reports as Mac
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Check if SharedArrayBuffer is available (requires secure context + COOP/COEP headers)
 * SharedArrayBuffer is needed for ONNX Runtime multi-threading.
 * It's NOT available when:
 * 1. Accessing via local IP (e.g., 192.168.x.x) over HTTP (not secure context)
 * 2. Missing COOP/COEP headers
 * 3. Some mobile browsers
 */
function isSharedArrayBufferAvailable(): boolean {
  try {
    // Check if SharedArrayBuffer exists and is constructible
    if (typeof SharedArrayBuffer === "undefined") {
      console.log("[Segmentation] SharedArrayBuffer is undefined");
      return false;
    }
    // Try to construct a small one to verify it works
    new SharedArrayBuffer(1);
    console.log("[Segmentation] SharedArrayBuffer is available");
    return true;
  } catch (e) {
    console.log("[Segmentation] SharedArrayBuffer construction failed:", e);
    return false;
  }
}

/**
 * Check if running in a secure context
 * localhost is always secure, but local IP addresses over HTTP are not
 */
function isSecureContext(): boolean {
  if (typeof window === "undefined") return false;
  const secure = window.isSecureContext ?? false;
  console.log("[Segmentation] Secure context:", secure);
  console.log("[Segmentation] Current origin:", window.location?.origin);
  return secure;
}

/**
 * Configure ONNX Runtime for the current environment
 *
 * CRITICAL: This function handles multiple scenarios:
 * 1. Secure context (localhost or HTTPS) with SharedArrayBuffer -> multi-threaded OK
 * 2. Non-secure context (local IP over HTTP) -> must use single-threaded + non-JSEP WASM
 * 3. Mobile devices (iOS/Android) -> single-threaded + non-JSEP WASM (memory issues)
 *
 * The .jsep WASM files cause crashes when SharedArrayBuffer is unavailable.
 * Using the non-jsep variants from CDN fixes this issue.
 */
let onnxConfigured = false;
function configureOnnxForMobile(): void {
  // Only configure once
  if (onnxConfigured) {
    console.log("[Segmentation] ONNX already configured, skipping");
    return;
  }

  const mobile = isMobileDevice();
  const ios = isIOS();
  const secure = isSecureContext();
  const hasSharedArrayBuffer = isSharedArrayBufferAvailable();

  console.log("[Segmentation] Environment detection:");
  console.log("[Segmentation] - Mobile:", mobile);
  console.log("[Segmentation] - iOS:", ios);
  console.log("[Segmentation] - Secure context:", secure);
  console.log(
    "[Segmentation] - SharedArrayBuffer available:",
    hasSharedArrayBuffer,
  );
  console.log("[Segmentation] env.backends.onnx exists:", !!env.backends?.onnx);
  console.log(
    "[Segmentation] env.backends.onnx.wasm exists:",
    !!(env.backends?.onnx as any)?.wasm,
  );

  // Need single-threaded mode if: mobile OR no SharedArrayBuffer (non-secure context)
  const needsSingleThreaded = mobile || !hasSharedArrayBuffer;

  if (needsSingleThreaded) {
    const reason = !hasSharedArrayBuffer
      ? "SharedArrayBuffer unavailable (non-secure context or missing headers)"
      : "mobile device";
    console.log(
      `[Segmentation] Configuring ONNX for single-threaded mode. Reason: ${reason}`,
    );

    // The env.backends.onnx object should be populated by the onnx backend now
    // It references the actual ONNX_ENV from onnxruntime-web
    const onnxEnv = env.backends?.onnx;

    if (onnxEnv && (onnxEnv as any).wasm) {
      console.log("[Segmentation] Found existing ONNX wasm config");
      console.log(
        "[Segmentation] Current wasmPaths:",
        (onnxEnv as any).wasm.wasmPaths,
      );

      // Set single-threaded mode
      (onnxEnv as any).wasm.numThreads = 1;
      console.log("[Segmentation] Set ONNX WASM numThreads = 1");

      // CRITICAL FIX: Use NON-JSEP WASM files
      // The default .jsep variants require SharedArrayBuffer and cause crashes without it
      // Using the non-jsep variants from CDN works in all environments
      // See: https://github.com/huggingface/transformers.js/issues/1242
      // IMPORTANT: Must match the EXACT version used by transformers.js 3.8.1
      const onnxVersion = "1.22.0-dev.20250409-89f8206ba4";
      const newWasmPaths = {
        mjs: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${onnxVersion}/dist/ort-wasm-simd-threaded.mjs`,
        wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${onnxVersion}/dist/ort-wasm-simd-threaded.wasm`,
      };
      (onnxEnv as any).wasm.wasmPaths = newWasmPaths;
      console.log(
        `[Segmentation] Set ONNX WASM paths to non-JSEP variants (v${onnxVersion})`,
      );
      console.log(
        "[Segmentation] New wasmPaths:",
        JSON.stringify(newWasmPaths),
      );

      onnxConfigured = true;
    } else {
      console.warn(
        "[Segmentation] ONNX wasm config not found yet, creating it",
      );
      // Setup a fallback structure if the backend hasn't initialized yet
      if (!env.backends) {
        (env as any).backends = {};
      }
      if (!env.backends.onnx) {
        (env.backends as any).onnx = {};
      }
      if (!(env.backends.onnx as any).wasm) {
        (env.backends.onnx as any).wasm = {};
      }

      // IMPORTANT: Must match the EXACT version used by transformers.js 3.8.1
      const onnxVersion = "1.22.0-dev.20250409-89f8206ba4";
      (env.backends.onnx as any).wasm.numThreads = 1;
      (env.backends.onnx as any).wasm.wasmPaths = {
        mjs: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${onnxVersion}/dist/ort-wasm-simd-threaded.mjs`,
        wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${onnxVersion}/dist/ort-wasm-simd-threaded.wasm`,
      };
      console.log(
        `[Segmentation] Created ONNX wasm config structure with non-JSEP WASM paths (v${onnxVersion})`,
      );
      onnxConfigured = true;
    }
  } else {
    console.log(
      "[Segmentation] Secure context with SharedArrayBuffer - using default ONNX config",
    );
    onnxConfigured = true;
  }
}

// Don't configure at module load - the ONNX backend isn't initialized yet
// Configuration will be done right before pipeline() is called

// Type for the segmentation pipeline - using image-segmentation for RMBG (desktop)
type SegmentationPipeline = Awaited<
  ReturnType<typeof pipeline<"image-segmentation">>
>;

// Type for the background removal pipeline - using background-removal for MODNet (mobile)
type BackgroundRemovalPipeline = Awaited<
  ReturnType<typeof pipeline<"background-removal">>
>;

// Type for semantic segmentation pipeline - using SegFormer for true wall detection
type SemanticSegmentationPipeline = Awaited<
  ReturnType<typeof pipeline<"image-segmentation">>
>;

// Singleton for the desktop segmentation pipeline (RMBG)
let segmentationPipeline: SegmentationPipeline | null = null;
let isLoading = false;
let loadingPromise: Promise<SegmentationPipeline> | null = null;
let loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 3;

// Singleton for the mobile background removal pipeline (MODNet)
let mobilePipeline: BackgroundRemovalPipeline | null = null;
let isMobileLoading = false;
let mobileLoadingPromise: Promise<BackgroundRemovalPipeline> | null = null;
let mobileLoadAttempts = 0;

// Singleton for DeepLabV3 semantic segmentation pipeline
let semanticPipeline: SemanticSegmentationPipeline | null = null;
let isSemanticLoading = false;
let semanticLoadingPromise: Promise<SemanticSegmentationPipeline> | null = null;
let semanticLoadAttempts = 0;

/**
 * Detect if we're running on Android specifically
 * Android Chrome has known WASM memory limitations
 */
function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

// Maximum image size for segmentation
// Use smaller size on mobile devices to reduce memory pressure
// Android Chrome has known WASM memory limitations (often 256MB-1GB)
const MAX_SEGMENTATION_SIZE_DESKTOP = 1024;
const MAX_SEGMENTATION_SIZE_MOBILE = 512; // Reduced further for Android memory constraints
const MAX_SEGMENTATION_SIZE = isMobileDevice()
  ? MAX_SEGMENTATION_SIZE_MOBILE
  : MAX_SEGMENTATION_SIZE_DESKTOP;

// Check if we should skip ML models entirely on this device
// Some older Android devices simply can't handle WASM-based ML models
function shouldSkipMLModels(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";

  // Check for very old Android versions (below Android 10)
  const androidMatch = ua.match(/Android\s+(\d+)/);
  if (androidMatch) {
    const androidVersion = parseInt(androidMatch[1], 10);
    if (androidVersion < 10) {
      console.warn(
        "[Segmentation] Old Android version detected, skipping ML models",
      );
      return true;
    }
  }

  // Check available memory if possible
  if ("deviceMemory" in navigator) {
    const memory = (navigator as any).deviceMemory;
    if (memory && memory < 4) {
      console.warn(
        `[Segmentation] Low device memory (${memory}GB), may have issues with ML models`,
      );
    }
  }

  return false;
}

// Model configuration
// Desktop: RMBG-1.4 with image-segmentation pipeline (high quality, ~176MB)
// Mobile: MODNet with background-removal pipeline (light weight, ~6.6MB)
// Semantic: SegFormer for true wall detection (ADE20K trained, well-tested with transformers.js)
//   - Using b5 variant (~340MB quantized) for both desktop and mobile - highest quality wall detection
//   - Input images are resized to 640px max dimension to match model's expected input size
const SEGMENTATION_MODEL = "briaai/RMBG-1.4";
const MOBILE_MODEL = "Xenova/modnet";
const SEMANTIC_MODEL_DESKTOP = "Xenova/segformer-b5-finetuned-ade-640-640";
const SEMANTIC_MODEL_MOBILE = "Xenova/segformer-b5-finetuned-ade-640-640";

// Get the appropriate semantic model based on device
function getSemanticModel(): string {
  const mobile = isMobileDevice();
  const model = mobile ? SEMANTIC_MODEL_MOBILE : SEMANTIC_MODEL_DESKTOP;
  console.log(
    `[Segmentation] Using semantic model: ${model} (mobile: ${mobile})`,
  );
  return model;
}

// ADE20K class indices for wall-related categories
// The model outputs labels like "wall", "building", etc. which we match against
// NOTE: Only include TRUE wall classes - avoid cabinet, door, etc. which may catch furniture
const WALL_LABELS = ["wall"];

// Secondary labels that might be walls in some contexts
const SECONDARY_WALL_LABELS = ["building", "fence"];

// Primary wall label - what we're most interested in
const PRIMARY_WALL_LABELS = ["wall", "building"];

// Track if we've had a memory error - if so, disable segmentation
let hasMemoryError = false;

// Flag to use semantic segmentation (DeepLabV3) instead of background removal
let useSemanticSegmentation = true;

/**
 * Simple color-based wall detection for devices that can't run ML models.
 * This is a fallback that works on Android and other limited devices.
 * It detects walls by finding the dominant color in the upper portion of the image
 * (where walls typically are) and treating similar colors as "wall".
 */
async function simpleWallDetection(
  imageUrl: string,
  onProgress?: (progress: number, status: string) => void,
): Promise<WallSegmentationResult> {
  console.log(
    "[Segmentation] Using simple color-based wall detection (fallback)",
  );
  onProgress?.(20, "Analyzing image colors...");

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        // Create canvas at reduced size for processing
        const maxSize = 256; // Small size for fast processing
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        onProgress?.(40, "Detecting wall regions...");

        // Sample colors from the upper third of the image (where walls usually are)
        const sampleHeight = Math.floor(height / 3);
        const colorCounts: Map<string, number> = new Map();

        for (let y = 0; y < sampleHeight; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            // Quantize colors to reduce noise (group similar colors)
            const r = Math.floor(pixels[idx] / 32) * 32;
            const g = Math.floor(pixels[idx + 1] / 32) * 32;
            const b = Math.floor(pixels[idx + 2] / 32) * 32;
            const key = `${r},${g},${b}`;
            colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
          }
        }

        // Find the most common color (likely the wall)
        let dominantColor = "128,128,128";
        let maxCount = 0;
        colorCounts.forEach((count, color) => {
          if (count > maxCount) {
            maxCount = count;
            dominantColor = color;
          }
        });

        const [wallR, wallG, wallB] = dominantColor.split(",").map(Number);
        console.log(
          `[Segmentation] Dominant color detected: RGB(${wallR}, ${wallG}, ${wallB})`,
        );

        onProgress?.(60, "Creating wall mask...");

        // Create wall mask based on color similarity
        const wallMask = new Uint8Array(width * height);
        const colorThreshold = 60; // How similar a color needs to be to count as "wall"

        let minX = width,
          minY = height,
          maxX = 0,
          maxY = 0;
        let wallPixelCount = 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];

            // Calculate color distance
            const distance = Math.sqrt(
              Math.pow(r - wallR, 2) +
              Math.pow(g - wallG, 2) +
              Math.pow(b - wallB, 2),
            );

            // Also check if it's not too dark (floor) or has high saturation (furniture)
            const brightness = (r + g + b) / 3;
            const maxChannel = Math.max(r, g, b);
            const minChannel = Math.min(r, g, b);
            const saturation =
              maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;

            // Wall detection criteria:
            // 1. Similar color to dominant wall color
            // 2. Not too dark (>40 brightness)
            // 3. Not too saturated (<0.6)
            const isWall =
              distance < colorThreshold && brightness > 40 && saturation < 0.6;

            const maskIdx = y * width + x;
            wallMask[maskIdx] = isWall ? 255 : 0;

            if (isWall) {
              wallPixelCount++;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
        }

        onProgress?.(80, "Generating masks...");

        const wallArea = wallPixelCount / (width * height);
        console.log(
          `[Segmentation] Simple detection - Wall area: ${(wallArea * 100).toFixed(1)}%`,
        );

        // Create visualization canvas (red tint)
        const vizCanvas = document.createElement("canvas");
        vizCanvas.width = width;
        vizCanvas.height = height;
        const vizCtx = vizCanvas.getContext("2d")!;
        const vizImageData = vizCtx.createImageData(width, height);
        for (let i = 0; i < wallMask.length; i++) {
          const val = wallMask[i];
          vizImageData.data[i * 4] = val;
          vizImageData.data[i * 4 + 1] = val > 0 ? 128 : 0;
          vizImageData.data[i * 4 + 2] = 0;
          vizImageData.data[i * 4 + 3] = val > 0 ? 180 : 0;
        }
        vizCtx.putImageData(vizImageData, 0, 0);

        // Create CSS mask (using alpha channel for cross-browser compat)
        const cssMaskCanvas = document.createElement("canvas");
        cssMaskCanvas.width = width;
        cssMaskCanvas.height = height;
        const cssMaskCtx = cssMaskCanvas.getContext("2d")!;
        const cssMaskImageData = cssMaskCtx.createImageData(width, height);
        for (let i = 0; i < wallMask.length; i++) {
          const isWall = wallMask[i] > 0;
          cssMaskImageData.data[i * 4] = 255;
          cssMaskImageData.data[i * 4 + 1] = 255;
          cssMaskImageData.data[i * 4 + 2] = 255;
          cssMaskImageData.data[i * 4 + 3] = isWall ? 255 : 0;
        }
        cssMaskCtx.putImageData(cssMaskImageData, 0, 0);

        // Create foreground mask (inverted - using alpha channel)
        const fgMaskCanvas = document.createElement("canvas");
        fgMaskCanvas.width = width;
        fgMaskCanvas.height = height;
        const fgMaskCtx = fgMaskCanvas.getContext("2d")!;
        const fgMaskImageData = fgMaskCtx.createImageData(width, height);
        for (let i = 0; i < wallMask.length; i++) {
          const isWall = wallMask[i] > 0;
          fgMaskImageData.data[i * 4] = 255;
          fgMaskImageData.data[i * 4 + 1] = 255;
          fgMaskImageData.data[i * 4 + 2] = 255;
          fgMaskImageData.data[i * 4 + 3] = isWall ? 0 : 255;
        }
        fgMaskCtx.putImageData(fgMaskImageData, 0, 0);

        // Create wall plane
        const wallPlanes: WallPlane[] = [];
        if (wallPixelCount > 0) {
          const centerX = (minX + maxX) / 2 / width;
          const centerY = (minY + maxY) / 2 / height;
          wallPlanes.push({
            label: "detected_wall",
            centerX,
            centerY,
            normalX: 0,
            normalY: 0,
            area: wallArea,
            boundingBox: {
              xmin: minX / width,
              ymin: minY / height,
              xmax: maxX / width,
              ymax: maxY / height,
            },
          });
        }

        // Detect rectangles
        const detectedRectangles = detectRectanglesInMask(
          wallMask,
          width,
          height,
        );

        onProgress?.(100, "Wall detection complete!");

        resolve({
          wallMask,
          wallBoundingBox:
            wallPixelCount > 0
              ? {
                xmin: minX / width,
                ymin: minY / height,
                xmax: maxX / width,
                ymax: maxY / height,
              }
              : null,
          wallArea,
          width,
          height,
          wallMaskUrl: vizCanvas.toDataURL("image/png"),
          cssMaskUrl: cssMaskCanvas.toDataURL("image/png"),
          foregroundMaskUrl: fgMaskCanvas.toDataURL("image/png"),
          wallPlanes,
          detectedRectangles,
        });
      } catch (error) {
        console.error("[Segmentation] Simple detection failed:", error);
        reject(error);
      }
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageUrl;
  });
}

/**
 * Analyze the wall mask boundary to find significant corner points.
 * These corners often indicate where different walls meet.
 */
function findWallCorners(
  wallMask: Uint8Array,
  width: number,
  height: number,
  component: { pixels: number[]; minX: number; minY: number; maxX: number; maxY: number }
): { x: number; y: number }[] {
  const corners: { x: number; y: number; angle: number }[] = [];
  
  // Create a set for quick lookup
  const pixelSet = new Set(component.pixels);
  
  // Find boundary pixels (pixels that have at least one non-wall neighbor)
  const boundaryPixels: { x: number; y: number }[] = [];
  for (const idx of component.pixels) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    
    // Check if this is a boundary pixel
    const neighbors = [
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
    ];
    
    for (const nIdx of neighbors) {
      if (nIdx === -1 || !pixelSet.has(nIdx)) {
        boundaryPixels.push({ x, y });
        break;
      }
    }
  }
  
  if (boundaryPixels.length < 10) return [];
  
  // Sample boundary points at regular intervals
  const sampleInterval = Math.max(1, Math.floor(boundaryPixels.length / 100));
  const sampledPoints = boundaryPixels.filter((_, i) => i % sampleInterval === 0);
  
  // Find points with high curvature (corners)
  const windowSize = Math.max(3, Math.floor(sampledPoints.length / 20));
  
  for (let i = windowSize; i < sampledPoints.length - windowSize; i++) {
    const prev = sampledPoints[i - windowSize];
    const curr = sampledPoints[i];
    const next = sampledPoints[i + windowSize];
    
    // Calculate vectors
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    
    // Calculate angle between vectors
    const dot = v1.x * v2.x + v1.y * v2.y;
    const cross = v1.x * v2.y - v1.y * v2.x;
    const angle = Math.abs(Math.atan2(cross, dot));
    
    // If angle is significant (> 45 degrees), it's a corner
    if (angle > Math.PI / 4) {
      corners.push({ x: curr.x, y: curr.y, angle });
    }
  }
  
  // Merge nearby corners and keep the most significant ones
  const mergeDistance = Math.max(width, height) * 0.05;
  const mergedCorners: { x: number; y: number }[] = [];
  
  for (const corner of corners) {
    let merged = false;
    for (const existing of mergedCorners) {
      const dist = Math.sqrt((corner.x - existing.x) ** 2 + (corner.y - existing.y) ** 2);
      if (dist < mergeDistance) {
        merged = true;
        break;
      }
    }
    if (!merged) {
      mergedCorners.push({ x: corner.x, y: corner.y });
    }
  }
  
  return mergedCorners;
}

/**
 * Split a connected wall region into multiple sub-regions based on geometric analysis.
 * Uses vertical and horizontal scan lines to detect internal boundaries.
 */
function splitConnectedWallRegion(
  wallMask: Uint8Array,
  width: number,
  height: number,
  component: { pixels: number[]; minX: number; minY: number; maxX: number; maxY: number }
): DetectedRectangle[] {
  const pixelSet = new Set(component.pixels);
  const boxWidth = component.maxX - component.minX + 1;
  const boxHeight = component.maxY - component.minY + 1;
  
  // If the region is too small, treat as single rectangle
  const minSplitSize = Math.max(width, height) * 0.15;
  if (boxWidth < minSplitSize || boxHeight < minSplitSize) {
    return [];
  }
  
  // Analyze vertical slices to find gaps or thin connections
  const verticalProfile: number[] = [];
  for (let x = component.minX; x <= component.maxX; x++) {
    let count = 0;
    for (let y = component.minY; y <= component.maxY; y++) {
      if (pixelSet.has(y * width + x)) count++;
    }
    verticalProfile.push(count);
  }
  
  // Analyze horizontal slices
  const horizontalProfile: number[] = [];
  for (let y = component.minY; y <= component.maxY; y++) {
    let count = 0;
    for (let x = component.minX; x <= component.maxX; x++) {
      if (pixelSet.has(y * width + x)) count++;
    }
    horizontalProfile.push(count);
  }
  
  // Find significant valleys in profiles (potential split points)
  const avgVertical = verticalProfile.reduce((a, b) => a + b, 0) / verticalProfile.length;
  const avgHorizontal = horizontalProfile.reduce((a, b) => a + b, 0) / horizontalProfile.length;
  
  const verticalSplits: number[] = [];
  const horizontalSplits: number[] = [];
  
  // Look for narrow "necks" that might indicate wall boundaries
  const neckThreshold = 0.3; // A valley must be less than 30% of average to be a split
  
  for (let i = Math.floor(verticalProfile.length * 0.1); i < verticalProfile.length * 0.9; i++) {
    if (verticalProfile[i] < avgVertical * neckThreshold) {
      verticalSplits.push(component.minX + i);
    }
  }
  
  for (let i = Math.floor(horizontalProfile.length * 0.1); i < horizontalProfile.length * 0.9; i++) {
    if (horizontalProfile[i] < avgHorizontal * neckThreshold) {
      horizontalSplits.push(component.minY + i);
    }
  }
  
  // If we found clear split points, use them to create sub-regions
  const subRegions: DetectedRectangle[] = [];
  
  // For now, if we found vertical splits, create left/right regions
  if (verticalSplits.length > 0) {
    // Use the most significant split (where profile is lowest)
    let bestSplit = verticalSplits[0];
    let lowestValue = verticalProfile[bestSplit - component.minX];
    for (const split of verticalSplits) {
      const value = verticalProfile[split - component.minX];
      if (value < lowestValue) {
        lowestValue = value;
        bestSplit = split;
      }
    }
    
    // Create left region
    const leftPixels = component.pixels.filter(idx => (idx % width) < bestSplit);
    if (leftPixels.length > 0) {
      const leftMinX = Math.min(...leftPixels.map(idx => idx % width));
      const leftMaxX = Math.max(...leftPixels.map(idx => idx % width));
      const leftMinY = Math.min(...leftPixels.map(idx => Math.floor(idx / width)));
      const leftMaxY = Math.max(...leftPixels.map(idx => Math.floor(idx / width)));
      
      const normMinX = leftMinX / width;
      const normMinY = leftMinY / height;
      const normMaxX = leftMaxX / width;
      const normMaxY = leftMaxY / height;
      
      subRegions.push({
        corners: [
          { x: normMinX, y: normMinY },
          { x: normMaxX, y: normMinY },
          { x: normMaxX, y: normMaxY },
          { x: normMinX, y: normMaxY },
        ],
        boundingBox: { xmin: normMinX, ymin: normMinY, xmax: normMaxX, ymax: normMaxY },
        center: { x: (normMinX + normMaxX) / 2, y: (normMinY + normMaxY) / 2 },
        width: normMaxX - normMinX,
        height: normMaxY - normMinY,
        area: leftPixels.length / (width * height),
        aspectRatio: (normMaxX - normMinX) / (normMaxY - normMinY),
      });
    }
    
    // Create right region
    const rightPixels = component.pixels.filter(idx => (idx % width) > bestSplit);
    if (rightPixels.length > 0) {
      const rightMinX = Math.min(...rightPixels.map(idx => idx % width));
      const rightMaxX = Math.max(...rightPixels.map(idx => idx % width));
      const rightMinY = Math.min(...rightPixels.map(idx => Math.floor(idx / width)));
      const rightMaxY = Math.max(...rightPixels.map(idx => Math.floor(idx / width)));
      
      const normMinX = rightMinX / width;
      const normMinY = rightMinY / height;
      const normMaxX = rightMaxX / width;
      const normMaxY = rightMaxY / height;
      
      subRegions.push({
        corners: [
          { x: normMinX, y: normMinY },
          { x: normMaxX, y: normMinY },
          { x: normMaxX, y: normMaxY },
          { x: normMinX, y: normMaxY },
        ],
        boundingBox: { xmin: normMinX, ymin: normMinY, xmax: normMaxX, ymax: normMaxY },
        center: { x: (normMinX + normMaxX) / 2, y: (normMinY + normMaxY) / 2 },
        width: normMaxX - normMinX,
        height: normMaxY - normMinY,
        area: rightPixels.length / (width * height),
        aspectRatio: (normMaxX - normMinX) / (normMaxY - normMinY),
      });
    }
  }
  
  // Similarly for horizontal splits
  if (horizontalSplits.length > 0 && subRegions.length === 0) {
    let bestSplit = horizontalSplits[0];
    let lowestValue = horizontalProfile[bestSplit - component.minY];
    for (const split of horizontalSplits) {
      const value = horizontalProfile[split - component.minY];
      if (value < lowestValue) {
        lowestValue = value;
        bestSplit = split;
      }
    }
    
    // Create top region
    const topPixels = component.pixels.filter(idx => Math.floor(idx / width) < bestSplit);
    if (topPixels.length > 0) {
      const topMinX = Math.min(...topPixels.map(idx => idx % width));
      const topMaxX = Math.max(...topPixels.map(idx => idx % width));
      const topMinY = Math.min(...topPixels.map(idx => Math.floor(idx / width)));
      const topMaxY = Math.max(...topPixels.map(idx => Math.floor(idx / width)));
      
      const normMinX = topMinX / width;
      const normMinY = topMinY / height;
      const normMaxX = topMaxX / width;
      const normMaxY = topMaxY / height;
      
      subRegions.push({
        corners: [
          { x: normMinX, y: normMinY },
          { x: normMaxX, y: normMinY },
          { x: normMaxX, y: normMaxY },
          { x: normMinX, y: normMaxY },
        ],
        boundingBox: { xmin: normMinX, ymin: normMinY, xmax: normMaxX, ymax: normMaxY },
        center: { x: (normMinX + normMaxX) / 2, y: (normMinY + normMaxY) / 2 },
        width: normMaxX - normMinX,
        height: normMaxY - normMinY,
        area: topPixels.length / (width * height),
        aspectRatio: (normMaxX - normMinX) / (normMaxY - normMinY),
      });
    }
    
    // Create bottom region
    const bottomPixels = component.pixels.filter(idx => Math.floor(idx / width) > bestSplit);
    if (bottomPixels.length > 0) {
      const bottomMinX = Math.min(...bottomPixels.map(idx => idx % width));
      const bottomMaxX = Math.max(...bottomPixels.map(idx => idx % width));
      const bottomMinY = Math.min(...bottomPixels.map(idx => Math.floor(idx / width)));
      const bottomMaxY = Math.max(...bottomPixels.map(idx => Math.floor(idx / width)));
      
      const normMinX = bottomMinX / width;
      const normMinY = bottomMinY / height;
      const normMaxX = bottomMaxX / width;
      const normMaxY = bottomMaxY / height;
      
      subRegions.push({
        corners: [
          { x: normMinX, y: normMinY },
          { x: normMaxX, y: normMinY },
          { x: normMaxX, y: normMaxY },
          { x: normMinX, y: normMaxY },
        ],
        boundingBox: { xmin: normMinX, ymin: normMinY, xmax: normMaxX, ymax: normMaxY },
        center: { x: (normMinX + normMaxX) / 2, y: (normMinY + normMaxY) / 2 },
        width: normMaxX - normMinX,
        height: normMaxY - normMinY,
        area: bottomPixels.length / (width * height),
        aspectRatio: (normMaxX - normMinX) / (normMaxY - normMinY),
      });
    }
  }
  
  return subRegions;
}

/**
 * Split a large wall region into grid-based sub-regions if no natural splits are found.
 * This handles L-shaped or corner rooms where walls are fully connected.
 */
function splitIntoGridRegions(
  wallMask: Uint8Array,
  width: number,
  height: number,
  component: { pixels: number[]; minX: number; minY: number; maxX: number; maxY: number },
  aspectRatio: number
): DetectedRectangle[] {
  const pixelSet = new Set(component.pixels);
  const boxWidth = component.maxX - component.minX + 1;
  const boxHeight = component.maxY - component.minY + 1;
  const boxAspect = boxWidth / boxHeight;
  
  const regions: DetectedRectangle[] = [];
  
  // Determine grid divisions based on aspect ratio
  let cols = 1;
  let rows = 1;
  
  // If the wall region is very wide, split into columns
  if (boxAspect > 2.5) {
    cols = Math.min(3, Math.ceil(boxAspect / 1.5));
  }
  // If very tall, split into rows
  else if (boxAspect < 0.4) {
    rows = Math.min(3, Math.ceil(1.5 / boxAspect));
  }
  // If roughly square but large, consider 2x1 or 1x2 split
  else if (boxWidth > width * 0.6 && boxHeight > height * 0.6) {
    // Large region covering most of the image - likely multiple walls
    if (boxAspect > 1.2) {
      cols = 2;
    } else if (boxAspect < 0.8) {
      rows = 2;
    }
  }
  
  if (cols === 1 && rows === 1) return regions;
  
  const cellWidth = boxWidth / cols;
  const cellHeight = boxHeight / rows;
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellMinX = Math.floor(component.minX + col * cellWidth);
      const cellMaxX = Math.floor(component.minX + (col + 1) * cellWidth);
      const cellMinY = Math.floor(component.minY + row * cellHeight);
      const cellMaxY = Math.floor(component.minY + (row + 1) * cellHeight);
      
      // Count pixels in this cell
      let pixelCount = 0;
      let actualMinX = cellMaxX, actualMaxX = cellMinX;
      let actualMinY = cellMaxY, actualMaxY = cellMinY;
      
      for (let y = cellMinY; y < cellMaxY; y++) {
        for (let x = cellMinX; x < cellMaxX; x++) {
          if (pixelSet.has(y * width + x)) {
            pixelCount++;
            actualMinX = Math.min(actualMinX, x);
            actualMaxX = Math.max(actualMaxX, x);
            actualMinY = Math.min(actualMinY, y);
            actualMaxY = Math.max(actualMaxY, y);
          }
        }
      }
      
      // Only add if this cell has significant content (>50% filled)
      const cellArea = (cellMaxX - cellMinX) * (cellMaxY - cellMinY);
      if (pixelCount > cellArea * 0.4) {
        const normMinX = actualMinX / width;
        const normMinY = actualMinY / height;
        const normMaxX = actualMaxX / width;
        const normMaxY = actualMaxY / height;
        const normWidth = normMaxX - normMinX;
        const normHeight = normMaxY - normMinY;
        
        regions.push({
          corners: [
            { x: normMinX, y: normMinY },
            { x: normMaxX, y: normMinY },
            { x: normMaxX, y: normMaxY },
            { x: normMinX, y: normMaxY },
          ],
          boundingBox: { xmin: normMinX, ymin: normMinY, xmax: normMaxX, ymax: normMaxY },
          center: { x: (normMinX + normMaxX) / 2, y: (normMinY + normMaxY) / 2 },
          width: normWidth,
          height: normHeight,
          area: pixelCount / (width * height),
          aspectRatio: normWidth / normHeight,
        });
      }
    }
  }
  
  return regions;
}

/**
 * Detect rectangular regions within the wall mask using contour analysis.
 * Now includes logic to split connected wall regions into separate planes.
 * Returns rectangles sorted by area (largest first).
 */
function detectRectanglesInMask(
  wallMask: Uint8Array,
  width: number,
  height: number,
  minAreaRatio: number = 0.02, // Minimum 2% of image area
): DetectedRectangle[] {
  const rectangles: DetectedRectangle[] = [];

  // Find connected components and their bounding boxes
  const visited = new Uint8Array(width * height);
  const components: {
    pixels: number[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }[] = [];

  // Flood fill to find connected components
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (wallMask[idx] > 0 && !visited[idx]) {
        // BFS flood fill
        const component = {
          pixels: [] as number[],
          minX: x,
          minY: y,
          maxX: x,
          maxY: y,
        };
        const queue: number[] = [idx];
        visited[idx] = 1;

        while (queue.length > 0) {
          const currentIdx = queue.shift()!;
          component.pixels.push(currentIdx);

          const cx = currentIdx % width;
          const cy = Math.floor(currentIdx / width);
          component.minX = Math.min(component.minX, cx);
          component.minY = Math.min(component.minY, cy);
          component.maxX = Math.max(component.maxX, cx);
          component.maxY = Math.max(component.maxY, cy);

          // Check 4-connected neighbors
          const neighbors = [
            cy > 0 ? currentIdx - width : -1, // up
            cy < height - 1 ? currentIdx + width : -1, // down
            cx > 0 ? currentIdx - 1 : -1, // left
            cx < width - 1 ? currentIdx + 1 : -1, // right
          ];

          for (const nIdx of neighbors) {
            if (nIdx >= 0 && wallMask[nIdx] > 0 && !visited[nIdx]) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }

        components.push(component);
      }
    }
  }

  console.log(`[Segmentation] Found ${components.length} connected components`);

  // Analyze each component for rectangular-ness
  for (const component of components) {
    const boxWidth = component.maxX - component.minX + 1;
    const boxHeight = component.maxY - component.minY + 1;
    const boxArea = boxWidth * boxHeight;
    const pixelCount = component.pixels.length;

    // Calculate fill ratio (how much of bounding box is filled)
    const fillRatio = pixelCount / boxArea;

    // Skip if too small
    const areaRatio = pixelCount / (width * height);
    if (areaRatio < minAreaRatio) {
      console.log(`[Segmentation] Skipping component: area ${(areaRatio * 100).toFixed(1)}% < ${minAreaRatio * 100}%`);
      continue;
    }

    console.log(`[Segmentation] Component: ${boxWidth}x${boxHeight}, fill=${(fillRatio * 100).toFixed(1)}%, area=${(areaRatio * 100).toFixed(1)}%`);

    // Check if this is a large region that might contain multiple walls
    const isLargeRegion = areaRatio > 0.15; // More than 15% of image
    const hasNonRectangularShape = fillRatio < 0.85; // Less than 85% filled
    
    if (isLargeRegion || hasNonRectangularShape) {
      // Try to split into sub-regions
      console.log(`[Segmentation] Attempting to split large/irregular region...`);
      
      // First try natural boundary detection
      const splitRegions = splitConnectedWallRegion(wallMask, width, height, component);
      
      if (splitRegions.length > 1) {
        console.log(`[Segmentation] Split into ${splitRegions.length} natural sub-regions`);
        rectangles.push(...splitRegions);
        continue;
      }
      
      // If no natural splits found, try grid-based splitting for very large regions
      if (areaRatio > 0.25) {
        const boxAspect = boxWidth / boxHeight;
        const gridRegions = splitIntoGridRegions(wallMask, width, height, component, boxAspect);
        
        if (gridRegions.length > 1) {
          console.log(`[Segmentation] Split into ${gridRegions.length} grid sub-regions`);
          rectangles.push(...gridRegions);
          continue;
        }
      }
    }

    // If fill ratio is high enough (>70%), treat as single rectangle
    if (fillRatio > 0.70) {
      const normMinX = component.minX / width;
      const normMinY = component.minY / height;
      const normMaxX = component.maxX / width;
      const normMaxY = component.maxY / height;
      const normWidth = normMaxX - normMinX;
      const normHeight = normMaxY - normMinY;

      rectangles.push({
        corners: [
          { x: normMinX, y: normMinY }, // top-left
          { x: normMaxX, y: normMinY }, // top-right
          { x: normMaxX, y: normMaxY }, // bottom-right
          { x: normMinX, y: normMaxY }, // bottom-left
        ],
        boundingBox: {
          xmin: normMinX,
          ymin: normMinY,
          xmax: normMaxX,
          ymax: normMaxY,
        },
        center: {
          x: (normMinX + normMaxX) / 2,
          y: (normMinY + normMaxY) / 2,
        },
        width: normWidth,
        height: normHeight,
        area: areaRatio,
        aspectRatio: normWidth / normHeight,
      });
    } else {
      console.log(`[Segmentation] Skipping component: fill ratio ${(fillRatio * 100).toFixed(1)}% < 70%`);
    }
  }

  // Sort by area (largest first)
  rectangles.sort((a, b) => b.area - a.area);

  console.log(
    `[Segmentation] Detected ${rectangles.length} rectangular regions`,
  );
  
  // Log details of each detected rectangle
  rectangles.forEach((rect, i) => {
    console.log(`  [${i}] area=${(rect.area * 100).toFixed(1)}%, aspect=${rect.aspectRatio.toFixed(2)}, center=(${rect.center.x.toFixed(2)}, ${rect.center.y.toFixed(2)})`);
  });
  
  return rectangles;
}

/**
 * Resize an image to fit within max dimensions while maintaining aspect ratio
 * Returns a data URL of the resized image along with original and new dimensions
 * @param imageUrl - The image URL to resize
 * @param maxSize - Optional maximum dimension (defaults to MAX_SEGMENTATION_SIZE)
 */
async function resizeImageForSegmentation(imageUrl: string, maxSize?: number): Promise<{
  dataUrl: string;
  scale: number;
  originalWidth: number;
  originalHeight: number;
  newWidth: number;
  newHeight: number;
}> {
  const targetMaxSize = maxSize ?? MAX_SEGMENTATION_SIZE;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const { width, height } = img;

      // Calculate scale factor to fit within targetMaxSize
      const maxDim = Math.max(width, height);
      const scale =
        maxDim > targetMaxSize ? targetMaxSize / maxDim : 1;

      const newWidth = Math.round(width * scale);
      const newHeight = Math.round(height * scale);

      console.log(
        `[Segmentation] Resizing image from ${width}x${height} to ${newWidth}x${newHeight} (scale: ${scale.toFixed(
          2,
        )})`,
      );

      // Create canvas and resize
      const canvas = document.createElement("canvas");
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      resolve({
        dataUrl: canvas.toDataURL("image/jpeg", 0.9),
        scale,
        originalWidth: width,
        originalHeight: height,
        newWidth,
        newHeight,
      });
    };

    img.onerror = () => reject(new Error("Failed to load image for resizing"));
    img.src = imageUrl;
  });
}

export interface WallSegmentationResult {
  wallMask: Uint8Array;
  wallBoundingBox: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  } | null;
  wallArea: number;
  width: number;
  height: number;
  wallMaskUrl: string;
  /** Black & white mask URL for CSS masking (white = wall, black = non-wall) */
  cssMaskUrl: string;
  /** Inverted mask URL for foreground overlay (white = non-wall/foreground, black = wall) */
  foregroundMaskUrl: string;
  wallPlanes: WallPlane[];
  /** Detected rectangular regions where panels can fit */
  detectedRectangles: DetectedRectangle[];
}

/** A detected rectangular region on the wall */
export interface DetectedRectangle {
  /** Normalized coordinates (0-1) of the four corners */
  corners: { x: number; y: number }[];
  /** Bounding box in normalized coordinates */
  boundingBox: { xmin: number; ymin: number; xmax: number; ymax: number };
  /** Center point in normalized coordinates */
  center: { x: number; y: number };
  /** Width and height in normalized coordinates */
  width: number;
  height: number;
  /** Area as fraction of total image */
  area: number;
  /** Aspect ratio (width/height) */
  aspectRatio: number;
}

export interface WallPlane {
  label: string;
  centerX: number;
  centerY: number;
  normalX: number;
  normalY: number;
  area: number;
  boundingBox: { xmin: number; ymin: number; xmax: number; ymax: number };
}

/**
 * Initialize the RMBG segmentation pipeline for DESKTOP only.
 * This is the original high-quality pipeline that works well on desktop.
 */
async function initSegmentationPipeline(
  onProgress?: (progress: number, status: string) => void,
): Promise<SegmentationPipeline> {
  // Return cached pipeline if available
  if (segmentationPipeline) {
    console.log("[Segmentation] Using cached RMBG pipeline");
    return segmentationPipeline;
  }

  // Return in-progress loading promise if available
  if (isLoading && loadingPromise) {
    console.log("[Segmentation] Waiting for in-progress RMBG load");
    return loadingPromise;
  }

  // Check if we've exceeded max attempts
  if (loadAttempts >= MAX_LOAD_ATTEMPTS) {
    console.error("[Segmentation] Max RMBG load attempts exceeded");
    throw new Error(
      "Failed to load segmentation model after multiple attempts",
    );
  }

  isLoading = true;
  loadAttempts++;

  console.log(
    `[Segmentation] Loading RMBG model (attempt ${loadAttempts}/${MAX_LOAD_ATTEMPTS})...`,
  );

  loadingPromise = (async () => {
    try {
      onProgress?.(0, "Loading RMBG model...");

      console.log(
        `[Segmentation] Calling pipeline() for image-segmentation with ${SEGMENTATION_MODEL}...`,
      );

      // DESKTOP: Use RMBG-1.4 with image-segmentation pipeline
      const pipe = await pipeline("image-segmentation", SEGMENTATION_MODEL, {
        progress_callback: (data: {
          progress?: number;
          status?: string;
          file?: string;
        }) => {
          console.log("[Segmentation] Progress:", data);
          if (data.progress !== undefined) {
            onProgress?.(
              data.progress,
              data.status || `Loading ${data.file || "model"}...`,
            );
          }
        },
      });

      console.log("[Segmentation] RMBG Pipeline created successfully!");
      segmentationPipeline = pipe;
      onProgress?.(100, "Segmentation model loaded!");
      return segmentationPipeline;
    } catch (error) {
      console.error("[Segmentation] Failed to load RMBG model:", error);
      // Reset state so we can try again
      segmentationPipeline = null;
      loadingPromise = null;
      throw error;
    } finally {
      isLoading = false;
    }
  })();

  return loadingPromise;
}

/**
 * Initialize the MODNet pipeline for MOBILE only.
 * This is a lightweight pipeline that works on Android devices.
 */
async function initMobilePipeline(
  onProgress?: (progress: number, status: string) => void,
): Promise<BackgroundRemovalPipeline> {
  // Return cached pipeline if available
  if (mobilePipeline) {
    console.log("[Segmentation] Using cached MODNet pipeline");
    return mobilePipeline;
  }

  // Return in-progress loading promise if available
  if (isMobileLoading && mobileLoadingPromise) {
    console.log("[Segmentation] Waiting for in-progress MODNet load");
    return mobileLoadingPromise;
  }

  // Check if we've exceeded max attempts
  if (mobileLoadAttempts >= MAX_LOAD_ATTEMPTS) {
    console.error("[Segmentation] Max MODNet load attempts exceeded");
    throw new Error(
      "Failed to load mobile segmentation model after multiple attempts",
    );
  }

  isMobileLoading = true;
  mobileLoadAttempts++;

  console.log(
    `[Segmentation] Loading MODNet model (attempt ${mobileLoadAttempts}/${MAX_LOAD_ATTEMPTS})...`,
  );

  mobileLoadingPromise = (async () => {
    try {
      onProgress?.(0, "Loading MODNet model...");

      // Configure ONNX for mobile BEFORE loading the model
      configureOnnxForMobile();

      console.log(
        `[Segmentation] Calling pipeline() for background-removal with ${MOBILE_MODEL}...`,
      );

      // MOBILE: Use MODNet with background-removal pipeline and uint8 quantization
      const pipe = await pipeline("background-removal", MOBILE_MODEL, {
        dtype: "uint8" as any,
        progress_callback: (data: {
          progress?: number;
          status?: string;
          file?: string;
        }) => {
          console.log("[Segmentation] MODNet Progress:", data);
          if (data.progress !== undefined) {
            onProgress?.(
              data.progress,
              data.status || `Loading ${data.file || "model"}...`,
            );
          }
        },
      });

      console.log("[Segmentation] MODNet Pipeline created successfully!");
      mobilePipeline = pipe;
      onProgress?.(100, "Mobile segmentation model loaded!");
      return mobilePipeline;
    } catch (error) {
      console.error("[Segmentation] Failed to load MODNet model:", error);
      // Reset state so we can try again
      mobilePipeline = null;
      mobileLoadingPromise = null;
      throw error;
    } finally {
      isMobileLoading = false;
    }
  })();

  return mobileLoadingPromise;
}

/**
 * Initialize the DeepLabV3 MobileViT semantic segmentation pipeline.
 * This model directly detects walls using ADE20K labels (~5MB, very lightweight).
 */
async function initSemanticPipeline(
  onProgress?: (progress: number, status: string) => void,
): Promise<SemanticSegmentationPipeline> {
  // Return cached pipeline if available
  if (semanticPipeline) {
    console.log("[Segmentation] Using cached SegFormer pipeline");
    return semanticPipeline;
  }

  // Return in-progress loading promise if available
  if (isSemanticLoading && semanticLoadingPromise) {
    console.log("[Segmentation] Waiting for in-progress SegFormer load");
    return semanticLoadingPromise;
  }

  // Check if we've exceeded max attempts
  if (semanticLoadAttempts >= MAX_LOAD_ATTEMPTS) {
    console.error("[Segmentation] Max SegFormer load attempts exceeded");
    throw new Error(
      "Failed to load semantic segmentation model after multiple attempts",
    );
  }

  isSemanticLoading = true;
  semanticLoadAttempts++;

  // Get the appropriate model for this device
  const modelToUse = getSemanticModel();

  console.log(
    `[Segmentation] Loading SegFormer ADE20K model (attempt ${semanticLoadAttempts}/${MAX_LOAD_ATTEMPTS})...`,
  );
  console.log(`[Segmentation] Model: ${modelToUse}`);

  semanticLoadingPromise = (async () => {
    try {
      onProgress?.(
        0,
        `Loading wall detection model (${isMobileDevice() ? "mobile" : "desktop"})...`,
      );

      // Configure ONNX for mobile BEFORE loading the model
      // This must be done here (not at module load) because env.backends.onnx
      // is only populated after the onnx backend module is imported
      configureOnnxForMobile();

      // Log the final ONNX configuration for debugging
      if (isMobileDevice()) {
        console.log("[Segmentation] Final ONNX configuration:");
        console.log(
          "[Segmentation] - numThreads:",
          (env.backends?.onnx as any)?.wasm?.numThreads,
        );
        console.log(
          "[Segmentation] - wasmPaths:",
          JSON.stringify((env.backends?.onnx as any)?.wasm?.wasmPaths),
        );
      }

      console.log(
        `[Segmentation] Calling pipeline() for image-segmentation with ${modelToUse}...`,
      );

      // Use image-segmentation pipeline for SegFormer
      // Use q8 (quantized) dtype for better performance and smaller download size (~89MB vs ~341MB)
      const pipe = await pipeline("image-segmentation", modelToUse, {
        dtype: "q8",
        progress_callback: (data: {
          progress?: number;
          status?: string;
          file?: string;
        }) => {
          console.log("[Segmentation] SegFormer Progress:", data);
          if (data.progress !== undefined) {
            onProgress?.(
              data.progress,
              data.status || `Loading ${data.file || "model"}...`,
            );
          }
        },
      });

      console.log("[Segmentation] SegFormer Pipeline created successfully!");
      semanticPipeline = pipe;
      onProgress?.(100, "Wall detection model loaded!");
      return semanticPipeline;
    } catch (error) {
      console.error("[Segmentation] Failed to load SegFormer model:", error);
      console.error("[Segmentation] Error details:", {
        name: (error as Error)?.name,
        message: (error as Error)?.message,
        stack: (error as Error)?.stack?.substring(0, 500),
      });
      // Reset state so we can try again
      semanticPipeline = null;
      semanticLoadingPromise = null;
      throw error;
    } finally {
      isSemanticLoading = false;
    }
  })();

  return semanticLoadingPromise;
}

export async function segmentWalls(
  imageUrl: string,
  onProgress?: (progress: number, status: string) => void,
): Promise<WallSegmentationResult> {
  console.log("[Segmentation] segmentWalls called");
  console.log(
    "[Segmentation] Device info - Mobile:",
    isMobileDevice(),
    "Android:",
    isAndroid(),
  );
  console.log("[Segmentation] Max size:", MAX_SEGMENTATION_SIZE);

  // Check if we should skip ML models entirely (very old devices or previous memory errors)
  if (shouldSkipMLModels() || hasMemoryError) {
    console.log(
      "[Segmentation] Skipping ML models, using simple color-based detection",
    );
    console.log(
      "[Segmentation] Reason:",
      shouldSkipMLModels() ? "shouldSkipMLModels=true" : "hasMemoryError=true",
    );
    onProgress?.(10, "Using lightweight wall detection...");
    try {
      return await simpleWallDetection(imageUrl, onProgress);
    } catch (error) {
      console.error("[Segmentation] Simple detection failed:", error);
      return {
        wallMask: new Uint8Array(0),
        wallBoundingBox: null,
        wallArea: 0,
        width: 0,
        height: 0,
        wallMaskUrl: "",
        cssMaskUrl: "",
        foregroundMaskUrl: "",
        wallPlanes: [],
        detectedRectangles: [],
      };
    }
  }

  // Route to the appropriate pipeline based on device and settings
  // Use ONLY semantic segmentation (SegFormer) for true wall detection
  const modelToUse = getSemanticModel();
  console.log(`[Segmentation] Using SEMANTIC path with model: ${modelToUse}`);
  try {
    return await segmentWallsSemantic(imageUrl, onProgress);
  } catch (error) {
    console.error("[Segmentation] Semantic segmentation failed:", error);
    console.error("[Segmentation] Error type:", (error as Error)?.name);
    console.error("[Segmentation] Error message:", (error as Error)?.message);

    // Check if it's a memory error
    hasMemoryError = isMemoryError(error);
    if (hasMemoryError) {
      console.log(
        "[Segmentation] Memory error detected, will skip ML models on next run",
      );
    }

    // Fall back to simple color-based detection (no RMBG/MODNet)
    console.log("[Segmentation] Falling back to simple color-based detection");
    return await simpleWallDetection(imageUrl, onProgress);
  }
}

/**
 * SEMANTIC segmentation using SegFormer (ADE20K labels).
 * This directly detects walls by semantic class, not by background removal.
 * Much more accurate for wall detection as it understands "wall" as a concept.
 */
async function segmentWallsSemantic(
  imageUrl: string,
  onProgress?: (progress: number, status: string) => void,
): Promise<WallSegmentationResult> {
  try {
    // Step 1: Resize image for processing and get original dimensions
    // Use 640px max dimension to match SegFormer B5's expected input size
    console.log("[Segmentation Semantic] Step 1: Resizing image to 640px...");
    onProgress?.(10, "Preparing image...");
    const {
      dataUrl: resizedImageUrl,
      originalWidth,
      originalHeight,
      newWidth,
      newHeight,
    } = await resizeImageForSegmentation(imageUrl, 640);

    console.log(
      `[Segmentation Semantic] Original: ${originalWidth}x${originalHeight}, Resized: ${newWidth}x${newHeight}`,
    );

    // Step 2: Initialize the SegFormer pipeline
    console.log(
      "[Segmentation Semantic] Step 2: Getting SegFormer pipeline...",
    );
    const pipe = await initSemanticPipeline(onProgress);
    console.log("[Segmentation Semantic] Pipeline ready");

    onProgress?.(50, "Detecting walls...");

    // Step 3: Run semantic segmentation
    console.log("[Segmentation Semantic] Step 3: Running SegFormer...");
    const results = await pipe(resizedImageUrl);
    console.log("[Segmentation Semantic] SegFormer result received");

    // SegFormer returns an array of {label, mask, score} for each detected class
    const segments = Array.isArray(results) ? results : [results];

    console.log(`[Segmentation Semantic] Found ${segments.length} segments`);
    segments.forEach((seg: any, i: number) => {
      console.log(
        `  [${i}] label="${seg.label}" score=${seg.score !== null ? seg.score?.toFixed(3) : "N/A"}`,
      );
    });

    if (segments.length === 0) {
      console.log("[Segmentation Semantic] No segments found");
      onProgress?.(100, "No segments detected");
      return createEmptyResult();
    }

    // Step 4: Find wall-related segments and merge their masks
    // First try primary wall labels only
    let wallSegments = segments.filter((seg: any) => {
      const label = (seg.label || "").toLowerCase();
      return WALL_LABELS.some((wl) => label.includes(wl));
    });

    console.log(
      `[Segmentation Semantic] Found ${wallSegments.length} primary wall segments`,
    );

    // Log all detected segments for debugging
    console.log(
      "[Segmentation Semantic] All detected labels:",
      segments.map((s: any) => `"${s.label}"`).join(", "),
    );

    // If no primary wall found, try secondary labels
    if (wallSegments.length === 0) {
      console.log(
        "[Segmentation Semantic] No primary wall, trying secondary labels...",
      );
      wallSegments = segments.filter((seg: any) => {
        const label = (seg.label || "").toLowerCase();
        return SECONDARY_WALL_LABELS.some((wl) => label.includes(wl));
      });
      console.log(
        `[Segmentation Semantic] Found ${wallSegments.length} secondary wall segments`,
      );
    }

    // If still no wall segments, DON'T fall back to largest segment
    // This prevents furniture from being treated as wall
    if (wallSegments.length === 0) {
      console.log(
        "[Segmentation Semantic] No wall segments found - returning empty result",
      );
      console.log(
        "[Segmentation Semantic] Available labels were:",
        segments.map((s: any) => s.label).join(", "),
      );
      return createEmptyResult();
    }

    if (wallSegments.length === 0 || !wallSegments[0]?.mask) {
      console.log("[Segmentation Semantic] No usable mask found");
      return createEmptyResult();
    }

    // Get dimensions from first wall segment (model output size)
    const firstMask = wallSegments[0].mask as RawImage;
    const maskWidth = firstMask.width;
    const maskHeight = firstMask.height;

    console.log(
      `[Segmentation Semantic] Model mask dimensions: ${maskWidth}x${maskHeight}`,
    );
    console.log(
      `[Segmentation Semantic] Target output dimensions: ${newWidth}x${newHeight}`,
    );

    // Step 5: Merge all wall segment masks and upscale to target dimensions
    // We use newWidth/newHeight (the resized input size) as the target since that's what
    // the Visualizer expects (it displays the image at newWidth x newHeight)
    onProgress?.(70, "Creating wall mask...");
    return processSemanticMasksWithUpscale(
      wallSegments,
      maskWidth,
      maskHeight,
      newWidth,
      newHeight,
      onProgress,
    );
  } catch (error) {
    console.error("[Segmentation Semantic] Error:", error);
    hasMemoryError = isMemoryError(error);
    if (hasMemoryError) {
      console.log(
        "[Segmentation Semantic] Memory error, falling back to simple detection",
      );
      return simpleWallDetection(imageUrl, onProgress);
    }
    throw error;
  }
}

/**
 * DESKTOP segmentation using RMBG-1.4 (original working implementation)
 * This is the high-quality pipeline that works well on desktop browsers.
 */
async function segmentWallsDesktop(
  imageUrl: string,
  onProgress?: (progress: number, status: string) => void,
): Promise<WallSegmentationResult> {
  try {
    // Step 1: Resize image for processing
    console.log("[Segmentation Desktop] Step 1: Resizing image...");
    onProgress?.(10, "Preparing image...");
    const { dataUrl: resizedImageUrl, scale } =
      await resizeImageForSegmentation(imageUrl);
    console.log("[Segmentation Desktop] Image resized (scale:", scale, ")");

    // Step 2: Initialize the RMBG pipeline
    console.log("[Segmentation Desktop] Step 2: Getting RMBG pipeline...");
    const pipe = await initSegmentationPipeline(onProgress);
    console.log("[Segmentation Desktop] Pipeline ready");

    onProgress?.(50, "Detecting foreground objects...");

    // Step 3: Run RMBG segmentation
    console.log("[Segmentation Desktop] Step 3: Running RMBG...");
    const results = await pipe(resizedImageUrl);
    console.log("[Segmentation Desktop] RMBG result received");

    // RMBG returns [{mask: RawImage, label, score}]
    const segments = Array.isArray(results) ? results : [results];

    if (segments.length === 0 || !segments[0]?.mask) {
      console.log("[Segmentation Desktop] No mask in results");
      onProgress?.(100, "Background removal failed");
      return createEmptyResult();
    }

    const foregroundMask = segments[0].mask as RawImage;
    const width = foregroundMask.width;
    const height = foregroundMask.height;
    const channels = foregroundMask.channels || 1;
    const maskData = foregroundMask.data as Uint8Array;

    console.log(
      `[Segmentation Desktop] Mask: ${width}x${height}, ${channels} channels`,
    );

    // Step 4: Create wall mask by inverting the foreground mask
    // RMBG: high value = foreground, low value = background (wall)
    return processRMBGMask(maskData, width, height, channels, onProgress);
  } catch (error) {
    console.error("[Segmentation Desktop] Error:", error);
    hasMemoryError = isMemoryError(error);
    if (hasMemoryError) {
      console.log(
        "[Segmentation Desktop] Memory error, falling back to simple detection",
      );
      return simpleWallDetection(imageUrl, onProgress);
    }
    throw error;
  }
}

/**
 * MOBILE segmentation using MODNet (lightweight implementation for Android)
 * This uses a smaller model that fits within Android's WASM memory limits.
 */
async function segmentWallsMobile(
  imageUrl: string,
  onProgress?: (progress: number, status: string) => void,
): Promise<WallSegmentationResult> {
  try {
    // Step 1: Resize image (use smaller size for mobile)
    console.log("[Segmentation Mobile] Step 1: Resizing image...");
    onProgress?.(10, "Preparing image...");
    const { dataUrl: resizedImageUrl, scale } =
      await resizeImageForSegmentation(imageUrl);
    console.log("[Segmentation Mobile] Image resized (scale:", scale, ")");

    // Step 2: Initialize the MODNet pipeline
    console.log("[Segmentation Mobile] Step 2: Getting MODNet pipeline...");
    const pipe = await initMobilePipeline(onProgress);
    console.log("[Segmentation Mobile] Pipeline ready");

    onProgress?.(50, "Detecting foreground objects...");

    // Step 3: Run MODNet background removal
    console.log("[Segmentation Mobile] Step 3: Running MODNet...");
    const results = await pipe(resizedImageUrl);
    console.log("[Segmentation Mobile] MODNet result received");

    // MODNet with background-removal returns RawImage[] (RGBA with alpha as mask)
    const outputs = Array.isArray(results) ? results : [results];

    if (outputs.length === 0 || !outputs[0]) {
      console.log("[Segmentation Mobile] No output in results");
      onProgress?.(100, "Background removal failed");
      return createEmptyResult();
    }

    const outputImage = outputs[0] as RawImage;
    if (!outputImage.data) {
      console.log("[Segmentation Mobile] No data in output image");
      return createEmptyResult();
    }

    const width = outputImage.width;
    const height = outputImage.height;
    const channels = outputImage.channels || 4;
    const imageData = outputImage.data as Uint8Array;

    console.log(
      `[Segmentation Mobile] Output: ${width}x${height}, ${channels} channels`,
    );

    // Step 4: Create wall mask from alpha channel
    // MODNet: high alpha = foreground, low alpha = background (wall)
    return processMODNetOutput(imageData, width, height, channels, onProgress);
  } catch (error) {
    console.error("[Segmentation Mobile] Error:", error);
    hasMemoryError = isMemoryError(error);
    if (hasMemoryError) {
      console.log(
        "[Segmentation Mobile] Memory error, falling back to simple detection",
      );
    }
    // Always fall back to simple detection on mobile errors
    return simpleWallDetection(imageUrl, onProgress);
  }
}

/**
 * Create an empty result for failed segmentation
 */
function createEmptyResult(): WallSegmentationResult {
  return {
    wallMask: new Uint8Array(0),
    wallBoundingBox: null,
    wallArea: 0,
    width: 0,
    height: 0,
    wallMaskUrl: "",
    cssMaskUrl: "",
    foregroundMaskUrl: "",
    wallPlanes: [],
    detectedRectangles: [],
  };
}

/**
 * Check if an error is a memory-related error
 * These errors are common on mobile devices (especially Android) with limited WASM memory
 */
function isMemoryError(error: any): boolean {
  const msg = String(error).toLowerCase();
  return (
    msg.includes("memory") ||
    msg.includes("oom") ||
    msg.includes("allocation") ||
    msg.includes("array buffer") || // "Array buffer allocation failed"
    msg.includes("buffer of size") || // "failed to allocate a buffer of size"
    msg.includes("out of memory") ||
    msg.includes("rangeerror") || // RangeError often indicates memory issues
    msg.includes("can't create a session") // ONNX session creation failure
  );
}

/**
 * Process semantic segmentation masks from SegFormer with upscaling.
 * The model outputs masks at a fixed resolution (typically 512x512).
 * This function upscales the mask to the target dimensions for better accuracy.
 */
function processSemanticMasksWithUpscale(
  wallSegments: any[],
  maskWidth: number,
  maskHeight: number,
  targetWidth: number,
  targetHeight: number,
  onProgress?: (progress: number, status: string) => void,
): WallSegmentationResult {
  console.log(
    `[Segmentation Semantic] Processing ${wallSegments.length} wall segments with upscaling...`,
  );
  console.log(
    `[Segmentation Semantic] Mask: ${maskWidth}x${maskHeight} -> Target: ${targetWidth}x${targetHeight}`,
  );

  // Step 1: Create merged wall mask at model resolution
  const smallMask = new Uint8Array(maskWidth * maskHeight);

  for (const segment of wallSegments) {
    const mask = segment.mask as RawImage;
    if (!mask || !mask.data) continue;

    const maskData = mask.data as Uint8Array;
    const channels = mask.channels || 1;

    console.log(
      `[Segmentation Semantic] Processing segment "${segment.label}" (${channels} channels, ${mask.width}x${mask.height})`,
    );

    for (let y = 0; y < maskHeight; y++) {
      for (let x = 0; x < maskWidth; x++) {
        const pixelIdx = y * maskWidth + x;

        // Read mask value - handle different channel counts
        let maskValue: number;
        if (channels === 1) {
          maskValue = maskData[pixelIdx];
        } else if (channels === 4) {
          maskValue = maskData[pixelIdx * channels + 3];
        } else {
          maskValue = maskData[pixelIdx * channels];
        }

        // Using threshold 180 for stricter wall detection
        if (maskValue > 180 && smallMask[pixelIdx] === 0) {
          smallMask[pixelIdx] = 255;
        }
      }
    }
  }

  // Step 2: Create canvas with small mask and upscale using bilinear interpolation
  const smallCanvas = document.createElement("canvas");
  smallCanvas.width = maskWidth;
  smallCanvas.height = maskHeight;
  const smallCtx = smallCanvas.getContext("2d")!;
  const smallImageData = smallCtx.createImageData(maskWidth, maskHeight);

  // Convert Uint8Array mask to ImageData (grayscale -> RGBA)
  for (let i = 0; i < smallMask.length; i++) {
    const val = smallMask[i];
    smallImageData.data[i * 4] = val;
    smallImageData.data[i * 4 + 1] = val;
    smallImageData.data[i * 4 + 2] = val;
    smallImageData.data[i * 4 + 3] = 255;
  }
  smallCtx.putImageData(smallImageData, 0, 0);

  // Step 3: Upscale to target dimensions using canvas drawImage (bilinear interpolation)
  const largeCanvas = document.createElement("canvas");
  largeCanvas.width = targetWidth;
  largeCanvas.height = targetHeight;
  const largeCtx = largeCanvas.getContext("2d")!;

  // Use imageSmoothingEnabled for better upscaling quality
  largeCtx.imageSmoothingEnabled = true;
  largeCtx.imageSmoothingQuality = "high";
  largeCtx.drawImage(smallCanvas, 0, 0, targetWidth, targetHeight);

  // Step 4: Extract upscaled mask data
  const largeImageData = largeCtx.getImageData(0, 0, targetWidth, targetHeight);
  const wallMask = new Uint8Array(targetWidth * targetHeight);

  let minX = targetWidth,
    minY = targetHeight,
    maxX = 0,
    maxY = 0;
  let sumX = 0,
    sumY = 0,
    wallPixelCount = 0;

  // Convert back to binary mask (threshold at 128 after upscaling)
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const pixelIdx = y * targetWidth + x;
      const val = largeImageData.data[pixelIdx * 4]; // Red channel (grayscale)

      // Use threshold after upscaling to clean up edges
      if (val > 128) {
        wallMask[pixelIdx] = 255;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        sumX += x;
        sumY += y;
        wallPixelCount++;
      }
    }
  }

  console.log(
    `[Segmentation Semantic] Wall pixels after upscaling: ${wallPixelCount} / ${targetWidth * targetHeight}`,
  );

  // Create wall planes
  const wallPlanes: WallPlane[] = [];
  if (wallPixelCount > 0) {
    const centerX = sumX / wallPixelCount / targetWidth;
    const centerY = sumY / wallPixelCount / targetHeight;
    wallPlanes.push({
      label: "wall",
      centerX,
      centerY,
      normalX: (0.5 - centerX) * 2,
      normalY: (0.5 - centerY) * 0.3,
      area: wallPixelCount / (targetWidth * targetHeight),
      boundingBox: {
        xmin: minX / targetWidth,
        ymin: minY / targetHeight,
        xmax: maxX / targetWidth,
        ymax: maxY / targetHeight,
      },
    });
  }

  // Create visualization canvases at target resolution
  onProgress?.(80, "Creating visualizations...");

  // Visualization (red tint)
  const vizCanvas = document.createElement("canvas");
  vizCanvas.width = targetWidth;
  vizCanvas.height = targetHeight;
  const vizCtx = vizCanvas.getContext("2d")!;
  const vizImageData = vizCtx.createImageData(targetWidth, targetHeight);

  for (let i = 0; i < wallMask.length; i++) {
    const val = wallMask[i];
    vizImageData.data[i * 4] = val;
    vizImageData.data[i * 4 + 1] = val > 0 ? 128 : 0;
    vizImageData.data[i * 4 + 2] = 0;
    vizImageData.data[i * 4 + 3] = val > 0 ? 180 : 0;
  }
  vizCtx.putImageData(vizImageData, 0, 0);

  // CSS mask
  const cssMaskCanvas = document.createElement("canvas");
  cssMaskCanvas.width = targetWidth;
  cssMaskCanvas.height = targetHeight;
  const cssMaskCtx = cssMaskCanvas.getContext("2d")!;
  const cssMaskImageData = cssMaskCtx.createImageData(
    targetWidth,
    targetHeight,
  );

  for (let i = 0; i < wallMask.length; i++) {
    const isWall = wallMask[i] > 0;
    cssMaskImageData.data[i * 4] = 255;
    cssMaskImageData.data[i * 4 + 1] = 255;
    cssMaskImageData.data[i * 4 + 2] = 255;
    cssMaskImageData.data[i * 4 + 3] = isWall ? 255 : 0;
  }
  cssMaskCtx.putImageData(cssMaskImageData, 0, 0);

  // Foreground mask (inverted)
  const fgMaskCanvas = document.createElement("canvas");
  fgMaskCanvas.width = targetWidth;
  fgMaskCanvas.height = targetHeight;
  const fgMaskCtx = fgMaskCanvas.getContext("2d")!;
  const fgMaskImageData = fgMaskCtx.createImageData(targetWidth, targetHeight);

  for (let i = 0; i < wallMask.length; i++) {
    const isWall = wallMask[i] > 0;
    fgMaskImageData.data[i * 4] = 255;
    fgMaskImageData.data[i * 4 + 1] = 255;
    fgMaskImageData.data[i * 4 + 2] = 255;
    fgMaskImageData.data[i * 4 + 3] = isWall ? 0 : 255;
  }
  fgMaskCtx.putImageData(fgMaskImageData, 0, 0);

  // Detect rectangles
  const detectedRectangles = detectRectanglesInMask(
    wallMask,
    targetWidth,
    targetHeight,
  );

  onProgress?.(100, "Wall detection complete!");
  console.log(
    `[Segmentation Semantic] Complete! Wall area: ${((wallPixelCount / (targetWidth * targetHeight)) * 100).toFixed(1)}%, Rectangles: ${detectedRectangles.length}`,
  );

  return {
    wallMask,
    wallBoundingBox:
      wallPixelCount > 0
        ? {
          xmin: minX / targetWidth,
          ymin: minY / targetHeight,
          xmax: maxX / targetWidth,
          ymax: maxY / targetHeight,
        }
        : null,
    wallArea: wallPixelCount / (targetWidth * targetHeight),
    width: targetWidth,
    height: targetHeight,
    wallMaskUrl: vizCanvas.toDataURL("image/png"),
    cssMaskUrl: cssMaskCanvas.toDataURL("image/png"),
    foregroundMaskUrl: fgMaskCanvas.toDataURL("image/png"),
    wallPlanes,
    detectedRectangles,
  };
}

/**
 * Process semantic segmentation masks from SegFormer.
 * Merges multiple wall-related segment masks into a single wall mask.
 */
function processSemanticMasks(
  wallSegments: any[],
  width: number,
  height: number,
  onProgress?: (progress: number, status: string) => void,
): WallSegmentationResult {
  console.log(
    `[Segmentation Semantic] Processing ${wallSegments.length} wall segments...`,
  );

  // Create merged wall mask
  const wallMask = new Uint8Array(width * height);
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  let sumX = 0,
    sumY = 0,
    wallPixelCount = 0;

  // Merge all wall segment masks
  for (const segment of wallSegments) {
    const mask = segment.mask as RawImage;
    if (!mask || !mask.data) continue;

    const maskData = mask.data as Uint8Array;
    const channels = mask.channels || 1;

    console.log(
      `[Segmentation Semantic] Processing segment "${segment.label}" (${channels} channels)`,
    );

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIdx = y * width + x;

        // Read mask value - handle different channel counts
        let maskValue: number;
        if (channels === 1) {
          maskValue = maskData[pixelIdx];
        } else if (channels === 4) {
          // Use alpha channel for RGBA
          maskValue = maskData[pixelIdx * channels + 3];
        } else {
          // Use first channel
          maskValue = maskData[pixelIdx * channels];
        }

        // If this pixel is part of the segment (high confidence wall pixel)
        // Using higher threshold (180) for stricter wall detection
        if (maskValue > 180 && wallMask[pixelIdx] === 0) {
          wallMask[pixelIdx] = 255;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          sumX += x;
          sumY += y;
          wallPixelCount++;
        }
      }
    }
  }

  console.log(
    `[Segmentation Semantic] Wall pixels: ${wallPixelCount} / ${width * height}`,
  );

  // Create wall planes
  const wallPlanes: WallPlane[] = [];
  if (wallPixelCount > 0) {
    const centerX = sumX / wallPixelCount / width;
    const centerY = sumY / wallPixelCount / height;
    wallPlanes.push({
      label: "wall",
      centerX,
      centerY,
      normalX: (0.5 - centerX) * 2,
      normalY: (0.5 - centerY) * 0.3,
      area: wallPixelCount / (width * height),
      boundingBox: {
        xmin: minX / width,
        ymin: minY / height,
        xmax: maxX / width,
        ymax: maxY / height,
      },
    });
  }

  // Create visualization (red tint)
  onProgress?.(80, "Creating visualizations...");
  const vizCanvas = document.createElement("canvas");
  vizCanvas.width = width;
  vizCanvas.height = height;
  const vizCtx = vizCanvas.getContext("2d")!;
  const vizImageData = vizCtx.createImageData(width, height);

  for (let i = 0; i < wallMask.length; i++) {
    const val = wallMask[i];
    vizImageData.data[i * 4] = val;
    vizImageData.data[i * 4 + 1] = val > 0 ? 128 : 0;
    vizImageData.data[i * 4 + 2] = 0;
    vizImageData.data[i * 4 + 3] = val > 0 ? 180 : 0;
  }
  vizCtx.putImageData(vizImageData, 0, 0);

  // Create CSS mask (alpha channel)
  const cssMaskCanvas = document.createElement("canvas");
  cssMaskCanvas.width = width;
  cssMaskCanvas.height = height;
  const cssMaskCtx = cssMaskCanvas.getContext("2d")!;
  const cssMaskImageData = cssMaskCtx.createImageData(width, height);

  for (let i = 0; i < wallMask.length; i++) {
    const isWall = wallMask[i] > 0;
    cssMaskImageData.data[i * 4] = 255;
    cssMaskImageData.data[i * 4 + 1] = 255;
    cssMaskImageData.data[i * 4 + 2] = 255;
    cssMaskImageData.data[i * 4 + 3] = isWall ? 255 : 0;
  }
  cssMaskCtx.putImageData(cssMaskImageData, 0, 0);

  // Create foreground mask (inverted - non-wall areas)
  const fgMaskCanvas = document.createElement("canvas");
  fgMaskCanvas.width = width;
  fgMaskCanvas.height = height;
  const fgMaskCtx = fgMaskCanvas.getContext("2d")!;
  const fgMaskImageData = fgMaskCtx.createImageData(width, height);

  for (let i = 0; i < wallMask.length; i++) {
    const isWall = wallMask[i] > 0;
    fgMaskImageData.data[i * 4] = 255;
    fgMaskImageData.data[i * 4 + 1] = 255;
    fgMaskImageData.data[i * 4 + 2] = 255;
    fgMaskImageData.data[i * 4 + 3] = isWall ? 0 : 255; // Inverted: foreground (non-wall) is visible
  }
  fgMaskCtx.putImageData(fgMaskImageData, 0, 0);

  // Detect rectangles
  const detectedRectangles = detectRectanglesInMask(wallMask, width, height);

  onProgress?.(100, "Wall detection complete!");
  console.log(
    `[Segmentation Semantic] Complete! Wall area: ${((wallPixelCount / (width * height)) * 100).toFixed(1)}%, Rectangles: ${detectedRectangles.length}`,
  );

  return {
    wallMask,
    wallBoundingBox:
      wallPixelCount > 0
        ? {
          xmin: minX / width,
          ymin: minY / height,
          xmax: maxX / width,
          ymax: maxY / height,
        }
        : null,
    wallArea: wallPixelCount / (width * height),
    width,
    height,
    wallMaskUrl: vizCanvas.toDataURL("image/png"),
    cssMaskUrl: cssMaskCanvas.toDataURL("image/png"),
    foregroundMaskUrl: fgMaskCanvas.toDataURL("image/png"),
    wallPlanes,
    detectedRectangles,
  };
}

/**
 * Process RMBG mask output (single channel, first channel for multi-channel)
 */
function processRMBGMask(
  maskData: Uint8Array,
  width: number,
  height: number,
  channels: number,
  onProgress?: (progress: number, status: string) => void,
): WallSegmentationResult {
  console.log("[Segmentation] Processing RMBG mask...");
  onProgress?.(70, "Creating wall mask...");

  const wallMask = new Uint8Array(width * height);
  const wallPlanes: WallPlane[] = [];

  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  let sumX = 0,
    sumY = 0,
    wallPixelCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      // RMBG: read first channel
      const dataIdx = pixelIdx * channels;
      const foregroundValue = maskData[dataIdx];

      // Invert: low foreground value = wall (background)
      const isWall = foregroundValue < 128;

      if (isWall) {
        wallMask[pixelIdx] = 255;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        sumX += x;
        sumY += y;
        wallPixelCount++;
      }
    }
  }

  return finalizeMaskResult(
    wallMask,
    width,
    height,
    minX,
    minY,
    maxX,
    maxY,
    sumX,
    sumY,
    wallPixelCount,
    maskData,
    channels,
    false,
    onProgress,
  );
}

/**
 * Process MODNet output (RGBA, use alpha channel as mask)
 */
function processMODNetOutput(
  imageData: Uint8Array,
  width: number,
  height: number,
  channels: number,
  onProgress?: (progress: number, status: string) => void,
): WallSegmentationResult {
  console.log("[Segmentation] Processing MODNet output...");
  onProgress?.(70, "Creating wall mask...");

  const wallMask = new Uint8Array(width * height);
  const wallPlanes: WallPlane[] = [];

  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  let sumX = 0,
    sumY = 0,
    wallPixelCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      // MODNet: read alpha channel (index 3 for RGBA)
      const alphaIdx = pixelIdx * channels + (channels === 4 ? 3 : 0);
      const foregroundValue = imageData[alphaIdx];

      // Invert: low alpha value = wall (background)
      const isWall = foregroundValue < 128;

      if (isWall) {
        wallMask[pixelIdx] = 255;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        sumX += x;
        sumY += y;
        wallPixelCount++;
      }
    }
  }

  return finalizeMaskResult(
    wallMask,
    width,
    height,
    minX,
    minY,
    maxX,
    maxY,
    sumX,
    sumY,
    wallPixelCount,
    imageData,
    channels,
    true,
    onProgress,
  );
}

/**
 * Finalize the mask result with all the computed data
 * Now includes areas where the model is less confident in the foreground mask
 */
function finalizeMaskResult(
  wallMask: Uint8Array,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  sumX: number,
  sumY: number,
  wallPixelCount: number,
  originalData: Uint8Array,
  channels: number,
  isMobileOutput: boolean,
  onProgress?: (progress: number, status: string) => void,
): WallSegmentationResult {
  const wallPlanes: WallPlane[] = [];

  console.log(
    `[Segmentation] Wall pixels found: ${wallPixelCount} / ${width * height}`,
  );

  // Create a single wall plane for the detected background area
  if (wallPixelCount > 0) {
    const centerX = sumX / wallPixelCount / width;
    const centerY = sumY / wallPixelCount / height;
    wallPlanes.push({
      label: "background",
      centerX,
      centerY,
      normalX: (0.5 - centerX) * 2,
      normalY: (0.5 - centerY) * 0.3,
      area: wallPixelCount / (width * height),
      boundingBox: {
        xmin: minX / width,
        ymin: minY / height,
        xmax: maxX / width,
        ymax: maxY / height,
      },
    });
    console.log(
      `[Segmentation] Wall plane detected: center=(${centerX.toFixed(
        2,
      )}, ${centerY.toFixed(2)}), area=${(
        (wallPixelCount / (width * height)) *
        100
      ).toFixed(1)}%`,
    );
  }

  // Step 5: Calculate overall bounding box
  const wallArea = wallPixelCount / (width * height);
  console.log(
    `[Segmentation] Total wall area: ${(wallArea * 100).toFixed(1)}%`,
  );

  // Step 6: Create visualization of the wall mask (red tint for debugging)
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < wallMask.length; i++) {
    const val = wallMask[i];
    imageData.data[i * 4] = val;
    imageData.data[i * 4 + 1] = val > 0 ? 128 : 0;
    imageData.data[i * 4 + 2] = 0;
    imageData.data[i * 4 + 3] = val > 0 ? 180 : 0;
  }
  ctx.putImageData(imageData, 0, 0);

  // Step 7: Create CSS-compatible mask using ALPHA channel for cross-browser compatibility
  // Wall: alpha = 255 (visible), Non-wall: alpha = 0 (hidden)
  const cssMaskCanvas = document.createElement("canvas");
  cssMaskCanvas.width = width;
  cssMaskCanvas.height = height;
  const cssMaskCtx = cssMaskCanvas.getContext("2d")!;
  const cssMaskImageData = cssMaskCtx.createImageData(width, height);
  for (let i = 0; i < wallMask.length; i++) {
    const isWall = wallMask[i] > 0;
    cssMaskImageData.data[i * 4] = 255; // R (white for debugging)
    cssMaskImageData.data[i * 4 + 1] = 255; // G
    cssMaskImageData.data[i * 4 + 2] = 255; // B
    cssMaskImageData.data[i * 4 + 3] = isWall ? 255 : 0; // A: wall=opaque, non-wall=transparent
  }
  cssMaskCtx.putImageData(cssMaskImageData, 0, 0);

  // Step 8: Create inverted foreground mask using ALPHA channel for cross-browser compatibility
  // This mask includes areas where the model is LESS confident - using soft thresholds
  // - High confidence foreground (>180): fully visible (alpha=255)
  // - Medium confidence (80-180): partially visible based on confidence (includes uncertain edges)
  // - High confidence background (<80): hidden (alpha=0)
  const fgMaskCanvas = document.createElement("canvas");
  fgMaskCanvas.width = width;
  fgMaskCanvas.height = height;
  const fgMaskCtx = fgMaskCanvas.getContext("2d")!;
  const fgMaskImageData = fgMaskCtx.createImageData(width, height);

  // BINARY threshold for foreground mask - no gradients, only opaque or transparent
  const FOREGROUND_THRESHOLD = 96; // Anything >96 is treated as opaque foreground

  // Debug counters
  let transparentCount = 0,
    opaqueCount = 0;
  let minVal = 255,
    maxVal = 0;

  for (let i = 0; i < wallMask.length; i++) {
    const pixelIdx = i;
    // Get the original foreground confidence value from the model output
    const dataIdx = isMobileOutput
      ? pixelIdx * channels + (channels === 4 ? 3 : 0)
      : pixelIdx * channels;
    const foregroundValue = originalData[dataIdx];

    // Track value range for debugging
    minVal = Math.min(minVal, foregroundValue);
    maxVal = Math.max(maxVal, foregroundValue);

    // Simple binary threshold - no gradients
    const alpha = foregroundValue > FOREGROUND_THRESHOLD ? 255 : 0;

    if (alpha === 0) {
      transparentCount++;
    } else {
      opaqueCount++;
    }

    fgMaskImageData.data[i * 4] = 255; // R
    fgMaskImageData.data[i * 4 + 1] = 255; // G
    fgMaskImageData.data[i * 4 + 2] = 255; // B
    fgMaskImageData.data[i * 4 + 3] = alpha; // A: binary (0 or 255)
  }

  console.log(
    `[Segmentation] Foreground mask stats: transparent=${transparentCount}, opaque=${opaqueCount}, valueRange=[${minVal}, ${maxVal}]`,
  );
  fgMaskCtx.putImageData(fgMaskImageData, 0, 0);

  // Step 9: Detect rectangular regions for panel placement
  const detectedRectangles = detectRectanglesInMask(wallMask, width, height);

  onProgress?.(100, "Wall detection complete!");
  console.log(
    "[Segmentation] Complete! Wall planes:",
    wallPlanes.length,
    "Rectangles:",
    detectedRectangles.length,
  );

  return {
    wallMask,
    wallBoundingBox:
      wallPixelCount > 0
        ? {
          xmin: minX / width,
          ymin: minY / height,
          xmax: maxX / width,
          ymax: maxY / height,
        }
        : null,
    wallArea,
    width,
    height,
    wallMaskUrl: canvas.toDataURL("image/png"),
    cssMaskUrl: cssMaskCanvas.toDataURL("image/png"),
    foregroundMaskUrl: fgMaskCanvas.toDataURL("image/png"),
    wallPlanes,
    detectedRectangles,
  };
}

export function isPointOnWall(
  wallMask: Uint8Array,
  width: number,
  height: number,
  normalizedX: number,
  normalizedY: number,
): boolean {
  if (wallMask.length === 0) return false;
  const x = Math.floor(normalizedX * width);
  const y = Math.floor(normalizedY * height);
  const index = y * width + x;
  return index >= 0 && index < wallMask.length && wallMask[index] > 0;
}

export function calculateWallPerspective(
  wallPlanes: WallPlane[],
  depthData: Float32Array,
  depthWidth: number,
  depthHeight: number,
  normalizedX: number,
  normalizedY: number,
): { rotateX: number; rotateY: number; scale: number } {
  // Sample depth at point
  const dx = Math.floor(normalizedX * depthWidth);
  const dy = Math.floor(normalizedY * depthHeight);
  const depthIdx = dy * depthWidth + dx;
  const depthAtPoint =
    depthIdx >= 0 && depthIdx < depthData.length ? depthData[depthIdx] : 0.5;

  if (wallPlanes.length === 0) {
    // Simple depth-based perspective
    const rotateY = (normalizedX - 0.5) * 20;
    const rotateX = (normalizedY - 0.5) * 10;
    return { rotateX, rotateY, scale: 1.2 - depthAtPoint * 0.4 };
  }

  // Find closest wall plane
  let closest = wallPlanes[0];
  let minDist = Infinity;
  for (const plane of wallPlanes) {
    const dist = Math.sqrt(
      (normalizedX - plane.centerX) ** 2 + (normalizedY - plane.centerY) ** 2,
    );
    if (dist < minDist) {
      minDist = dist;
      closest = plane;
    }
  }

  const rotateY = -closest.normalX * 20;
  const rotateX = closest.normalY * 10;
  const scale = 1.2 - depthAtPoint * 0.4;

  return { rotateX, rotateY, scale: Math.max(0.6, Math.min(1.4, scale)) };
}

/**
 * Find the best rectangle to fit a panel with a given aspect ratio.
 * Returns the rectangle that best matches the panel's aspect ratio while being large enough.
 */
export function findBestRectangleForPanel(
  rectangles: DetectedRectangle[],
  panelAspectRatio: number,
  minArea: number = 0.05, // Minimum 5% of image
): DetectedRectangle | null {
  if (rectangles.length === 0) return null;

  // Filter by minimum area
  const candidates = rectangles.filter((r) => r.area >= minArea);
  if (candidates.length === 0) {
    // Fallback to largest rectangle if none meet minimum
    return rectangles[0];
  }

  // Score rectangles by aspect ratio match (lower is better)
  const scored = candidates.map((r) => ({
    rect: r,
    score: Math.abs(r.aspectRatio - panelAspectRatio) / panelAspectRatio,
  }));

  // Sort by score (best match first)
  scored.sort((a, b) => a.score - b.score);

  return scored[0].rect;
}

/**
 * Get panel position and size to fit exactly within a detected rectangle.
 * Returns position (top-left) and dimensions in normalized coordinates.
 *
 * @param stretchToFill - If true, stretches panel to fill full height of rectangle (ignores aspect ratio)
 */
export function fitPanelToRectangle(
  rectangle: DetectedRectangle,
  panelAspectRatio: number,
  containerWidth: number,
  containerHeight: number,
  padding: number = 0.02, // 2% padding inside the rectangle
  stretchToFill: boolean = true, // Stretch to fill full height by default
): { x: number; y: number; width: number; height: number } {
  // Apply padding only horizontally, no vertical padding for full stretch
  const horizontalPadding = padding;
  const verticalPadding = stretchToFill ? 0 : padding;

  const paddedWidth = rectangle.width * (1 - horizontalPadding * 2);
  const paddedHeight = rectangle.height * (1 - verticalPadding * 2);
  const paddedX =
    rectangle.boundingBox.xmin + rectangle.width * horizontalPadding;
  const paddedY =
    rectangle.boundingBox.ymin + rectangle.height * verticalPadding;

  let panelWidth: number, panelHeight: number;
  let offsetX: number, offsetY: number;

  if (stretchToFill) {
    // Stretch to fill full height, calculate width based on aspect ratio
    panelHeight = paddedHeight;
    panelWidth = paddedHeight * panelAspectRatio;

    // If panel would be wider than rectangle, constrain to rectangle width
    if (panelWidth > paddedWidth) {
      panelWidth = paddedWidth;
    }

    // Center horizontally, align to top/bottom edges
    offsetX = (paddedWidth - panelWidth) / 2;
    offsetY = 0;
  } else {
    // Original behavior: fit within rectangle maintaining aspect ratio
    const rectAspect = paddedWidth / paddedHeight;

    if (panelAspectRatio > rectAspect) {
      // Panel is wider than rectangle - fit to width
      panelWidth = paddedWidth;
      panelHeight = paddedWidth / panelAspectRatio;
    } else {
      // Panel is taller than rectangle - fit to height
      panelHeight = paddedHeight;
      panelWidth = paddedHeight * panelAspectRatio;
    }

    // Center panel within rectangle
    offsetX = (paddedWidth - panelWidth) / 2;
    offsetY = (paddedHeight - panelHeight) / 2;
  }

  return {
    x: (paddedX + offsetX) * containerWidth,
    y: (paddedY + offsetY) * containerHeight,
    width: panelWidth * containerWidth,
    height: panelHeight * containerHeight,
  };
}

/**
 * Calculate wall orientation (rotation) from the wall mask shape.
 * Analyzes edge profiles to determine perspective/tilt based on mask geometry.
 *
 * This uses the wall mask shape rather than depth data to determine rotation:
 * - rotateY (horizontal tilt): Based on left/right edge slope convergence
 * - rotateX (vertical tilt): Based on top/bottom edge width difference
 *
 * @param wallMask - Binary mask where 255 = wall, 0 = not wall
 * @param width - Width of the mask in pixels
 * @param height - Height of the mask in pixels
 * @param normalizedX - X position (0-1) where the panel center is
 * @param normalizedY - Y position (0-1) where the panel center is
 * @returns Rotation angles for panel placement
 */
export function calculateWallOrientationFromMask(
  wallMask: Uint8Array,
  width: number,
  height: number,
  normalizedX: number,
  normalizedY: number,
): { rotateX: number; rotateY: number } {
  if (wallMask.length === 0 || width === 0 || height === 0) {
    return { rotateX: 0, rotateY: 0 };
  }

  // Find the wall region around the panel position
  const centerX = Math.floor(normalizedX * width);
  const centerY = Math.floor(normalizedY * height);

  // Define sampling region (25% of image around center point)
  const regionRadius = Math.min(width, height) * 0.25;
  const sampleLeft = Math.max(0, Math.floor(centerX - regionRadius));
  const sampleRight = Math.min(width - 1, Math.floor(centerX + regionRadius));
  const sampleTop = Math.max(0, Math.floor(centerY - regionRadius));
  const sampleBottom = Math.min(height - 1, Math.floor(centerY + regionRadius));

  // Sample multiple horizontal scanlines to find left and right edges
  const numScanlines = 10;
  const leftEdges: number[] = [];
  const rightEdges: number[] = [];
  const scanlineYs: number[] = [];

  for (let i = 0; i < numScanlines; i++) {
    const y = sampleTop + Math.floor((i / (numScanlines - 1)) * (sampleBottom - sampleTop));
    scanlineYs.push(y);

    // Find left edge (first wall pixel from left)
    let leftEdge = -1;
    for (let x = sampleLeft; x <= sampleRight; x++) {
      const idx = y * width + x;
      if (wallMask[idx] > 0) {
        leftEdge = x;
        break;
      }
    }

    // Find right edge (first wall pixel from right)
    let rightEdge = -1;
    for (let x = sampleRight; x >= sampleLeft; x--) {
      const idx = y * width + x;
      if (wallMask[idx] > 0) {
        rightEdge = x;
        break;
      }
    }

    if (leftEdge >= 0) leftEdges.push(leftEdge);
    if (rightEdge >= 0) rightEdges.push(rightEdge);
  }

  // Sample multiple vertical scanlines to find top and bottom edges
  const topEdges: number[] = [];
  const bottomEdges: number[] = [];

  for (let i = 0; i < numScanlines; i++) {
    const x = sampleLeft + Math.floor((i / (numScanlines - 1)) * (sampleRight - sampleLeft));

    // Find top edge (first wall pixel from top)
    let topEdge = -1;
    for (let y = sampleTop; y <= sampleBottom; y++) {
      const idx = y * width + x;
      if (wallMask[idx] > 0) {
        topEdge = y;
        break;
      }
    }

    // Find bottom edge (first wall pixel from bottom)
    let bottomEdge = -1;
    for (let y = sampleBottom; y >= sampleTop; y--) {
      const idx = y * width + x;
      if (wallMask[idx] > 0) {
        bottomEdge = y;
        break;
      }
    }

    if (topEdge >= 0) topEdges.push(topEdge);
    if (bottomEdge >= 0) bottomEdges.push(bottomEdge);
  }

  // Calculate rotateY from left/right edge convergence
  // If left edges move right as we go down and right edges move left -> wall faces camera
  // If left edges move left as we go down and right edges move right -> wall tilts away
  let rotateY = 0;
  if (leftEdges.length >= 2 && rightEdges.length >= 2) {
    // Calculate slope of left edge (positive = edges converge going down = perspective)
    const leftSlope = (leftEdges[leftEdges.length - 1] - leftEdges[0]) / leftEdges.length;
    // Calculate slope of right edge (negative = edges converge going down = perspective)
    const rightSlope = (rightEdges[rightEdges.length - 1] - rightEdges[0]) / rightEdges.length;

    // Difference in slopes indicates which direction wall is angled
    // If left edge slants more to the right than right edge slants to the left -> wall faces right
    const slopeDiff = leftSlope - rightSlope;

    // Normalize by region width and convert to rotation angle
    // Positive slopeDiff -> wall faces left (negative rotateY)
    // Negative slopeDiff -> wall faces right (positive rotateY)
    rotateY = -(slopeDiff / (regionRadius * 2)) * 60;
  }

  // Calculate rotateX from top/bottom edge width difference
  // If top is narrower than bottom -> typical perspective (wall tilts back)
  let rotateX = 0;
  if (topEdges.length >= 2 && bottomEdges.length >= 2) {
    // Average top and bottom widths at different scanlines
    const topWidth = Math.max(...topEdges) - Math.min(...topEdges);
    const bottomWidth = Math.max(...bottomEdges) - Math.min(...bottomEdges);

    // Also consider vertical edge slopes
    const topSlope = (topEdges[topEdges.length - 1] - topEdges[0]) / topEdges.length;
    const bottomSlope = (bottomEdges[bottomEdges.length - 1] - bottomEdges[0]) / bottomEdges.length;

    // If both slope downward: wall tilts back; if upward: wall tilts forward
    const avgSlope = (topSlope + bottomSlope) / 2;

    // Normalize and convert to rotation angle
    rotateX = (avgSlope / regionRadius) * 40;
  }

  // Clamp to reasonable rotation limits
  rotateX = Math.max(-30, Math.min(30, Math.round(rotateX * 10) / 10));
  rotateY = Math.max(-40, Math.min(40, Math.round(rotateY * 10) / 10));

  console.log(`[Segmentation] Mask-based orientation: rotateX=${rotateX}, rotateY=${rotateY}`);

  return { rotateX, rotateY };
}

/**
 * Point type for perspective calculations
 */
interface Point2D {
  x: number;
  y: number;
}

/**
 * Calculate a CSS matrix3d transformation that warps a rectangle to an arbitrary quadrilateral.
 * This allows the panel to conform to the wall's perspective shape.
 *
 * Uses homography (perspective transformation) mathematics to compute the transformation matrix.
 *
 * @param srcWidth - Width of the source rectangle (panel)
 * @param srcHeight - Height of the source rectangle (panel)
 * @param dstCorners - 4 corners of destination quadrilateral [topLeft, topRight, bottomRight, bottomLeft]
 *                     in pixel coordinates relative to container
 * @returns CSS matrix3d string for the transform property
 */
export function calculatePerspectiveTransformMatrix(
  srcWidth: number,
  srcHeight: number,
  dstCorners: Point2D[],
): string {
  if (dstCorners.length !== 4) {
    console.warn('[Segmentation] calculatePerspectiveTransformMatrix requires exactly 4 corners');
    return 'none';
  }

  // Source corners: rectangle at origin
  const srcCorners: Point2D[] = [
    { x: 0, y: 0 },             // top-left
    { x: srcWidth, y: 0 },      // top-right
    { x: srcWidth, y: srcHeight }, // bottom-right
    { x: 0, y: srcHeight },     // bottom-left
  ];

  // Compute the 3x3 homography matrix that maps srcCorners to dstCorners
  const H = computeHomography(srcCorners, dstCorners);

  if (!H) {
    console.warn('[Segmentation] Failed to compute homography matrix');
    return 'none';
  }

  // Convert 3x3 homography to CSS matrix3d (4x4 matrix flattened)
  // CSS matrix3d format: matrix3d(a, b, 0, p, c, d, 0, q, 0, 0, 1, 0, tx, ty, 0, 1)
  // But for proper perspective, we need the full transformation
  const matrix3d = homographyToMatrix3d(H, srcWidth, srcHeight);

  console.log('[Segmentation] Perspective matrix computed');
  return matrix3d;
}

/**
 * Compute the 3x3 homography matrix that maps 4 source points to 4 destination points.
 * Uses the Direct Linear Transform (DLT) algorithm.
 *
 * @returns 3x3 matrix as a flat array [a, b, c, d, e, f, g, h, 1] (row-major)
 */
function computeHomography(src: Point2D[], dst: Point2D[]): number[] | null {
  // Build the 8x8 matrix for solving the homography
  // For each point correspondence, we have 2 equations:
  // -src.x, -src.y, -1, 0, 0, 0, dst.x*src.x, dst.x*src.y, dst.x
  // 0, 0, 0, -src.x, -src.y, -1, dst.y*src.x, dst.y*src.y, dst.y

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  // Solve using Gaussian elimination with partial pivoting
  const solution = solveLinearSystem(A, b);

  if (!solution) {
    return null;
  }

  // The homography matrix H is:
  // [ h0, h1, h2 ]
  // [ h3, h4, h5 ]
  // [ h6, h7, 1  ]
  return [...solution, 1];
}

/**
 * Solve a linear system Ax = b using Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;

  // Create augmented matrix
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);

    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }

    if (maxVal < 1e-10) {
      return null; // Singular matrix
    }

    // Swap rows
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x: number[] = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i];
  }

  return x;
}

/**
 * Convert a 3x3 homography matrix to a CSS matrix3d string.
 * The matrix3d maps the source rectangle to the destination quadrilateral.
 */
function homographyToMatrix3d(H: number[], srcWidth: number, srcHeight: number): string {
  // H is [h0, h1, h2, h3, h4, h5, h6, h7, 1] in row-major order
  // Representing:
  // [ h0, h1, h2 ]
  // [ h3, h4, h5 ]
  // [ h6, h7, 1  ]

  // For CSS matrix3d, we need a 4x4 matrix in column-major order:
  // matrix3d(m11, m21, m31, m41, m12, m22, m32, m42, m13, m23, m33, m43, m14, m24, m34, m44)
  //
  // The 3x3 homography embeds into 4x4 as:
  // [ h0, h1, 0, h2 ]
  // [ h3, h4, 0, h5 ]
  // [ 0,  0,  1, 0  ]
  // [ h6, h7, 0, 1  ]

  const [h0, h1, h2, h3, h4, h5, h6, h7] = H;

  // CSS matrix3d uses column-major order
  const matrix = [
    h0, h3, 0, h6,  // column 1
    h1, h4, 0, h7,  // column 2
    0, 0, 1, 0,     // column 3
    h2, h5, 0, 1    // column 4
  ];

  return `matrix3d(${matrix.join(', ')})`;
}

/**
 * Get the corner points of a detected rectangle in pixel coordinates.
 * Converts normalized corners (0-1) to pixel coordinates.
 *
 * @param rectangle - The detected rectangle from segmentation
 * @param containerWidth - Width of the container in pixels
 * @param containerHeight - Height of the container in pixels
 * @returns Array of 4 corners [TL, TR, BR, BL] in pixel coordinates
 */
export function getRectanglePixelCorners(
  rectangle: { corners?: Point2D[]; boundingBox: { xmin: number; ymin: number; xmax: number; ymax: number } },
  containerWidth: number,
  containerHeight: number,
): Point2D[] {
  // If we have actual corners, use them
  if (rectangle.corners && rectangle.corners.length === 4) {
    return rectangle.corners.map(c => ({
      x: c.x * containerWidth,
      y: c.y * containerHeight,
    }));
  }

  // Otherwise, create corners from bounding box
  const { xmin, ymin, xmax, ymax } = rectangle.boundingBox;
  return [
    { x: xmin * containerWidth, y: ymin * containerHeight },  // TL
    { x: xmax * containerWidth, y: ymin * containerHeight },  // TR
    { x: xmax * containerWidth, y: ymax * containerHeight },  // BR
    { x: xmin * containerWidth, y: ymax * containerHeight },  // BL
  ];
}
