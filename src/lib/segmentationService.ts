import { pipeline, env, RawImage } from "@huggingface/transformers";

// Configure transformers.js for browser usage
// Allow local models and enable caching
env.allowLocalModels = false;
env.useBrowserCache = true;

// Type for the segmentation pipeline - using image-segmentation for RMBG
type SegmentationPipeline = Awaited<
  ReturnType<typeof pipeline<"image-segmentation">>
>;

// Singleton for the segmentation pipeline
let segmentationPipeline: SegmentationPipeline | null = null;
let isLoading = false;
let loadingPromise: Promise<SegmentationPipeline> | null = null;
let loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 3;

// Maximum image size for segmentation
// RMBG-1.4 supports higher resolutions - we use 1024 for better quality
const MAX_SEGMENTATION_SIZE = 1024;

// Model configuration - using RMBG-1.4 for better foreground/background separation
// RMBG produces a foreground mask, so we invert it to get the wall (background) mask
const SEGMENTATION_MODEL = "briaai/RMBG-1.4";

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
  const components: { pixels: number[]; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  
  // Flood fill to find connected components
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (wallMask[idx] > 0 && !visited[idx]) {
        // BFS flood fill
        const component = { pixels: [] as number[], minX: x, minY: y, maxX: x, maxY: y };
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
            cy > 0 ? currentIdx - width : -1,           // up
            cy < height - 1 ? currentIdx + width : -1,  // down
            cx > 0 ? currentIdx - 1 : -1,               // left
            cx < width - 1 ? currentIdx + 1 : -1        // right
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
  
  console.log(`[Segmentation] Detected ${rectangles.length} rectangular regions`);
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
      onProgress?.(0, "Loading background removal model...");

      console.log(
        "[Segmentation] Calling pipeline() for image-segmentation with RMBG..."
      );

      // Use RMBG-1.4 for high-quality foreground/background separation
      // The model returns a foreground mask - we'll invert it to get the wall (background) mask
      const pipe = await pipeline(
        "image-segmentation",
        SEGMENTATION_MODEL,
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
  console.log("[Segmentation] segmentWalls called (using RMBG-1.4)");

  try {
    // Step 1: Resize image for processing
    console.log("[Segmentation] Step 1: Resizing image...");
    onProgress?.(10, "Preparing image...");
    const { dataUrl: resizedImageUrl, scale } =
      await resizeImageForSegmentation(imageUrl);
    console.log("[Segmentation] Image resized successfully (scale:", scale, ")");

    // Step 2: Initialize the pipeline
    console.log("[Segmentation] Step 2: Getting pipeline...");
    const pipe = await initSegmentationPipeline(onProgress);
    console.log("[Segmentation] Pipeline ready");

    onProgress?.(50, "Detecting foreground objects...");

    // Step 3: Run RMBG segmentation - returns foreground mask
    console.log("[Segmentation] Step 3: Running RMBG background removal...");
    
    // RMBG-1.4 uses the standard image-segmentation pipeline
    // It returns an array with a single segment containing the foreground mask
    const results = await pipe(resizedImageUrl);
    console.log("[Segmentation] RMBG result received");
    
    // Ensure results is an array
    const segments = Array.isArray(results) ? results : [results];
    
    if (segments.length === 0 || !segments[0]?.mask) {
      console.log("[Segmentation] No mask in results");
      onProgress?.(100, "Background removal failed");
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
    
    // Get the foreground mask from the first (and typically only) segment
    const foregroundMask = segments[0].mask as RawImage;
    const width = foregroundMask.width;
    const height = foregroundMask.height;
    const channels = foregroundMask.channels || 1;
    const maskData = foregroundMask.data as Uint8Array;

    console.log(
      `[Segmentation] Mask dimensions: ${width}x${height}, channels: ${channels}`
    );

    // Step 4: Create wall mask by INVERTING the foreground mask
    // RMBG: white (255) = foreground (objects/people), black (0) = background (walls)
    // We want: white = wall, black = non-wall
    const wallMask = new Uint8Array(width * height);
    const wallPlanes: WallPlane[] = [];
    
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let sumX = 0, sumY = 0, wallPixelCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIdx = y * width + x;
        // For RMBG, the mask is typically single channel or RGBA
        // We read the first channel (or alpha if available)
        const dataIdx = pixelIdx * channels;
        const foregroundValue = maskData[dataIdx];
        
        // Invert: low foreground value = wall (background)
        // Using threshold of 128 for binary decision
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

    console.log(`[Segmentation] Wall pixels found: ${wallPixelCount} / ${width * height}`);

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
        `[Segmentation] Wall plane detected: center=(${centerX.toFixed(2)}, ${centerY.toFixed(2)}), area=${(
          (wallPixelCount / (width * height)) * 100
        ).toFixed(1)}%`
      );
    }

    // Step 5: Calculate overall bounding box
    const wallArea = wallPixelCount / (width * height);
    console.log(`[Segmentation] Total wall area: ${(wallArea * 100).toFixed(1)}%`);

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

    // Step 7: Create CSS-compatible mask (white = wall, black = non-wall)
    const cssMaskCanvas = document.createElement("canvas");
    cssMaskCanvas.width = width;
    cssMaskCanvas.height = height;
    const cssMaskCtx = cssMaskCanvas.getContext("2d")!;
    const cssMaskImageData = cssMaskCtx.createImageData(width, height);
    for (let i = 0; i < wallMask.length; i++) {
      const val = wallMask[i] > 0 ? 255 : 0;
      cssMaskImageData.data[i * 4] = val; // R
      cssMaskImageData.data[i * 4 + 1] = val; // G
      cssMaskImageData.data[i * 4 + 2] = val; // B
      cssMaskImageData.data[i * 4 + 3] = 255; // A (fully opaque)
    }
    cssMaskCtx.putImageData(cssMaskImageData, 0, 0);

    // Step 8: Create inverted foreground mask (white = non-wall/foreground, black = wall)
    const fgMaskCanvas = document.createElement("canvas");
    fgMaskCanvas.width = width;
    fgMaskCanvas.height = height;
    const fgMaskCtx = fgMaskCanvas.getContext("2d")!;
    const fgMaskImageData = fgMaskCtx.createImageData(width, height);
    for (let i = 0; i < wallMask.length; i++) {
      // Inverted: non-wall = white (255), wall = black (0)
      const val = wallMask[i] > 0 ? 0 : 255;
      fgMaskImageData.data[i * 4] = val; // R
      fgMaskImageData.data[i * 4 + 1] = val; // G
      fgMaskImageData.data[i * 4 + 2] = val; // B
      fgMaskImageData.data[i * 4 + 3] = 255; // A (fully opaque)
    }
    fgMaskCtx.putImageData(fgMaskImageData, 0, 0);

    // Step 9: Detect rectangular regions for panel placement
    const detectedRectangles = detectRectanglesInMask(wallMask, width, height);

    onProgress?.(100, "Wall detection complete!");
    console.log("[Segmentation] Complete! Wall planes:", wallPlanes.length, "Rectangles:", detectedRectangles.length);

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
  } catch (error) {
    console.error("[Segmentation] Wall segmentation failed:", error);
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
  const candidates = rectangles.filter(r => r.area >= minArea);
  if (candidates.length === 0) {
    // Fallback to largest rectangle if none meet minimum
    return rectangles[0];
  }
  
  // Score rectangles by aspect ratio match (lower is better)
  const scored = candidates.map(r => ({
    rect: r,
    score: Math.abs(r.aspectRatio - panelAspectRatio) / panelAspectRatio
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
  const paddedX = rectangle.boundingBox.xmin + rectangle.width * horizontalPadding;
  const paddedY = rectangle.boundingBox.ymin + rectangle.height * verticalPadding;
  
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
