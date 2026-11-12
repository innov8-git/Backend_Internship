# SPRINT TICKETS: EMAIL OTP AUTHENTICATION & VERIFICATION SYSTEM
**Project:** Internship Portal Backend (`Backend_Internship`)  
**Target Database:** Supabase (PostgreSQL via Prisma ORM)  
**SMTP Status:** Verified (`smtp.gmail.com:587`, ready)  
**Security Standard:** OWASP ASVS v4.0 & NIST 800-63B Authentication Guidelines

---

## 🔍 Root Cause Analysis: Why Emails Weren't Getting Sent

1. **Commented-Out Email Dispatch in `auth.service.js`:**
   In `src/modules/auth/services/auth.service.js`, lines 78 and 192 had the email sending calls commented out:
   ```javascript
   // In production with SMTP configured:
   // await sendEmail({ to: result.email, ... });
   ```
2. **`EMAIL_FROM` Format & Domain Mismatch:**
   In `.env`, `EMAIL_FROM` was set to `Internship Portal shantanud303@alfre.com`. Gmail SMTP requires the sender address to match your authenticated Gmail account (`"Internship Portal" <shantanud303@gmail.com>`).

---

## 🛡️ OTP Security Architecture & Requirements

1. **Never Store Plaintext OTPs:** Store only `SHA-256` or `bcrypt` hash of the 6-digit numeric OTP in the database.
2. **Cryptographic Randomness:** Generate OTPs using `crypto.randomInt(100000, 1000000)` (Node.js crypto engine, not `Math.random()`).
3. **Strict Expiration:** OTP validity is strictly **5 minutes** (`OTP_EXPIRES_IN=300000`).
4. **Brute-Force & Attempt Throttling:**
   - Max **3 failed attempts** per OTP. On the 4th attempt, the OTP is permanently invalidated.
5. **Cooldown & Rate Limiting:**
   - **60-second cooldown** between OTP requests to prevent email bombing.
   - Max **5 OTP requests per hour** per email address and IP.
6. **Purpose Isolation:** Each OTP is tagged with an enum purpose (`REGISTRATION_VERIFY`, `LOGIN`, `PASSWORD_RESET`). An OTP issued for registration cannot be used to login.
7. **Single-Use Enforcement:** Once verified, an OTP record is immediately marked `used = true` inside a database transaction.

---

## 📋 SPRINT TICKETS BREAKDOWN

### TICKET OTP-1: Database Schema Migration for OTP Verification Table

#### Objective
Add a dedicated, indexed `OtpToken` model in `prisma/schema.prisma` and synchronize to Supabase PostgreSQL.

#### Database Schema Specification (`prisma/schema.prisma`):
```prisma
enum OtpPurpose {
  REGISTRATION_VERIFY
  LOGIN
  PASSWORD_RESET
}

model OtpToken {
  id         String     @id @default(uuid())
  email      String
  otpHash    String
  purpose    OtpPurpose
  expiresAt  DateTime
  attempts   Int        @default(0)
  maxAttempts Int       @default(3)
  isUsed     Boolean    @default(false)
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
  ipAddress  String?
  userAgent  String?

  @@index([email, purpose, isUsed])
  @@index([expiresAt])
  @@map("otp_tokens")
}
```

#### Acceptance Criteria:
- [ ] Enum `OtpPurpose` and model `OtpToken` added to `prisma/schema.prisma`.
- [ ] Database synchronized with `npx prisma db push`.
- [ ] Prisma client regenerated with `npx prisma generate`.

---

### TICKET OTP-2: Dedicated Email Template & Nodemailer Transporter Service

#### Objective
Activate the live email dispatch service with responsive, branded HTML templates for OTP verification.

#### Technical Specifications:
- **Service Location:** `src/libs/email/index.js` & `src/libs/email/templates/otp.template.js`
- **Email Configuration Fix:** Update `EMAIL_FROM` in `.env` to:
  ```env
  EMAIL_FROM="Internship Portal <shantanud303@gmail.com>"
  ```
- **HTML Email Template Design:**
  - Modern, mobile-responsive email card.
  - Highlighted 6-digit OTP code in large, monospace bold font with letter-spacing.
  - Clear 5-minute expiration notice and warning not to share the OTP with anyone.

#### Acceptance Criteria:
- [ ] Nodemailer transporter configured with error logging and retries.
- [ ] `sendOtpEmail({ to, otp, purpose })` implemented and tested with real delivery.
- [ ] Emails successfully arrive in user inbox without spam triggers.

---

### TICKET OTP-3: Core OTP Business Logic & Security Engine

#### Objective
Implement `src/modules/auth/services/otp.service.js` containing secure OTP generation, hashing, verification, attempt tracking, and cooldown enforcement.

#### Methods to Implement:
1. `generateAndSendOtp({ email, purpose, ipAddress, userAgent })`:
   - Enforce 60-second cooldown: Query recent OTP for this email within 60s. If exists, throw `ApiError.tooManyRequests('Please wait 60 seconds before requesting a new OTP.')`.
   - Invalidate any previous unexpired OTPs for `(email, purpose)`: Set `isUsed = true`.
   - Generate secure 6-digit numeric code: `crypto.randomInt(100000, 1000000).toString()`.
   - Hash OTP using `hashToken(otp)` (SHA-256).
   - Save record to `OtpToken` table with 5-minute expiry.
   - Dispatch HTML email via `sendOtpEmail`.
   - Return `{ success: true, message: 'OTP sent to your email.', expiresIn: 300 }`.

2. `verifyOtp({ email, otp, purpose })`:
   - Find active record where `email`, `purpose`, `isUsed: false`, and `expiresAt > now()`.
   - If not found -> Throw `ApiError.badRequest('INVALID_OTP', 'OTP is invalid or has expired.')`.
   - Check attempts: If `attempts >= maxAttempts` -> Invalidate OTP and throw `ApiError.badRequest('OTP_MAX_ATTEMPTS', 'Maximum attempts exceeded. Please request a new OTP.')`.
   - Compare hash: `hashToken(otp) === record.otpHash`.
   - If mismatch:
     - Increment `attempts` by 1.
     - Throw `ApiError.badRequest('INVALID_OTP', `Incorrect OTP. ${record.maxAttempts - record.attempts - 1} attempt(s) remaining.`)`.
   - If match:
     - Mark `isUsed = true`.
     - Return `{ success: true, verified: true }`.

#### Acceptance Criteria:
- [ ] 6-digit cryptographic generation verified.
- [ ] Attempts count strictly enforced; locked out after 3 failures.
- [ ] Cooldown window prevents rapid requests.

---

### TICKET OTP-4: OTP Authentication Integration & REST Endpoints

#### Objective
Connect OTP verification into user registration, login, and password reset flows with validation DTOs.

#### API Endpoints Specification:

| Method | Endpoint | Request Body | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/otp/send` | `{ email, purpose }` | Requests an OTP for registration, login, or reset |
| `POST` | `/api/v1/auth/otp/verify-registration` | `{ email, otp }` | Validates registration OTP and marks user as `ACTIVE` & `emailVerified: true` |
| `POST` | `/api/v1/auth/otp/login` | `{ email, otp }` | Passwordless login via OTP; returns JWT Access Token + sets Refresh Cookie |
| `POST` | `/api/v1/auth/otp/verify-reset` | `{ email, otp }` | Validates reset OTP and returns a single-use token to update password |
| `POST` | `/api/v1/auth/otp/resend` | `{ email, purpose }` | Resends OTP after 60s cooldown check |

#### Flow Walkthroughs:

1. **Registration with OTP Verification Flow:**
   - User submits `POST /api/v1/auth/register` (Account created in `PENDING_VERIFICATION`).
   - Server automatically generates and sends 6-digit OTP to user's email.
   - User enters OTP on the frontend.
   - Frontend calls `POST /api/v1/auth/otp/verify-registration`.
   - Account status transitions to `ACTIVE`, and session tokens are returned.

2. **Passwordless OTP Login Flow:**
   - User inputs email and clicks "Login with OTP".
   - Frontend calls `POST /api/v1/auth/otp/send` (`purpose: 'LOGIN'`).
   - User enters 6-digit OTP.
   - Frontend calls `POST /api/v1/auth/otp/login`.
   - Server validates OTP, checks active status, generates access token and sets refresh cookie.

#### Acceptance Criteria:
- [ ] Joi DTO validation for all OTP endpoints (`email`, 6-digit string regex `^\d{6}$`, `purpose`).
- [ ] Routes wired into `auth.routes.js`.
- [ ] Swagger API definitions updated with the new `/auth/otp/*` endpoints.

---

### TICKET OTP-5: Automated Test Suite & Verification

#### Objective
Implement unit and integration tests covering positive and negative OTP security cases.

#### Test Cases to Write (`src/tests/unit/auth/otp.service.spec.js` & `src/tests/integration/auth/otp.api.spec.js`):
1. **Happy Path:** Request OTP -> Email dispatched -> Verify valid OTP -> Success.
2. **Expired OTP:** Attempt to verify after 5-minute window -> 400 Bad Request.
3. **Invalid Code:** Submit incorrect code -> Attempt count increments; remaining attempts returned.
4. **Brute Force Lockout:** Submit 3 consecutive incorrect codes -> 4th attempt rejected as locked out.
5. **Cooldown Enforcement:** Request 2 OTPs within 30 seconds -> 429 Too Many Requests.
6. **Purpose Mismatch:** Attempt to verify registration OTP against login endpoint -> Rejected.

---

## 🚀 Execution Order for AI Agent
1. **Step 1:** Implement **Ticket OTP-1** (`prisma/schema.prisma` updates + `npx prisma db push`).
2. **Step 2:** Implement **Ticket OTP-2** (Fix `.env` `EMAIL_FROM` + HTML template + nodemailer send).
3. **Step 3:** Implement **Ticket OTP-3** (`otp.service.js` with hash comparison & attempts).
4. **Step 4:** Implement **Ticket OTP-4** (Controllers, DTOs, routes, Swagger).
5. **Step 5:** Implement **Ticket OTP-5** (Jest unit and integration tests).
