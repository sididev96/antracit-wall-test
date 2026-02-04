<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Category;
use App\Models\Panel;
use Illuminate\Support\Str;

class PanelSeeder extends Seeder
{
    /**
     * Run the database seeds.
     *
     * This migrates the existing hardcoded panels from the frontend
     * to the database.
     */
    public function run(): void
    {
        // Create the Premium category
        $premiumCategory = Category::firstOrCreate(
            ['slug' => 'premium'],
            [
                'name' => 'Premium',
                'description' => 'Premium quality wall panels with superior finishes.',
                'sort_order' => 0,
            ]
        );

        // Create additional categories
        $standardCategory = Category::firstOrCreate(
            ['slug' => 'standard'],
            [
                'name' => 'Standard',
                'description' => 'Standard wall panels for everyday use.',
                'sort_order' => 1,
            ]
        );

        $woodCategory = Category::firstOrCreate(
            ['slug' => 'wood'],
            [
                'name' => 'Wood',
                'description' => 'Natural wood finish wall panels.',
                'sort_order' => 2,
            ]
        );

        $stoneCategory = Category::firstOrCreate(
            ['slug' => 'stone'],
            [
                'name' => 'Stone',
                'description' => 'Stone and marble finish wall panels.',
                'sort_order' => 3,
            ]
        );

        $this->command->info('Categories created.');

        // Migrate existing panels from samplePanels.ts
        $existingPanels = [
            [
                'slug' => 'anthracite-classic',
                'name' => 'Anthracite Classic',
                'description' => 'Elegant anthracite panel with a modern matte finish, perfect for contemporary spaces.',
                'category_id' => $premiumCategory->id,
                'image_url' => '/panels/panel.png',
                'texture_url' => '/panels/panel.png',
                'colors' => ['#3D3D3D', '#2B2B2B', '#4A4A4A'],
                'material' => 'Anthracite',
                'price' => '$125/m²',
                'sort_order' => 0,
                'is_active' => true,
            ],
            [
                'slug' => 'anthracite-textured',
                'name' => 'Anthracite Textured',
                'description' => 'Sophisticated textured anthracite panel with subtle depth variations for visual interest.',
                'category_id' => $premiumCategory->id,
                'image_url' => '/panels/panel2.png',
                'texture_url' => '/panels/panel2.png',
                'colors' => ['#454545', '#333333', '#555555'],
                'material' => 'Anthracite',
                'price' => '$135/m²',
                'sort_order' => 1,
                'is_active' => true,
            ],
        ];

        // Additional panels from the public/panels directory
        $additionalPanels = [
            [
                'slug' => 'oak-natural',
                'name' => 'Oak Natural',
                'description' => 'Beautiful natural oak wood panel with authentic grain patterns.',
                'category_id' => $woodCategory->id,
                'image_url' => '/panels/oak-natural.png',
                'texture_url' => '/panels/oak-natural.png',
                'colors' => ['#C4A35A', '#8B7355', '#D4B896'],
                'material' => 'Oak Wood',
                'price' => '$145/m²',
                'sort_order' => 0,
                'is_active' => true,
            ],
            [
                'slug' => 'walnut-dark',
                'name' => 'Walnut Dark',
                'description' => 'Rich dark walnut panel with luxurious deep tones.',
                'category_id' => $woodCategory->id,
                'image_url' => '/panels/walnut-dark.png',
                'texture_url' => '/panels/walnut-dark.png',
                'colors' => ['#4A3728', '#3D2914', '#5C4033'],
                'material' => 'Walnut Wood',
                'price' => '$155/m²',
                'sort_order' => 1,
                'is_active' => true,
            ],
            [
                'slug' => 'marble-white',
                'name' => 'Marble White',
                'description' => 'Elegant white marble panel with subtle gray veining.',
                'category_id' => $stoneCategory->id,
                'image_url' => '/panels/marble-white.png',
                'texture_url' => '/panels/marble-white.png',
                'colors' => ['#F5F5F5', '#E8E8E8', '#CCCCCC'],
                'material' => 'Marble',
                'price' => '$175/m²',
                'sort_order' => 0,
                'is_active' => true,
            ],
            [
                'slug' => 'slate-charcoal',
                'name' => 'Slate Charcoal',
                'description' => 'Modern charcoal slate panel with natural texture.',
                'category_id' => $stoneCategory->id,
                'image_url' => '/panels/slate-charcoal.png',
                'texture_url' => '/panels/slate-charcoal.png',
                'colors' => ['#2F4F4F', '#3D3D3D', '#4A4A4A'],
                'material' => 'Slate',
                'price' => '$165/m²',
                'sort_order' => 1,
                'is_active' => true,
            ],
            [
                'slug' => 'concrete-gray',
                'name' => 'Concrete Gray',
                'description' => 'Industrial concrete panel with urban appeal.',
                'category_id' => $standardCategory->id,
                'image_url' => '/panels/concrete-gray.png',
                'texture_url' => '/panels/concrete-gray.png',
                'colors' => ['#808080', '#696969', '#A9A9A9'],
                'material' => 'Concrete',
                'price' => '$95/m²',
                'sort_order' => 0,
                'is_active' => true,
            ],
            [
                'slug' => 'brick-rustic',
                'name' => 'Brick Rustic',
                'description' => 'Classic rustic brick panel for traditional spaces.',
                'category_id' => $standardCategory->id,
                'image_url' => '/panels/brick-rustic.png',
                'texture_url' => '/panels/brick-rustic.png',
                'colors' => ['#8B4513', '#A0522D', '#CD853F'],
                'material' => 'Brick',
                'price' => '$85/m²',
                'sort_order' => 1,
                'is_active' => true,
            ],
        ];

        $allPanels = array_merge($existingPanels, $additionalPanels);

        foreach ($allPanels as $panelData) {
            Panel::updateOrCreate(
                ['slug' => $panelData['slug']],
                $panelData
            );
        }

        $this->command->info('Panels created/updated: ' . count($allPanels));
    }
}
