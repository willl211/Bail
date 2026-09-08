# Front Bail — image de production.
#
# Contexte de construction : la **racine du monorepo** (voir `backend/Dockerfile`).
#
#   docker build -f frontend/Dockerfile -t bail-web .
#
# ATTENTION — les variables `NEXT_PUBLIC_*` sont **inscrites dans le bundle au
# moment de la compilation**, pas lues au démarrage : Next les remplace par leur
# valeur dans le code envoyé au navigateur. Une image construite pour la
# pré-production ne peut donc pas être promue telle quelle en production, elle
# pointerait sur la mauvaise API. C'est pourquoi elles sont ici des arguments de
# construction, et non des variables d'environnement.

# ---------------------------------------------------------------- Dépendances
FROM node:22-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

# ---------------------------------------------------------------- Compilation
FROM deps AS build
WORKDIR /app

# Adresses publiques, figées dans le bundle. Les valeurs par défaut sont celles
# du développement : construire sans les fournir donne une image qui parle à
# `localhost`, ce qui se voit tout de suite plutôt que de tomber en panne à la
# première requête d'un visiteur.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_APP_ENV=production
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
ENV NEXT_TELEMETRY_DISABLED=1

COPY frontend/ frontend/
RUN npm run build --workspace frontend

# ----------------------------------------------------------------- Exécution
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Sortie autonome : Next a déjà rassemblé le serveur et les seules dépendances
# qu'il atteint réellement. Ni les fichiers statiques ni le dossier public ne
# font partie de cette trace — ils se copient à part, et les oublier ne casse
# rien à la construction : les images manquent simplement à l'exécution, page
# par page, sans qu'aucune erreur ne le signale.
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public

USER node

EXPOSE 3000

# Le front est en bonne santé s'il rend sa page d'accueil. Inutile d'y ajouter
# l'état de l'API : elle a sa propre sonde, et confondre les deux ferait
# redémarrer le front pour une panne qui n'est pas la sienne.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "frontend/server.js"]
