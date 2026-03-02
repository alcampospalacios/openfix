FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git openssh-client

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "run", "start"]
