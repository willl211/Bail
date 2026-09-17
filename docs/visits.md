# Étape 6 — Visites

## Périmètre du 16 septembre 2026

Le parcours accompagné est consolidé. Aucun boîtier connecté n’est développé.
La visio reste indisponible à la réservation : aucun prestataire réel n’est
configuré. Le choix de la proposer au lancement reste à confirmer. Le simulateur
ne constitue pas une salle rejoignable et ses anciens liens ne sont plus exposés.

## Réservations et calendrier

- Une réservation revérifie la diffusion du bien, la candidature et l’identité.
- Les réservations d’un même locataire sont sérialisées, y compris sur des biens
  différents. Deux visites actives sur un bien ou des horaires qui se chevauchent
  sont refusés.
- Ouverture, fermeture et réservation se coordonnent sur le bien. Une fermeture
  concurrente ne peut pas laisser un créneau à la fois fermé et réservé.
- Deux ouvertures concurrentes ne créent pas de créneaux qui se chevauchent.
  Un créneau fermé peut être rouvert au même horaire.
- La durée du créneau doit permettre le type demandé. Les créneaux passés,
  occupés, fermés ou appartenant à un autre bien sont refusés.

## Annulations et agents

L’annulation locataire respecte le délai configuré (4 h par défaut), libère le
créneau et remet une candidature encore « visite planifiée » à « retenue ».
Une seconde annulation est sans effet et ne modifie pas une nouvelle réservation.
Une visite d’un autre locataire reste invisible (404).

L’affectation exige un agent actif et une visite à venir encore ouverte. Les
affectations concurrentes d’un agent ne peuvent pas créer de chevauchement.
Les intervalles contigus restent autorisés : le temps de déplacement n’est pas
calculé et doit être prévu par l’équipe qui organise les visites.

Les annulations liées à un refus de candidature ou à l’attribution du logement
ferment aussi l’accès local à la visio et préviennent les personnes concernées.

## Notifications

Réservation : propriétaire et locataire. Annulation : propriétaire, locataire et
agent affecté. Affectation : agent et locataire ; l’ancien agent reçoit aussi le
retrait de son affectation en cas de changement. Ces notifications sont mises en
file dans la transaction métier, avec une clé de déduplication par destinataire.

Un traitement par minute prépare un rappel pour les visites confirmées qui
commencent dans les deux heures. Il prévient le locataire et l’agent affecté, une
fois par destinataire. Le statut et les droits sont relus à l’envoi : un rappel
ou une confirmation devenu sans objet après annulation est abandonné.

Les liens renvoient vers l’espace authentifié de chaque rôle, jamais vers une
pièce privée ou un secret de salle. Aucun numéro d’agent absent du parcours n’est
promis. Avec `MAIL_DRIVER=mock`, les messages sont enregistrés localement ; un
envoi réel exige la configuration SMTP et une recette de délivrabilité.

## Enregistrements et purge

Un passage par minute traite par lots les enregistrements expirés et les salles
annulées, y compris sans fichier local. Les suppressions fournisseur et stockage
doivent réussir avant l’effacement des références et le marquage de purge.

Un fichier déjà absent est un succès ; une erreur de permissions, de réseau ou
de fournisseur conserve les références pour réessayer. Un fournisseur différent
de celui configuré ne peut pas être purgé par le simulateur. Les échecs sont
journalisés et repoussés derrière les autres éléments du lot.

## Dépendances encore ouvertes

**Stripe :** les préautorisations relèvent aussi de l’étape 3. L’annulation locale
n’écrit plus « libérée » sans confirmation bancaire. En mode paiement simulé,
aucune empreinte n’est demandée (`NOT_REQUIRED`). En mode Stripe, la réservation
reste bloquée explicitement tant que le parcours complet d’empreinte n’est pas
terminé ; aucune réservation bloquée avec une intention bancaire orpheline n’est
créée par ce parcours.

Avant cette activation : confirmation client, événements signés, expiration,
libération effective, reprise des erreurs et recette sandbox. Voir [paiements](payments.md).

**Visio :** si elle est retenue, intégrer et tester un prestataire, les accès
temporaires authentifiés du locataire et de l’agent affecté, l’expiration et la
révocation des accès, les échecs de création et la suppression effective des
enregistrements. Le paramètre `cameraRequired` ne prouve pas qu’une caméra est
techniquement imposée. Les modalités d’enregistrement et d’information doivent
être arrêtées avant une utilisation réelle. Les tests du simulateur ne valident
aucune de ces capacités chez un fournisseur.

## Recette locale

Validation du 16 septembre : **29 tests d’intégration dans trois suites** et
**12 tests du composant de réservation réussis**. TypeScript et lint passent sur
le backend et le frontend. Les tests emploient une vraie base PostgreSQL isolée,
avec des fournisseurs simulés ; ils ne valident ni Stripe ni un prestataire visio.

Les tests d’intégration utilisent exclusivement la base isolée `bail_test` et
les fournisseurs simulés. Ils couvrent concurrence, annulations, agents,
notifications, accès entre rôles et reprises de purge. Les tests du composant de
réservation couvrent aussi la désactivation de la visio indisponible.

```powershell
npm.cmd run test:int --workspace backend -- --runTestsByPath test/visits.int-spec.ts test/concurrency.int-spec.ts test/attribution.int-spec.ts
npm.cmd run test --workspace frontend -- --runInBand --runTestsByPath components/visit-booking-screen.spec.tsx
```

Recette manuelle à effectuer en préproduction : propriétaire ouvrant des créneaux,
deux locataires qui réservent en même temps, affectation puis annulation, réception
des messages SMTP, rappel proche de l’heure et reprise après panne de stockage.
