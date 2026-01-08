import { pipeline, env, RawImage } from "@huggingface/transformers";

// Configure transformers.js for browser usage
// Allow local models and enable caching
env.allowLocalModels = false;
env.useBrowserCache = true;

// Type for the segmentation pipeline
type SegmentationPipeline = Awaited<
  ReturnType<typeof pipeline<"image-segmentation">>
>;

// Singleton for the segmentation pipeline
let segmentationPipeline: SegmentationPipeline | null = null;
let isLoading = false;
let loadingPromise: Promise<SegmentationPipeline> | null = null;
let loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 3;

// Maximum image size for segmentation (to avoid memory issues)
// SegFormer was trained on 512x512, so we use that as the max
const MAX_SEGMENTATION_SIZE = 512;

// Wall-related labels from ADE20K dataset (150 classes)
// ADE20K wall class is "wall" - but the model may also detect related objects
const WALL_LABELS = [
  "wall",
  "building",
  "house",
  "ceiling",
  "floor",
  "door",
  "window",
  "fence",
];

function isWallLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return WALL_LABELS.some((w) => lower.includes(w));
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
  wallPlanes: WallPlane[];
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

async function initSegmentationPipeline(
  onProgress?: (progress: number, status: string) => void
): Promise<SegmentationPipeline> {
  // Return cached pipeline if available
  if (segmentationPipeline) {
    console.log("[Segmentation] Using cached pipeline");
    return segmentationPipeline;
  }

  // Return in-progress loading promise if available
  if (isLoading && loadingPromise) {
    console.log("[Segmentation] Waiting for in-progress load");
    return loadingPromise;
  }

  // Check if we've exceeded max attempts
  if (loadAttempts >= MAX_LOAD_ATTEMPTS) {
    console.error("[Segmentation] Max load attempts exceeded");
    throw new Error(
      "Failed to load segmentation model after multiple attempts"
    );
  }

  isLoading = true;
  loadAttempts++;

  console.log(
    `[Segmentation] Loading model (attempt ${loadAttempts}/${MAX_LOAD_ATTEMPTS})...`
  );

  loadingPromise = (async () => {
    try {
      onProgress?.(0, "Loading wall segmentation model...");

      console.log(
        "[Segmentation] Calling pipeline() for image-segmentation..."
      );

      // Use the correct model with explicit configuration
      const pipe = await pipeline(
        "image-segmentation",
        "Xenova/segformer-b0-finetuned-ade-512-512",
        {
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
        }
      );

      console.log("[Segmentation] Pipeline created successfully!");
      segmentationPipeline = pipe;
      onProgress?.(100, "Segmentation model loaded!");
      return segmentationPipeline;
    } catch (error) {
      console.error("[Segmentation] Failed to load model:", error);
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

export async function segmentWalls(
  imageUrl: string,
  onProgress?: (progress: number, status: string) => void
): Promise<WallSegmentationResult> {
  console.log("[Segmentation] segmentWalls called");

  try {
    // Step 1: Resize image to avoid memory issues
    console.log("[Segmentation] Step 1: Resizing image...");
    onProgress?.(10, "Preparing image...");
    const { dataUrl: resizedImageUrl, scale } =
      await resizeImageForSegmentation(imageUrl);
    console.log("[Segmentation] Image resized successfully");

    // Step 2: Initialize the pipeline
    console.log("[Segmentation] Step 2: Getting pipeline...");
    const pipe = await initSegmentationPipeline(onProgress);
    console.log("[Segmentation] Pipeline ready");

    onProgress?.(50, "Analyzing image for walls...");

    // Step 3: Run the segmentation on resized image
    console.log(
      "[Segmentation] Step 3: Running segmentation on resized image..."
    );
    const results = await pipe(resizedImageUrl);
    console.log("[Segmentation] Raw results received");

    // Ensure results is an array
    const segments = Array.isArray(results) ? results : [results];

    console.log("[Segmentation] Found", segments.length, "total segments");
    console.log(
      "[Segmentation] All segment labels:",
      segments.map((s: any) => s.label)
    );

    // Step 4: Filter for wall-related segments
    const wallSegments = segments.filter((seg: any) => {
      const isWall = seg.label && isWallLabel(seg.label);
      if (isWall) {
        console.log(`[Segmentation] ✓ Found wall segment: "${seg.label}"`);
      }
      return isWall;
    });

    console.log("[Segmentation] Wall segments found:", wallSegments.length);

    if (wallSegments.length === 0) {
      console.log("[Segmentation] No wall segments detected!");
      console.log(
        "[Segmentation] Available labels were:",
        segments.map((s: any) => s.label).join(", ")
      );
      onProgress?.(100, "No walls detected in image");
      return {
        wallMask: new Uint8Array(0),
        wallBoundingBox: null,
        wallArea: 0,
        width: 0,
        height: 0,
        wallMaskUrl: "",
        wallPlanes: [],
      };
    }

    // Step 5: Process the first wall segment to get dimensions
    console.log("[Segmentation] Step 5: Processing wall masks...");
    const firstMask = wallSegments[0].mask as RawImage;
    const width = firstMask.width;
    const height = firstMask.height;
    const channels = (firstMask as any).channels || 1;

    console.log(
      `[Segmentation] Mask dimensions: ${width}x${height}, channels: ${channels}`
    );

    const wallMask = new Uint8Array(width * height);
    const wallPlanes: WallPlane[] = [];

    // Step 6: Process each wall segment
    for (const segment of wallSegments) {
      const mask = segment.mask as RawImage;
      const maskData = mask.data as Uint8Array;
      let minX = width,
        minY = height,
        maxX = 0,
        maxY = 0;
      let sumX = 0,
        sumY = 0,
        pixelCount = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pixelIdx = y * width + x;
          const dataIdx = pixelIdx * channels;
          if (maskData[dataIdx] > 127) {
            wallMask[pixelIdx] = 255;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            sumX += x;
            sumY += y;
            pixelCount++;
          }
        }
      }

      if (pixelCount > 0) {
        const centerX = sumX / pixelCount / width;
        const centerY = sumY / pixelCount / height;
        wallPlanes.push({
          label: segment.label,
          centerX,
          centerY,
          normalX: (0.5 - centerX) * 2,
          normalY: (0.5 - centerY) * 0.3,
          area: pixelCount / (width * height),
          boundingBox: {
            xmin: minX / width,
            ymin: minY / height,
            xmax: maxX / width,
            ymax: maxY / height,
          },
        });
        console.log(
          `[Segmentation] Wall plane "${
            segment.label
          }": center=(${centerX.toFixed(2)}, ${centerY.toFixed(2)}), area=${(
            (pixelCount / (width * height)) *
            100
          ).toFixed(1)}%`
        );
      }
    }

    // Step 7: Calculate overall bounding box
    let overallMinX = 1,
      overallMinY = 1,
      overallMaxX = 0,
      overallMaxY = 0;
    let totalWallPixels = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (wallMask[y * width + x] > 0) {
          overallMinX = Math.min(overallMinX, x / width);
          overallMinY = Math.min(overallMinY, y / height);
          overallMaxX = Math.max(overallMaxX, x / width);
          overallMaxY = Math.max(overallMaxY, y / height);
          totalWallPixels++;
        }
      }
    }

    const wallArea = totalWallPixels / (width * height);
    console.log(
      `[Segmentation] Total wall area: ${(wallArea * 100).toFixed(1)}%`
    );

    // Step 8: Create visualization of the wall mask
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

    onProgress?.(100, "Wall detection complete!");
    console.log("[Segmentation] Complete! Wall planes:", wallPlanes.length);

    return {
      wallMask,
      wallBoundingBox:
        totalWallPixels > 0
          ? {
              xmin: overallMinX,
              ymin: overallMinY,
              xmax: overallMaxX,
              ymax: overallMaxY,
            }
          : null,
      wallArea,
      width,
      height,
      wallMaskUrl: canvas.toDataURL("image/png"),
      wallPlanes,
    };
  } catch (error) {
    console.error("[Segmentation] Wall segmentation failed:", error);
    return {
      wallMask: new Uint8Array(0),
      wallBoundingBox: null,
      wallArea: 0,
      width: 0,
      height: 0,
      wallMaskUrl: "",
      wallPlanes: [],
    };
  }
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
    const rotateY = (0.5 - normalizedX) * 20;
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

  const rotateY = closest.normalX * 20;
  const rotateX = closest.normalY * 10;
  const scale = 1.2 - depthAtPoint * 0.4;

  return { rotateX, rotateY, scale: Math.max(0.6, Math.min(1.4, scale)) };
}
