# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /backend

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm install --production

# Copy the rest of the backend code
COPY . .

# Start the backend server
CMD ["node", "app.js"]
