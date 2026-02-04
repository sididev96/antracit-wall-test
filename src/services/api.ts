/**
 * API Service for Antracit Wall Panel Backend
 *
 * This service handles all communication with the Laravel backend API.
 */

import { WallPanel } from "@/types/panel";

// API base URL - configurable via environment variable
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

// Session ID for analytics tracking (persisted per browser session)
const getSessionId = (): string => {
  let sessionId = sessionStorage.getItem("antracit_session_id");
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem("antracit_session_id", sessionId);
  }
  return sessionId;
};

// Helper for making API requests
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...options.headers,
  };

  // Add auth token if available (for admin operations)
  const token = localStorage.getItem("antracit_admin_token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(error.message || `API error: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Public API (no auth required)
// ============================================================================

export interface PanelListResponse {
  data: WallPanel[];
  meta: {
    total: number;
    categories: string[];
  };
}

export interface PanelFilters {
  category?: string;
  search?: string;
  sort?: "name" | "price" | "newest";
  order?: "asc" | "desc";
}

/**
 * Fetch all active panels from the API
 */
export async function fetchPanels(filters?: PanelFilters): Promise<PanelListResponse> {
  const params = new URLSearchParams();

  if (filters?.category && filters.category !== "All") {
    params.append("category", filters.category.toLowerCase());
  }
  if (filters?.search) {
    params.append("search", filters.search);
  }
  if (filters?.sort) {
    params.append("sort", filters.sort);
  }
  if (filters?.order) {
    params.append("order", filters.order);
  }

  const queryString = params.toString();
  const endpoint = `/panels${queryString ? `?${queryString}` : ""}`;

  return apiRequest<PanelListResponse>(endpoint);
}

/**
 * Fetch a single panel by slug
 */
export async function fetchPanel(slug: string): Promise<{ data: WallPanel }> {
  return apiRequest<{ data: WallPanel }>(`/panels/${slug}`);
}

/**
 * Fetch all categories
 */
export async function fetchCategories(): Promise<string[]> {
  const response = await apiRequest<{
    data: Array<{ name: string; slug: string; panel_count: number }>;
  }>("/categories");

  return ["All", ...response.data.map((c) => c.name)];
}

// ============================================================================
// Analytics Tracking
// ============================================================================

export type AnalyticsEventType = "impression" | "selection" | "visualization";

/**
 * Track an analytics event for a panel
 */
export async function trackEvent(
  panelSlug: string,
  eventType: AnalyticsEventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await apiRequest(`/panels/${panelSlug}/events`, {
      method: "POST",
      body: JSON.stringify({
        event_type: eventType,
        session_id: getSessionId(),
        metadata: {
          ...metadata,
          user_agent: navigator.userAgent,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        },
      }),
    });
  } catch (error) {
    // Silently fail analytics - don't break the user experience
    console.warn("Analytics tracking failed:", error);
  }
}

/**
 * Track panel impression (when panel card is visible)
 */
export function trackImpression(panelSlug: string): void {
  trackEvent(panelSlug, "impression");
}

/**
 * Track panel selection (when user clicks/selects a panel)
 */
export function trackSelection(panelSlug: string): void {
  trackEvent(panelSlug, "selection");
}

/**
 * Track visualization (when panel is applied to a wall image)
 */
export function trackVisualization(panelSlug: string): void {
  trackEvent(panelSlug, "visualization");
}

// ============================================================================
// Authentication (Admin)
// ============================================================================

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

/**
 * Admin login
 */
export async function adminLogin(
  email: string,
  password: string
): Promise<LoginResponse> {
  const response = await apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  // Store the token
  localStorage.setItem("antracit_admin_token", response.access_token);

  return response;
}

/**
 * Admin logout
 */
export async function adminLogout(): Promise<void> {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } finally {
    localStorage.removeItem("antracit_admin_token");
  }
}

/**
 * Get current admin user info
 */
export async function getAdminUser(): Promise<{ data: AdminUser }> {
  return apiRequest<{ data: AdminUser }>("/auth/me");
}

/**
 * Refresh the access token
 */
export async function refreshToken(): Promise<LoginResponse> {
  const response = await apiRequest<LoginResponse>("/auth/refresh", {
    method: "POST",
  });

  localStorage.setItem("antracit_admin_token", response.access_token);

  return response;
}

/**
 * Check if admin is logged in
 */
export function isAdminLoggedIn(): boolean {
  return !!localStorage.getItem("antracit_admin_token");
}

// ============================================================================
// Admin Panel Management
// ============================================================================

export interface AdminPanel {
  id: number;
  slug: string;
  name: string;
  description: string;
  category_id: number;
  category: string;
  image_url: string;
  texture_url: string;
  colors: string[];
  material: string;
  price: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  impressions_count: number;
  selections_count: number;
  visualizations_count: number;
}

export interface CreatePanelData {
  slug: string;
  name: string;
  description: string;
  category_id: number;
  colors: string[];
  material: string;
  price?: string;
  sort_order?: number;
  is_active?: boolean;
  image_url?: string;
  texture_url?: string;
}

export interface UpdatePanelData extends Partial<CreatePanelData> {}

/**
 * Fetch all panels (admin - includes inactive)
 */
export async function adminFetchPanels(): Promise<{ data: AdminPanel[] }> {
  return apiRequest<{ data: AdminPanel[] }>("/admin/panels");
}

/**
 * Create a new panel
 */
export async function adminCreatePanel(
  data: CreatePanelData
): Promise<{ data: { id: number; slug: string; name: string } }> {
  return apiRequest("/admin/panels", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Update a panel
 */
export async function adminUpdatePanel(
  panelId: number,
  data: UpdatePanelData
): Promise<{ data: { id: number; slug: string; name: string } }> {
  return apiRequest(`/admin/panels/${panelId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a panel
 */
export async function adminDeletePanel(panelId: number): Promise<void> {
  await apiRequest(`/admin/panels/${panelId}`, { method: "DELETE" });
}

/**
 * Upload panel image
 */
export async function adminUploadPanelImage(
  panelId: number,
  file: File
): Promise<{ data: { image_url: string } }> {
  const formData = new FormData();
  formData.append("image", file);

  const token = localStorage.getItem("antracit_admin_token");

  const response = await fetch(`${API_BASE}/admin/panels/${panelId}/upload-image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Upload failed" }));
    throw new Error(error.message);
  }

  return response.json();
}

/**
 * Upload panel texture
 */
export async function adminUploadPanelTexture(
  panelId: number,
  file: File
): Promise<{ data: { texture_url: string } }> {
  const formData = new FormData();
  formData.append("texture", file);

  const token = localStorage.getItem("antracit_admin_token");

  const response = await fetch(`${API_BASE}/admin/panels/${panelId}/upload-texture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Upload failed" }));
    throw new Error(error.message);
  }

  return response.json();
}

/**
 * Reorder panels
 */
export async function adminReorderPanels(
  panels: Array<{ id: number; sort_order: number }>
): Promise<void> {
  await apiRequest("/admin/panels/reorder", {
    method: "POST",
    body: JSON.stringify({ panels }),
  });
}

// ============================================================================
// Admin Category Management
// ============================================================================

export interface AdminCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  panels_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCategoryData {
  name: string;
  slug?: string;
  description?: string;
  sort_order?: number;
}

/**
 * Fetch all categories (admin)
 */
export async function adminFetchCategories(): Promise<{ data: AdminCategory[] }> {
  return apiRequest<{ data: AdminCategory[] }>("/admin/categories");
}

/**
 * Create a new category
 */
export async function adminCreateCategory(
  data: CreateCategoryData
): Promise<{ data: { id: number; name: string; slug: string } }> {
  return apiRequest("/admin/categories", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Update a category
 */
export async function adminUpdateCategory(
  categoryId: number,
  data: Partial<CreateCategoryData>
): Promise<{ data: { id: number; name: string; slug: string } }> {
  return apiRequest(`/admin/categories/${categoryId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a category
 */
export async function adminDeleteCategory(categoryId: number): Promise<void> {
  await apiRequest(`/admin/categories/${categoryId}`, { method: "DELETE" });
}

/**
 * Reorder categories
 */
export async function adminReorderCategories(
  categories: Array<{ id: number; sort_order: number }>
): Promise<void> {
  await apiRequest("/admin/categories/reorder", {
    method: "POST",
    body: JSON.stringify({ categories }),
  });
}

// ============================================================================
// Admin Analytics
// ============================================================================

export interface AnalyticsOverview {
  total_panels: number;
  active_panels: number;
  total_impressions: number;
  total_selections: number;
  total_visualizations: number;
  top_panels: Array<{ id: string; name: string; total_events: number }>;
  daily_events: Array<{
    date: string;
    impressions: number;
    selections: number;
    visualizations: number;
  }>;
  period_days: number;
}

export interface PanelAnalytics {
  id: number;
  slug: string;
  name: string;
  category: string;
  is_active: boolean;
  impressions: number;
  selections: number;
  visualizations: number;
  conversion_rate: number;
}

/**
 * Fetch analytics overview
 */
export async function adminFetchAnalyticsOverview(
  days: number = 30
): Promise<{ data: AnalyticsOverview }> {
  return apiRequest<{ data: AnalyticsOverview }>(`/admin/analytics/overview?days=${days}`);
}

/**
 * Fetch per-panel analytics
 */
export async function adminFetchPanelAnalytics(
  days: number = 30
): Promise<{ data: PanelAnalytics[]; period_days: number }> {
  return apiRequest(`/admin/analytics/panels?days=${days}`);
}

/**
 * Fetch analytics event log
 */
export async function adminFetchEventLog(filters?: {
  panel_id?: number;
  event_type?: AnalyticsEventType;
  start_date?: string;
  end_date?: string;
  per_page?: number;
  page?: number;
}): Promise<{
  data: Array<{
    id: number;
    panel_id: number;
    panel_name: string;
    panel_slug: string;
    event_type: string;
    session_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}> {
  const params = new URLSearchParams();
  if (filters?.panel_id) params.append("panel_id", String(filters.panel_id));
  if (filters?.event_type) params.append("event_type", filters.event_type);
  if (filters?.start_date) params.append("start_date", filters.start_date);
  if (filters?.end_date) params.append("end_date", filters.end_date);
  if (filters?.per_page) params.append("per_page", String(filters.per_page));
  if (filters?.page) params.append("page", String(filters.page));

  const queryString = params.toString();
  return apiRequest(`/admin/analytics/events${queryString ? `?${queryString}` : ""}`);
}
