# API Bail — image de production.
#
# Le contexte de construction est la **racine du monorepo**, pas ce dossier :
# les workspaces npm remontent les dépendances à la racine, et un contexte
# limité à `backend/` ne verrait ni le `package-lock.json` ni le
# `node_modules` partagé.
#
#   docker build -f backend/Dockerfile -t bail-api .
#
# Debian « slim » et non Alpine : le moteur de requête Prisma est distribué par
# cible, et celle de la musl libc d'Alpine demande une variable de plus et une
# vigilance à chaque montée de version. L'écart de taille ne vaut pas ce risque
# sur la brique qui parle à la base.

# ---------------------------------------------------------------- Dépendances
FROM node:22-slim AS deps
WORKDIR /app

# `openssl` est requis par le moteur Prisma ; `ca-certificates` par les appels
# sortants (SMTP, stockage objet, prestataires).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Seuls les manifestes d'abord : tant qu'ils ne changent pas, Docker réutilise
# la couche d'installation, qui est de loin la plus longue.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

# ---------------------------------------------------------------- Compilation
FROM deps AS build
WORKDIR /app

COPY backend/ backend/

# Le client Prisma est généré ici, contre la cible Linux de l'image — celui
# d'une machine de développement Windows ne s'y exécuterait pas.
RUN npm run prisma:generate --workspace backend \
  && npm run build --workspace backend

# ------------------------------------------------- Dépendances de production
# Réinstallation limitée au workspace backend. Sans `--workspace`, npm installe
# aussi les dépendances de production du front — Next, sharp et leurs binaires,
# soit 400 Mo qui n'ont rien à faire dans l'image de l'API (mesuré : 790 Mo
# contre 377 Mo).
#
# La CLI Prisma reste embarquée, et c'est voulu : c'est cette image qui applique
# ses propres migrations au déploiement (`prisma migrate deploy`). Une image qui
# ne porterait pas ses migrations pourrait démarrer sur une base qu'elle ne
# comprend pas. Elle coûte une centaine de mégaoctets — à reconsidérer si le
# temps de déploiement devient gênant, en la sortant dans une image dédiée.
FROM deps AS prod-deps
WORKDIR /app
RUN npm ci --omit=dev --workspace backend --include-workspace-root

# ----------------------------------------------------------------- Exécution
FROM node:22-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/node_modules ./backend/node_modules

# Le schéma et les migrations voyagent avec l'image : c'est elle qui applique
# `prisma migrate deploy` au déploiement, et une image qui ne porterait pas ses
# migrations pourrait démarrer sur une base qu'elle ne comprend pas.
COPY backend/prisma ./backend/prisma
COPY backend/prisma.config.ts ./backend/prisma.config.ts
COPY backend/package.json ./backend/package.json
COPY package.json ./package.json

# L'image de base fournit un utilisateur `node` non privilégié. L'API n'écrit
# rien sur son disque en production — les fichiers vont au stockage objet — et
# n'a donc aucune raison de tourner en root.
USER node

EXPOSE 4000

# La sonde interroge la base, pas seulement le processus : une API qui répond
# alors que sa base est tombée n'est pas en bonne santé, et l'orchestrateur doit
# le savoir avant les utilisateurs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>r.json()).then(b=>process.exit(b.database==='up'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/main.js"]
