# Build stage
FROM node:14 AS build

# Set working directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./

# Install all dependencies including 'devDependencies'
RUN npm install

# Copy app source
COPY . .

# Run build script to build and obfuscate JavaScript
RUN npm run build

# Production stage
FROM node:14

# Set working directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./

# Only install production dependencies
RUN npm install --only=production

# Copy built and obfuscated JavaScript from the build stage
COPY --from=build /usr/src/app/dist ./dist

#Copy private files from previous build
COPY --from=build /usr/src/app/private ./private

#Copy the confetti software into the dist folder:
RUN cp ./node_modules/canvas-confetti/dist/confetti.browser.js ./dist/

EXPOSE 80

CMD node private/server.js
