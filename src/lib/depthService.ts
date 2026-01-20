import {
  pipeline,
  DepthEstimationPipeline,
  RawImage,
} from "@huggingface/transformers";

// Singleton to hold the depth estimation pipeline
let depthPipeline: DepthEstimationPipeline | null = null;
let isLoading = false;
let loadingPromise: Promise<DepthEstimationPipeline> | null = null;

// Track if we've had a memory error - if so, use fallback depth
let hasMemoryError = false;

/**
 * Detect if we're running on Android specifically
 * Android Chrome has known WASM memory limitations
 */
function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
}

export interface DepthMapResult {
  depthData: Float32Array;
  width: number;
  height: number;
  depthImageUrl: string;
}

/**
 * Create a fallback depth map when the model can't run
 * Uses a simple gradient from top to bottom (simulating typical room perspective)
 */
function createFallbackDepthMap(width: number, height: number): DepthMapResult {
  console.log("[Depth] Creating fallback depth map");
  
  const depthData = new Float32Array(width * height);
  
  // Create a simple vertical gradient (top = far, bottom = near)
  // This mimics typical room photos where the floor is closer
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      // Linear gradient: 0.3 at top to 0.8 at bottom
      depthData[idx] = 0.3 + (y / height) * 0.5;
    }
  }
  
  // Create a visualization canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(width, height);
  
  for (let i = 0; i < depthData.length; i++) {
    const val = Math.round(depthData[i] * 255);
    imageData.data[i * 4] = val;
    imageData.data[i * 4 + 1] = val;
    imageData.data[i * 4 + 2] = val;
    imageData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  
  return {
    depthData,
    width,
    height,
    depthImageUrl: canvas.toDataURL("image/png"),
  };
}

/**
 * Initialize the depth estimation pipeline.
 * Uses the Xenova/depth-anything-small-hf model which runs in-browser via ONNX.
 */
export async function initDepthPipeline(
  onProgress?: (progress: number, status: string) => void
): Promise<DepthEstimationPipeline> {
  // Return existing pipeline if already loaded
  if (depthPipeline) {
    return depthPipeline;
  }

  // Return existing loading promise if currently loading
  if (isLoading && loadingPromise) {
    return loadingPromise;
  }

  isLoading = true;

  loadingPromise = (async () => {
    try {
      onProgress?.(0, "Loading depth estimation model...");

      // Create the depth estimation pipeline with the small model for faster loading
      const pipe = await pipeline(
        "depth-estimation",
        "Xenova/depth-anything-small-hf",
        {
          progress_callback: (progressData: {
            progress?: number;
            status?: string;
          }) => {
            if (progressData.progress !== undefined) {
              onProgress?.(
                progressData.progress,
                progressData.status || "Loading..."
              );
            }
          },
        }
      );

      depthPipeline = pipe as DepthEstimationPipeline;
      onProgress?.(100, "Model loaded!");
      return depthPipeline;
    } catch (error) {
      console.error("Failed to load depth estimation model:", error);
      throw error;
    } finally {
      isLoading = false;
    }
  })();

  return loadingPromise;
}

/**
 * Estimate depth from an image URL.
 * Returns the depth data as a Float32Array along with dimensions.
 * Falls back to a simple gradient if model fails (e.g., on Android with memory constraints).
 */
export async function estimateDepth(
  imageUrl: string,
  onProgress?: (progress: number, status: string) => void
): Promise<DepthMapResult> {
  console.log("[Depth] estimateDepth called, hasMemoryError:", hasMemoryError);
  
  // If we've previously had a memory error, use fallback
  if (hasMemoryError) {
    console.warn("[Depth] Using fallback depth map due to previous memory error");
    onProgress?.(50, "Using simplified depth (memory constraints)...");
    
    // Get image dimensions
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = imageUrl;
    });
    
    onProgress?.(100, "Done!");
    return createFallbackDepthMap(img.width, img.height);
  }

  try {
    // Ensure pipeline is initialized
    const pipe = await initDepthPipeline(onProgress);

    onProgress?.(50, "Processing image...");

    // Run depth estimation
    const result = await pipe(imageUrl);

    onProgress?.(90, "Generating depth map...");

    // The result contains predicted_depth (tensor) and depth (RawImage)
    const depthImage = result.depth as RawImage;

    // Convert depth image to data URL for visualization
    const depthCanvas = document.createElement("canvas");
    depthCanvas.width = depthImage.width;
    depthCanvas.height = depthImage.height;
    const ctx = depthCanvas.getContext("2d")!;

    // Create ImageData from the depth image
    const imageData = ctx.createImageData(depthImage.width, depthImage.height);

    // Depth image is grayscale (1 channel), we need to expand to RGBA
    for (let i = 0; i < depthImage.data.length; i++) {
      const val = depthImage.data[i];
      imageData.data[i * 4] = val; // R
      imageData.data[i * 4 + 1] = val; // G
      imageData.data[i * 4 + 2] = val; // B
      imageData.data[i * 4 + 3] = 255; // A
    }

    ctx.putImageData(imageData, 0, 0);

    // Get normalized depth data as Float32Array (0-1 range)
    const depthData = new Float32Array(depthImage.data.length);
    for (let i = 0; i < depthImage.data.length; i++) {
      depthData[i] = depthImage.data[i] / 255;
    }

    onProgress?.(100, "Done!");

    return {
      depthData,
      width: depthImage.width,
      height: depthImage.height,
      depthImageUrl: depthCanvas.toDataURL("image/png"),
    };
  } catch (error) {
    console.error("[Depth] Depth estimation failed:", error);
    
    // Check for Android/mobile memory errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isMemoryError = 
      errorMessage.includes("allocate") ||
      errorMessage.includes("buffer") ||
      errorMessage.includes("memory") ||
      errorMessage.includes("OOM") ||
      errorMessage.includes("RangeError") ||
      errorMessage.includes("Array buffer allocation") ||
      errorMessage.includes("session");
    
    if (isMemoryError) {
      console.warn("[Depth] Memory error detected - using fallback for this session");
      hasMemoryError = true;
      // Reset the pipeline to free memory
      depthPipeline = null;
      loadingPromise = null;
    }
    
    // Get image dimensions for fallback
    onProgress?.(50, "Using simplified depth...");
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = imageUrl;
    });
    
    onProgress?.(100, "Done!");
    return createFallbackDepthMap(img.width, img.height);
  }
}

/**
 * Sample depth at a specific position in the depth map.
 * Coordinates are normalized (0-1) relative to image dimensions.
 */
export function sampleDepthAt(
  depthData: Float32Array,
  width: number,
  height: number,
  normalizedX: number,
  normalizedY: number
): number {
  const x = Math.floor(normalizedX * width);
  const y = Math.floor(normalizedY * height);
  const index = y * width + x;

  if (index >= 0 && index < depthData.length) {
    return depthData[index];
  }

  return 0.5; // Default to middle depth if out of bounds
}

/**
 * Check if the pipeline is ready to use.
 */
export function isDepthPipelineReady(): boolean {
  return depthPipeline !== null;
}

/**
 * Check if the pipeline is currently loading.
 */
export function isDepthPipelineLoading(): boolean {
  return isLoading;
}
