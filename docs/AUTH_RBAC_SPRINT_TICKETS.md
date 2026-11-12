# SPRINT TICKETS: AUTHENTICATION, RBAC & USER SYSTEM
**Project:** Internship Portal Backend (`Backend_Internship`)  
**Target Database:** Supabase (PostgreSQL via Prisma ORM)  
**Architecture:** Node.js, Express, Layered Clean Architecture (Controller -> Service -> Model/Prisma), SOLID & DRY  
**Frontend Contract:** Matches `FrontEnd_Internship/src/features/auth`

---

## Architecture Overview & Role-Permission Matrix

### 1. System Roles
- `STUDENT`: Normal learner / intern.
- `TRAINER`: Evaluator / mentor with specialized domain & experience profile.
- `ADMIN`: System administrator with comprehensive access.

### 2. High-Level Permissions Catalog
| Permission Code | Name | Module | Default Roles |
|---|---|---|---|
| `auth:login` | User Login | Auth | All |
| `auth:register` | User Registration | Auth | Public |
| `auth:profile:read` | Read Own Profile | Auth | All |
| `auth:profile:update` | Update Own Profile | Auth | All |
| `user:read:any` | View Any User | Users | Admin |
| `user:update:any` | Edit Any User | Users | Admin |
| `user:delete` | Soft Delete / Ban User | Users | Admin |
| `trainer:profile:read` | View Trainer Profile | Trainer | All |
| `trainer:profile:update` | Edit Trainer Profile | Trainer | Trainer, Admin |
| `task:read` | View Tasks | Tasks | Student, Trainer, Admin |
| `task:submit` | Submit Task Solutions | Tasks | Student |
| `task:evaluate` | Grade / Evaluate Student Tasks | Tasks | Trainer, Admin |
| `assessment:attempt` | Take Assessments | Assessment | Student |
| `assessment:evaluate`| Review Assessment Submissions | Assessment | Trainer, Admin |
| `rbac:manage` | Manage Roles & Permissions | RBAC | Admin |

---

## TICKET 1: Database Architecture & Supabase/Prisma Schema for Users, RBAC & Tokens

### Priority: Critical (Blocker for All Tickets)
### Dependency: None

### Description
Design and implement the normalized relational schema using Prisma ORM connecting to Supabase PostgreSQL. This must support clean decoupled RBAC (Users <-> Roles <-> Permissions), session/token lifecycle management, and role-specific extension profiles (`TrainerProfile`).

### Technical Specifications & Schema (`prisma/schema.prisma`)
Add/refactor the following models with exact relations, foreign keys, and indexes:

```prisma
// ============================================
// ENUMS
// ============================================
enum UserStatus {
  PENDING_VERIFICATION
  ACTIVE
  SUSPENDED
}

enum TokenType {
  REFRESH
  EMAIL_VERIFICATION
  PASSWORD_RESET
}

// ============================================
// USER CORE MODEL
// ============================================
model User {
  id            String      @id @default(uuid())
  email         String      @unique
  passwordHash  String
  name          String
  status        UserStatus  @default(PENDING_VERIFICATION)
  emailVerified Boolean     @default(false)
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  // Relations
  userRoles      UserRole[]
  tokens         Token[]
  trainerProfile TrainerProfile?
  auditLogs      AuditLog[]

  @@index([email])
  @@index([status])
  @@map("users")
}

// ============================================
// RBAC: ROLES & PERMISSIONS
// ============================================
model Role {
  id          String           @id @default(uuid())
  name        String           @unique // "STUDENT", "TRAINER", "ADMIN"
  displayName String
  description String?
  isSystem    Boolean          @default(true) // System roles cannot be deleted
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  userRoles       UserRole[]
  rolePermissions RolePermission[]

  @@map("roles")
}

model Permission {
  id          String           @id @default(uuid())
  code        String           @unique // e.g. "task:evaluate", "user:read:any"
  name        String
  description String?
  module      String           // "auth", "tasks", "users", "admin"
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  rolePermissions RolePermission[]

  @@index([module])
  @@map("permissions")
}

model UserRole {
  userId     String
  roleId     String
  assignedAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role Role @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@id([userId, roleId])
  @@index([userId])
  @@index([roleId])
  @@map("user_roles")
}

model RolePermission {
  roleId       String
  permissionId String
  assignedAt   DateTime @default(now())

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@index([roleId])
  @@index([permissionId])
  @@map("role_permissions")
}

// ============================================
// EXTENDED ENTITY PROFILES
// ============================================
model TrainerProfile {
  id           String   @id @default(uuid())
  userId       String   @unique
  domain       String   // e.g. "Full Stack Web Development"
  experience   String   // e.g. "3-5 years"
  linkedinUrl  String?
  organization String?
  resumeUrl    String?
  bio          String?
  isApproved   Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("trainer_profiles")
}

// ============================================
// TOKEN MANAGEMENT
// ============================================
model Token {
  id         String    @id @default(uuid())
  userId     String
  tokenHash  String    @unique
  type       TokenType
  family     String?   // UUID for refresh token rotation family tracking
  revoked    Boolean   @default(false)
  expiresAt  DateTime
  createdAt  DateTime  @default(now())
  usedAt     DateTime?
  userAgent  String?
  ipAddress  String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([tokenHash])
  @@index([type, revoked])
  @@map("tokens")
}
```

### Action Items & Implementation Steps:
1. Update `prisma/schema.prisma` with above models and relations.
2. Ensure environment variable `DATABASE_URL` is configured for Supabase connection pooling (port `6543`) with `DIRECT_URL` (port `5432`) for migrations if needed.
3. Create `scripts/seed-rbac.js` to seed:
   - Initial 3 roles: `STUDENT`, `TRAINER`, `ADMIN`.
   - Comprehensive permission set.
   - Attach permissions to roles as defined in the Permission Matrix.
   - Create 1 default Super Admin user account with hashed password.
4. Run `npx prisma db push` or `npx prisma migrate dev --name init_auth_rbac`.
5. Verify schema generation with `npx prisma generate`.

---

## TICKET 2: Core Security Infrastructure, Tokens & Error Handling Layer

### Priority: High
### Dependency: Ticket 1

### Description
Implement the centralized, reusable security utilities and infrastructure following SOLID and DRY principles. This includes dual JWT handling (access + refresh), cryptographic token hashing, timing-safe comparisons, password hashing, and global error handling adhering to the frontend API contract.

### Required Packages:
- `bcryptjs` (Password hashing)
- `jsonwebtoken` (JWT creation/verification)
- `crypto` (Built-in Node.js for token hashing)
- `http-status-codes` (Clean status codes)
- `helmet`, `express-rate-limit`, `cookie-parser`

### Action Items & Implementation Steps:

1. **Password Utility (`src/utils/hash.util.js`)**:
   - `hashPassword(plainPassword)`: Salt rounds = 12.
   - `comparePassword(plainPassword, hash)`: Returns boolean, safe against timing attacks.

2. **Token Utility (`src/utils/token.util.js`)**:
   - `generateAccessToken(payload)`: Payload contains `{ sub: user.id, email: user.email, roles: string[] }`. Expires in 15 minutes (`JWT_EXPIRES_IN`). Signed with `JWT_SECRET`.
   - `generateRefreshToken()`: Generates cryptographically secure 64-byte random hex string.
   - `hashToken(rawToken)`: SHA-256 hash using `crypto.createHash('sha256')`. (Raw tokens are never stored in DB).
   - `verifyAccessToken(token)`: Verifies signature and expiration.

3. **Custom ApiError & Global Filter (`src/utils/ApiError.js` & `src/common/filters/global-exception.filter.js`)**:
   - Standard response envelope:
     ```json
     {
       "success": false,
       "message": "Human readable error message",
       "errors": [] // Array of validation error objects if applicable
     }
     ```
   - Intercept known Prisma errors (P2002 unique constraint, P2025 record not found) and map to friendly 409 Conflict / 404 Not Found HTTP codes.

4. **Security Cookie Helper (`src/utils/cookie.util.js`)**:
   - `setRefreshTokenCookie(res, refreshToken)`:
     - `httpOnly: true`
     - `secure: process.env.NODE_ENV === 'production'`
     - `sameSite: 'lax'`
     - `path: '/api/v1/auth'`
     - `maxAge: 7 * 24 * 60 * 60 * 1000` (7 days)
   - `clearRefreshTokenCookie(res)`: Sets maxAge 0.

5. **Rate Limiting Configuration (`src/config/rate-limit.config.js`)**:
   - Create strict rate limiter for Auth endpoints (`/login`, `/register`, `/forgot-password`): Max 10 requests per 15 minutes per IP.

---

## TICKET 3: Dynamic RBAC Engine & Authorization Middleware

### Priority: High
### Dependency: Ticket 1, Ticket 2

### Description
Build high-performance, cached role and permission authorization guards. Decouple endpoint access from hardcoded roles by checking fine-grained permission codes.

### Architecture & Design (SOLID - Open/Closed Principle)
Guards must not hardcode business rules. Instead, decorate routes with required permissions or minimum roles:
- `authenticate`: Validates JWT Access Token from `Authorization: Bearer <token>`, attaches `req.user` with current roles and permissions.
- `requirePermissions(...permissions)`: Ensures the authenticated user possesses all specified permissions.
- `requireRole(...roles)`: Convenience helper for coarse-grained checks.

### Action Items & Implementation Steps:

1. **Authentication Middleware (`src/common/guards/auth.guard.js`)**:
   - Extract Bearer token from header.
   - Verify token using `verifyAccessToken`.
   - Query user from database or memory cache: verify `status === 'ACTIVE'`. If suspended or deleted, reject with 401/403.
   - Populate `req.user = { id, email, roles, permissions }`.

2. **Permission Guard (`src/common/guards/permissions.guard.js`)**:
   - Factory function: `requirePermission(requiredPermission)` or `requirePermissions(permissionsArray)`.
   - Checks if `req.user.permissions.includes(requiredPermission)`.
   - If user has `ADMIN` role, automatically bypass or grant full permissions.
   - Returns `403 Forbidden` with `{ success: false, message: "You lack the required permission: <code-name>" }`.

3. **Roles Guard (`src/common/guards/roles.guard.js`)**:
   - Factory function: `requireRole('ADMIN', 'TRAINER')`.
   - Checks if user's roles intersect with required roles.

4. **RBAC Service (`src/modules/auth/services/rbac.service.js`)**:
   - `getUserPermissions(userId)`: Efficient Prisma query fetching user -> userRoles -> role -> rolePermissions -> permission.code.
   - Deduplicate into array of unique permission code strings.
   - (Optional/Recommended) Cache in Redis with 10-minute TTL, invalidated on role change.

---

## TICKET 4: Authentication Business Logic (Services) & DTO Validation Layer

### Priority: High
### Dependency: Ticket 1, Ticket 2, Ticket 3

### Description
Implement full registration, login, refresh token rotation, logout, password reset, and email verification workflows in the service layer with rigorous input validation matching the frontend forms.

### Input Validation Schemas (`src/modules/auth/dto/` using `joi` or `express-validator`):

1. **`register.dto.js`**:
   - `name`: string, min 2, max 80, required.
   - `email`: valid email string, max 254, required, lowercase trimmed.
   - `password`: string, min 8, max 128, required, must contain at least 1 letter and 1 number.
   - `role`: enum [`STUDENT`, `TRAINER`], default `STUDENT`. (Direct `ADMIN` registration forbidden).
   - If `role === 'TRAINER'`:
     - `domain`: required string (from allowed domains list).
     - `experience`: required string (from allowed experience levels).
     - `linkedinUrl`: optional string, valid URL format.
     - `organization`: optional string.
     - `resumeUrl`: optional string.

2. **`login.dto.js`**:
   - `email`: required string.
   - `password`: required string.

3. **`forgot-password.dto.js`** & **`reset-password.dto.js`**:
   - Forgot: `email`.
   - Reset: `token` (required string), `password` (conforms to strong password rule).

### Service Implementation (`src/modules/auth/services/auth.service.js`):

1. **`register(registerDto)`**:
   - Check if email is already registered -> Throw `ApiError(409, 'An account with this email already exists.')`.
   - Hash password with `bcryptjs`.
   - Execute in Prisma `$transaction`:
     - Create `User` record (status: `PENDING_VERIFICATION`).
     - Look up `Role` record matching `registerDto.role` and create `UserRole` link.
     - If `TRAINER`, create `TrainerProfile` record linked to `User.id`.
     - Generate raw email verification token, hash with SHA-256, store in `Token` table (type: `EMAIL_VERIFICATION`, expires: 24h).
   - Dispatch verification email via `email.service.js` (non-blocking).
   - Return `{ id, name, email, role, status }`.

2. **`login(email, password, context: { ip, userAgent })`**:
   - Find user by email including `userRoles.role.rolePermissions.permission`.
   - If user not found -> Throw generic `ApiError(401, 'Invalid email or password.')` (prevent user enumeration).
   - Verify password with `comparePassword`. If false -> Throw `ApiError(401, 'Invalid email or password.')`.
   - Check `user.status`: If `SUSPENDED` -> Throw `ApiError(403, 'Your account has been suspended.')`.
   - Assemble user's roles and permissions array.
   - Generate Access Token (15 min).
   - Generate Refresh Token (random bytes), generate `family` UUID, hash token, save in `Token` table (type: `REFRESH`, expires: 7 days).
   - Return `{ user: { id, name, email, roles, permissions }, accessToken, rawRefreshToken }`.

3. **`refreshToken(rawToken, context)`**:
   - Hash incoming raw token.
   - Find token record in `Token` table.
   - **Reuse Detection (Token Theft Defense)**:
     - If token found and `revoked === true`: Suspicious reuse attempt! Revoke all tokens in the same `family` immediately. Throw `ApiError(401, 'Session invalidated. Please log in again.')`.
   - If token expired or not found -> Throw `ApiError(401, 'Invalid or expired session.')`.
   - Mark current token as `revoked = true` and set `usedAt = now()`.
   - Issue **new** Refresh Token with the **same** `family` and save to DB.
   - Issue **new** Access Token.
   - Return `{ accessToken, newRawRefreshToken }`.

4. **`logout(rawRefreshToken)`**:
   - Hash incoming refresh token, set `revoked = true` in DB.

5. **`forgotPassword(email)`**:
   - Find user by email. If not found, return generic success message (security best practice against timing/enumeration attacks).
   - Revoke any existing active `PASSWORD_RESET` tokens for this user.
   - Generate raw reset token, hash, store with 1-hour expiration.
   - Dispatch password reset email with reset link containing raw token.

6. **`resetPassword(rawToken, newPassword)`**:
   - Hash raw token, find matching unrevoked, unexpired `PASSWORD_RESET` token.
   - Hash new password.
   - Execute in `$transaction`:
     - Update user's `passwordHash`.
     - Mark token as revoked/used.
     - Invalidate all existing `REFRESH` tokens for this user (logs out all devices).

---

## TICKET 5: API Endpoints, HTTP Controllers & End-to-End Test Suite

### Priority: Medium
### Dependency: Ticket 1, Ticket 2, Ticket 3, Ticket 4

### Description
Expose clean, RESTful API endpoints at `/api/v1/auth` and `/api/v1/rbac`, link them to Express routers in `app.js`, and provide a comprehensive test suite (Unit & Integration tests) using Jest and Supertest.

### API Routes Specification

#### Auth Router (`/api/v1/auth`)
| Method | Endpoint | Guards | Validation DTO | Success Status | Description |
|---|---|---|---|---|---|
| `POST` | `/register` | Public (Rate Limited) | `registerDto` | 201 Created | Register Student or Trainer |
| `POST` | `/login` | Public (Rate Limited) | `loginDto` | 200 OK | Authenticate, return user & tokens |
| `POST` | `/logout` | Optional Auth | — | 200 OK | Revoke refresh token & clear cookie |
| `POST` | `/refresh-token` | Public (Cookie Check) | — | 200 OK | Issue new access token + rotated refresh token |
| `GET`  | `/me` | `authenticate` | — | 200 OK | Return current user info, roles, permissions |
| `POST` | `/forgot-password`| Public (Rate Limited) | `forgotPasswordDto` | 200 OK | Request reset link |
| `POST` | `/reset-password` | Public | `resetPasswordDto` | 200 OK | Submit new password with token |
| `GET`  | `/verify-email/:token` | Public | — | 200 OK | Mark email as verified |
| `POST` | `/resend-verification` | Public (Rate Limited) | `emailDto` | 200 OK | Resend verification email |

#### RBAC Router (`/api/v1/rbac`)
| Method | Endpoint | Guards | Success Status | Description |
|---|---|---|---|---|
| `GET` | `/roles` | `authenticate`, `requireRole('ADMIN')` | 200 OK | List all roles with permission sets |
| `GET` | `/permissions` | `authenticate`, `requireRole('ADMIN')` | 200 OK | List all available system permissions |
| `POST`| `/assign-role` | `authenticate`, `requirePermission('rbac:manage')` | 200 OK | Assign role to a user |

### Standard Response Formats:

**Login / Register Success Response:**
```json
{
  "success": true,
  "message": "Login successful.",
  "data": {
    "user": {
      "id": "uuid-v4",
      "name": "Alex Morgan",
      "email": "alex@example.com",
      "status": "ACTIVE",
      "emailVerified": true,
      "roles": ["STUDENT"],
      "permissions": [
        "task:read",
        "task:submit",
        "assessment:attempt",
        "auth:profile:read"
      ]
    },
    "accessToken": "eyJhbGciOi..."
  }
}
```
*(Refresh token sent strictly as `Set-Cookie: refreshToken=...; HttpOnly; SameSite=Lax; Path=/api/v1/auth`)*

### Testing Specifications (`src/tests/`):
1. **Unit Tests**:
   - `hash.util.spec.js`: Hash verification and salt randomness.
   - `token.util.spec.js`: Token generation, expiration calculation, token hashing.
   - `rbac.guard.spec.js`: Correct 403 response on missing permission.
2. **Integration Tests (`src/tests/integration/auth.spec.js`)**:
   - Register a `STUDENT` -> Verify 201 status and database records.
   - Register a `TRAINER` -> Verify `TrainerProfile` record created.
   - Login with invalid password -> Verify 401 response and generic error message.
   - Login with valid credentials -> Verify access token and `Set-Cookie` header.
   - Call `/api/v1/auth/me` with Bearer token -> Verify 200 with matching payload.
   - Call `/api/v1/auth/refresh-token` -> Verify token rotation.
   - Attempt refresh with previously used token -> Verify 401 and family revocation.

---

## Execution Checklist for AI Agent

When implementing these tickets, proceed in this exact sequence:
- [ ] **Step 1:** Implement Ticket 1 (`prisma/schema.prisma` updates, DB push, seed script).
- [ ] **Step 2:** Implement Ticket 2 (Security utils, hashing, JWT helpers, ApiError filter).
- [ ] **Step 3:** Implement Ticket 3 (RBAC guards, dynamic permission evaluation).
- [ ] **Step 4:** Implement Ticket 4 (DTO validation schemas, Auth & RBAC service methods).
- [ ] **Step 5:** Implement Ticket 5 (Controllers, route wiring, integration tests).

