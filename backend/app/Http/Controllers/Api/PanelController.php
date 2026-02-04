<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StorePanelRequest;
use App\Http\Requests\UpdatePanelRequest;
use App\Models\Panel;
use App\Models\Category;
use App\Services\ImageUploadService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PanelController extends Controller
{
    protected ImageUploadService $imageService;

    public function __construct(ImageUploadService $imageService)
    {
        $this->imageService = $imageService;
    }

    /**
     * Display a listing of active panels (Public endpoint).
     */
    public function index(Request $request): JsonResponse
    {
        $query = Panel::with('category')
            ->active()
            ->ordered();

        // Filter by category
        if ($request->has('category') && $request->category !== 'all') {
            $query->inCategory($request->category);
        }

        // Search by name or description
        if ($request->has('search') && $request->search) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('name', 'ilike', "%{$search}%")
                  ->orWhere('description', 'ilike', "%{$search}%")
                  ->orWhere('material', 'ilike', "%{$search}%");
            });
        }

        // Sort options
        if ($request->has('sort')) {
            $direction = $request->get('order', 'asc');
            switch ($request->sort) {
                case 'name':
                    $query->reorder('name', $direction);
                    break;
                case 'price':
                    $query->reorder('price', $direction);
                    break;
                case 'newest':
                    $query->reorder('created_at', 'desc');
                    break;
                default:
                    // Keep default ordering
                    break;
            }
        }

        $panels = $query->get();

        // Get all categories for the meta response
        $categories = Category::ordered()->pluck('name')->toArray();

        return response()->json([
            'data' => $panels->map(fn($panel) => $panel->toApiResponse()),
            'meta' => [
                'total' => $panels->count(),
                'categories' => array_merge(['All'], $categories),
            ],
        ]);
    }

    /**
     * Display the specified panel (Public endpoint).
     */
    public function show(string $slug): JsonResponse
    {
        $panel = Panel::with('category')
            ->where('slug', $slug)
            ->active()
            ->first();

        if (!$panel) {
            return response()->json([
                'error' => 'Panel not found',
                'message' => 'The requested panel does not exist or is not active.',
            ], 404);
        }

        return response()->json([
            'data' => $panel->toApiResponse(),
        ]);
    }

    /**
     * Display a listing of all panels including inactive (Admin endpoint).
     */
    public function adminIndex(Request $request): JsonResponse
    {
        $query = Panel::with('category')->ordered();

        // Optional: filter by active status
        if ($request->has('active')) {
            $query->where('is_active', $request->boolean('active'));
        }

        // Filter by category
        if ($request->has('category_id')) {
            $query->where('category_id', $request->category_id);
        }

        $panels = $query->get();

        return response()->json([
            'data' => $panels->map(function ($panel) {
                return [
                    'id' => $panel->id,
                    'slug' => $panel->slug,
                    'name' => $panel->name,
                    'description' => $panel->description,
                    'category_id' => $panel->category_id,
                    'category' => $panel->category?->name,
                    'image_url' => $panel->image_url,
                    'texture_url' => $panel->texture_url,
                    'colors' => $panel->colors,
                    'material' => $panel->material,
                    'price' => $panel->price,
                    'sort_order' => $panel->sort_order,
                    'is_active' => $panel->is_active,
                    'created_at' => $panel->created_at,
                    'updated_at' => $panel->updated_at,
                    'impressions_count' => $panel->impressions_count,
                    'selections_count' => $panel->selections_count,
                    'visualizations_count' => $panel->visualizations_count,
                ];
            }),
            'meta' => [
                'total' => $panels->count(),
            ],
        ]);
    }

    /**
     * Display the specified panel (Admin endpoint).
     */
    public function adminShow(Panel $panel): JsonResponse
    {
        $panel->load('category');

        return response()->json([
            'data' => [
                'id' => $panel->id,
                'slug' => $panel->slug,
                'name' => $panel->name,
                'description' => $panel->description,
                'category_id' => $panel->category_id,
                'category' => $panel->category?->name,
                'image_url' => $panel->image_url,
                'texture_url' => $panel->texture_url,
                'colors' => $panel->colors,
                'material' => $panel->material,
                'price' => $panel->price,
                'sort_order' => $panel->sort_order,
                'is_active' => $panel->is_active,
                'created_at' => $panel->created_at,
                'updated_at' => $panel->updated_at,
                'impressions_count' => $panel->impressions_count,
                'selections_count' => $panel->selections_count,
                'visualizations_count' => $panel->visualizations_count,
            ],
        ]);
    }

    /**
     * Store a newly created panel (Admin endpoint).
     */
    public function store(StorePanelRequest $request): JsonResponse
    {
        $data = $request->validated();

        // Set defaults
        $data['sort_order'] = $data['sort_order'] ?? 0;
        $data['is_active'] = $data['is_active'] ?? true;

        $panel = Panel::create($data);
        $panel->load('category');

        return response()->json([
            'message' => 'Panel created successfully.',
            'data' => [
                'id' => $panel->id,
                'slug' => $panel->slug,
                'name' => $panel->name,
            ],
        ], 201);
    }

    /**
     * Update the specified panel (Admin endpoint).
     */
    public function update(UpdatePanelRequest $request, Panel $panel): JsonResponse
    {
        $data = $request->validated();

        $panel->update($data);
        $panel->load('category');

        return response()->json([
            'message' => 'Panel updated successfully.',
            'data' => [
                'id' => $panel->id,
                'slug' => $panel->slug,
                'name' => $panel->name,
            ],
        ]);
    }

    /**
     * Remove the specified panel (Admin endpoint).
     */
    public function destroy(Panel $panel): JsonResponse
    {
        // Delete associated images
        $this->imageService->delete($panel->image_url);
        $this->imageService->delete($panel->texture_url);

        $panel->delete();

        return response()->json([
            'message' => 'Panel deleted successfully.',
        ]);
    }

    /**
     * Upload an image for the panel (Admin endpoint).
     */
    public function uploadImage(Request $request, Panel $panel): JsonResponse
    {
        $request->validate([
            'image' => 'required|file|mimes:jpeg,jpg,png,webp|max:' . $this->imageService->getMaxFileSizeBytes() / 1024,
        ]);

        $result = $this->imageService->upload(
            $request->file('image'),
            'image',
            $panel->image_url
        );

        if (!$result['success']) {
            return response()->json([
                'error' => 'Upload failed',
                'message' => $result['error'],
            ], 422);
        }

        $panel->update(['image_url' => $result['url']]);

        return response()->json([
            'message' => 'Image uploaded successfully.',
            'data' => [
                'image_url' => $result['url'],
            ],
        ]);
    }

    /**
     * Upload a texture for the panel (Admin endpoint).
     */
    public function uploadTexture(Request $request, Panel $panel): JsonResponse
    {
        $request->validate([
            'texture' => 'required|file|mimes:jpeg,jpg,png,webp|max:' . $this->imageService->getMaxFileSizeBytes() / 1024,
        ]);

        $result = $this->imageService->upload(
            $request->file('texture'),
            'texture',
            $panel->texture_url
        );

        if (!$result['success']) {
            return response()->json([
                'error' => 'Upload failed',
                'message' => $result['error'],
            ], 422);
        }

        $panel->update(['texture_url' => $result['url']]);

        return response()->json([
            'message' => 'Texture uploaded successfully.',
            'data' => [
                'texture_url' => $result['url'],
            ],
        ]);
    }

    /**
     * Reorder panels (Admin endpoint).
     */
    public function reorder(Request $request): JsonResponse
    {
        $request->validate([
            'panels' => 'required|array',
            'panels.*.id' => 'required|exists:panels,id',
            'panels.*.sort_order' => 'required|integer|min:0',
        ]);

        foreach ($request->panels as $item) {
            Panel::where('id', $item['id'])->update(['sort_order' => $item['sort_order']]);
        }

        return response()->json([
            'message' => 'Panels reordered successfully.',
        ]);
    }
}
