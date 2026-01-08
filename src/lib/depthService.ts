import {
  pipeline,
  DepthEstimationPipeline,
  RawImage,
} from "@huggingface/transformers";

// Singleton to hold the depth estimation pipeline
let depthPipeline: DepthEstimationPipeline | null = null;
let isLoading = false;
let loadingPromise: Promise<DepthEstimationPipeline> | null = null;

export interface DepthMapResult {
  depthData: Float32Array;
  width: number;
  height: number;
  depthImageUrl: string;
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
 */
export async function estimateDepth(
  imageUrl: string,
  onProgress?: (progress: number, status: string) => void
): Promise<DepthMapResult> {
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
