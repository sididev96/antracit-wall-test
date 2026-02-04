<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Panel extends Model
{
    use HasFactory;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'slug',
        'name',
        'description',
        'category_id',
        'image_url',
        'texture_url',
        'colors',
        'material',
        'price',
        'sort_order',
        'is_active',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'colors' => 'array',
            'sort_order' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    /**
     * Get the route key for the model.
     */
    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    /**
     * Get the category that owns the panel.
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    /**
     * Get the events for the panel.
     */
    public function events(): HasMany
    {
        return $this->hasMany(PanelEvent::class);
    }

    /**
     * Scope a query to only include active panels.
     */
    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    /**
     * Scope a query to order by sort_order.
     */
    public function scopeOrdered($query)
    {
        return $query->orderBy('sort_order')->orderBy('name');
    }

    /**
     * Scope a query to filter by category slug.
     */
    public function scopeInCategory($query, string $categorySlug)
    {
        return $query->whereHas('category', function ($q) use ($categorySlug) {
            $q->where('slug', $categorySlug);
        });
    }

    /**
     * Get the impressions count.
     */
    public function getImpressionsCountAttribute(): int
    {
        return $this->events()->where('event_type', 'impression')->count();
    }

    /**
     * Get the selections count.
     */
    public function getSelectionsCountAttribute(): int
    {
        return $this->events()->where('event_type', 'selection')->count();
    }

    /**
     * Get the visualizations count.
     */
    public function getVisualizationsCountAttribute(): int
    {
        return $this->events()->where('event_type', 'visualization')->count();
    }

    /**
     * Transform to API response format (matching frontend WallPanel interface).
     */
    public function toApiResponse(): array
    {
        return [
            'id' => $this->slug,
            'name' => $this->name,
            'description' => $this->description,
            'category' => $this->category?->name ?? 'Uncategorized',
            'imageUrl' => $this->image_url,
            'textureUrl' => $this->texture_url,
            'colors' => $this->colors ?? [],
            'material' => $this->material,
            'price' => $this->price,
        ];
    }
}
