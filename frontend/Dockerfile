FROM node:20-alpine

WORKDIR /app

# Install Angular CLI globally
RUN npm install -g @angular/cli@latest

# Copy package files
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copy source
COPY . .

# Build the app
RUN ng build

# Serve with nginx
FROM nginx:alpine
COPY --from=0 /app/dist/openfix/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
