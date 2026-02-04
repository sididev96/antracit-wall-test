<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ImageUploadService
{
    /**
     * Max file size in kilobytes (25MB = 25600KB)
     */
    protected int $maxFileSize;

    /**
     * Allowed image mime types.
     */
    protected array $allowedMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
    ];

    /**
     * Allowed file extensions.
     */
    protected array $allowedExtensions = [
        'jpg',
        'jpeg',
        'png',
        'webp',
    ];

    public function __construct()
    {
        // 25MB in kilobytes
        $this->maxFileSize = (int) env('MAX_PANEL_IMAGE_SIZE', 25600);
    }

    /**
     * Upload a panel image.
     *
     * @param UploadedFile $file
     * @param string $type 'image' or 'texture'
     * @param string|null $existingPath Path to existing file to delete
     * @return array{success: bool, path?: string, url?: string, error?: string}
     */
    public function upload(UploadedFile $file, string $type = 'image', ?string $existingPath = null): array
    {
        // Validate file size
        if ($file->getSize() > $this->maxFileSize * 1024) {
            return [
                'success' => false,
                'error' => "File size exceeds maximum allowed size of " . ($this->maxFileSize / 1024) . "MB.",
            ];
        }

        // Validate mime type
        if (!in_array($file->getMimeType(), $this->allowedMimeTypes)) {
            return [
                'success' => false,
                'error' => 'Invalid file type. Allowed types: ' . implode(', ', $this->allowedExtensions),
            ];
        }

        // Validate extension
        $extension = strtolower($file->getClientOriginalExtension());
        if (!in_array($extension, $this->allowedExtensions)) {
            return [
                'success' => false,
                'error' => 'Invalid file extension. Allowed extensions: ' . implode(', ', $this->allowedExtensions),
            ];
        }

        // Generate unique filename
        $filename = $this->generateFilename($file, $type);

        // Delete existing file if provided
        if ($existingPath) {
            $this->delete($existingPath);
        }

        try {
            // Store the file
            $path = $file->storeAs('panels', $filename, 'public');

            return [
                'success' => true,
                'path' => $path,
                'url' => '/storage/' . $path,
            ];
        } catch (\Exception $e) {
            return [
                'success' => false,
                'error' => 'Failed to upload file: ' . $e->getMessage(),
            ];
        }
    }

    /**
     * Delete an image from storage.
     */
    public function delete(?string $path): bool
    {
        if (!$path) {
            return true;
        }

        // Remove /storage/ prefix if present
        $path = str_replace('/storage/', '', $path);

        if (Storage::disk('public')->exists($path)) {
            return Storage::disk('public')->delete($path);
        }

        return true;
    }

    /**
     * Generate a unique filename for the upload.
     */
    protected function generateFilename(UploadedFile $file, string $type): string
    {
        $extension = strtolower($file->getClientOriginalExtension());
        $timestamp = now()->format('Ymd_His');
        $random = Str::random(8);

        return "{$type}_{$timestamp}_{$random}.{$extension}";
    }

    /**
     * Get max file size in bytes.
     */
    public function getMaxFileSizeBytes(): int
    {
        return $this->maxFileSize * 1024;
    }

    /**
     * Get max file size in MB.
     */
    public function getMaxFileSizeMB(): float
    {
        return $this->maxFileSize / 1024;
    }

    /**
     * Get allowed extensions.
     */
    public function getAllowedExtensions(): array
    {
        return $this->allowedExtensions;
    }
}
