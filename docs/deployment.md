# Mise en ligne

Ce document décrit comment whoma passe d'un poste de développement à une machine
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

1. **Une instance** (VPS ou équivalent) sous Debian ou Ubuntu. Deux cœurs et
   4 Go suffisent largement pour le pilote messin — la compilation de l'image du
   front est le moment le plus gourmand.

   Prendre la **LTS la plus récente que propose l'hébergeur** : la machine va
   rester allumée des années, et chaque cycle sauté est deux ans de correctifs
   de sécurité gagnés. Une seule condition, que le script de préparation impose
   sans le dire : Docker doit publier un dépôt pour le nom de code de cette
   version. Ça se vérifie en une commande, avant de commander quoi que ce soit :

   ```bash
   curl -s https://download.docker.com/linux/ubuntu/dists/ | grep NOM_DE_CODE
   ```

   Rien dans le projet ne dépend de la version de l'hôte : les images sont
   construites sur `node:22-slim`, qui est une base Debian indépendante de la
   machine. Se tromper ici ne coûte qu'une réinstallation depuis l'espace
   client, quelques minutes tant que rien ne tourne encore.
2. **Une base PostgreSQL 16 managée**, avec sauvegardes automatiques. C'est le
   seul poste sur lequel je vous déconseille d'économiser : la base porte les
   dossiers locataires, et la question n'est pas la performance mais qui fait
   les sauvegardes et qui les teste.
3. **Deux conteneurs de stockage objet**, un public et un privé. Jamais un seul
   avec deux préfixes : le conteneur privé porte les pièces d'identité et les
   bulletins de salaire, il doit rester fermé sans exception à prévoir. Un
   préfixe se contourne par une règle d'accès trop large ; deux conteneurs se
   configurent séparément.
4. **Un compte SMTP** chez un hébergeur de messagerie européen (Brevo, Mailjet
   — voir [`integrations.md`](integrations.md)). Le plus sous-estimé de la
   liste : sans lui, une adresse ne peut pas être confirmée, et une adresse non
   confirmée bloque aussi bien la mise en ligne d'une annonce que le dépôt
   d'une candidature. Le site serait en ligne et inutilisable.
5. **Un domaine**, et trois entrées DNS de type A vers l'adresse IP de
   l'instance : le domaine nu, `api.` et `www.`. **Le seul point de cette liste
   qui n'est pas bloquant** : les quatre autres se vérifient ensemble sans lui,
   voir la section suivante.

   L'hébergeur crée une zone DNS par défaut qui pointe **vers son propre serveur
   de parking**. Ce sont donc des entrées à **modifier**, pas à ajouter — en
   créer de nouvelles à côté laisserait deux réponses contradictoires pour le
   même nom.

   Un piège s'y cache : la zone contient déjà un enregistrement **SPF** qui
   autorise les serveurs de messagerie de l'hébergeur, et **uniquement** eux
   (`-all`). Tant qu'il est là, les e-mails expédiés par votre prestataire SMTP
   seront rejetés ou classés indésirables — et une adresse non confirmée bloque
   la mise en ligne d'une annonce comme le dépôt d'une candidature. Il faut le
   remplacer par celui que le prestataire fournit.

### Le stockage objet, en pratique

Deux points ont coûté du temps à découvrir. Ils sont propres à OVH et ne se
devinent pas.

**Les régions 3-AZ n'acceptent que l'adressage par hôte virtuel.** Une adresse
en chemin — `endpoint/seau/clé` — y répond `InvalidRequest — Not S3 request`.
D'où `S3_FORCE_PATH_STYLE=false` dans les modèles de production, alors que MinIO,
en développement, exige l'inverse.

**Les politiques de seau ne sont pas implémentées.** `PutBucketPolicy` répond
`NotImplemented`. Et une ACL de conteneur `public-read` n'ouvre que le
**listage**, pas la lecture des objets — les deux verrous sont distincts, et
c'est le second qu'on veut.

La seule voie est donc l'**ACL par objet**, que l'API pose maintenant
elle-même à chaque dépôt dans le conteneur public. Rien à configurer côté
OVH pour les fichiers à venir.

Il reste un geste manuel, une fois, pour refermer le listage ouvert par erreur
si vous avez essayé `--acl public-read` sur le conteneur :

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID=VOTRE_ACCESS_KEY \
  -e AWS_SECRET_ACCESS_KEY=VOTRE_SECRET_KEY \
  amazon/aws-cli \
  --endpoint-url https://s3.eu-west-par.io.cloud.ovh.net --region eu-west-par \
  s3api put-bucket-acl --bucket whoma-prod-public --acl private
```

Les trois contrôles qui valident l'ensemble, depuis l'extérieur :

| Adresse | Attendu |
|---|---|
| un objet du conteneur public | **200** |
| la racine du conteneur public (listage) | **403** |
| un objet du conteneur privé | **403** |

Le dernier est le plus important : ce conteneur porte les pièces d'identité.

### La messagerie, en pratique

Les paramètres sont dans `env/production.env.example`, déjà renseignés pour la
messagerie d'OVH — vous n'aurez que le mot de passe et, éventuellement,
l'adresse de la boîte à changer. Trois choses ont coûté du temps à découvrir :

**Le serveur s'écrit `ssl0.ovh.net`** : s-s-**L**-**zéro**, « ssl » suivi du
chiffre. Le `l` et le `1` se ressemblent dans la plupart des polices de
terminal, et l'erreur — `getaddrinfo ENOTFOUND` — n'aide pas à la voir.

**Le port 465 va avec `SMTP_SECURE=true`**, le 587 avec `false`. Les deux
fonctionnent ; `false` ne signifie pas « sans chiffrement » mais STARTTLS,
négocié après l'ouverture de la connexion.

**`MAIL_FROM` doit porter la même adresse que `SMTP_USER`.** OVH refuse
d'expédier depuis une boîte qui n'est pas celle authentifiée — un
`ne-pas-repondre@` qui n'existe pas comme boîte échouerait.

L'API se contente d'un avertissement si le serveur est injoignable, plutôt que
de refuser de démarrer : un canal accessoire indisponible ne doit pas rendre
tout le site inaccessible. Le message dit exactement ce qui coince.

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  logs api --tail 40 | grep -i smtp
```

## Préparer l'instance

Une fois la machine créée chez l'hébergeur, un script la met en état. Il ne
demande aucune valeur et n'écrit aucun secret :

```bash
scp deploy/provision.sh ubuntu@ADRESSE-IP:/tmp/
ssh ubuntu@ADRESSE-IP 'sudo bash /tmp/provision.sh'
```

### Si aucune clé SSH n'a été choisie à la commande

C'est un cas fréquent : le formulaire ne l'impose pas. L'hébergeur envoie alors
un **mot de passe temporaire** par lien sécurisé dans l'e-mail de livraison. À
la première connexion il faut le changer, et la session se ferme aussitôt —
c'est le comportement normal, on se reconnecte.

Mais la machine n'a alors **aucune clé**, et le script créerait le compte
applicatif sans clé : inutilisable en SSH. Déposez-la avant de le lancer, depuis
votre poste :

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh ubuntu@ADRESSE-IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Vérifiez qu'elle fonctionne — `ssh ubuntu@ADRESSE-IP` ne doit plus rien demander
— **avant** de lancer le script. Il coupe l'authentification par mot de passe
quand il trouve une clé, et une clé qui ne marche pas fermerait la machine. (Pas
définitivement : la console KVM de l'espace client reste une porte de retour.
Mais autant ne pas avoir à s'en servir.)

Le script ne coupe rien s'il ne trouve aucune clé — il le dit et laisse le mot
de passe actif.

### Le compte de connexion

`ubuntu` et non `root` : c'est le compte livré par OVH sur une image Ubuntu, et
la connexion SSH en root y est fermée. Le script cherche donc la clé chez le
compte qui l'invoque avant de regarder chez root — sans quoi le compte
applicatif naîtrait sans aucune clé, verrouillé sur une machine où plus personne
n'aurait de raison de revenir.

Il installe Docker depuis le dépôt officiel — celui des distributions livre une
version âgée, parfois sans le greffon Compose v2 —, crée un utilisateur `bail`
non privilégié en lui recopiant votre clé SSH, n'ouvre le pare-feu que sur SSH,
active les mises à jour de sécurité automatiques, et ajoute deux gigaoctets
d'échange si la machine en manque.

Cette dernière étape n'est pas cosmétique : **la compilation de l'image du front
est le moment le plus gourmand du déploiement**, et une machine à 4 Go peut s'y
faire tuer par le noyau. Si l'échange ne peut pas être créé, le script le dit et
continue — la parade est alors de construire l'image ailleurs.

### Deux comptes, deux rôles

Le script laisse la machine avec deux comptes, et il ne faut pas les confondre :

| Compte | Rôle | Exemple |
|---|---|---|
| `ubuntu` *(livré par l'hébergeur)* | **administrer** la machine | `sudo ufw allow 80/tcp` |
| `bail` *(créé par le script)* | **faire tourner** l'application | `docker compose … up -d` |

`bail` n'est volontairement pas dans le groupe `sudo` : une commande
d'administration lancée sous ce compte échoue, et c'est le comportement attendu.

Puis se reconnecter en `bail` : l'appartenance au groupe `docker` ne prend effet
qu'à l'ouverture de session suivante.

```bash
ssh bail@ADRESSE-IP
docker run --rm hello-world
```

## Avant d'avoir choisi le nom de domaine

Le domaine n'est pas sur le chemin critique. Ce qui réserve les mauvaises
surprises, c'est l'assemblage : l'endpoint exact du stockage objet, la chaîne de
connexion à la base managée, l'authentification SMTP. Tout cela se vérifie sans
lui, et il vaut mieux le découvrir avant que le nom soit acheté.

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.recette.yml \
  --env-file deploy/.env \
  up -d --build migrate api web
```

Les trois services sont nommés en fin de commande : **le proxy ne démarre pas**.
Sans domaine il n'a rien à router et ne pourrait obtenir aucun certificat. L'API
et le front sont alors publiés directement sur les ports 4000 et 3000.

Six variables changent par rapport au modèle de production. En remplaçant
`ADRESSE-IP` par celle de l'instance :

```
CORS_ORIGINS=http://ADRESSE-IP:3000
PUBLIC_SITE_URL=http://ADRESSE-IP:3000
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_DOMAIN=
NEXT_PUBLIC_SITE_URL=http://ADRESSE-IP:3000
NEXT_PUBLIC_API_URL=http://ADRESSE-IP:4000/api/v1
```

`SESSION_COOKIE_DOMAIN` est laissé **vide** : le cookie se rattache alors à
l'hôte qui l'a posé. Les cookies ignorant le port, celui que dépose l'API sur
`4000` est bien renvoyé au front sur `3000` — c'est le même site.

### Ce que ce mode n'est pas

Il sert en **HTTP, sans chiffrement**. Les deux ports sont donc publiés sur
`127.0.0.1` et non sur toutes les interfaces : rien n'est joignable depuis
Internet, et on y accède par un tunnel SSH depuis son poste.

```bash
ssh -L 3000:localhost:3000 -L 4000:localhost:4000 bail@ADRESSE-IP
```

Puis, dans le navigateur du poste : `http://localhost:3000`.

**Un pare-feu ne suffirait pas**, et c'est le piège à connaître : Docker écrit
ses propres règles de routage et court-circuite UFW. Un port publié sur toutes
les interfaces reste joignable depuis Internet alors que `ufw status` affiche un
refus. La liaison à `127.0.0.1` ferme la question au lieu de la confier à une
règle qui ne s'applique pas.

Et **aucune pièce d'identité réelle** ne doit y être déposée. Une carte
d'identité qui transite en clair est une fuite, quel que soit le nombre de
personnes au courant de l'adresse. Ce mode sert à vérifier que l'infrastructure
tient, pas à recevoir des dossiers.

### Ce qu'il reste à revérifier une fois le domaine acquis

Trois choses que ce mode ne peut pas prouver : l'obtention des certificats, la
redirection HTTP vers HTTPS, et le cookie de session — il porte ici sur un hôte
unique, il portera ensuite sur deux sous-domaines.

Il faudra aussi **reconstruire l'image du front** : les variables
`NEXT_PUBLIC_*` sont figées dans le bundle à la compilation, l'image de recette
continuerait de viser l'adresse IP. C'est ce que fait `--build`.

## Premier déploiement

```bash
git clone <dépôt> whoma && cd whoma

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

### Créer les premiers comptes

Une instance neuve n'a **aucun compte**, et deux obstacles se présentent au
moment de vouloir la tester.

Le rôle d'agent n'a **pas de formulaire d'inscription** — c'est voulu : personne
ne se déclare agent du back-office. Il se pose donc en base.

Et l'inscription exige une adresse confirmée, alors qu'aucun message ne part
tant que `MAIL_DRIVER=mock`. Deux façons de s'en sortir :

- **relire le message sur disque** : le driver `mock` écrit chaque envoi dans
  `/app/storage/private/mails` du conteneur de l'API, en `.html` et en `.txt`.
  Le lien de confirmation y figure.

  ```bash
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
    exec api ls -t /app/storage/private/mails | head
  ```

- **confirmer en base**, plus direct pour une mise en service :

  ```sql
  UPDATE users SET "emailVerifiedAt" = now() WHERE "emailVerifiedAt" IS NULL;
  UPDATE users SET role = 'AGENT' WHERE email = 'adresse@exemple.fr';
  ```

Les deux sont des contournements le temps que la messagerie soit branchée.
L'inscription reprend son cours normal dès que `MAIL_DRIVER=smtp` fonctionne.

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

### Faire le ménage

À faire après chaque déploiement, ou l'espace disque finit par manquer :

```bash
docker image prune -af
docker buildx prune -f --filter until=168h
```

Ce n'est pas une précaution de principe. Les images du projet pèsent environ
1,5 Go à elles deux, mais **le cache de construction atteint près de 19 Go après
quelques compilations** — mesuré, pas estimé. Sur un disque de 40 Go dont
le système occupe déjà 5, quelques mois de redéploiements suffisent à le remplir.
Et un disque plein, c'est une base qui n'écrit plus et un dépôt de pièce qui
échoue.

Le filtre `until=168h` garde une semaine de cache : les redéploiements restent
rapides, seul le vieux part. Purger tout ferait recommencer chaque `npm ci`
depuis zéro, plusieurs minutes à chaque fois.

Ne jamais y ajouter `--volumes` : le volume de Caddy porte les certificats, et
les redemander à chaque déploiement ferait tomber sur les limites de Let's
Encrypt en quelques jours.

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
