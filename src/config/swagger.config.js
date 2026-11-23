'use strict';

const swaggerJsdoc = require('swagger-jsdoc');
const config = require('./index');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Internship Portal Backend API',
    version: '1.0.0',
    description:
      'Production-grade RESTful API for the Internship Portal supporting Role-Based Access Control (RBAC), Supabase PostgreSQL database, JWT authentication, Email OTP Verification, and automated task workflows.',
    contact: {
      name: 'API Support',
      email: 'support@alfre.com',
    },
  },
  servers: [
    {
      url: `http://localhost:${config.server.port}${config.server.apiPrefix}`,
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT access token.',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'refreshToken',
        description: 'HttpOnly Refresh Token cookie automatically sent by the browser.',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Operation completed successfully.' },
          data: { type: 'object' },
        },
      },
      ApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Validation failed.' },
              details: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string', example: 'email' },
                    message: { type: 'string', example: 'Enter a valid email address.' },
                  },
                },
              },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'John Doe' },
          email: { type: 'string', format: 'email', example: 'john@example.com' },
          status: { type: 'string', enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'], example: 'ACTIVE' },
          emailVerified: { type: 'boolean', example: true },
          roles: { type: 'array', items: { type: 'string' }, example: ['STUDENT'] },
          permissions: { type: 'array', items: { type: 'string' }, example: ['task:read', 'task:submit'] },
        },
      },
      RegisterStudentRequest: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', example: 'Alex Morgan' },
          email: { type: 'string', format: 'email', example: 'alex@example.com' },
          password: { type: 'string', format: 'password', example: 'SecurePassword123' },
        },
      },
      RegisterTrainerRequest: {
        type: 'object',
        required: ['name', 'email', 'password', 'domain', 'experience'],
        properties: {
          name: { type: 'string', example: 'Sarah Connor' },
          email: { type: 'string', format: 'email', example: 'sarah.trainer@example.com' },
          password: { type: 'string', format: 'password', example: 'MentorPass123' },
          domain: { type: 'string', example: 'Full Stack Web Development' },
          experience: { type: 'string', example: '5-8 years' },
          organization: { type: 'string', example: 'Tech Labs' },
          linkedinUrl: { type: 'string', example: 'https://linkedin.com/in/sarah-mentor' },
          resumeUrl: { type: 'string', example: 'https://example.com/resumes/sarah.pdf' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'student@example.com' },
          password: { type: 'string', format: 'password', example: 'Password123' },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Login successful.' },
          data: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsIn...' },
            },
          },
        },
      },
      ForgotPasswordRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email', example: 'alex@example.com' },
        },
      },
      ResetPasswordRequest: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', example: '32_byte_hex_token' },
          password: { type: 'string', format: 'password', example: 'NewPassword123' },
        },
      },
      SendOtpRequest: {
        type: 'object',
        required: ['email', 'purpose'],
        properties: {
          email: { type: 'string', format: 'email', example: 'shantanud303@gmail.com' },
          purpose: {
            type: 'string',
            enum: ['REGISTRATION_VERIFY', 'LOGIN', 'PASSWORD_RESET'],
            example: 'LOGIN',
          },
        },
      },
      VerifyRegistrationOtpRequest: {
        type: 'object',
        required: ['email', 'otp'],
        properties: {
          email: { type: 'string', format: 'email', example: 'shantanud303@gmail.com' },
          otp: { type: 'string', example: '123456', description: '6-digit numeric OTP' },
        },
      },
      LoginOtpRequest: {
        type: 'object',
        required: ['email', 'otp'],
        properties: {
          email: { type: 'string', format: 'email', example: 'shantanud303@gmail.com' },
          otp: { type: 'string', example: '123456', description: '6-digit numeric OTP' },
        },
      },
      VerifyResetOtpRequest: {
        type: 'object',
        required: ['email', 'otp'],
        properties: {
          email: { type: 'string', format: 'email', example: 'shantanud303@gmail.com' },
          otp: { type: 'string', example: '123456', description: '6-digit numeric OTP' },
        },
      },
      AssignRoleRequest: {
        type: 'object',
        required: ['userId', 'roleName'],
        properties: {
          userId: { type: 'string', format: 'uuid' },
          roleName: { type: 'string', enum: ['STUDENT', 'TRAINER', 'ADMIN'], example: 'TRAINER' },
        },
      },
    },
  },
  paths: {
    '/auth/register/student': {
      post: {
        summary: 'Student Registration (Dedicated)',
        description: 'Quick student onboarding with name, email, and password. Automatically dispatches a 6-digit verification OTP.',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RegisterStudentRequest' } },
          },
        },
        responses: {
          201: { description: 'Student registered successfully', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } } },
          409: { description: 'Email already exists' },
          422: { description: 'Validation failed' },
        },
      },
    },
    '/auth/register/trainer': {
      post: {
        summary: 'Trainer Registration (Dedicated)',
        description: 'Professional onboarding for mentors/trainers with domain qualifications. Automatically dispatches a 6-digit verification OTP and sets account under admin review.',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RegisterTrainerRequest' } },
          },
        },
        responses: {
          201: { description: 'Trainer application submitted for review', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } } },
          409: { description: 'Email already exists' },
          422: { description: 'Validation failed' },
        },
      },
    },
    '/auth/register': {
      post: {
        summary: 'Register a new Student or Trainer',
        description: 'Single registration endpoint with conditional validation for Students vs Trainers. Sends an OTP code to user email.',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: '#/components/schemas/RegisterStudentRequest' },
                  { $ref: '#/components/schemas/RegisterTrainerRequest' },
                ],
              },
            },
          },
        },
        responses: {
          201: { description: 'Registration successful', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } } },
          409: { description: 'Email already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          422: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        },
      },
    },
    '/auth/login': {
      post: {
        summary: 'User Login (Single login with RBAC)',
        description: 'Authenticates student, trainer, or admin. Returns JWT Access Token in response and sets HttpOnly Refresh Token cookie.',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } },
          },
        },
        responses: {
          200: { description: 'Login successful', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
          401: { description: 'Invalid email or password' },
          403: { description: 'Account suspended' },
          429: { description: 'Too many attempts. Rate limit exceeded.' },
        },
      },
    },
    '/auth/logout': {
      post: {
        summary: 'User Logout',
        description: 'Revokes the active refresh token family and clears the cookie.',
        tags: ['Authentication'],
        responses: {
          200: { description: 'Logged out successfully' },
        },
      },
    },
    '/auth/refresh-token': {
      post: {
        summary: 'Rotate Refresh Token',
        description: 'Issues a new Access Token and rotated Refresh Token cookie. Includes automated token reuse/theft detection.',
        tags: ['Authentication'],
        security: [{ cookieAuth: [] }],
        responses: {
          200: { description: 'Token rotated successfully' },
          401: { description: 'Invalid or revoked token' },
        },
      },
    },
    '/auth/me': {
      get: {
        summary: 'Get Current Authenticated User',
        description: 'Returns profile details, active roles, and granular permission codes.',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Current user profile' },
          401: { description: 'Unauthenticated' },
        },
      },
      patch: {
        summary: 'Update Own Profile',
        description:
          'Partial update of the signed-in user profile. email, roles, status and password cannot be changed here. trainerProfile is only applied for trainers.',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  avatarUrl: { type: 'string', nullable: true, description: 'https URL or data:image/...;base64 (max 5 MB)' },
                  phone: { type: 'string' },
                  headline: { type: 'string' },
                  bio: { type: 'string' },
                  location: { type: 'string' },
                  college: { type: 'string' },
                  degree: { type: 'string' },
                  graduationYear: { type: 'string' },
                  department: { type: 'string' },
                  organization: { type: 'string' },
                  linkedinUrl: { type: 'string' },
                  portfolioUrl: { type: 'string' },
                  trainerProfile: {
                    type: 'object',
                    properties: {
                      domain: { type: 'string' },
                      experience: { type: 'string' },
                      organization: { type: 'string' },
                      linkedinUrl: { type: 'string' },
                      resumeName: { type: 'string' },
                      resumeSize: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated user profile' },
          401: { description: 'Unauthenticated' },
          422: { description: 'Validation failed' },
        },
      },
    },
    '/auth/google': {
      post: {
        summary: 'Sign In With Google',
        description:
          'Verifies a Google Identity Services ID token (credential) or exchanges an auth code. Creates an ACTIVE student account on first sign-in and sets the refresh cookie.',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { credential: { type: 'string' }, code: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: '{ user, accessToken } + httpOnly refresh cookie' },
          401: { description: 'INVALID_GOOGLE_TOKEN' },
          403: { description: 'ACCOUNT_SUSPENDED' },
        },
      },
    },
    '/admin/users/{id}/trainer': {
      patch: {
        summary: "Change / Remove a Student's Trainer",
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { trainerId: { type: 'string' }, unassign: { type: 'boolean' } },
              },
            },
          },
        },
        responses: {
          200: { description: '{ success, assignment }' },
          404: { description: 'User not found' },
          422: { description: 'NO_ACTIVE_ENROLLMENT or validation failed' },
        },
      },
    },
    '/admin/trainers/{id}/assignments': {
      get: {
        summary: "List a Trainer's Active Assignments",
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: '{ items, total }' }, 404: { description: 'Trainer not found' } },
      },
      post: {
        summary: 'Assign a Student Enrollment or Team to a Trainer',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { enrollmentId: { type: 'string' }, teamId: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          201: { description: 'Assignment created' },
          409: { description: 'DUPLICATE_ASSIGNMENT' },
          422: { description: 'Validation failed / not a trainer' },
        },
      },
    },
    '/admin/trainers/{trainerId}/assignments/{assignmentId}': {
      delete: {
        summary: 'Remove a Trainer Assignment',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'trainerId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'assignmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: '{ success: true }' }, 404: { description: 'Assignment not found' } },
      },
    },
    '/auth/forgot-password': {
      post: {
        summary: 'Forgot Password Request',
        description: 'Generates a secure password reset token and emails it to the user.',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ForgotPasswordRequest' } },
          },
        },
        responses: {
          200: { description: 'Reset link dispatched' },
        },
      },
    },
    '/auth/reset-password': {
      post: {
        summary: 'Reset Password',
        description: 'Sets a new password using the reset token and revokes all active user sessions.',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ResetPasswordRequest' } },
          },
        },
        responses: {
          200: { description: 'Password reset successful' },
          400: { description: 'Invalid or expired reset token' },
        },
      },
    },
    '/auth/otp/send': {
      post: {
        summary: 'Send One-Time Password (OTP)',
        description: 'Generates a cryptographically random 6-digit OTP, stores SHA-256 hash in DB with 5-minute expiry, and dispatches HTML email.',
        tags: ['OTP Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SendOtpRequest' } },
          },
        },
        responses: {
          200: { description: 'OTP sent to email', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } } },
          429: { description: 'Cooldown in progress (60s rate limit)' },
        },
      },
    },
    '/auth/otp/resend': {
      post: {
        summary: 'Resend OTP Code',
        description: 'Resends a fresh 6-digit OTP after checking 60-second cooldown.',
        tags: ['OTP Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SendOtpRequest' } },
          },
        },
        responses: {
          200: { description: 'OTP resent to email' },
          429: { description: 'Please wait before requesting a new OTP' },
        },
      },
    },
    '/auth/otp/verify-registration': {
      post: {
        summary: 'Verify Registration via OTP',
        description: 'Validates 6-digit OTP for REGISTRATION_VERIFY purpose, activates user account (ACTIVE, emailVerified: true), and logs the user in.',
        tags: ['OTP Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/VerifyRegistrationOtpRequest' } },
          },
        },
        responses: {
          200: { description: 'Registration verified and logged in', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
          400: { description: 'Invalid OTP or expired' },
        },
      },
    },
    '/auth/otp/login': {
      post: {
        summary: 'Passwordless Login via OTP',
        description: 'Authenticates user with 6-digit OTP, creates session, returns JWT Access Token, and sets Refresh Token cookie.',
        tags: ['OTP Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LoginOtpRequest' } },
          },
        },
        responses: {
          200: { description: 'OTP login successful', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
          400: { description: 'Invalid or expired OTP' },
          403: { description: 'Account suspended' },
        },
      },
    },
    '/auth/otp/verify-reset': {
      post: {
        summary: 'Verify Password Reset OTP',
        description: 'Validates 6-digit OTP for PASSWORD_RESET purpose and returns a secure reset token consumable by /reset-password.',
        tags: ['OTP Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/VerifyResetOtpRequest' } },
          },
        },
        responses: {
          200: { description: 'OTP verified, resetToken returned' },
          400: { description: 'Invalid or expired OTP' },
        },
      },
    },
    '/rbac/roles': {
      get: {
        summary: 'List All Roles & Permissions (Admin Only)',
        tags: ['RBAC Management'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Roles and mapped permissions' },
          403: { description: 'Forbidden - requires ADMIN role' },
        },
      },
    },
    '/rbac/permissions': {
      get: {
        summary: 'List All System Permissions (Admin Only)',
        tags: ['RBAC Management'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'List of all system permissions' },
          403: { description: 'Forbidden - requires ADMIN role' },
        },
      },
    },
    '/rbac/assign-role': {
      post: {
        summary: 'Assign Role to User',
        tags: ['RBAC Management'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/AssignRoleRequest' } },
          },
        },
        responses: {
          200: { description: 'Role assigned successfully' },
          403: { description: 'Forbidden - requires rbac:manage permission' },
        },
      },
    },
  },
};

const swaggerSpec = swaggerJsdoc({
  swaggerDefinition,
  apis: [], // Defined inline above for complete reliability
});

module.exports = { swaggerSpec };
