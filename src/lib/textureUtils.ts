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
export function createGradientTexture(colors: string[], width = 256, height = 256): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

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
        console.warn(`Failed to load texture ${textureUrl}, using gradient fallback`);
        textureSource = createGradientTexture(fallbackColors);
    }

    // Create output canvas matching the original dimensions
    const canvas = document.createElement('canvas');
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    const ctx = canvas.getContext('2d')!;

    // Calculate scale factor between polygon canvas and original image
    const scaleX = originalImage.width / canvasWidth;
    const scaleY = originalImage.height / canvasHeight;

    // Scale polygon points to match original image dimensions
    const scaledPoints = points.map(p => ({
        x: p.x * scaleX,
        y: p.y * scaleY
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
    const pattern = ctx.createPattern(textureSource, 'repeat');
    if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Restore context state
    ctx.restore();

    return canvas.toDataURL('image/png');
}
