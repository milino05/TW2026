Quando usare docker compose up --build
```
Dockerfile  
package.json  
package-lock.json  
npm install di nuove dipendenze  
versione di Node  
comando CMD  
struttura delle dipendenze  
```
Comandi per avviare docker:  
```  
"dev": "docker compose up -d",  
"dev:build": "docker compose up --build",  
"down": "docker compose down",  
"down:clean": "docker compose down -v",  
"logs": "docker compose logs -f backend",  
"start": "node index.js",  
"dev:container": "nodemon index.js"
```


