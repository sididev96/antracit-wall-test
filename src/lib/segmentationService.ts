import { pipeline, env, RawImage } from "@huggingface/transformers";

// Configure transformers.js for browser usage
// Allow local models and enable caching
env.allowLocalModels = false;
env.useBrowserCache = true;

// Type for the segmentation pipeline - using image-segmentation for RMBG (desktop)
type SegmentationPipeline = Awaited<
  ReturnType<typeof pipeline<"image-segmentation">>
>;

// Type for the background removal pipeline - using background-removal for MODNet (mobile)
type BackgroundRemovalPipeline = Awaited<
  ReturnType<typeof pipeline<"background-removal">>
>;

// Type for semantic segmentation pipeline - using DeepLabV3 MobileViT for true wall detection
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
 * Detect if we're running on a mobile/Android device
 * These devices often have limited WASM memory and need smaller image sizes
 */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

/**
 * Detect if we're running on Android specifically
 * Android Chrome has known WASM memory limitations
 */
function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
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
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';

  // Check for very old Android versions (below Android 10)
  const androidMatch = ua.match(/Android\s+(\d+)/);
  if (androidMatch) {
    const androidVersion = parseInt(androidMatch[1], 10);
    if (androidVersion < 10) {
      console.warn("[Segmentation] Old Android version detected, skipping ML models");
      return true;
    }
  }

  // Check available memory if possible
  if ('deviceMemory' in navigator) {
    const memory = (navigator as any).deviceMemory;
    if (memory && memory < 4) {
      console.warn(`[Segmentation] Low device memory (${memory}GB), may have issues with ML models`);
    }
  }

  return false;
}

// Model configuration
// Desktop: RMBG-1.4 with image-segmentation pipeline (high quality, ~176MB)
// Mobile: MODNet with background-removal pipeline (light weight, ~6.6MB)
// Semantic: DeepLabV3 MobileViT for true wall detection (~5MB)
const SEGMENTATION_MODEL = "briaai/RMBG-1.4";
const MOBILE_MODEL = "Xenova/modnet";
const SEMANTIC_MODEL = "Xenova/deeplabv3-mobilevit-x-small";

// ADE20K class indices for wall-related categories
// The model outputs labels like "wall", "building", etc. which we match against
const WALL_LABELS = [
  "wall",
  "building",
  "fence",
  "cabinet",
  "door",
  "column",
  "windowpane",
];

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
  onProgress?: (progress: number, status: string) => void
): Promise<WallSegmentationResult> {
  console.log("[Segmentation] Using simple color-based wall detection (fallback)");
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
        console.log(`[Segmentation] Dominant color detected: RGB(${wallR}, ${wallG}, ${wallB})`);

        onProgress?.(60, "Creating wall mask...");

        // Create wall mask based on color similarity
        const wallMask = new Uint8Array(width * height);
        const colorThreshold = 60; // How similar a color needs to be to count as "wall"

        let minX = width, minY = height, maxX = 0, maxY = 0;
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
              Math.pow(b - wallB, 2)
            );

            // Also check if it's not too dark (floor) or has high saturation (furniture)
            const brightness = (r + g + b) / 3;
            const maxChannel = Math.max(r, g, b);
            const minChannel = Math.min(r, g, b);
            const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;

            // Wall detection criteria:
            // 1. Similar color to dominant wall color
            // 2. Not too dark (>40 brightness)
            // 3. Not too saturated (<0.6)
            const isWall = distance < colorThreshold && brightness > 40 && saturation < 0.6;

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
        console.log(`[Segmentation] Simple detection - Wall area: ${(wallArea * 100).toFixed(1)}%`);

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
        const detectedRectangles = detectRectanglesInMask(wallMask, width, height);

        onProgress?.(100, "Wall detection complete!");

        resolve({
          wallMask,
          wallBoundingBox: wallPixelCount > 0 ? {
            xmin: minX / width,
            ymin: minY / height,
            xmax: maxX / width,
            ymax: maxY / height,
          } : null,
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
 * Detect rectangular regions within the wall mask using contour analysis.
 * Returns rectangles sorted by area (largest first).
 */
function detectRectanglesInMask(
  wallMask: Uint8Array,
  width: number,
  height: number,
  minAreaRatio: number = 0.02 // Minimum 2% of image area
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
    if (areaRatio < minAreaRatio) continue;

    // Consider it rectangular if fill ratio is high enough (>70%)
    if (fillRatio > 0.7) {
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
    }
  }

  // Sort by area (largest first)
  rectangles.sort((a, b) => b.area - a.area);

  console.log(
    `[Segmentation] Detected ${rectangles.length} rectangular regions`
  );
  return rectangles;
}

/**
 * Resize an image to fit within max dimensions while maintaining aspect ratio
 * Returns a data URL of the resized image
 */
async function resizeImageForSegmentation(
  imageUrl: string
): Promise<{ dataUrl: string; scale: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const { width, height } = img;

      // Calculate scale factor to fit within MAX_SEGMENTATION_SIZE
      const maxDim = Math.max(width, height);
      const scale =
        maxDim > MAX_SEGMENTATION_SIZE ? MAX_SEGMENTATION_SIZE / maxDim : 1;

      const newWidth = Math.round(width * scale);
      const newHeight = Math.round(height * scale);

      console.log(
        `[Segmentation] Resizing image from ${width}x${height} to ${newWidth}x${newHeight} (scale: ${scale.toFixed(
          2
        )})`
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
  onProgress?: (progress: number, status: string) => void
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
      "Failed to load segmentation model after multiple attempts"
    );
  }

  isLoading = true;
  loadAttempts++;

  console.log(
    `[Segmentation] Loading RMBG model (attempt ${loadAttempts}/${MAX_LOAD_ATTEMPTS})...`
  );

  loadingPromise = (async () => {
    try {
      onProgress?.(0, "Loading RMBG model...");

      console.log(
        `[Segmentation] Calling pipeline() for image-segmentation with ${SEGMENTATION_MODEL}...`
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
              data.status || `Loading ${data.file || "model"}...`
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
  onProgress?: (progress: number, status: string) => void
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
      "Failed to load mobile segmentation model after multiple attempts"
    );
  }

  isMobileLoading = true;
  mobileLoadAttempts++;

  console.log(
    `[Segmentation] Loading MODNet model (attempt ${mobileLoadAttempts}/${MAX_LOAD_ATTEMPTS})...`
  );

  mobileLoadingPromise = (async () => {
    try {
      onProgress?.(0, "Loading MODNet model...");

      console.log(
        `[Segmentation] Calling pipeline() for background-removal with ${MOBILE_MODEL}...`
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
              data.status || `Loading ${data.file || "model"}...`
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
  onProgress?: (progress: number, status: string) => void
): Promise<SemanticSegmentationPipeline> {
  // Return cached pipeline if available
  if (semanticPipeline) {
    console.log("[Segmentation] Using cached DeepLabV3 pipeline");
    return semanticPipeline;
  }

  // Return in-progress loading promise if available
  if (isSemanticLoading && semanticLoadingPromise) {
    console.log("[Segmentation] Waiting for in-progress DeepLabV3 load");
    return semanticLoadingPromise;
  }

  // Check if we've exceeded max attempts
  if (semanticLoadAttempts >= MAX_LOAD_ATTEMPTS) {
    console.error("[Segmentation] Max DeepLabV3 load attempts exceeded");
    throw new Error(
      "Failed to load semantic segmentation model after multiple attempts"
    );
  }

  isSemanticLoading = true;
  semanticLoadAttempts++;

  console.log(
    `[Segmentation] Loading DeepLabV3 MobileViT model (attempt ${semanticLoadAttempts}/${MAX_LOAD_ATTEMPTS})...`
  );

  semanticLoadingPromise = (async () => {
    try {
      onProgress?.(0, "Loading DeepLabV3 wall detection model...");

      console.log(
        `[Segmentation] Calling pipeline() for image-segmentation with ${SEMANTIC_MODEL}...`
      );

      // Use image-segmentation pipeline for DeepLabV3
      const pipe = await pipeline("image-segmentation", SEMANTIC_MODEL, {
        progress_callback: (data: {
          progress?: number;
          status?: string;
          file?: string;
        }) => {
          console.log("[Segmentation] DeepLabV3 Progress:", data);
          if (data.progress !== undefined) {
            onProgress?.(
              data.progress,
              data.status || `Loading ${data.file || "model"}...`
            );
          }
        },
      });

      console.log("[Segmentation] DeepLabV3 Pipeline created successfully!");
      semanticPipeline = pipe;
      onProgress?.(100, "Wall detection model loaded!");
      return semanticPipeline;
    } catch (error) {
      console.error("[Segmentation] Failed to load DeepLabV3 model:", error);
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
  onProgress?: (progress: number, status: string) => void
): Promise<WallSegmentationResult> {
  console.log("[Segmentation] segmentWalls called");
  console.log("[Segmentation] Device info - Mobile:", isMobileDevice(), "Android:", isAndroid());
  console.log("[Segmentation] Max size:", MAX_SEGMENTATION_SIZE);

  // Check if we should skip ML models entirely (very old devices or previous memory errors)
  if (shouldSkipMLModels() || hasMemoryError) {
    console.log("[Segmentation] Skipping ML models, using simple color-based detection");
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
  // Prefer semantic segmentation (DeepLabV3) for true wall detection
  if (useSemanticSegmentation) {
    console.log("[Segmentation] Using SEMANTIC path (DeepLabV3 MobileViT)");
    try {
      return await segmentWallsSemantic(imageUrl, onProgress);
    } catch (error) {
      console.error("[Segmentation] Semantic segmentation failed, falling back:", error);
      // Fall back to device-specific pipeline
      useSemanticSegmentation = false;
    }
  }

  if (isMobileDevice()) {
    console.log("[Segmentation] Using MOBILE path (MODNet)");
    return segmentWallsMobile(imageUrl, onProgress);
  } else {
    console.log("[Segmentation] Using DESKTOP path (RMBG)");
    return segmentWallsDesktop(imageUrl, onProgress);
  }
}

/**
 * SEMANTIC segmentation using DeepLabV3 MobileViT (ADE20K labels).
 * This directly detects walls by semantic class, not by background removal.
 * Much more accurate for wall detection as it understands "wall" as a concept.
 */
async function segmentWallsSemantic(
  imageUrl: string,
  onProgress?: (progress: number, status: string) => void
): Promise<WallSegmentationResult> {
  try {
    // Step 1: Resize image for processing
    console.log("[Segmentation Semantic] Step 1: Resizing image...");
    onProgress?.(10, "Preparing image...");
    const { dataUrl: resizedImageUrl } =
      await resizeImageForSegmentation(imageUrl);

    // Step 2: Initialize the DeepLabV3 pipeline
    console.log("[Segmentation Semantic] Step 2: Getting DeepLabV3 pipeline...");
    const pipe = await initSemanticPipeline(onProgress);
    console.log("[Segmentation Semantic] Pipeline ready");

    onProgress?.(50, "Detecting walls...");

    // Step 3: Run semantic segmentation
    console.log("[Segmentation Semantic] Step 3: Running DeepLabV3...");
    const results = await pipe(resizedImageUrl);
    console.log("[Segmentation Semantic] DeepLabV3 result received");

    // DeepLabV3 returns an array of {label, mask, score} for each detected class
    const segments = Array.isArray(results) ? results : [results];

    console.log(`[Segmentation Semantic] Found ${segments.length} segments`);
    segments.forEach((seg: any, i: number) => {
      console.log(`  [${i}] label="${seg.label}" score=${seg.score?.toFixed(3)}`);
    });

    if (segments.length === 0) {
      console.log("[Segmentation Semantic] No segments found");
      onProgress?.(100, "No segments detected");
      return createEmptyResult();
    }

    // Step 4: Find wall-related segments and merge their masks
    const wallSegments = segments.filter((seg: any) => {
      const label = (seg.label || "").toLowerCase();
      return WALL_LABELS.some(wl => label.includes(wl));
    });

    console.log(`[Segmentation Semantic] Found ${wallSegments.length} wall-related segments`);

    if (wallSegments.length === 0) {
      console.log("[Segmentation Semantic] No wall segments found, using largest segment");
      // Fall back to using the largest segment as "wall"
      const sortedByScore = [...segments].sort((a: any, b: any) =>
        (b.score || 0) - (a.score || 0)
      );
      if (sortedByScore.length > 0 && sortedByScore[0].mask) {
        wallSegments.push(sortedByScore[0]);
      }
    }

    if (wallSegments.length === 0 || !wallSegments[0]?.mask) {
      console.log("[Segmentation Semantic] No usable mask found");
      return createEmptyResult();
    }

    // Get dimensions from first wall segment
    const firstMask = wallSegments[0].mask as RawImage;
    const width = firstMask.width;
    const height = firstMask.height;

    console.log(`[Segmentation Semantic] Mask dimensions: ${width}x${height}`);

    // Step 5: Merge all wall segment masks into one
    onProgress?.(70, "Creating wall mask...");
    return processSemanticMasks(wallSegments, width, height, onProgress);
  } catch (error) {
    console.error("[Segmentation Semantic] Error:", error);
    hasMemoryError = isMemoryError(error);
    if (hasMemoryError) {
      console.log("[Segmentation Semantic] Memory error, falling back to simple detection");
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
  onProgress?: (progress: number, status: string) => void
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

    console.log(`[Segmentation Desktop] Mask: ${width}x${height}, ${channels} channels`);

    // Step 4: Create wall mask by inverting the foreground mask
    // RMBG: high value = foreground, low value = background (wall)
    return processRMBGMask(maskData, width, height, channels, onProgress);
  } catch (error) {
    console.error("[Segmentation Desktop] Error:", error);
    hasMemoryError = isMemoryError(error);
    if (hasMemoryError) {
      console.log("[Segmentation Desktop] Memory error, falling back to simple detection");
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
  onProgress?: (progress: number, status: string) => void
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

    console.log(`[Segmentation Mobile] Output: ${width}x${height}, ${channels} channels`);

    // Step 4: Create wall mask from alpha channel
    // MODNet: high alpha = foreground, low alpha = background (wall)
    return processMODNetOutput(imageData, width, height, channels, onProgress);
  } catch (error) {
    console.error("[Segmentation Mobile] Error:", error);
    hasMemoryError = isMemoryError(error);
    if (hasMemoryError) {
      console.log("[Segmentation Mobile] Memory error, falling back to simple detection");
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
 */
function isMemoryError(error: any): boolean {
  const msg = String(error).toLowerCase();
  return msg.includes('memory') || msg.includes('oom') || msg.includes('allocation');
}

/**
 * Process semantic segmentation masks from DeepLabV3.
 * Merges multiple wall-related segment masks into a single wall mask.
 */
function processSemanticMasks(
  wallSegments: any[],
  width: number,
  height: number,
  onProgress?: (progress: number, status: string) => void
): WallSegmentationResult {
  console.log(`[Segmentation Semantic] Processing ${wallSegments.length} wall segments...`);

  // Create merged wall mask
  const wallMask = new Uint8Array(width * height);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let sumX = 0, sumY = 0, wallPixelCount = 0;

  // Merge all wall segment masks
  for (const segment of wallSegments) {
    const mask = segment.mask as RawImage;
    if (!mask || !mask.data) continue;

    const maskData = mask.data as Uint8Array;
    const channels = mask.channels || 1;

    console.log(`[Segmentation Semantic] Processing segment "${segment.label}" (${channels} channels)`);

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

        // If this pixel is part of the segment (non-zero mask value)
        if (maskValue > 128 && wallMask[pixelIdx] === 0) {
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

  console.log(`[Segmentation Semantic] Wall pixels: ${wallPixelCount} / ${width * height}`);

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
    `[Segmentation Semantic] Complete! Wall area: ${((wallPixelCount / (width * height)) * 100).toFixed(1)}%, Rectangles: ${detectedRectangles.length}`
  );

  return {
    wallMask,
    wallBoundingBox: wallPixelCount > 0 ? {
      xmin: minX / width,
      ymin: minY / height,
      xmax: maxX / width,
      ymax: maxY / height,
    } : null,
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
  onProgress?: (progress: number, status: string) => void
): WallSegmentationResult {
  console.log("[Segmentation] Processing RMBG mask...");
  onProgress?.(70, "Creating wall mask...");

  const wallMask = new Uint8Array(width * height);
  const wallPlanes: WallPlane[] = [];

  let minX = width, minY = height, maxX = 0, maxY = 0;
  let sumX = 0, sumY = 0, wallPixelCount = 0;

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

  return finalizeMaskResult(wallMask, width, height, minX, minY, maxX, maxY, sumX, sumY, wallPixelCount, maskData, channels, false, onProgress);
}

/**
 * Process MODNet output (RGBA, use alpha channel as mask)
 */
function processMODNetOutput(
  imageData: Uint8Array,
  width: number,
  height: number,
  channels: number,
  onProgress?: (progress: number, status: string) => void
): WallSegmentationResult {
  console.log("[Segmentation] Processing MODNet output...");
  onProgress?.(70, "Creating wall mask...");

  const wallMask = new Uint8Array(width * height);
  const wallPlanes: WallPlane[] = [];

  let minX = width, minY = height, maxX = 0, maxY = 0;
  let sumX = 0, sumY = 0, wallPixelCount = 0;

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

  return finalizeMaskResult(wallMask, width, height, minX, minY, maxX, maxY, sumX, sumY, wallPixelCount, imageData, channels, true, onProgress);
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
  onProgress?: (progress: number, status: string) => void
): WallSegmentationResult {
  const wallPlanes: WallPlane[] = [];

  console.log(
    `[Segmentation] Wall pixels found: ${wallPixelCount} / ${width * height}`
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
        2
      )}, ${centerY.toFixed(2)}), area=${(
        (wallPixelCount / (width * height)) *
        100
      ).toFixed(1)}%`
    );
  }

  // Step 5: Calculate overall bounding box
  const wallArea = wallPixelCount / (width * height);
  console.log(
    `[Segmentation] Total wall area: ${(wallArea * 100).toFixed(1)}%`
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
  const FOREGROUND_THRESHOLD = 96;  // Anything >96 is treated as opaque foreground

  // Debug counters
  let transparentCount = 0, opaqueCount = 0;
  let minVal = 255, maxVal = 0;

  for (let i = 0; i < wallMask.length; i++) {
    const pixelIdx = i;
    // Get the original foreground confidence value from the model output
    const dataIdx = isMobileOutput ? pixelIdx * channels + (channels === 4 ? 3 : 0) : pixelIdx * channels;
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

  console.log(`[Segmentation] Foreground mask stats: transparent=${transparentCount}, opaque=${opaqueCount}, valueRange=[${minVal}, ${maxVal}]`);
  fgMaskCtx.putImageData(fgMaskImageData, 0, 0);

  // Step 9: Detect rectangular regions for panel placement
  const detectedRectangles = detectRectanglesInMask(wallMask, width, height);

  onProgress?.(100, "Wall detection complete!");
  console.log(
    "[Segmentation] Complete! Wall planes:",
    wallPlanes.length,
    "Rectangles:",
    detectedRectangles.length
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
  normalizedY: number
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
  normalizedY: number
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
      (normalizedX - plane.centerX) ** 2 + (normalizedY - plane.centerY) ** 2
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
  minArea: number = 0.05 // Minimum 5% of image
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
  stretchToFill: boolean = true // Stretch to fill full height by default
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
