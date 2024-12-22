# Base stage
FROM node:14 AS base

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./

# Install all dependencies
RUN npm install

# Copy the entire project directory
COPY . .

# Build stage
FROM base AS build

# Run the build script
RUN npm run build

# Development stage
FROM base AS dev

# Expose the development server's port
EXPOSE 3000

# Install additional development dependencies
RUN npm install --save-dev nodemon

# Command to run the development server
CMD ["npx", "nodemon", "private/server.js"]

# Production stage
FROM node:14 AS production

# Set working directory
WORKDIR /usr/src/app

# Copy only production dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy built files and private folder from the build stage
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/private ./private

# Expose the production server's port
EXPOSE 80

# Command to run the production server
CMD ["node", "private/server.js"]
