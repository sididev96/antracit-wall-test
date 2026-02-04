# Antracit Wall Panel API

Laravel 11 backend API for the Antracit Wall Panel Visualizer.

## Requirements

- PHP 8.2+
- Composer
- PostgreSQL 14+
- Node.js 18+ (for frontend)

## Installation

1. **Install PHP dependencies:**
   ```bash
   cd backend
   composer install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and configure:
   - `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` - PostgreSQL credentials
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` - Initial admin credentials
   - `FRONTEND_URL` - Your React app URL for CORS
   - `JWT_SECRET` - Generate with `php artisan jwt:secret`

3. **Generate application key:**
   ```bash
   php artisan key:generate
   ```

4. **Generate JWT secret:**
   ```bash
   php artisan jwt:secret
   ```

5. **Create database:**
   ```sql
   CREATE DATABASE antracit_panels;
   ```

6. **Run migrations:**
   ```bash
   php artisan migrate
   ```

7. **Seed the database:**
   ```bash
   php artisan db:seed
   ```

8. **Create storage link:**
   ```bash
   php artisan storage:link
   ```

9. **Start the development server:**
   ```bash
   php artisan serve
   ```
   
   The API will be available at `http://localhost:8000`

## API Endpoints

### Public Endpoints (No Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/panels` | List active panels |
| GET | `/api/v1/panels/{slug}` | Get panel details |
| GET | `/api/v1/categories` | List categories |
| POST | `/api/v1/panels/{slug}/events` | Track analytics event |

### Auth Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/login` | Admin login |
| POST | `/api/v1/auth/logout` | Logout (requires auth) |
| POST | `/api/v1/auth/refresh` | Refresh token |
| GET | `/api/v1/auth/me` | Get current user |

### Admin Endpoints (Requires Auth)

#### Panels
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/panels` | List all panels |
| POST | `/api/v1/admin/panels` | Create panel |
| GET | `/api/v1/admin/panels/{id}` | Get panel |
| PUT | `/api/v1/admin/panels/{id}` | Update panel |
| DELETE | `/api/v1/admin/panels/{id}` | Delete panel |
| POST | `/api/v1/admin/panels/reorder` | Reorder panels |
| POST | `/api/v1/admin/panels/{id}/upload-image` | Upload image |
| POST | `/api/v1/admin/panels/{id}/upload-texture` | Upload texture |

#### Categories
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/categories` | List categories |
| POST | `/api/v1/admin/categories` | Create category |
| PUT | `/api/v1/admin/categories/{id}` | Update category |
| DELETE | `/api/v1/admin/categories/{id}` | Delete category |
| POST | `/api/v1/admin/categories/reorder` | Reorder categories |

#### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/analytics/overview` | Dashboard stats |
| GET | `/api/v1/admin/analytics/panels` | Per-panel stats |
| GET | `/api/v1/admin/analytics/events` | Event log |

## Authentication

The API uses JWT tokens for authentication.

**Login:**
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@antracit.com", "password": "changeme123"}'
```

**Response:**
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

**Authenticated Request:**
```bash
curl http://localhost:8000/api/v1/admin/panels \
  -H "Authorization: Bearer eyJ..."
```

## File Uploads

Panel images are uploaded via multipart form data:

```bash
curl -X POST http://localhost:8000/api/v1/admin/panels/1/upload-image \
  -H "Authorization: Bearer eyJ..." \
  -F "image=@/path/to/panel.png"
```

**Max file size:** 25MB (configurable via `MAX_PANEL_IMAGE_SIZE` in KB)

**Supported formats:** JPEG, PNG, WebP

## Default Admin Credentials

- **Email:** admin@antracit.com
- **Password:** changeme123

**Important:** Change these in production!

## Database Schema

- `users` - Admin authentication
- `categories` - Panel categories
- `panels` - Wall panel data
- `panel_events` - Analytics events

## Configuration

Key environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_CONNECTION` | Database driver | pgsql |
| `DB_DATABASE` | Database name | antracit_panels |
| `JWT_TTL` | Token lifetime (minutes) | 60 |
| `MAX_PANEL_IMAGE_SIZE` | Max upload size (KB) | 25600 |
| `FRONTEND_URL` | CORS allowed origin | http://localhost:5173 |

## Development

```bash
# Run tests
php artisan test

# Clear cache
php artisan cache:clear
php artisan config:clear

# Fresh migration with seeding
php artisan migrate:fresh --seed
```
