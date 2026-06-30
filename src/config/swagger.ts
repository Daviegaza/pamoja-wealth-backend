import { config } from "./index.js";

const apiUrl = `http://localhost:${config.port}/api/v1`;

export const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "Pamoja Wealth API",
    version: "1.0.0",
    description:
      "Backend API for Pamoja Wealth — a digital chama (investment group) platform for savings, lending, investments, meetings, and member management in East Africa.",
    contact: {
      name: "Pamoja Wealth",
      email: "noreply@pamojawealth.com",
    },
  },
  servers: [
    { url: apiUrl, description: "Local development" },
    { url: "https://api.pamojawealth.com/api/v1", description: "Production" },
  ],
  tags: [
    { name: "Health", description: "Service health checks" },
    { name: "Auth", description: "Authentication, registration, OTP, 2FA" },
    { name: "Users", description: "User profiles and search" },
    { name: "Chamas", description: "Investment groups management" },
    { name: "Wallet", description: "Wallet, deposits, withdrawals, bank & M-Pesa accounts" },
    { name: "Loans", description: "Chama loans, approvals, repayments" },
    { name: "Investments", description: "Group investment portfolio" },
    { name: "Meetings", description: "Meetings, RSVPs, minutes" },
    { name: "Votes", description: "Polls and voting" },
    { name: "Chat", description: "In-chama messaging" },
    { name: "Notifications", description: "User notifications" },
    { name: "Documents", description: "File upload and download" },
    { name: "Goals", description: "Savings goals" },
    { name: "Settings", description: "User preferences" },
    { name: "Network", description: "Connections and privacy" },
    { name: "AI", description: "AI chat, insights, health score" },
    { name: "Billing", description: "Subscription plans and invoices" },
  ],

  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT access token obtained from /auth/login",
      },
    },

    schemas: {
      // ── Envelope ──
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "NOT_FOUND" },
              message: { type: "string" },
              details: { type: "object" },
            },
          },
        },
      },
      PaginationMeta: {
        type: "object",
        properties: {
          page: { type: "integer", example: 1 },
          pageSize: { type: "integer", example: 20 },
          total: { type: "integer", example: 150 },
          totalPages: { type: "integer", example: 8 },
        },
      },

      // ── Auth ──
      RegisterRequest: {
        type: "object",
        required: ["email", "phone", "fullName", "password"],
        properties: {
          email: { type: "string", format: "email", example: "jane@example.com" },
          phone: { type: "string", example: "+254712345678" },
          fullName: { type: "string", example: "Jane Muthoni" },
          password: { type: "string", format: "password", example: "Str0ngP@ss1" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password" },
        },
      },
      VerifyOtpRequest: {
        type: "object",
        required: ["userId", "code"],
        properties: {
          userId: { type: "string", format: "uuid" },
          code: { type: "string", example: "123456" },
        },
      },
      ResendOtpRequest: {
        type: "object",
        required: ["userId"],
        properties: {
          userId: { type: "string", format: "uuid" },
        },
      },
      ForgotPasswordRequest: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email" },
        },
      },
      ResetPasswordRequest: {
        type: "object",
        required: ["token", "newPassword"],
        properties: {
          token: { type: "string" },
          newPassword: { type: "string", format: "password" },
        },
      },
      RefreshRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string" },
        },
      },
      Enable2faRequest: {
        type: "object",
        required: ["password"],
        properties: {
          password: { type: "string" },
        },
      },
      Verify2faRequest: {
        type: "object",
        required: ["code"],
        properties: {
          code: { type: "string", example: "123456" },
        },
      },
      AuthTokensResponse: {
        type: "object",
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          user: { $ref: "#/components/schemas/UserProfile" },
        },
      },

      // ── Users ──
      UpdateProfileRequest: {
        type: "object",
        properties: {
          fullName: { type: "string" },
          phone: { type: "string" },
          location: { type: "string" },
          avatarUrl: { type: "string", format: "uri" },
          nationalId: { type: "string" },
        },
      },
      UserProfile: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          fullName: { type: "string" },
          avatarUrl: { type: "string", nullable: true },
          location: { type: "string", nullable: true },
          nationalId: { type: "string", nullable: true },
          isVerified: { type: "boolean" },
          isActive: { type: "boolean" },
          twoFactorEnabled: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      PublicProfile: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          fullName: { type: "string" },
          avatarUrl: { type: "string", nullable: true },
          location: { type: "string", nullable: true },
        },
      },

      // ── Chamas ──
      CreateChamaRequest: {
        type: "object",
        required: ["name", "category"],
        properties: {
          name: { type: "string", example: "Upendo Investment Group" },
          description: { type: "string" },
          category: { type: "string", enum: ["savings", "investment", "welfare", "mixed"] },
          monthlyContribution: { type: "number", default: 0 },
          location: { type: "string" },
        },
      },
      UpdateChamaRequest: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          monthlyContribution: { type: "number" },
          location: { type: "string" },
          status: { type: "string", enum: ["active", "dormant", "archived"] },
        },
      },
      JoinChamaRequest: {
        type: "object",
        required: ["inviteCode"],
        properties: {
          inviteCode: { type: "string" },
        },
      },
      InviteMemberRequest: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
        },
      },
      ChamaDetail: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          category: { type: "string" },
          logoUrl: { type: "string", nullable: true },
          location: { type: "string", nullable: true },
          monthlyContribution: { type: "number" },
          totalFunds: { type: "number" },
          status: { type: "string" },
          nextMeetingDate: { type: "string", format: "date", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Membership: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          userId: { type: "string", format: "uuid" },
          chamaId: { type: "string", format: "uuid" },
          role: { type: "string", enum: ["owner", "admin", "chairperson", "treasurer", "secretary", "member"] },
          totalContributions: { type: "number" },
          shares: { type: "integer" },
          contributionStreak: { type: "integer" },
          status: { type: "string", enum: ["active", "inactive", "suspended"] },
          joinedAt: { type: "string", format: "date-time" },
          user: { $ref: "#/components/schemas/PublicProfile" },
        },
      },

      // ── Wallet ──
      DepositRequest: {
        type: "object",
        required: ["amount", "method"],
        properties: {
          amount: { type: "number", example: 5000 },
          method: { type: "string", enum: ["mpesa", "bank", "card"] },
          chamaId: { type: "string", format: "uuid" },
        },
      },
      WithdrawRequest: {
        type: "object",
        required: ["amount", "method", "destination"],
        properties: {
          amount: { type: "number", example: 2000 },
          method: { type: "string", enum: ["mpesa", "bank"] },
          destination: { type: "string", example: "+254712345678" },
        },
      },
      AddBankAccountRequest: {
        type: "object",
        required: ["bankName", "accountNumber", "accountName"],
        properties: {
          bankName: { type: "string" },
          accountNumber: { type: "string" },
          accountName: { type: "string" },
        },
      },
      AddMpesaAccountRequest: {
        type: "object",
        required: ["phoneNumber"],
        properties: {
          phoneNumber: { type: "string", example: "+254712345678" },
        },
      },
      WalletDetail: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          balance: { type: "number" },
          currency: { type: "string" },
          pendingBalance: { type: "number" },
          totalDeposits: { type: "number" },
          totalWithdrawals: { type: "number" },
          lastTransactionAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      Transaction: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["contribution", "withdrawal", "loan_disbursement", "loan_repayment", "investment", "dividend", "fee", "transfer"] },
          amount: { type: "number" },
          balanceAfter: { type: "number" },
          method: { type: "string", enum: ["mpesa", "bank", "card", "cash"], nullable: true },
          reference: { type: "string" },
          description: { type: "string", nullable: true },
          status: { type: "string", enum: ["completed", "pending", "failed", "reversed"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },

      // ── Loans ──
      CreateLoanRequest: {
        type: "object",
        required: ["chamaId", "amount", "termMonths", "purpose"],
        properties: {
          chamaId: { type: "string", format: "uuid" },
          amount: { type: "number", example: 50000 },
          termMonths: { type: "integer", example: 12 },
          purpose: { type: "string", example: "Business expansion" },
          guarantorIds: { type: "array", items: { type: "string", format: "uuid" } },
        },
      },
      RepayLoanRequest: {
        type: "object",
        required: ["amount"],
        properties: {
          amount: { type: "number", example: 5000 },
        },
      },
      LoanDetail: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          chamaId: { type: "string", format: "uuid" },
          borrowerId: { type: "string", format: "uuid" },
          amount: { type: "number" },
          interestRate: { type: "number" },
          termMonths: { type: "integer" },
          amountRepaid: { type: "number" },
          purpose: { type: "string" },
          status: { type: "string", enum: ["pending", "approved", "active", "completed", "defaulted", "rejected"] },
          appliedDate: { type: "string", format: "date-time" },
          approvedDate: { type: "string", format: "date-time", nullable: true },
          dueDate: { type: "string", format: "date" },
        },
      },
      LoanRepayment: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          loanId: { type: "string", format: "uuid" },
          amount: { type: "number" },
          principal: { type: "number" },
          interest: { type: "number" },
          dueDate: { type: "string", format: "date" },
          paidDate: { type: "string", format: "date-time", nullable: true },
          status: { type: "string", enum: ["pending", "paid", "overdue"] },
        },
      },

      // ── Investments ──
      CreateInvestmentRequest: {
        type: "object",
        required: ["chamaId", "name", "type", "amountInvested", "riskLevel", "startDate"],
        properties: {
          chamaId: { type: "string", format: "uuid" },
          name: { type: "string", example: "Safaricom Shares" },
          type: { type: "string", enum: ["real_estate", "stocks", "bonds", "treasury_bills", "money_market", "sacco"] },
          amountInvested: { type: "number", example: 100000 },
          riskLevel: { type: "string", enum: ["low", "medium", "high"] },
          startDate: { type: "string", format: "date" },
          maturityDate: { type: "string", format: "date" },
        },
      },
      UpdateInvestmentRequest: {
        type: "object",
        properties: {
          currentValue: { type: "number" },
          roi: { type: "number" },
          status: { type: "string", enum: ["active", "matured", "closed", "pending"] },
        },
      },
      InvestmentDetail: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          chamaId: { type: "string", format: "uuid" },
          name: { type: "string" },
          type: { type: "string" },
          amountInvested: { type: "number" },
          currentValue: { type: "number" },
          roi: { type: "number" },
          riskLevel: { type: "string" },
          status: { type: "string" },
          startDate: { type: "string", format: "date" },
          maturityDate: { type: "string", format: "date", nullable: true },
        },
      },

      // ── Meetings ──
      CreateMeetingRequest: {
        type: "object",
        required: ["chamaId", "title", "date", "time", "location"],
        properties: {
          chamaId: { type: "string", format: "uuid" },
          title: { type: "string", example: "Monthly Review" },
          description: { type: "string" },
          date: { type: "string", format: "date", example: "2026-07-15" },
          time: { type: "string", example: "14:00" },
          location: { type: "string", example: "Community Hall" },
          isVirtual: { type: "boolean", default: false },
          agenda: { type: "array", items: { type: "string" } },
        },
      },
      UpdateMeetingRequest: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          date: { type: "string", format: "date" },
          time: { type: "string" },
          location: { type: "string" },
          status: { type: "string", enum: ["scheduled", "ongoing", "completed", "cancelled"] },
        },
      },
      RsvpRequest: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["attending", "declined", "tentative"] },
        },
      },
      MeetingMinutesRequest: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string" },
        },
      },
      MeetingDetail: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          chamaId: { type: "string", format: "uuid" },
          createdById: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string", nullable: true },
          agenda: { type: "array", items: { type: "string" } },
          date: { type: "string", format: "date" },
          time: { type: "string" },
          location: { type: "string" },
          isVirtual: { type: "boolean" },
          status: { type: "string" },
          attendeesCount: { type: "integer" },
          totalInvited: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
        },
      },

      // ── Votes ──
      CreateVoteRequest: {
        type: "object",
        required: ["chamaId", "title", "options", "closesAt"],
        properties: {
          chamaId: { type: "string", format: "uuid" },
          title: { type: "string", example: "Should we increase monthly contributions?" },
          description: { type: "string" },
          options: { type: "array", items: { type: "string" }, example: ["Yes", "No", "Abstain"] },
          closesAt: { type: "string", format: "date-time" },
        },
      },
      CastVoteRequest: {
        type: "object",
        required: ["optionId"],
        properties: {
          optionId: { type: "string", format: "uuid" },
        },
      },
      VoteDetail: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          chamaId: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string", nullable: true },
          status: { type: "string", enum: ["open", "closed", "passed", "rejected"] },
          closesAt: { type: "string", format: "date-time" },
          options: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, count: { type: "integer" } } } },
        },
      },

      // ── Goals ──
      CreateGoalRequest: {
        type: "object",
        required: ["name", "targetAmount", "targetDate"],
        properties: {
          name: { type: "string", example: "Emergency Fund" },
          targetAmount: { type: "number", example: 100000 },
          targetDate: { type: "string", format: "date", example: "2026-12-31" },
          chamaId: { type: "string", format: "uuid" },
        },
      },
      UpdateGoalRequest: {
        type: "object",
        properties: {
          name: { type: "string" },
          targetAmount: { type: "number" },
          targetDate: { type: "string", format: "date" },
        },
      },

      // ── Settings ──
      UpdateSettingsRequest: {
        type: "object",
        properties: {
          theme: { type: "string", enum: ["light", "dark", "system"] },
          language: { type: "string", enum: ["en", "sw"] },
          currency: { type: "string", enum: ["KES", "UGX", "TZS", "RWF", "NGN", "GHS", "ZAR", "EGP"] },
          emailNotifications: { type: "boolean" },
          smsNotifications: { type: "boolean" },
          pushNotifications: { type: "boolean" },
        },
      },

      // ── Notifications ──
      Notification: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["info", "success", "warning", "error", "loan", "meeting", "vote", "wallet"] },
          title: { type: "string" },
          message: { type: "string" },
          isRead: { type: "boolean" },
          actionUrl: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },

      // ── Chat ──
      ChatMessage: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          chamaId: { type: "string", format: "uuid" },
          userId: { type: "string", format: "uuid" },
          content: { type: "string" },
          user: { $ref: "#/components/schemas/PublicProfile" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      SendMessageRequest: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string" },
        },
      },

      // ── AI ──
      AiChatRequest: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string" },
          chamaId: { type: "string", format: "uuid" },
        },
      },
      AiInsightsRequest: {
        type: "object",
        properties: {
          chamaId: { type: "string", format: "uuid" },
        },
      },
      AiHealthScoreRequest: {
        type: "object",
        properties: {
          chamaId: { type: "string", format: "uuid" },
        },
      },
    },

    responses: {
      Unauthorized: {
        description: "Authentication required or token expired",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Forbidden: {
        description: "Insufficient permissions for this action",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "Resource not found",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      ServerError: {
        description: "Unexpected server error",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },

  security: [{ bearerAuth: [] }],

  paths: {
    // ════════════════════════════════════════════════════════════
    // HEALTH
    // ════════════════════════════════════════════════════════════
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Service health check",
        description: "Verifies database and Redis connectivity.",
        security: [],
        responses: {
          200: {
            description: "Health status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        status: { type: "string", example: "ok" },
                        uptime: { type: "number" },
                        db: { type: "string" },
                        redis: { type: "string" },
                        timestamp: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // AUTH
    // ════════════════════════════════════════════════════════════
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new user",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterRequest" } } },
        },
        responses: {
          201: { description: "User registered. Check email/phone for OTP.", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { userId: { type: "string" }, message: { type: "string" } } } } } } } },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          409: { description: "Email or phone already taken", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login with email and password",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } },
        },
        responses: {
          200: { description: "Tokens issued", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/AuthTokensResponse" } } } } } },
          401: { description: "Invalid credentials or unverified account", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          429: { description: "Rate limited", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/verify-otp": {
      post: {
        tags: ["Auth"],
        summary: "Verify OTP to activate account",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/VerifyOtpRequest" } } },
        },
        responses: {
          200: { description: "Account verified. Returns auth tokens.", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/AuthTokensResponse" } } } } } },
          400: { description: "Invalid or expired OTP", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/resend-otp": {
      post: {
        tags: ["Auth"],
        summary: "Resend OTP code",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ResendOtpRequest" } } },
        },
        responses: {
          200: { description: "OTP resent" },
          429: { description: "Rate limited (1 per 30s)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/forgot-password": {
      post: {
        tags: ["Auth"],
        summary: "Request password reset",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ForgotPasswordRequest" } } },
        },
        responses: {
          200: { description: "Reset link sent to email" },
          429: { description: "Rate limited", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/reset-password": {
      post: {
        tags: ["Auth"],
        summary: "Reset password with token",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ResetPasswordRequest" } } },
        },
        responses: {
          200: { description: "Password reset successful" },
          400: { description: "Invalid or expired reset token", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rotate refresh token to get new access token",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshRequest" } } },
        },
        responses: {
          200: { description: "New token pair", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/AuthTokensResponse" } } } } } },
          401: { description: "Invalid or blocked refresh token", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Logout and block refresh token",
        responses: {
          200: { description: "Logged out successfully" },
        },
      },
    },
    "/auth/enable-2fa": {
      post: {
        tags: ["Auth"],
        summary: "Enable two-factor authentication",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Enable2faRequest" } } },
        },
        responses: {
          200: { description: "2FA enabled. Returns QR code and backup codes." },
          401: { description: "Wrong password", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/verify-2fa": {
      post: {
        tags: ["Auth"],
        summary: "Verify 2FA code and bind to account",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Verify2faRequest" } } },
        },
        responses: {
          200: { description: "2FA verified and activated" },
          400: { description: "Invalid 2FA code", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // USERS
    // ════════════════════════════════════════════════════════════
    "/users/me": {
      get: {
        tags: ["Users"],
        summary: "Get current user profile",
        responses: {
          200: { description: "Current user", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/UserProfile" } } } } } },
        },
      },
      patch: {
        tags: ["Users"],
        summary: "Update current user profile",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateProfileRequest" } } },
        },
        responses: {
          200: { description: "Profile updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/UserProfile" } } } } } },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/users/me/profile": {
      get: {
        tags: ["Users"],
        summary: "Get current user's full profile",
        responses: {
          200: { description: "Full profile", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/UserProfile" } } } } } },
        },
      },
    },
    "/users/me/enable-2fa": {
      post: {
        tags: ["Users"],
        summary: "Enable 2FA on current user",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Enable2faRequest" } } },
        },
        responses: {
          200: { description: "2FA setup initiated" },
        },
      },
    },
    "/users/me/verify-2fa": {
      post: {
        tags: ["Users"],
        summary: "Verify and activate 2FA",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Verify2faRequest" } } },
        },
        responses: {
          200: { description: "2FA activated" },
        },
      },
    },
    "/users/search": {
      get: {
        tags: ["Users"],
        summary: "Search users by name, email, or phone",
        parameters: [{ name: "q", in: "query", schema: { type: "string" }, description: "Search query" }],
        responses: {
          200: { description: "Search results", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/PublicProfile" } } } } } } },
        },
      },
    },
    "/users/{id}": {
      get: {
        tags: ["Users"],
        summary: "Get a user's public profile",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Public profile", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/PublicProfile" } } } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // CHAMAS
    // ════════════════════════════════════════════════════════════
    "/chamas": {
      get: {
        tags: ["Chamas"],
        summary: "List chamas",
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "category", in: "query", schema: { type: "string", enum: ["savings", "investment", "welfare", "mixed"] } },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "dormant", "archived"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          200: { description: "Chama list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/ChamaDetail" } }, meta: { $ref: "#/components/schemas/PaginationMeta" } } } } } },
        },
      },
      post: {
        tags: ["Chamas"],
        summary: "Create a new chama",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateChamaRequest" } } },
        },
        responses: {
          201: { description: "Chama created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/ChamaDetail" } } } } } },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/chamas/{id}": {
      get: {
        tags: ["Chamas"],
        summary: "Get chama by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Chama detail", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/ChamaDetail" } } } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Chamas"],
        summary: "Update chama details",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateChamaRequest" } } },
        },
        responses: {
          200: { description: "Chama updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/ChamaDetail" } } } } } },
          403: { $ref: "#/components/responses/Forbidden" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Chamas"],
        summary: "Delete a chama",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Chama deleted" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/chamas/{id}/members": {
      get: {
        tags: ["Chamas"],
        summary: "List chama members",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "role", in: "query", schema: { type: "string", enum: ["owner", "admin", "chairperson", "treasurer", "secretary", "member"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          200: { description: "Member list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/Membership" } }, meta: { $ref: "#/components/schemas/PaginationMeta" } } } } } },
        },
      },
    },
    "/chamas/{id}/join": {
      post: {
        tags: ["Chamas"],
        summary: "Join a chama with an invite code",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/JoinChamaRequest" } } },
        },
        responses: {
          200: { description: "Join request submitted (or approved)", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Membership" } } } } } },
          400: { description: "Invalid or expired invite code", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/chamas/{id}/invite": {
      post: {
        tags: ["Chamas"],
        summary: "Invite a member to the chama",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/InviteMemberRequest" } } },
        },
        responses: {
          200: { description: "Invitation sent" },
          403: { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/chamas/{id}/approve-join/{userId}": {
      post: {
        tags: ["Chamas"],
        summary: "Approve a pending join request",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          200: { description: "Member approved" },
          403: { $ref: "#/components/responses/Forbidden" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/chamas/{id}/remove-member/{userId}": {
      post: {
        tags: ["Chamas"],
        summary: "Remove a member from the chama",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          200: { description: "Member removed" },
          403: { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/chamas/{id}/stats": {
      get: {
        tags: ["Chamas"],
        summary: "Get chama statistics",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Chama stats (totalMembers, totalFunds, activeLoans, etc.)" },
        },
      },
    },
    "/chamas/{id}/analytics": {
      get: {
        tags: ["Chamas"],
        summary: "Get chama analytics",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "period", in: "query", schema: { type: "string", enum: ["daily", "monthly", "yearly"], default: "monthly" } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: {
          200: { description: "Analytics data" },
          403: { $ref: "#/components/responses/Forbidden" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // WALLET
    // ════════════════════════════════════════════════════════════
    "/wallet": {
      get: {
        tags: ["Wallet"],
        summary: "Get current user's wallet",
        responses: {
          200: { description: "Wallet details", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/WalletDetail" } } } } } },
        },
      },
    },
    "/wallet/deposit": {
      post: {
        tags: ["Wallet"],
        summary: "Initiate a deposit",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/DepositRequest" } } },
        },
        responses: {
          200: { description: "Deposit initiated. Returns payment instructions.", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { transactionId: { type: "string" }, checkoutUrl: { type: "string", nullable: true } } } } } } } },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/wallet/deposit/mpesa-callback": {
      post: {
        tags: ["Wallet"],
        summary: "M-Pesa payment callback (Safaricom Daraja)",
        security: [],
        description: "Internal webhook endpoint. Receives STK push result from Safaricom.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { Body: { type: "object", properties: { stkCallback: { type: "object" } } } } } } },
        },
        responses: {
          200: { description: "Callback processed" },
        },
      },
    },
    "/wallet/withdraw": {
      post: {
        tags: ["Wallet"],
        summary: "Withdraw funds",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/WithdrawRequest" } } },
        },
        responses: {
          200: { description: "Withdrawal initiated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Transaction" } } } } } },
          422: { description: "Insufficient funds", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/wallet/history": {
      get: {
        tags: ["Wallet"],
        summary: "Get wallet transaction history (summary)",
        parameters: [{ name: "days", in: "query", schema: { type: "integer", default: 90 } }],
        responses: {
          200: { description: "Wallet history summary" },
        },
      },
    },
    "/wallet/transactions": {
      get: {
        tags: ["Wallet"],
        summary: "List wallet transactions",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } },
          { name: "type", in: "query", schema: { type: "string", enum: ["contribution", "withdrawal", "loan_disbursement", "loan_repayment", "investment", "dividend", "fee", "transfer"] } },
          { name: "status", in: "query", schema: { type: "string", enum: ["completed", "pending", "failed", "reversed"] } },
          { name: "chamaId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "days", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          200: { description: "Transactions list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/Transaction" } }, meta: { $ref: "#/components/schemas/PaginationMeta" } } } } } },
        },
      },
    },
    "/wallet/bank-accounts": {
      get: {
        tags: ["Wallet"],
        summary: "List user's bank accounts",
        responses: {
          200: { description: "Bank accounts list" },
        },
      },
      post: {
        tags: ["Wallet"],
        summary: "Add a bank account",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AddBankAccountRequest" } } },
        },
        responses: {
          201: { description: "Bank account added" },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/wallet/bank-accounts/{id}": {
      delete: {
        tags: ["Wallet"],
        summary: "Remove a bank account",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Bank account removed" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/wallet/mpesa-accounts": {
      get: {
        tags: ["Wallet"],
        summary: "List user's M-Pesa accounts",
        responses: {
          200: { description: "M-Pesa accounts list" },
        },
      },
      post: {
        tags: ["Wallet"],
        summary: "Add an M-Pesa account",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AddMpesaAccountRequest" } } },
        },
        responses: {
          201: { description: "M-Pesa account added" },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/wallet/mpesa-accounts/{id}": {
      delete: {
        tags: ["Wallet"],
        summary: "Remove an M-Pesa account",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "M-Pesa account removed" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // LOANS
    // ════════════════════════════════════════════════════════════
    "/loans": {
      get: {
        tags: ["Loans"],
        summary: "List loans",
        parameters: [
          { name: "chamaId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["pending", "approved", "active", "completed", "defaulted", "rejected"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          200: { description: "Loan list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/LoanDetail" } }, meta: { $ref: "#/components/schemas/PaginationMeta" } } } } } },
        },
      },
      post: {
        tags: ["Loans"],
        summary: "Apply for a loan",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateLoanRequest" } } },
        },
        responses: {
          201: { description: "Loan application submitted", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/LoanDetail" } } } } } },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/loans/{id}": {
      get: {
        tags: ["Loans"],
        summary: "Get loan by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Loan detail", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/LoanDetail" } } } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/loans/{id}/approve": {
      post: {
        tags: ["Loans"],
        summary: "Approve a loan application",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Loan approved", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/LoanDetail" } } } } } },
          403: { $ref: "#/components/responses/Forbidden" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/loans/{id}/reject": {
      post: {
        tags: ["Loans"],
        summary: "Reject a loan application",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Loan rejected", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/LoanDetail" } } } } } },
          403: { $ref: "#/components/responses/Forbidden" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/loans/{id}/repay": {
      post: {
        tags: ["Loans"],
        summary: "Make a loan repayment",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RepayLoanRequest" } } },
        },
        responses: {
          200: { description: "Repayment processed", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/LoanRepayment" } } } } } },
          400: { description: "Invalid repayment amount", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/loans/{id}/repayments": {
      get: {
        tags: ["Loans"],
        summary: "Get loan repayment schedule",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Repayment schedule", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/LoanRepayment" } } } } } } },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // INVESTMENTS
    // ════════════════════════════════════════════════════════════
    "/investments": {
      get: {
        tags: ["Investments"],
        summary: "List investments",
        parameters: [
          { name: "chamaId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "type", in: "query", schema: { type: "string", enum: ["real_estate", "stocks", "bonds", "treasury_bills", "money_market", "sacco"] } },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "matured", "closed", "pending"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          200: { description: "Investment list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/InvestmentDetail" } }, meta: { $ref: "#/components/schemas/PaginationMeta" } } } } } },
        },
      },
      post: {
        tags: ["Investments"],
        summary: "Create a new investment",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateInvestmentRequest" } } },
        },
        responses: {
          201: { description: "Investment created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/InvestmentDetail" } } } } } },
          403: { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/investments/{id}": {
      get: {
        tags: ["Investments"],
        summary: "Get investment by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Investment detail", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/InvestmentDetail" } } } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Investments"],
        summary: "Update investment value and status",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateInvestmentRequest" } } },
        },
        responses: {
          200: { description: "Investment updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/InvestmentDetail" } } } } } },
          403: { $ref: "#/components/responses/Forbidden" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // MEETINGS
    // ════════════════════════════════════════════════════════════
    "/meetings": {
      get: {
        tags: ["Meetings"],
        summary: "List meetings",
        parameters: [
          { name: "chamaId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["scheduled", "ongoing", "completed", "cancelled"] } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          200: { description: "Meeting list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/MeetingDetail" } }, meta: { $ref: "#/components/schemas/PaginationMeta" } } } } } },
        },
      },
      post: {
        tags: ["Meetings"],
        summary: "Schedule a new meeting",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateMeetingRequest" } } },
        },
        responses: {
          201: { description: "Meeting scheduled", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/MeetingDetail" } } } } } },
          403: { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/meetings/{id}": {
      get: {
        tags: ["Meetings"],
        summary: "Get meeting by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Meeting detail", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/MeetingDetail" } } } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Meetings"],
        summary: "Update meeting details",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateMeetingRequest" } } },
        },
        responses: {
          200: { description: "Meeting updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/MeetingDetail" } } } } } },
          403: { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/meetings/{id}/rsvp": {
      post: {
        tags: ["Meetings"],
        summary: "RSVP to a meeting",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RsvpRequest" } } },
        },
        responses: {
          200: { description: "RSVP recorded" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/meetings/{id}/minutes": {
      post: {
        tags: ["Meetings"],
        summary: "Save meeting minutes",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/MeetingMinutesRequest" } } },
        },
        responses: {
          200: { description: "Minutes saved" },
          403: { $ref: "#/components/responses/Forbidden" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // VOTES
    // ════════════════════════════════════════════════════════════
    "/votes": {
      get: {
        tags: ["Votes"],
        summary: "List votes",
        parameters: [
          { name: "chamaId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["open", "closed", "passed", "rejected"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          200: { description: "Vote list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/VoteDetail" } }, meta: { $ref: "#/components/schemas/PaginationMeta" } } } } } },
        },
      },
      post: {
        tags: ["Votes"],
        summary: "Create a new vote/poll",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateVoteRequest" } } },
        },
        responses: {
          201: { description: "Vote created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/VoteDetail" } } } } } },
          403: { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/votes/{id}": {
      get: {
        tags: ["Votes"],
        summary: "Get vote by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Vote detail", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/VoteDetail" } } } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/votes/{id}/cast": {
      post: {
        tags: ["Votes"],
        summary: "Cast a vote",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CastVoteRequest" } } },
        },
        responses: {
          200: { description: "Vote cast" },
          400: { description: "Vote already closed or option invalid", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/votes/{id}/close": {
      post: {
        tags: ["Votes"],
        summary: "Close a vote",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Vote closed", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/VoteDetail" } } } } } },
          403: { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/votes/{id}/results": {
      get: {
        tags: ["Votes"],
        summary: "Get vote results",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Vote results with option tallies" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // CHAT
    // ════════════════════════════════════════════════════════════
    "/chat/chamas/{id}/messages": {
      get: {
        tags: ["Chat"],
        summary: "Get chat messages for a chama",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "Chama ID" }],
        responses: {
          200: { description: "Chat messages", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/ChatMessage" } } } } } } },
        },
      },
      post: {
        tags: ["Chat"],
        summary: "Send a chat message to a chama",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "Chama ID" }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/SendMessageRequest" } } },
        },
        responses: {
          201: { description: "Message sent", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/ChatMessage" } } } } } },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ════════════════════════════════════════════════════════════
    "/notifications": {
      get: {
        tags: ["Notifications"],
        summary: "List user notifications",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          200: { description: "Notification list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/Notification" } }, meta: { $ref: "#/components/schemas/PaginationMeta" } } } } } },
        },
      },
    },
    "/notifications/read-all": {
      post: {
        tags: ["Notifications"],
        summary: "Mark all notifications as read",
        responses: {
          200: { description: "All notifications marked as read" },
        },
      },
    },
    "/notifications/{id}": {
      delete: {
        tags: ["Notifications"],
        summary: "Delete a notification",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Notification deleted" },
        },
      },
    },
    "/notifications/{id}/read": {
      post: {
        tags: ["Notifications"],
        summary: "Mark a notification as read",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Notification marked as read" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // DOCUMENTS
    // ════════════════════════════════════════════════════════════
    "/documents": {
      get: {
        tags: ["Documents"],
        summary: "List user's documents",
        responses: {
          200: { description: "Document list" },
        },
      },
    },
    "/documents/upload": {
      post: {
        tags: ["Documents"],
        summary: "Upload a document",
        description: "Upload a file (PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG, GIF, WEBP) up to 25MB.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary" },
                  chamaId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Document uploaded" },
          400: { description: "Invalid file type or size", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          429: { description: "Rate limited", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/documents/{id}/download": {
      get: {
        tags: ["Documents"],
        summary: "Download a document",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "File download (binary)" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/documents/{id}": {
      delete: {
        tags: ["Documents"],
        summary: "Delete a document",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Document deleted" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // GOALS
    // ════════════════════════════════════════════════════════════
    "/goals": {
      get: {
        tags: ["Goals"],
        summary: "List savings goals",
        responses: {
          200: { description: "Goal list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, targetAmount: { type: "number" }, currentAmount: { type: "number" }, targetDate: { type: "string", format: "date" }, chamaId: { type: "string", nullable: true } } } } } } } } },
        },
      },
      post: {
        tags: ["Goals"],
        summary: "Create a savings goal",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateGoalRequest" } } },
        },
        responses: {
          201: { description: "Goal created" },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/goals/{id}": {
      patch: {
        tags: ["Goals"],
        summary: "Update a savings goal",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateGoalRequest" } } },
        },
        responses: {
          200: { description: "Goal updated" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Goals"],
        summary: "Delete a savings goal",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Goal deleted" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // SETTINGS
    // ════════════════════════════════════════════════════════════
    "/settings": {
      get: {
        tags: ["Settings"],
        summary: "Get user settings",
        responses: {
          200: { description: "User settings" },
        },
      },
      patch: {
        tags: ["Settings"],
        summary: "Update user settings",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateSettingsRequest" } } },
        },
        responses: {
          200: { description: "Settings updated" },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // NETWORK
    // ════════════════════════════════════════════════════════════
    "/network/connections": {
      get: {
        tags: ["Network"],
        summary: "Get user's network connections",
        responses: {
          200: { description: "Connection list" },
        },
      },
    },
    "/network/stats": {
      get: {
        tags: ["Network"],
        summary: "Get network statistics",
        responses: {
          200: { description: "Network stats" },
        },
      },
    },
    "/network/privacy": {
      get: {
        tags: ["Network"],
        summary: "Get privacy settings",
        responses: {
          200: { description: "Privacy settings" },
        },
      },
      patch: {
        tags: ["Network"],
        summary: "Update privacy settings",
        responses: {
          200: { description: "Privacy settings updated" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // AI
    // ════════════════════════════════════════════════════════════
    "/ai/chat": {
      post: {
        tags: ["AI"],
        summary: "AI chat",
        description: "Chat with the AI assistant about your chama's finances, investments, and operations.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AiChatRequest" } } },
        },
        responses: {
          200: { description: "AI response", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { reply: { type: "string" } } } } } } } },
          429: { description: "Rate limited", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/ai/insights": {
      post: {
        tags: ["AI"],
        summary: "Get AI-generated insights",
        description: "Generate financial and operational insights for a chama.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AiInsightsRequest" } } },
        },
        responses: {
          200: { description: "AI insights" },
        },
      },
    },
    "/ai/health-score": {
      post: {
        tags: ["AI"],
        summary: "Get AI-calculated chama health score",
        description: "Calculate a financial health score for a chama using AI analysis.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AiHealthScoreRequest" } } },
        },
        responses: {
          200: { description: "Health score result" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════
    // BILLING
    // ════════════════════════════════════════════════════════════
    "/billing/plan": {
      get: {
        tags: ["Billing"],
        summary: "Get current subscription plan",
        responses: {
          200: { description: "Current plan details" },
        },
      },
    },
    "/billing/upgrade": {
      post: {
        tags: ["Billing"],
        summary: "Upgrade subscription plan",
        responses: {
          200: { description: "Upgrade initiated" },
        },
      },
    },
    "/billing/cancel": {
      post: {
        tags: ["Billing"],
        summary: "Cancel subscription",
        responses: {
          200: { description: "Subscription cancelled" },
        },
      },
    },
    "/billing/invoices": {
      get: {
        tags: ["Billing"],
        summary: "Get invoice history",
        responses: {
          200: { description: "Invoice list" },
        },
      },
    },
  },
} as const;
