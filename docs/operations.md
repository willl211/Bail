# Administration et exploitation — étape 7

## Périmètre livré

L’administration impose désormais un second facteur à tous les comptes `AGENT`
(le projet utilise ce rôle pour les agents et les administrateurs). Les écrans
`/securite`, `/mes-donnees` et `/back-office/exploitation` couvrent l’enrôlement,
les demandes de suppression, les incidents HTTP et le journal de sécurité.
Ce socle local ne vaut pas validation de l’exploitation en production.

Migration : `20260916160000_admin_operations`, appliquée en développement.
Les tests d’intégration utilisent exclusivement `bail_test`, jamais la base de
démonstration. La compilation des deux applications et le lint sont validés.
La campagne frontend couvre notamment l’enrôlement, les secours, les refus,
la redirection MFA et l’absence de demande de suppression. Le contrôle HTTP
local vérifie l’accueil, la santé de l’API, les redirections admin et « Mes données ».
Le contrôle visuel navigateur reste à effectuer : aucun navigateur pilotable
n’était disponible dans la session de recette.

Résultats des 16–17 septembre : **190 tests unitaires backend**, **200 tests
frontend** (197 dans la campagne complète, puis 3 nouveaux cas de réponse API),
compilations et lint validés. La campagne d’intégration initiale couvrait 322 cas :
20 suites réussies, puis 4 suites affectées par la saturation des connexions.
Après correction du cycle de fermeture, ces 4 suites et le nouveau test de
libération des connexions ont été rejoués : **38/38 réussis**. Au total, les
25 suites et leurs 323 cas sont couverts par ces deux passages ; une campagne
complète unique n’a pas été relancée après ce correctif de fermeture.

## Connexion administrateur

1. Se connecter avec le compte admin habituel. Le mot de passe ouvre seulement
   une session de dix minutes permettant de configurer ou vérifier le facteur.
2. À la première connexion, confirmer le mot de passe puis ajouter la clé dans
   une application TOTP : six chiffres, trente secondes, SHA-1.
3. Saisir le code et conserver les dix codes de secours affichés une seule fois
   dans un gestionnaire de mots de passe. Chaque code est utilisable une seule fois.
4. Les connexions suivantes demandent le code de l’application ou un secours.
   Après validation, la session est renouvelée et expire après huit heures.

Un code TOTP déjà accepté ne peut pas être rejoué, même depuis une autre session.
Les essais sont limités par compte et par origine réseau. L’enrôlement révoque les
sessions précédentes. Changer ou réinitialiser le mot de passe ne retire pas le
second facteur. La déconnexion reste accessible pendant cette étape.

Le secret TOTP est chiffré avec AES-256-GCM et lié à l’identifiant du titulaire ;
seules les empreintes des codes de secours sont enregistrées. Aucun secret ne doit
apparaître dans les journaux, les captures ou les tickets d’assistance.

Configurer `MFA_ENCRYPTION_KEY` avec 32 octets aléatoires encodés en 64 caractères
hexadécimaux, dans le gestionnaire de secrets, séparément des sauvegardes SQL.
Une clé locale a été générée dans `backend/.env`, ignoré par Git. Ne pas la
remplacer à chaque démarrage et ne pas relancer `env:use` sur une configuration
existante sans en sauvegarder les secrets : ce script écrase les fichiers `.env`.
Le serveur refuse de démarrer sans clé valide hors développement.

La désactivation du contrôle est réservée aux tests automatisés (`NODE_ENV=test`
et `ADMIN_MFA_REQUIRED=false`) ; la suite MFA réactive explicitement le contrôle.

**Perte du téléphone :** utiliser un secours, puis organiser le remplacement du
facteur avec l’exploitant. Aucun bouton ne permet de retirer la MFA avec le seul
mot de passe. Si tous les facteurs sont perdus, vérifier l’identité hors du site,
faire approuver et journaliser la récupération par une autre personne autorisée,
puis révoquer les sessions et réinitialiser l’enrôlement pour ce seul compte dans
une intervention contrôlée. Cet outillage de récupération et la rotation des
secours restent à compléter avant une exploitation sans assistance technique.
La rotation de la clé de chiffrement exige de déchiffrer avec l’ancienne clé et de
rechiffrer avec la nouvelle ; changer simplement la variable rend les facteurs
existants illisibles.

Références techniques : [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.html)
et [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).

## Demandes de suppression

Le lien « Mes données » du pied de page mène à une demande authentifiée par le
mot de passe actuel. Une seule demande par compte est conservée. Le titulaire
peut suivre sa réception et lire le motif renseigné par l’administration.

Dans « Exploitation », l’admin peut consigner un examen ou effacer un **compte sans
engagement**. L’effacement est bloqué pour les comptes internes et les comptes
ayant des biens, candidatures, visites, baux, paiements ou abonnements. Il faut
alors examiner les finalités et obligations, expliquer ce qui doit être conservé
et fixer une prochaine revue ; le refus technique ne constitue pas une décision
juridique ni un rejet automatique de la demande.

L’effacement autorisé désactive d’abord le compte, révoque les sessions et jetons,
supprime les fichiers privés puis les données liées au compte. Une panne du
stockage laisse la demande « Effacement à reprendre », avec ses clés de fichiers,
pour une reprise manuelle. Elle n’est jamais annoncée comme terminée avant le
succès. Les preuves minimales de traitement gardent un identifiant technique,
sans le nom ni l’adresse e-mail du compte effacé.

**Limites :** pas encore d’effacement sélectif pour les comptes engagés, de portail
d’export des données ni de suppression chez les prestataires externes. Les
sauvegardes et éventuelles copies d’e-mails ne disparaissent pas immédiatement.
Le registre des suppressions doit être conservé séparément de la sauvegarde
restaurée pour réappliquer les effacements avant de rouvrir le service. Définir sa
durée de conservation et traiter les demandes dans le délai applicable avec le
responsable de traitement ; ne pas laisser les demandes en attente sans suivi.

## Conservation

La tâche quotidienne à 3 h (fuseau du serveur) applique cette politique technique :

| Données | Déclencheur de purge |
|---|---|
| Sessions | Expiration ou révocation depuis plus de 30 jours |
| Jetons d’authentification | Expiration depuis plus d’un jour |
| Journal de sécurité | Création depuis plus de 90 jours |
| Incidents pris en charge | Dernière occurrence depuis plus de 30 jours |
| Enrôlements MFA non confirmés | Configuration expirée |

Un incident ouvert et un facteur actif ne sont pas supprimés par cette tâche.
Ces valeurs sont des choix techniques du projet, pas une certification juridique.
Les documents, contrats et paiements ne font pas l’objet d’une purge aveugle.

Avant le pilote, faire valider une matrice **finalité / déclencheur / durée active /
archive / accès / suppression** pour : brouillons de dossiers, candidatures non
retenues, locations conclues, justificatifs, facturation, preuves de signature,
enregistrements, e-mails et sauvegardes. La gestion locative comporte des durées
différentes selon la finalité et le mode de gestion ; le référentiel CNIL indique
notamment trois mois comme durée en principe adaptée à l’examen de solvabilité
d’une candidature. Ce repère n’autorise pas à effacer tous les dossiers au même âge.
Référence : [référentiel CNIL de gestion locative](https://www.cnil.fr/sites/default/files/atoms/files/referentiel_relatif_aux_traitements_de_donnees_personnelles_mis_en_oeuvre_dans_le_cadre_de_la_gestion_locative.pdf).

L’automatisation des durées métier et l’archivage intermédiaire restent à développer
après cette validation. La purge des enregistrements de visites est traitée
séparément dans [visits.md](visits.md).

## Incidents et exploitation quotidienne

Les erreurs HTTP 5xx renvoient un message générique et une référence de requête.
Le journal agrège par code HTTP et gabarit de route, sans corps de requête, cookie,
URL nominative, message brut d’exception ou document. Une récidive réouvre
l’incident. La page admin affiche aussi les e-mails en échec et les analyses
documentaires dont le verrou de traitement est expiré.

L’API `/api/v1/health` répond 503 si sa base est inaccessible. En cas de panne de
la base, la trace serveur reste nécessaire : l’incident ne peut pas y être écrit.
Cette vue ne remplace pas la surveillance externe ni celle des tâches planifiées.

La fermeture de l’application déconnecte désormais explicitement Prisma, et le
serveur active les hooks d’arrêt Nest. La campagne étendue a révélé que l’ancien
comportement conservait les pools des applications fermées jusqu’à épuiser les
connexions de test. Un test observe directement `pg_stat_activity` pour vérifier
leur libération. Dimensionner aussi le pool par instance et la capacité PostgreSQL
lors du déploiement ; cette correction ne remplace pas ce dimensionnement.

Procédure : identifier la référence et l’heure, limiter l’impact, préserver les
traces utiles sans copier les justificatifs, corriger puis rejouer le parcours
affecté. « Pris en charge » signifie qu’un humain suit l’incident, pas que la cause
est résolue. Documenter le responsable, l’action et la vérification de retour au
service dans le suivi d’exploitation. Pour un incident de données personnelles,
faire qualifier les obligations de notification par le responsable désigné.

Restent à configurer : destinataire des alertes, supervision du front et de l’API,
des tâches, du disque et des sauvegardes, centralisation des logs avec accès
restreint, délais d’intervention et exercices de panne en préproduction.

## Restauration

`node scripts/restore-rehearsal.mjs` réalise un exercice **local et fictif** :
deux bases neuves à noms aléatoires, migrations, compte et document fictifs,
`pg_dump`, archive chiffrée, restauration transactionnelle par `pg_restore`,
comparaison des comptages, relations et empreinte du fichier. Il retire uniquement
les deux bases créées par cet exercice. Il ne cible ni `bail_dev` ni `bail_test`.

Recette du 16 septembre 2026 réussie en 6,5 s ; rapport local :
`.cache/restore-rehearsal/41e8a5f497b3/report.json`. Les 33 comptages de tables,
dont les migrations, concordent. La clé d’archive voisine du rapport n’est acceptable
que pour ces données fictives, jamais pour une sauvegarde réelle.

Ce résultat ne valide **ni** une sauvegarde hébergée/S3, **ni** sa planification,
son isolation, la restauration des secrets MFA ou les objectifs de reprise.
Avant lancement : décider la perte de données et le délai de reprise acceptables,
sauvegarder SQL + fichiers + secrets séparés, contrôler la réussite quotidienne,
puis restaurer une sauvegarde de préproduction dans un environnement isolé.
Révoquer les anciennes sessions, réappliquer les suppressions, vérifier les accès,
les fichiers et la MFA, et rapprocher les événements de paiement/signature sans
les rejouer en double avant ouverture. Tester également un retour à la version
applicative précédente compatible avec la base.

Références : [pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)
et [pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html).
