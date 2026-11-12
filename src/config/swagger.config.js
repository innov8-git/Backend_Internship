'use strict';

const swaggerJsdoc = require('swagger-jsdoc');
const config = require('./index');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Internship Portal Backend API',
    version: '1.0.0',
    description:
      'Production-grade RESTful API for the Internship Portal supporting Role-Based Access Control (RBAC), Supabase PostgreSQL database, JWT authentication, and automated task workflows.',
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
          role: { type: 'string', enum: ['STUDENT', 'TRAINER'], default: 'STUDENT' },
        },
      },
      RegisterTrainerRequest: {
        type: 'object',
        required: ['name', 'email', 'password', 'role', 'domain', 'experience'],
        properties: {
          name: { type: 'string', example: 'Sarah Connor' },
          email: { type: 'string', format: 'email', example: 'sarah.trainer@example.com' },
          password: { type: 'string', format: 'password', example: 'MentorPass123' },
          role: { type: 'string', example: 'TRAINER' },
          domain: { type: 'string', example: 'Full Stack Web Development' },
          experience: { type: 'string', example: '5-8 years' },
          linkedinUrl: { type: 'string', example: 'https://linkedin.com/in/sarah-mentor' },
          organization: { type: 'string', example: 'Tech Labs' },
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
    '/auth/register': {
      post: {
        summary: 'Register a new Student or Trainer',
        description: 'Single registration endpoint with conditional validation for Students vs Trainers.',
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
    '/auth/verify-email/{token}': {
      get: {
        summary: 'Verify Email Address',
        description: 'Validates one-time verification token and marks account as ACTIVE.',
        tags: ['Authentication'],
        parameters: [
          { in: 'path', name: 'token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Email verified' },
          400: { description: 'Invalid or expired token' },
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

