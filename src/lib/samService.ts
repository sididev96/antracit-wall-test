/**
 * SAM (Segment Anything Model) Service
 * Uses @huggingface/transformers for browser-based image segmentation
 */
import { SamModel, AutoProcessor, RawImage, type Tensor } from '@huggingface/transformers';

interface Point {
    x: number;
    y: number;
}

// Cached model and processor
let model: SamModel | null = null;
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;
let isInitializing = false;

/**
 * Initialize SAM model and processor
 * Downloads and caches the model files from Hugging Face
 */
export async function initializeSAM(): Promise<void> {
    if (model && processor) {
        return; // Already initialized
    }

    if (isInitializing) {
        // Wait for initialization to complete
        while (isInitializing) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return;
    }

    isInitializing = true;

    try {
        console.log('[SAM] Loading model and processor...');
        
        // Load model and processor from Hugging Face
        // Using the quantized model for faster loading in browser
        const modelId = 'Xenova/sam-vit-base';
        
        [model, processor] = await Promise.all([
            SamModel.from_pretrained(modelId, {
                progress_callback: (progress: { status: string; file?: string; progress?: number }) => {
                    if (progress.progress !== undefined) {
                        console.log(`[SAM] Loading ${progress.file}: ${Math.round(progress.progress)}%`);
                    }
                }
            }),
            AutoProcessor.from_pretrained(modelId)
        ]);

        console.log('[SAM] Model loaded successfully');
    } catch (error) {
        console.error('[SAM] Failed to load model:', error);
        model = null;
        processor = null;
        throw new Error('Failed to load SAM model. Please try again.');
    } finally {
        isInitializing = false;
    }
}

/**
 * Generate image embedding and return processor context
 * This prepares the image for mask prediction
 */
export async function generateEmbedding(imageUrl: string): Promise<{
    rawImage: RawImage;
    imageSize: { width: number; height: number };
}> {
    if (!model || !processor) {
        throw new Error('SAM not initialized. Call initializeSAM() first.');
    }

    console.log('[SAM] Loading image...');
    const rawImage = await RawImage.read(imageUrl);
    
    return {
        rawImage,
        imageSize: { width: rawImage.width, height: rawImage.height },
    };
}

/**
 * Predict mask using SAM
 * @param rawImage - The raw image loaded from generateEmbedding
 * @param points - Click points in original image coordinates
 * @param labels - Point labels (1 = foreground, 0 = background)
 * @param imageSize - Original image size
 */
export async function predictMask(
    rawImage: RawImage,
    points: Point[],
    labels: number[],
    imageSize: { width: number; height: number }
): Promise<ImageData> {
    if (!model || !processor) {
        throw new Error('SAM not initialized. Call initializeSAM() first.');
    }

    console.log('[SAM] Processing inputs...');
    
    // Format input points as required by the processor: [[[x1, y1], [x2, y2], ...]]
    const input_points = [points.map(p => [p.x, p.y])];
    const input_labels = [labels];
    
    // Process inputs
    const inputs = await processor(rawImage, { 
        input_points,
        input_labels
    });

    console.log('[SAM] Running inference...');
    const startTime = performance.now();
    
    // Run model
    const outputs = await model(inputs);
    
    console.log(`[SAM] Inference completed in ${(performance.now() - startTime).toFixed(0)}ms`);

    // Post-process masks
    const masks = await processor.post_process_masks(
        outputs.pred_masks,
        inputs.original_sizes,
        inputs.reshaped_input_sizes
    );

    // Get the mask tensor - select the best mask (highest IoU score)
    const maskTensor = masks[0]; // Shape: [1, 3, height, width]
    const scores = outputs.iou_scores.data as Float32Array;
    
    // Find the mask with the highest score
    let bestMaskIdx = 0;
    let bestScore = scores[0];
    for (let i = 1; i < scores.length; i++) {
        if (scores[i] > bestScore) {
            bestScore = scores[i];
            bestMaskIdx = i;
        }
    }
    
    console.log(`[SAM] Best mask index: ${bestMaskIdx}, score: ${bestScore.toFixed(4)}`);

    // Convert mask tensor to ImageData
    const maskData = maskTensor.data as Uint8Array;
    const height = maskTensor.dims[2];
    const width = maskTensor.dims[3];
    
    // Create output ImageData
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const outputImageData = ctx.createImageData(width, height);
    
    // Extract the best mask channel
    const channelOffset = bestMaskIdx * width * height;
    for (let i = 0; i < width * height; i++) {
        const maskValue = maskData[channelOffset + i] ? 255 : 0;
        const pixelIdx = i * 4;
        outputImageData.data[pixelIdx] = maskValue;
        outputImageData.data[pixelIdx + 1] = maskValue;
        outputImageData.data[pixelIdx + 2] = maskValue;
        outputImageData.data[pixelIdx + 3] = 255;
    }

    return outputImageData;
}

/**
 * Convert binary mask to polygon points using contour tracing
 */
export function maskToPolygon(mask: ImageData, simplifyTolerance: number = 2): Point[] {
    const { width, height, data } = mask;

    // Find boundary points
    const boundaryPoints: Point[] = [];

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            if (data[idx] > 128) {
                // Check if it's a boundary pixel (has at least one non-mask neighbor)
                const neighbors = [
                    data[((y - 1) * width + x) * 4],
                    data[((y + 1) * width + x) * 4],
                    data[(y * width + x - 1) * 4],
                    data[(y * width + x + 1) * 4],
                ];

                if (neighbors.some(n => n <= 128)) {
                    boundaryPoints.push({ x, y });
                }
            }
        }
    }

    if (boundaryPoints.length < 3) {
        return [];
    }

    // Order points to form a contour
    const orderedPoints = orderBoundaryPoints(boundaryPoints);

    // Simplify polygon using Ramer-Douglas-Peucker algorithm
    const simplified = simplifyPolygon(orderedPoints, simplifyTolerance);

    return simplified;
}

/**
 * Order boundary points to form a closed contour
 */
function orderBoundaryPoints(points: Point[]): Point[] {
    if (points.length === 0) return [];

    // Find centroid
    const centroid = {
        x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };

    // Sort points by angle from centroid
    return [...points].sort((a, b) => {
        const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
        const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
        return angleA - angleB;
    });
}

/**
 * Simplify polygon using Ramer-Douglas-Peucker algorithm
 */
function simplifyPolygon(points: Point[], tolerance: number): Point[] {
    if (points.length <= 2) return points;

    // Find the point with the maximum distance from the line between first and last
    let maxDist = 0;
    let maxIdx = 0;

    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIdx = i;
        }
    }

    // If max distance is greater than tolerance, recursively simplify
    if (maxDist > tolerance) {
        const left = simplifyPolygon(points.slice(0, maxIdx + 1), tolerance);
        const right = simplifyPolygon(points.slice(maxIdx), tolerance);
        return [...left.slice(0, -1), ...right];
    }

    return [first, last];
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;

    if (dx === 0 && dy === 0) {
        return Math.sqrt(Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2));
    }

    const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
    const nearestX = lineStart.x + t * dx;
    const nearestY = lineStart.y + t * dy;

    return Math.sqrt(Math.pow(point.x - nearestX, 2) + Math.pow(point.y - nearestY, 2));
}

/**
 * Check if SAM is initialized
 */
export function isSAMInitialized(): boolean {
    return model !== null && processor !== null;
}
