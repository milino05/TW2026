FROM node:22

WORKDIR /app

# Copia dipendenze
COPY package*.json ./

RUN npm install

# Copia il codice
COPY . .

EXPOSE 8000

CMD ["npm", "run", "dev:container"]
