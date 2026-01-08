// Utility functions for texture blending and visualization

interface Point {
  x: number;
  y: number;
}

interface PolygonData {
  points: Point[];
  canvasWidth: number;
  canvasHeight: number;
}

interface WallTextureOptions {
  /** Scale factor for the texture tiles (default: 1.0) */
  textureScale?: number;
  /** Blend opacity with original image (0-1, default: 0.85) */
  blendOpacity?: number;
  /** Whether to apply depth-based shading (default: true) */
  applyDepthShading?: boolean;
  /** Whether to apply perspective distortion (default: true) */
  applyPerspective?: boolean;
}

/**
 * Load an image from a URL and return a promise with the HTMLImageElement
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Create a gradient texture from colors when the actual texture fails to load
 */
export function createGradientTexture(
  colors: string[],
  width = 256,
  height = 256
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Create diagonal gradient using panel colors
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  colors.forEach((color, i) => {
    gradient.addColorStop(i / (colors.length - 1), color);
  });

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Add some noise/texture effect
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 20;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}

/**
 * Apply a texture to an image inside a polygon area using canvas clipping
 * polygonDataJson contains the polygon points and canvas dimensions
 */
export async function applyTextureWithMask(
  originalImageUrl: string,
  polygonDataJson: string,
  textureUrl: string,
  fallbackColors: string[]
): Promise<string> {
  // Parse polygon data
  const polygonData: PolygonData = JSON.parse(polygonDataJson);
  const { points, canvasWidth, canvasHeight } = polygonData;

  if (points.length < 3) {
    throw new Error("Need at least 3 points to form a polygon");
  }

  // Load original image
  const originalImage = await loadImage(originalImageUrl);

  // Try to load texture, fall back to gradient if it fails
  let textureSource: HTMLImageElement | HTMLCanvasElement;
  try {
    textureSource = await loadImage(textureUrl);
  } catch {
    console.warn(
      `Failed to load texture ${textureUrl}, using gradient fallback`
    );
    textureSource = createGradientTexture(fallbackColors);
  }

  // Create output canvas matching the original dimensions
  const canvas = document.createElement("canvas");
  canvas.width = originalImage.width;
  canvas.height = originalImage.height;
  const ctx = canvas.getContext("2d")!;

  // Calculate scale factor between polygon canvas and original image
  const scaleX = originalImage.width / canvasWidth;
  const scaleY = originalImage.height / canvasHeight;

  // Scale polygon points to match original image dimensions
  const scaledPoints = points.map((p) => ({
    x: p.x * scaleX,
    y: p.y * scaleY,
  }));

  // Draw original image as base
  ctx.drawImage(originalImage, 0, 0);

  // Save context state
  ctx.save();

  // Create clipping path from polygon
  ctx.beginPath();
  ctx.moveTo(scaledPoints[0].x, scaledPoints[0].y);
  for (let i = 1; i < scaledPoints.length; i++) {
    ctx.lineTo(scaledPoints[i].x, scaledPoints[i].y);
  }
  ctx.closePath();
  ctx.clip();

  // Create tiled texture pattern and fill the clipped area
  const pattern = ctx.createPattern(textureSource, "repeat");
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Restore context state
  ctx.restore();

  return canvas.toDataURL("image/png");
}

/**
 * Apply texture to an image using depth-based masking with perspective transformation.
 * The texture scales and tilts based on the depth map to create a realistic 3D effect.
 * Foreground objects (closer) remain visible while walls get the textured overlay.
 *
 * @param originalImageUrl - URL of the original image
 * @param depthData - Float32Array of normalized depth values (0-1)
 * @param depthWidth - Width of the depth map
 * @param depthHeight - Height of the depth map
 * @param targetDepth - The depth value at the clicked wall position (0-1)
 * @param textureUrl - URL of the panel texture
 * @param fallbackColors - Fallback colors for gradient if texture fails
 * @param depthThreshold - How similar the depth must be to be considered "wall" (default 0.15)
 */
export async function applyTextureWithDepthMask(
  originalImageUrl: string,
  depthData: Float32Array,
  depthWidth: number,
  depthHeight: number,
  targetDepth: number,
  textureUrl: string,
  fallbackColors: string[],
  depthThreshold: number = 0.15
): Promise<string> {
  // Load original image
  const originalImage = await loadImage(originalImageUrl);

  // Try to load texture, fall back to gradient if it fails
  let textureSource: HTMLImageElement | HTMLCanvasElement;
  try {
    textureSource = await loadImage(textureUrl);
  } catch {
    console.warn(
      `Failed to load texture ${textureUrl}, using gradient fallback`
    );
    textureSource = createGradientTexture(fallbackColors);
  }

  // Create output canvas matching the original dimensions
  const canvas = document.createElement("canvas");
  canvas.width = originalImage.width;
  canvas.height = originalImage.height;
  const ctx = canvas.getContext("2d")!;

  // Draw the original image as the base
  ctx.drawImage(originalImage, 0, 0);

  // Get the original image data
  const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const originalPixels = new Uint8ClampedArray(originalImageData.data);

  // Scale factors for mapping image coordinates to depth map coordinates
  const scaleX = depthWidth / canvas.width;
  const scaleY = depthHeight / canvas.height;

  // Get texture dimensions
  const texWidth = textureSource.width;
  const texHeight = textureSource.height;

  // Create a canvas to read texture pixels
  const texCanvas = document.createElement("canvas");
  texCanvas.width = texWidth;
  texCanvas.height = texHeight;
  const texCtx = texCanvas.getContext("2d")!;
  texCtx.drawImage(textureSource, 0, 0);
  const texImageData = texCtx.getImageData(0, 0, texWidth, texHeight);
  const texPixels = texImageData.data;

  // Calculate depth gradients for perspective effect
  // We'll compute local depth gradients to determine surface orientation
  const getDepthAt = (x: number, y: number): number => {
    const dx = Math.floor(x * scaleX);
    const dy = Math.floor(y * scaleY);
    const idx = dy * depthWidth + dx;
    return depthData[idx] ?? 0.5;
  };

  // Compute average depth gradient for the wall region to determine overall tilt
  let avgGradX = 0;
  let avgGradY = 0;
  let wallPixelCount = 0;
  const sampleStep = 10; // Sample every 10 pixels for efficiency

  for (let y = sampleStep; y < canvas.height - sampleStep; y += sampleStep) {
    for (let x = sampleStep; x < canvas.width - sampleStep; x += sampleStep) {
      const depth = getDepthAt(x, y);
      const depthDiff = Math.abs(depth - targetDepth);

      if (depthDiff <= depthThreshold) {
        // This pixel is on the wall - compute local gradient
        const depthLeft = getDepthAt(x - sampleStep, y);
        const depthRight = getDepthAt(x + sampleStep, y);
        const depthUp = getDepthAt(x, y - sampleStep);
        const depthDown = getDepthAt(x, y + sampleStep);

        avgGradX += depthRight - depthLeft;
        avgGradY += depthDown - depthUp;
        wallPixelCount++;
      }
    }
  }

  if (wallPixelCount > 0) {
    avgGradX /= wallPixelCount;
    avgGradY /= wallPixelCount;
  }

  // Convert gradients to perspective scale factors
  // Larger gradient = more perspective distortion
  const perspectiveStrength = 2.0;
  const baseScale = 1.0;

  // Process each pixel
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const pixelIndex = (y * canvas.width + x) * 4;

      // Get depth at this pixel
      const pixelDepth = getDepthAt(x, y);

      // Calculate depth difference from target wall
      const depthDiff = Math.abs(pixelDepth - targetDepth);

      // Check if this pixel should be textured (is it on the wall?)
      const isWall =
        depthDiff <= depthThreshold || pixelDepth >= targetDepth - 0.02;

      if (isWall) {
        // Calculate local depth-based scaling for perspective effect
        const localDepthOffset = pixelDepth - targetDepth;

        // Scale texture coordinates based on depth
        // Pixels farther away get smaller texture (compressed)
        // Pixels closer get larger texture (expanded)
        const depthScale = baseScale + localDepthOffset * perspectiveStrength;

        // Apply horizontal tilt based on depth gradient
        // This creates the effect of the wall receding into the distance
        const normalizedX = x / canvas.width;
        const normalizedY = y / canvas.height;

        // Compute perspective-adjusted texture coordinates
        const tiltOffsetX = avgGradX * (normalizedX - 0.5) * canvas.width * 0.5;
        const tiltOffsetY =
          avgGradY * (normalizedY - 0.5) * canvas.height * 0.5;

        // Calculate texture coordinates with perspective
        let texX = (x + tiltOffsetX) * depthScale;
        let texY = (y + tiltOffsetY) * depthScale;

        // Wrap texture coordinates for tiling
        texX = ((texX % texWidth) + texWidth) % texWidth;
        texY = ((texY % texHeight) + texHeight) % texHeight;

        // Bilinear interpolation for smooth texture sampling
        const tx0 = Math.floor(texX);
        const ty0 = Math.floor(texY);
        const tx1 = (tx0 + 1) % texWidth;
        const ty1 = (ty0 + 1) % texHeight;
        const fx = texX - tx0;
        const fy = texY - ty0;

        // Get the four nearest texture pixels
        const idx00 = (ty0 * texWidth + tx0) * 4;
        const idx10 = (ty0 * texWidth + tx1) * 4;
        const idx01 = (ty1 * texWidth + tx0) * 4;
        const idx11 = (ty1 * texWidth + tx1) * 4;

        // Interpolate each color channel
        const interpolate = (c: number) => {
          const v00 = texPixels[idx00 + c];
          const v10 = texPixels[idx10 + c];
          const v01 = texPixels[idx01 + c];
          const v11 = texPixels[idx11 + c];

          const v0 = v00 * (1 - fx) + v10 * fx;
          const v1 = v01 * (1 - fx) + v11 * fx;
          return v0 * (1 - fy) + v1 * fy;
        };

        const texR = interpolate(0);
        const texG = interpolate(1);
        const texB = interpolate(2);

        // Calculate blend factor for smooth edge transitions
        const blendFactor =
          depthDiff <= depthThreshold * 0.5
            ? 1.0
            : 1.0 - (depthDiff - depthThreshold * 0.5) / (depthThreshold * 0.5);
        const clampedBlend = Math.max(0, Math.min(1, blendFactor));

        // Apply depth-based shading (darker for farther areas)
        const shadeFactor = 1.0 - Math.abs(localDepthOffset) * 0.3;
        const clampedShade = Math.max(0.7, Math.min(1.0, shadeFactor));

        // Blend texture with original image
        pixels[pixelIndex] = Math.round(
          texR * clampedShade * clampedBlend +
            originalPixels[pixelIndex] * (1 - clampedBlend)
        );
        pixels[pixelIndex + 1] = Math.round(
          texG * clampedShade * clampedBlend +
            originalPixels[pixelIndex + 1] * (1 - clampedBlend)
        );
        pixels[pixelIndex + 2] = Math.round(
          texB * clampedShade * clampedBlend +
            originalPixels[pixelIndex + 2] * (1 - clampedBlend)
        );
      }
      // Non-wall pixels keep original image (foreground objects)
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Apply a tiled texture to wall areas using the wall segmentation mask.
 * This creates a Wizart-style effect where the texture covers all detected wall pixels.
 *
 * @param originalImageUrl - URL of the original room image
 * @param wallMask - Uint8Array where non-zero values indicate wall pixels
 * @param maskWidth - Width of the wall mask
 * @param maskHeight - Height of the wall mask
 * @param textureUrl - URL of the panel texture to tile
 * @param fallbackColors - Fallback colors if texture fails to load
 * @param depthData - Optional depth data for shading effects
 * @param depthWidth - Width of depth map
 * @param depthHeight - Height of depth map
 * @param options - Additional options for texture application
 */
export async function applyTextureToWallMask(
  originalImageUrl: string,
  wallMask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  textureUrl: string,
  fallbackColors: string[],
  depthData?: Float32Array,
  depthWidth?: number,
  depthHeight?: number,
  options: WallTextureOptions = {}
): Promise<string> {
  const {
    textureScale = 0.15,
    blendOpacity = 0.92,
    applyDepthShading = true,
    applyPerspective = true,
  } = options;

  // Load original image
  const originalImage = await loadImage(originalImageUrl);
  const imgWidth = originalImage.width;
  const imgHeight = originalImage.height;

  // Try to load texture, fall back to gradient if it fails
  let textureSource: HTMLImageElement | HTMLCanvasElement;
  try {
    textureSource = await loadImage(textureUrl);
  } catch {
    console.warn(
      `Failed to load texture ${textureUrl}, using gradient fallback`
    );
    textureSource = createGradientTexture(fallbackColors);
  }

  // Create output canvas
  const canvas = document.createElement("canvas");
  canvas.width = imgWidth;
  canvas.height = imgHeight;
  const ctx = canvas.getContext("2d")!;

  // Draw original image as base
  ctx.drawImage(originalImage, 0, 0);

  // Get original image data
  const originalImageData = ctx.getImageData(0, 0, imgWidth, imgHeight);
  const originalPixels = new Uint8ClampedArray(originalImageData.data);

  // Get texture pixels
  const texWidth = textureSource.width;
  const texHeight = textureSource.height;
  const texCanvas = document.createElement("canvas");
  texCanvas.width = texWidth;
  texCanvas.height = texHeight;
  const texCtx = texCanvas.getContext("2d")!;
  texCtx.drawImage(textureSource, 0, 0);
  const texImageData = texCtx.getImageData(0, 0, texWidth, texHeight);
  const texPixels = texImageData.data;

  // Scale factors for mapping image coordinates to mask coordinates
  const maskScaleX = maskWidth / imgWidth;
  const maskScaleY = maskHeight / imgHeight;

  // Depth scale factors (if depth data available)
  const hasDepth = depthData && depthWidth && depthHeight;
  const depthScaleX = hasDepth ? depthWidth! / imgWidth : 1;
  const depthScaleY = hasDepth ? depthHeight! / imgHeight : 1;

  // Calculate tile size in pixels (scaled texture)
  const tileWidth = texWidth / textureScale;
  const tileHeight = texHeight / textureScale;

  // Helper to get depth at a point
  const getDepthAt = (x: number, y: number): number => {
    if (!hasDepth) return 0.5;
    const dx = Math.floor(x * depthScaleX);
    const dy = Math.floor(y * depthScaleY);
    const idx = Math.min(dy * depthWidth! + dx, depthData!.length - 1);
    return depthData![idx] ?? 0.5;
  };

  // Calculate average depth in wall region for perspective reference
  let avgWallDepth = 0.5;
  let wallPixelCount = 0;
  const sampleStep = 20;
  for (let y = 0; y < imgHeight; y += sampleStep) {
    for (let x = 0; x < imgWidth; x += sampleStep) {
      const mx = Math.floor(x * maskScaleX);
      const my = Math.floor(y * maskScaleY);
      const maskIdx = my * maskWidth + mx;
      if (wallMask[maskIdx] > 0) {
        avgWallDepth += getDepthAt(x, y);
        wallPixelCount++;
      }
    }
  }
  if (wallPixelCount > 0) avgWallDepth /= wallPixelCount;

  // Process output image
  const imageData = ctx.getImageData(0, 0, imgWidth, imgHeight);
  const pixels = imageData.data;

  // Helper for bilinear texture sampling
  const sampleTexture = (
    texX: number,
    texY: number
  ): [number, number, number] => {
    // Wrap coordinates
    texX = ((texX % texWidth) + texWidth) % texWidth;
    texY = ((texY % texHeight) + texHeight) % texHeight;

    const tx0 = Math.floor(texX);
    const ty0 = Math.floor(texY);
    const tx1 = (tx0 + 1) % texWidth;
    const ty1 = (ty0 + 1) % texHeight;
    const fx = texX - tx0;
    const fy = texY - ty0;

    const idx00 = (ty0 * texWidth + tx0) * 4;
    const idx10 = (ty0 * texWidth + tx1) * 4;
    const idx01 = (ty1 * texWidth + tx0) * 4;
    const idx11 = (ty1 * texWidth + tx1) * 4;

    const interpolate = (c: number) => {
      const v00 = texPixels[idx00 + c];
      const v10 = texPixels[idx10 + c];
      const v01 = texPixels[idx01 + c];
      const v11 = texPixels[idx11 + c];
      const v0 = v00 * (1 - fx) + v10 * fx;
      const v1 = v01 * (1 - fx) + v11 * fx;
      return v0 * (1 - fy) + v1 * fy;
    };

    return [interpolate(0), interpolate(1), interpolate(2)];
  };

  // Process each pixel
  for (let y = 0; y < imgHeight; y++) {
    for (let x = 0; x < imgWidth; x++) {
      // Check if this pixel is on the wall
      const mx = Math.floor(x * maskScaleX);
      const my = Math.floor(y * maskScaleY);
      const maskIdx = my * maskWidth + mx;

      if (wallMask[maskIdx] > 0) {
        const pixelIndex = (y * imgWidth + x) * 4;

        // Calculate texture coordinates with tiling
        let texX = (x / tileWidth) * texWidth;
        let texY = (y / tileHeight) * texHeight;

        // Apply perspective distortion based on depth
        if (applyPerspective && hasDepth) {
          const depth = getDepthAt(x, y);
          const depthOffset = depth - avgWallDepth;
          const perspectiveScale = 1.0 + depthOffset * 0.5;
          texX *= perspectiveScale;
          texY *= perspectiveScale;
        }

        // Sample texture
        const [texR, texG, texB] = sampleTexture(texX, texY);

        // Calculate shading based on depth
        let shadeFactor = 1.0;
        if (applyDepthShading && hasDepth) {
          const depth = getDepthAt(x, y);
          // Darken areas that are farther away
          shadeFactor = 1.0 - (depth - avgWallDepth) * 0.4;
          shadeFactor = Math.max(0.7, Math.min(1.1, shadeFactor));
        }

        // Calculate edge softness for smooth blending at wall boundaries
        // Check neighboring pixels to detect edges
        let edgeFactor = 1.0;
        const edgeCheckRadius = 2;
        let wallNeighbors = 0;
        let totalNeighbors = 0;

        for (let dy = -edgeCheckRadius; dy <= edgeCheckRadius; dy++) {
          for (let dx = -edgeCheckRadius; dx <= edgeCheckRadius; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < imgWidth && ny >= 0 && ny < imgHeight) {
              const nmx = Math.floor(nx * maskScaleX);
              const nmy = Math.floor(ny * maskScaleY);
              const nmaskIdx = nmy * maskWidth + nmx;
              if (wallMask[nmaskIdx] > 0) wallNeighbors++;
              totalNeighbors++;
            }
          }
        }

        if (totalNeighbors > 0) {
          edgeFactor = wallNeighbors / totalNeighbors;
        }

        // Final blend factor
        const finalBlend = blendOpacity * edgeFactor;

        // Blend texture with original
        pixels[pixelIndex] = Math.round(
          texR * shadeFactor * finalBlend +
            originalPixels[pixelIndex] * (1 - finalBlend)
        );
        pixels[pixelIndex + 1] = Math.round(
          texG * shadeFactor * finalBlend +
            originalPixels[pixelIndex + 1] * (1 - finalBlend)
        );
        pixels[pixelIndex + 2] = Math.round(
          texB * shadeFactor * finalBlend +
            originalPixels[pixelIndex + 2] * (1 - finalBlend)
        );
      }
      // Non-wall pixels keep their original color
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}
