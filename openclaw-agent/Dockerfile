FROM node:20-alpine

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git openssh-client curl \
    && git config --global user.email "openfix-agent@openfix.dev" \
    && git config --global user.name "Openfix Agent"

# Copy agent code
COPY agent.js ./

# Install runtime dependencies
RUN npm init -y && npm install node-fetch ws

# Agent runs continuously
CMD ["node", "agent.js"]
