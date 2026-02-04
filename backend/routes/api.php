<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\PanelController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\AnalyticsController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application.
|
*/

// Public endpoints - no authentication required
Route::prefix('v1')->group(function () {
    // Panel listing and details
    Route::get('/panels', [PanelController::class, 'index']);
    Route::get('/panels/{slug}', [PanelController::class, 'show']);

    // Category listing
    Route::get('/categories', [CategoryController::class, 'index']);

    // Analytics event tracking
    Route::post('/panels/{slug}/events', [AnalyticsController::class, 'trackEvent']);
});

// Authentication endpoints
Route::prefix('v1/auth')->group(function () {
    Route::post('/login', [AuthController::class, 'login']);

    Route::middleware('jwt.auth')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::post('/refresh', [AuthController::class, 'refresh']);
        Route::get('/me', [AuthController::class, 'me']);
    });
});

// Admin endpoints - authentication required
Route::prefix('v1/admin')->middleware('jwt.auth')->group(function () {
    // Panel management
    Route::get('/panels', [PanelController::class, 'adminIndex']);
    Route::post('/panels', [PanelController::class, 'store']);
    Route::get('/panels/{panel}', [PanelController::class, 'adminShow']);
    Route::put('/panels/{panel}', [PanelController::class, 'update']);
    Route::delete('/panels/{panel}', [PanelController::class, 'destroy']);
    Route::post('/panels/reorder', [PanelController::class, 'reorder']);
    Route::post('/panels/{panel}/upload-image', [PanelController::class, 'uploadImage']);
    Route::post('/panels/{panel}/upload-texture', [PanelController::class, 'uploadTexture']);

    // Category management
    Route::get('/categories', [CategoryController::class, 'adminIndex']);
    Route::post('/categories', [CategoryController::class, 'store']);
    Route::get('/categories/{category}', [CategoryController::class, 'show']);
    Route::put('/categories/{category}', [CategoryController::class, 'update']);
    Route::delete('/categories/{category}', [CategoryController::class, 'destroy']);
    Route::post('/categories/reorder', [CategoryController::class, 'reorder']);

    // Analytics
    Route::get('/analytics/overview', [AnalyticsController::class, 'overview']);
    Route::get('/analytics/panels', [AnalyticsController::class, 'panels']);
    Route::get('/analytics/events', [AnalyticsController::class, 'events']);
});
