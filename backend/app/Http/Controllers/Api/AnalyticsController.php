<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Panel;
use App\Models\PanelEvent;
use App\Services\AnalyticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AnalyticsController extends Controller
{
    protected AnalyticsService $analyticsService;

    public function __construct(AnalyticsService $analyticsService)
    {
        $this->analyticsService = $analyticsService;
    }

    /**
     * Track an analytics event (Public endpoint).
     */
    public function trackEvent(Request $request, string $slug): JsonResponse
    {
        $validated = $request->validate([
            'event_type' => 'required|in:impression,selection,visualization',
            'session_id' => 'nullable|string|max:100',
            'metadata' => 'nullable|array',
        ]);

        $panel = Panel::where('slug', $slug)->first();

        if (!$panel) {
            return response()->json([
                'error' => 'Panel not found',
                'message' => 'The specified panel does not exist.',
            ], 404);
        }

        PanelEvent::create([
            'panel_id' => $panel->id,
            'event_type' => $validated['event_type'],
            'session_id' => $validated['session_id'] ?? null,
            'metadata' => $validated['metadata'] ?? null,
        ]);

        return response()->json([
            'message' => 'Event tracked successfully.',
        ], 201);
    }

    /**
     * Get analytics overview (Admin endpoint).
     */
    public function overview(Request $request): JsonResponse
    {
        $days = $request->input('days', 30);

        $data = $this->analyticsService->getOverview($days);

        return response()->json([
            'data' => $data,
        ]);
    }

    /**
     * Get per-panel statistics (Admin endpoint).
     */
    public function panels(Request $request): JsonResponse
    {
        $days = $request->input('days', 30);

        $data = $this->analyticsService->getPanelStats($days);

        return response()->json($data);
    }

    /**
     * Get event log (Admin endpoint).
     */
    public function events(Request $request): JsonResponse
    {
        $filters = [
            'panel_id' => $request->input('panel_id'),
            'event_type' => $request->input('event_type'),
            'start_date' => $request->input('start_date'),
            'end_date' => $request->input('end_date'),
        ];

        $perPage = $request->input('per_page', 50);

        $data = $this->analyticsService->getEventLog($filters, $perPage);

        return response()->json($data);
    }
}
