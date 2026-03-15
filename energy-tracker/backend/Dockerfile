FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3847
CMD ["node", "src/index.js"]
