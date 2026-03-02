FROM node:20-alpine

WORKDIR /app

RUN npm install -g @angular/cli@latest

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 4200

CMD ["ng", "serve", "--host", "0.0.0.0"]
