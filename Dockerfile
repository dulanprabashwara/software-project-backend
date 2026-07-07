FROM node:18-alpine

WORKDIR /app

# Install dependencies needed for Prisma
RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code
COPY . .

EXPOSE 5000

# Start the application
CMD ["npm", "start"]
