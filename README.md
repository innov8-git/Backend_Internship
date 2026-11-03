# Internship Portal Backend API

Enterprise-grade REST API backend for the Internship Management Portal built with **Node.js**, **Express**, **PostgreSQL**, and **Prisma ORM**.

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### 2. Install Dependencies
```bash
cd Backend_Internship
npm install
```

### 3. Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

### 4. Start Local Database (PGlite Embedded or External PostgreSQL)
The project includes a zero-dependency embedded PostgreSQL server via PGlite that runs on port 5432:
```bash
npm run db:server
```
*(Or point `DATABASE_URL` in `.env` to your own PostgreSQL instance/Supabase/Neon).*

### 5. Push Schema & Seed Demo Data
```bash
# Push Prisma schema to create all tables and relations
npm run db:push

# Seed demo users, catalog, assessments, schedule, and tasks
npm run seed
```

### 6. Start the API Server
```bash
# Development mode with hot-reloading
npm run dev

# Or standard production start
npm start
```

The server starts at `http://localhost:5000` with:
- **API Base**: `http://localhost:5000/api/v1`
- **Health Check**: `http://localhost:5000/health`
- **Static Uploads**: `http://localhost:5000/uploads`

---

## 👥 Seeded Demo Accounts (Password: `Password@123`)

| Role | Email | Features Available |
| :--- | :--- | :--- |
| **Student** | `student@demo.dev` | Enrollments, 30-day learning schedule, tasks, code submissions, team workspace, assessments |
| **Graduate Student** | `graduate@demo.dev` | Completed enrollment with issued certificate `IP-2026-000123` |
| **Trainer** | `trainer@demo.dev` | Trainer workspace, review queue, submission approvals/rejections with feedback |
| **Admin** | `admin@demo.dev` | System overview stats, user role management, catalog CRUD, audit logs, certificate resend |

---

## 📁 Architecture & Feature Modules

All features are modularly organized under `src/modules/`:

1. **Auth (`src/modules/auth`)**
   - Register, login, refresh token (httpOnly cookie), logout, me, email verification, password reset.
2. **Catalog (`src/modules/catalog`)**
   - Public designations, technical domains, internship plans with pricing, and schedule previews.
3. **Assessments (`src/modules/assessments`)**
   - Skill assessments with 15 questions, auto-scoring, discount percentage calculation, attempt history.
4. **Enrollment & Payments (`src/modules/enrollment`)**
   - 24-hour TTL quotes, terms acceptance, enrollment lifecycle, mock payment order creation and webhook completion with task initialization.
5. **Schedule & SOP (`src/modules/schedule`)**
   - Student schedule retrieval, watermarked SOP viewing with audit logs, admin template builder with publishing, versioning, and drag-and-drop task reordering.
6. **Tasks & Submissions (`src/modules/tasks`)**
   - Progressive task unlocking, multipart file uploads, submission history with code and demo links.
7. **Teams (`src/modules/teams`)**
   - Team formation, email invitations, member accept/decline, readiness validation, repo sync, progress tracking.
8. **Trainer Workspace (`src/modules/trainer`)**
   - Active student assignments, submission review queue, decision review flow (approve/request changes/reject), automatic certificate generation upon final task approval.
9. **Certificates (`src/modules/certificates`)**
   - Student certificate retrieval, public cryptographic verification, dynamic PDF generation via PDFKit.
10. **GitHub Integration (`src/modules/github-integration`)**
    - Connect OAuth account, connection status, repository selector, disconnect.
11. **Admin Workspace (`src/modules/admin`)**
    - High-level metrics, user suspension/role assignment, catalog management, assessment drafts, audit log inspection.

---

## 🔗 Connecting to the Frontend

In `FrontEnd_Internship`:
1. Ensure `.env.development.local` contains:
   ```env
   VITE_API_URL=/api/v1
   VITE_API_PROXY_TARGET=http://localhost:5000
   VITE_USE_MOCKS=false
   ```
2. Run the frontend:
   ```bash
   cd ../FrontEnd_Internship
   npm run dev
   ```
3. Vite proxies all `/api` requests to `http://localhost:5000/api` with full cookie and CORS support.
