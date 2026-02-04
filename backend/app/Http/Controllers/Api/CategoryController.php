<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class CategoryController extends Controller
{
    /**
     * Display a listing of categories (Public endpoint).
     */
    public function index(): JsonResponse
    {
        $categories = Category::ordered()->get();

        return response()->json([
            'data' => $categories->map(fn($category) => [
                'id' => $category->id,
                'name' => $category->name,
                'slug' => $category->slug,
                'description' => $category->description,
                'panel_count' => $category->active_panel_count,
            ]),
        ]);
    }

    /**
     * Display a listing of categories with full details (Admin endpoint).
     */
    public function adminIndex(): JsonResponse
    {
        $categories = Category::withCount('panels')->ordered()->get();

        return response()->json([
            'data' => $categories->map(fn($category) => [
                'id' => $category->id,
                'name' => $category->name,
                'slug' => $category->slug,
                'description' => $category->description,
                'sort_order' => $category->sort_order,
                'panels_count' => $category->panels_count,
                'created_at' => $category->created_at,
                'updated_at' => $category->updated_at,
            ]),
            'meta' => [
                'total' => $categories->count(),
            ],
        ]);
    }

    /**
     * Store a newly created category (Admin endpoint).
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:100|unique:categories,name',
            'slug' => [
                'nullable',
                'string',
                'max:100',
                'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/',
                'unique:categories,slug',
            ],
            'description' => 'nullable|string',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        // Generate slug from name if not provided
        $validated['slug'] = $validated['slug'] ?? Str::slug($validated['name']);
        $validated['sort_order'] = $validated['sort_order'] ?? 0;

        $category = Category::create($validated);

        return response()->json([
            'message' => 'Category created successfully.',
            'data' => [
                'id' => $category->id,
                'name' => $category->name,
                'slug' => $category->slug,
            ],
        ], 201);
    }

    /**
     * Display the specified category (Admin endpoint).
     */
    public function show(Category $category): JsonResponse
    {
        $category->loadCount('panels');

        return response()->json([
            'data' => [
                'id' => $category->id,
                'name' => $category->name,
                'slug' => $category->slug,
                'description' => $category->description,
                'sort_order' => $category->sort_order,
                'panels_count' => $category->panels_count,
                'created_at' => $category->created_at,
                'updated_at' => $category->updated_at,
            ],
        ]);
    }

    /**
     * Update the specified category (Admin endpoint).
     */
    public function update(Request $request, Category $category): JsonResponse
    {
        $validated = $request->validate([
            'name' => [
                'sometimes',
                'string',
                'max:100',
                Rule::unique('categories', 'name')->ignore($category->id),
            ],
            'slug' => [
                'sometimes',
                'string',
                'max:100',
                'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/',
                Rule::unique('categories', 'slug')->ignore($category->id),
            ],
            'description' => 'nullable|string',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        $category->update($validated);

        return response()->json([
            'message' => 'Category updated successfully.',
            'data' => [
                'id' => $category->id,
                'name' => $category->name,
                'slug' => $category->slug,
            ],
        ]);
    }

    /**
     * Remove the specified category (Admin endpoint).
     */
    public function destroy(Category $category): JsonResponse
    {
        // Check if category has panels
        if ($category->panels()->count() > 0) {
            return response()->json([
                'error' => 'Category not empty',
                'message' => 'Cannot delete a category that has panels. Move or delete the panels first.',
            ], 422);
        }

        $category->delete();

        return response()->json([
            'message' => 'Category deleted successfully.',
        ]);
    }

    /**
     * Reorder categories (Admin endpoint).
     */
    public function reorder(Request $request): JsonResponse
    {
        $request->validate([
            'categories' => 'required|array',
            'categories.*.id' => 'required|exists:categories,id',
            'categories.*.sort_order' => 'required|integer|min:0',
        ]);

        foreach ($request->categories as $item) {
            Category::where('id', $item['id'])->update(['sort_order' => $item['sort_order']]);
        }

        return response()->json([
            'message' => 'Categories reordered successfully.',
        ]);
    }
}
