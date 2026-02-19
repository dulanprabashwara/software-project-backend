# Easy Blogger Backend 🚀

A robust, production-ready Node.js/Express backend for a professional blogging platform (similar to Medium). Built with performance, security, and scalability in mind using PostgreSQL and Prisma ORM.

## 🌟 Features

- **Authentication:** Firebase Auth integration with secure JWT verification.
- **User Management:** detailed profiles, roles (USER, ADMIN), premium status via subscription.
- **Content Engine:** Full CRUD for articles with slugs, tags, and reading time calculation.
- **Engagement:** Like, comment (threaded), share, save-to-library, and follow users.
- **Social Mechanics:**
  - **Stories:** Ephemeral 24h content.
  - **Messaging:** Real-time private chat (Socket.IO).
  - **Feed:** Personalized content from followed authors.
  - **Notifications:** Real-time alerts for interactions.
- **Analytics:** Tracking views, reads (scrolled to bottom), and trending topics.
- **Moderation:** Report system, user banning, and Admin Dashboard with audit logs.
- **Security:** Rate limiting, Helmet headers, CORS, and role-based access control (RBAC).

## 🛠️ Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** PostgreSQL (hosted on NeonDB)
- **ORM:** Prisma
- **Real-time:** Socket.IO
- **Auth:** Firebase Admin SDK
- **Tools:** `morgan` (logging), `helmet` (security), `dotenv` (config)

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- PostgreSQL Database (or NeonDB account)
- Firebase Project (Service Account)

### 1. Clone the Repository

```bash
git clone https://github.com/dulanprabashwara/software-project-backend.git
cd software-project-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Create a `.env` file in the root directory:

```properties
PORT=5000
NODE_ENV=development

# Database Connection
# NeonDB connection string (Pooling URL recommended for production)
DATABASE_URL="postgresql://neondb_owner:...........@ep-tiny-lab.aws.neon.tech/neondb?sslmode=require"

# Firebase Service Account (JSON stringified)
# Convert your serviceAccountKey.json to a single line string
FIREBASE_SERVICE_ACCOUNT='{ "type": "service_account", "project_id": "...", ... }'

# JWT Secret (for optional custom issuing)
JWT_SECRET=your_secure_random_string
JWT_EXPIRES_IN=7d

# Frontend URL (for CORS)
CLIENT_URL=http://localhost:5173
```

### 4. Database Setup

Using **Prisma** to manage the schema:

```bash
# Generate Prisma Client
npx prisma generate

# Run Migrations (Apply schema to DB)
npx prisma migrate dev

# Seed Initial Data (Admin user, topics)
npx prisma db seed
```

### 5. Run the Server

```bash
# Development Mode (with nodemon)
npm run dev

# Production Mode
npm start
```

Server will start at `http://localhost:5000`.

---

## 📚 Database Workflow

We use **NeonDB** with branching.

- **Develop Environment:** Used for active development.
  - Run `npm run dev`
  - Uses `develop` branch connection string.
- **Production Environment:**
  - Switch `DATABASE_URL` to production branch.
  - Run `npx prisma migrate deploy` (safer for prod).

If you modify `prisma/schema.prisma`:

1.  Stop the server.
2.  Run `npx prisma migrate dev --name <descriptive-name>`.
3.  Restart server.

---

## 🔌 API Documentation

Base URL: `/api`

### Auth (`/auth`)

- `POST /register` - Register a new user (with Firebase UID).
- `POST /sync` - Sync Firebase user to local DB (Login).
- `GET /me` - Get current user profile.

### Users (`/users`)

- `GET /:id` - Get public profile.
- `PUT /profile` - Update own profile.
- `POST /:id/follow` - Follow/Unfollow user.

### Articles (`/articles`)

- `GET /` - List articles (feed/search).
- `POST /` - Create article.
- `GET /:slug` - Read article.
- `POST /:id/like` - Like article.
- `POST /:id/comments` - Add comment.

### Admin (`/admin`)

- `GET /dashboard` - System stats.
- `GET /users` - User management.
- `GET /reports` - Content moderation.

_(See full route list in `src/routes/index.js`)_

---

## 🔒 Security

- **ID Token Verification:** All protected routes require `Authorization: Bearer <firebase_id_token>`.
- **Role Guards:** Admin routes are protected by `authorize("ADMIN")`.
- **Rate Limiting:** API requests are limited to prevent abuse.

## 🤝 Contributing

1.  Checkout to a feature branch: `git checkout -b feature/amazing-feature`.
2.  Commit changes: `git commit -m "Add amazing feature"`.
3.  Push to branch: `git push origin feature/amazing-feature`.
4.  Open a Pull Request.

---

## 📄 License

This project is licensed under the ISC License.
