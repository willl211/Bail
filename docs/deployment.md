# Mise en ligne

Ce document décrit comment Bail passe d'un poste de développement à une machine
accessible au public. Il est écrit pour être suivi ligne à ligne le jour où le
compte d'hébergement et le domaine existent.

Rien ici ne dépend du volet juridique. La mise en ligne et le premier bail signé
sont deux jalons distincts : le second attend l'avocat
([`legal-context.md`](legal-context.md)), le premier non.

## Ce qui tourne

Quatre conteneurs, une base managée à côté.

| Conteneur | Rôle | Port |
|---|---|---|
| `migrate` | applique `prisma migrate deploy`, puis s'arrête | — |
| `api` | l'API NestJS, et les tâches planifiées | 4000, interne |
| `web` | le serveur Next.js qui rend les pages | 3000, interne |
| `proxy` | Caddy : TLS et routage des deux noms | 80, 443 |

Seul le proxy est exposé. L'API et le front ne sont joignables que depuis le
réseau interne de Docker : le front appelle l'API par `http://api:4000`, sans
ressortir sur Internet.

**Le front est un serveur, pas un site statique.** Les pages lisent les cookies
et sont rendues à chaque requête — un hébergement web mutualisé ne convient
donc pas, il faut une machine qui exécute Node.

## Ce que vous devez ouvrir chez l'hébergeur

Rien de tout cela ne peut être fait depuis le dépôt.

1. **Une instance** (VPS ou équivalent) sous Linux, avec Docker et le plugin
   Compose. Deux cœurs et 4 Go suffisent largement pour le pilote messin — la
   compilation de l'image du front est le moment le plus gourmand.
2. **Une base PostgreSQL 16 managée**, avec sauvegardes automatiques. C'est le
   seul poste sur lequel je vous déconseille d'économiser : la base porte les
   dossiers locataires, et la question n'est pas la performance mais qui fait
   les sauvegardes et qui les teste.
3. **Deux conteneurs de stockage objet**, un public et un privé. Jamais un seul
   avec deux préfixes : le conteneur privé porte les pièces d'identité et les
   bulletins de salaire, il doit rester fermé sans exception à prévoir. Un
   préfixe se contourne par une règle d'accès trop large ; deux conteneurs se
   configurent séparément.
4. **Un domaine**, et deux entrées DNS de type A vers l'adresse IP de
   l'instance : `votre-domaine` et `api.votre-domaine`.
5. **Un compte SMTP** chez un hébergeur de messagerie européen (Brevo, Mailjet
   — voir [`integrations.md`](integrations.md)).

## Premier déploiement

```bash
git clone <dépôt> bail && cd bail

cp env/production.env.example deploy/.env
# Renseigner les valeurs réelles, puis ajouter les quatre variables
# de déploiement décrites dans deploy/.env.example

docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

L'ordre est garanti par le manifeste : les migrations s'appliquent, l'API ne
démarre qu'ensuite, et le front attend que l'API se déclare en bonne santé.

Trois valeurs méritent une relecture avant ce premier démarrage, parce qu'une
erreur y est **silencieuse** — rien ne plante, le produit se comporte mal :

- `DATABASE_URL` doit finir par `?schema=public&sslmode=require` ;
- `SESSION_COOKIE_DOMAIN` doit valoir `.votre-domaine`, avec le point initial,
  sinon la session ne suit pas entre le site et l'API ;
- `PUBLIC_SITE_URL` sert à fabriquer les liens des e-mails. L'API ne la déduit
  pas de l'en-tête `Host` : un lien porteur d'un secret ne doit pas pouvoir
  être détourné par une requête forgée.

### Vérifier

```bash
curl https://api.votre-domaine/api/v1/health
```

La réponse dit l'environnement, l'état de la base et **quels drivers sont
actifs**. Tant que le volet juridique n'est pas bouclé, il est normal et
souhaitable d'y lire `mock` partout.

Puis, dans un navigateur : la page d'accueil doit afficher des annonces, et la
recherche doit répondre. Si la page se charge mais reste vide, l'API n'est pas
jointe depuis le conteneur du front — c'est `API_INTERNAL_URL` qu'il faut
regarder, pas le DNS public.

### Peupler

Le seed est un **jeu de démonstration** : huit annonces, quatre locataires
fictifs, mots de passe en clair dans le script. Il n'a rien à faire sur une
instance ouverte au public. Une mise en ligne commence avec une base vide et de
vrais comptes.

## Mettre à jour

```bash
git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Les migrations passent avant le redémarrage de l'API. Une migration qui échoue
arrête le déploiement au lieu de le laisser passer à moitié — l'ancienne version
continue de tourner.

Il y a une **interruption de quelques secondes** au redémarrage. C'est acceptable
pour un pilote ; l'éviter demanderait deux instances et un basculement, ce que le
volume ne justifie pas encore. La file d'envoi, elle, supporte déjà plusieurs
instances : les messages sont réservés avant d'être traités, aucun ne partirait
deux fois (voir README, principe 16).

## Ce qui reste à décider, et que le dépôt ne tranche pas

- **Le registre d'images.** Les images sont construites sur la machine. C'est
  volontaire : un pilote sur une seule machine n'a pas besoin d'un registre, et
  n'avoir rien à choisir vaut mieux que choisir mal. Le jour où il en faudra un,
  seules les lignes `image:` du manifeste changeront.
- **La supervision.** Les conteneurs redémarrent seuls et leurs journaux sont
  bornés à 50 Mo chacun, mais **personne n'est prévenu** si l'API tombe. Une
  sonde externe sur `/api/v1/health` est le minimum avant d'ouvrir à des
  utilisateurs réels ; le choix du service vous revient.
- **Les sauvegardes du stockage objet.** La base managée est sauvegardée par
  l'hébergeur ; le conteneur privé, non. Il porte les pièces des dossiers.

## Ce que la mise en ligne oblige à traiter

À partir du premier utilisateur réel, la machine contient des **pièces
d'identité, des bulletins de salaire et des avis d'imposition**. Le produit les
protège déjà côté applicatif — conteneur privé séparé, jamais servi par l'API,
jamais transmis au propriétaire, purge automatique des enregistrements de visite
au bout de quinze jours. L'hébergement ajoute des questions que le code ne règle
pas, et qui sont les vôtres :

- qui détient la clé SSH de l'instance ;
- où vont les sauvegardes, sont-elles chiffrées, combien de temps sont-elles
  gardées, et quelqu'un a-t-il déjà essayé d'en restaurer une ;
- qui peut lire le conteneur privé.

C'est aussi pour ça que la page des mentions légales ne peut pas rester un
gabarit : elle doit décrire ce dispositif, et il faut donc qu'il existe.

## Deux pièges déjà rencontrés

**Les variables `NEXT_PUBLIC_*` sont figées à la compilation.** Next les
remplace par leur valeur dans le code envoyé au navigateur : ce ne sont pas des
variables lues au démarrage. Une image construite pour la pré-production **ne
peut pas** être promue en production — elle pointerait sur la mauvaise API.
C'est pourquoi le manifeste les passe en arguments de construction.

**Le conteneur du front ne reçoit pas le fichier d'environnement.** Il n'a
aucune raison de détenir l'URL de la base, la clé Stripe ou le mot de passe
SMTP : lui passer le fichier entier ferait porter tous les secrets par le
conteneur le plus exposé. Son environnement est explicite dans le manifeste, et
tient en quatre lignes.
