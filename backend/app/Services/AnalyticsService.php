<?php

namespace App\Services;

use App\Models\Panel;
use App\Models\PanelEvent;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class AnalyticsService
{
    /**
     * Get overview statistics.
     */
    public function getOverview(int $days = 30): array
    {
        $startDate = Carbon::now()->subDays($days);

        $totalPanels = Panel::count();
        $activePanels = Panel::active()->count();

        // Get event counts
        $eventCounts = PanelEvent::query()
            ->where('created_at', '>=', $startDate)
            ->select('event_type', DB::raw('count(*) as count'))
            ->groupBy('event_type')
            ->pluck('count', 'event_type')
            ->toArray();

        // Get top panels
        $topPanels = Panel::query()
            ->select('panels.*')
            ->leftJoin('panel_events', 'panels.id', '=', 'panel_events.panel_id')
            ->where(function ($q) use ($startDate) {
                $q->where('panel_events.created_at', '>=', $startDate)
                  ->orWhereNull('panel_events.created_at');
            })
            ->groupBy('panels.id')
            ->orderByRaw('count(panel_events.id) desc')
            ->limit(5)
            ->get()
            ->map(fn($panel) => [
                'id' => $panel->slug,
                'name' => $panel->name,
                'total_events' => $panel->events()->where('created_at', '>=', $startDate)->count(),
            ]);

        // Get daily event counts for chart
        $dailyEvents = PanelEvent::query()
            ->where('created_at', '>=', $startDate)
            ->select(
                DB::raw("DATE(created_at) as date"),
                'event_type',
                DB::raw('count(*) as count')
            )
            ->groupBy(DB::raw("DATE(created_at)"), 'event_type')
            ->orderBy('date')
            ->get()
            ->groupBy('date')
            ->map(function ($events) {
                $result = [
                    'date' => $events->first()->date,
                    'impressions' => 0,
                    'selections' => 0,
                    'visualizations' => 0,
                ];
                foreach ($events as $event) {
                    $result[$event->event_type . 's'] = $event->count;
                }
                return $result;
            })
            ->values();

        return [
            'total_panels' => $totalPanels,
            'active_panels' => $activePanels,
            'total_impressions' => $eventCounts['impression'] ?? 0,
            'total_selections' => $eventCounts['selection'] ?? 0,
            'total_visualizations' => $eventCounts['visualization'] ?? 0,
            'top_panels' => $topPanels,
            'daily_events' => $dailyEvents,
            'period_days' => $days,
        ];
    }

    /**
     * Get per-panel statistics.
     */
    public function getPanelStats(int $days = 30): array
    {
        $startDate = Carbon::now()->subDays($days);

        $panels = Panel::with('category')
            ->get()
            ->map(function ($panel) use ($startDate) {
                $events = $panel->events()
                    ->where('created_at', '>=', $startDate)
                    ->select('event_type', DB::raw('count(*) as count'))
                    ->groupBy('event_type')
                    ->pluck('count', 'event_type')
                    ->toArray();

                return [
                    'id' => $panel->id,
                    'slug' => $panel->slug,
                    'name' => $panel->name,
                    'category' => $panel->category?->name ?? 'Uncategorized',
                    'is_active' => $panel->is_active,
                    'impressions' => $events['impression'] ?? 0,
                    'selections' => $events['selection'] ?? 0,
                    'visualizations' => $events['visualization'] ?? 0,
                    'conversion_rate' => $this->calculateConversionRate(
                        $events['impression'] ?? 0,
                        $events['visualization'] ?? 0
                    ),
                ];
            })
            ->sortByDesc('impressions')
            ->values();

        return [
            'data' => $panels,
            'period_days' => $days,
        ];
    }

    /**
     * Get event log with pagination.
     */
    public function getEventLog(array $filters = [], int $perPage = 50): array
    {
        $query = PanelEvent::with('panel')
            ->orderBy('created_at', 'desc');

        // Filter by panel
        if (!empty($filters['panel_id'])) {
            $query->where('panel_id', $filters['panel_id']);
        }

        // Filter by event type
        if (!empty($filters['event_type'])) {
            $query->where('event_type', $filters['event_type']);
        }

        // Filter by date range
        if (!empty($filters['start_date'])) {
            $query->where('created_at', '>=', $filters['start_date']);
        }
        if (!empty($filters['end_date'])) {
            $query->where('created_at', '<=', $filters['end_date']);
        }

        $events = $query->paginate($perPage);

        return [
            'data' => $events->map(fn($event) => [
                'id' => $event->id,
                'panel_id' => $event->panel_id,
                'panel_name' => $event->panel?->name,
                'panel_slug' => $event->panel?->slug,
                'event_type' => $event->event_type,
                'session_id' => $event->session_id,
                'metadata' => $event->metadata,
                'created_at' => $event->created_at,
            ]),
            'meta' => [
                'current_page' => $events->currentPage(),
                'last_page' => $events->lastPage(),
                'per_page' => $events->perPage(),
                'total' => $events->total(),
            ],
        ];
    }

    /**
     * Calculate conversion rate.
     */
    protected function calculateConversionRate(int $impressions, int $conversions): float
    {
        if ($impressions === 0) {
            return 0;
        }

        return round(($conversions / $impressions) * 100, 2);
    }
}
