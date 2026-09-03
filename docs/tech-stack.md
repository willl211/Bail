# Stack technique

Décisions validées par le porteur de projet — ne pas rouvrir ces choix sans raison forte.

## Stack

| Couche | Choix |
|---|---|
| Frontend web | Next.js / React |
| Backend | Node.js (NestJS) |
| Base de données | PostgreSQL |
| Mobile | Aucun natif au MVP — web responsive uniquement (décision réexaminée puis confirmée) |
| Hébergement | OVH (hébergeur français, utile pour la conformité RGPD sur des données sensibles) |
| Gestion de code | GitHub |
| Outil de suivi de projet | Pas de préférence exprimée — recommandation : Linear |
| Environnements | Dev / Staging / Production dès le départ |
| Authentification | **Session serveur + cookie `httpOnly`** (tranché le 2 septembre 2026) |

## Authentification

Décision du 2 septembre 2026, prise au moment d'attaquer l'écran 2 (premier
écran exigeant un compte) : **session côté serveur, transportée par un cookie
`httpOnly`**. JWT et fournisseur externe ont été écartés.

Pourquoi :

- Le front est rendu côté serveur. Un cookie part tout seul avec les requêtes
  SSR de Next, sans jeton à stocker ni à rafraîchir côté client.
- Une session se **révoque réellement**, contrairement à un JWT qui reste
  valide jusqu'à expiration sans registre de révocation. C'est déterminant
  pour des données comme les pièces d'identité et les bulletins de salaire.
- Un fournisseur externe sortirait les identités du périmètre OVH retenu pour
  la conformité RGPD (voir la ligne « Hébergement » ci-dessus).

Conséquences à respecter à l'implémentation :

- Cookie `httpOnly`, `secure` hors développement, `sameSite=lax`.
- Les variables `JWT_SECRET` / `JWT_EXPIRES_IN` déjà présentes dans `env/`
  et `backend/src/config/configuration.ts` sont à renommer ou à remplacer :
  elles décrivent un mécanisme qui n'a pas été retenu.
- Le contrôle d'accès vit **côté API** (guard de rôle NestJS sur chaque route).
  L'en-tête conditionnel du front n'est qu'un reflet, jamais une protection.

## Structure de repo recommandée

Monorepo avec séparation claire frontend/backend :

```
/frontend      (Next.js)
/backend       (NestJS)
/docs          (ce dossier, à conserver dans le repo)
.env.example par environnement
README.md avec instructions de lancement local
```

## Design

Approche choisie : **maquettes complètes avant de coder**, réalisées dans Claude Design puis transférées via handoff. Respecte le design importé pour tous les écrans déjà maquettés. Voir `design-system.md` pour les principes directeurs si un écran n'a pas encore de maquette validée.
