# Intégrations tierces

Ces prestataires peuvent être branchés en mode test/sandbox pendant tout le développement — ils ne doivent jamais bloquer l'avancement du MVP.

| Besoin | Prestataire | Statut |
|---|---|---|
| KYC / vérification des pièces (dossier locataire, avant visite) | Non choisi | **Interface en place, driver `mock` seul accepté** (voir ci-dessous) |
| Signature électronique du bail | DocuSign | Confirmé — **interface en place, driver non écrit** (voir ci-dessous) |
| Paiement (abonnements propriétaires, honoraires) | Stripe | Confirmé — **code complet, aucun compte branché** (voir ci-dessous) |
| Visio pour les visites à distance | Non choisi formellement | **Interface en place, driver `mock` seul accepté.** Recommandation : Daily.co (le plus simple à intégrer et le moins cher pour démarrer, comparé à Twilio) |

## Stripe — précision du 2 septembre 2026

Le paiement se construit **comme si Stripe était branché** : service dédié,
types, montants, création des enregistrements `Payment` et `Subscription`,
gestion des états et des webhooks. Ce qui n'est **pas** fait pour l'instant :
créer un compte Stripe et renseigner des clés.

Concrètement, `PAYMENT_DRIVER=mock` reste la valeur par défaut et le driver
simule les réponses de Stripe. Passer en réel doit se réduire à changer des
variables d'environnement (`PAYMENT_DRIVER=stripe`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRODUCT_ID`) — jamais à réécrire du code
métier. Si une décision d'implémentation oblige à toucher au code pour brancher
Stripe, c'est que l'abstraction est mauvaise.

### État au 3 septembre 2026

Écrit et vérifié en mode simulé :

- souscription, résiliation en fin de période, reprise avant échéance ;
- assiette de facturation = nombre de biens **diffusés** (un bien au contrôle ou
  en brouillon n'est pas facturé) ; zéro bien diffusé est un état valide,
  facturé zéro ;
- webhook `POST /api/v1/payments/webhook`, **signature obligatoire** côté Stripe
  (`rawBody: true` au démarrage, sans quoi l'empreinte ne correspondrait pas) :
  `invoice.created`, `invoice.paid`, `invoice.payment_failed`,
  `customer.subscription.updated` / `.deleted`. Les rejeux sont idempotents ; un
  type non traité renvoie 200 sans effet plutôt qu'une erreur qui le ferait
  rejouer indéfiniment.

Deux points restent ouverts :

- `STRIPE_PRODUCT_ID` désigne un produit à créer **une fois** dans le tableau de
  bord. Le prix, lui, n'est pas dans le catalogue : il est construit à chaque
  souscription à partir du barème en base, pour rester modifiable sans
  redéploiement.
- `SubscriptionService.syncQuantity()` doit être appelé quand un bien entre ou
  sort de la diffusion. Le back-office qui déclenche ça n'existe pas encore.

Rappel : aucun montant ne vient du code. Barème d'honoraires et abonnement
propriétaire sont lus dans `fee_schedules` et `platform_settings`, et tant que
`isLegallyApproved` est faux, rien ne doit être facturé pour de vrai
(`legal-context.md`).

## Vérification des pièces — précision du 3 septembre 2026

Le contrat du prestataire est écrit (`VerificationDriver`) et tout le dossier
locataire passe par lui. Aucun prestataire n'étant retenu, `KYC_DRIVER=mock` est
la **seule valeur acceptée** : un nom inconnu fait échouer le démarrage plutôt
que de retomber sur le simulateur — en production, ça reviendrait à valider des
pièces d'identité sans les contrôler.

Le simulateur ne valide pas tout. Il reproduit la répartition des verdicts d'un
vrai prestataire :

| Pièce | Verdict simulé |
|---|---|
| Identité, bulletins, contrat, avis d'imposition, certificat de scolarité, pièces du garant | vérifiée automatiquement, avec une note de contrôle |
| Justificatif de domicile, pièce non reconnue | **revue humaine** — document hétérogène dont l'adresse se lit à l'œil |

Un mock qui validerait tout masquerait l'existence même du contrôle manuel, et
l'écran du dossier afficherait des pastilles vertes sur des pièces que personne
n'a regardées. L'interface annonce d'ailleurs « prestataire simulé » tant que
c'est le cas.

La revue humaine a désormais son écran : l'onglet « Dossiers » du back-office
liste, dossier par dossier, les pièces en attente de décision et permet à
l'agent de les vérifier ou de les refuser — un refus toujours motivé, le motif
étant transmis au locataire. En attendant cette décision, la pièce n'empêche ni
de transmettre son dossier ni de candidater : c'est justement pour la faire
contrôler qu'on transmet.

Le contrat prévoit aussi un régime **différé** (verdict rendu plus tard par
webhook) dont le mock ne se sert pas : une intégration réelle en dépendra, et
l'ajouter après coup obligerait à retoucher le code métier.

## Signature — précision du 3 septembre 2026

Le contrat du prestataire est écrit (`SignatureDriver`) et tout le module bail
passe par lui : création d'enveloppe sur un document figé et son empreinte,
annulation, notifications signées, récupération du document signé.

**Le driver DocuSign n'est pas écrit**, et c'est délibéré. Le driver Stripe a pu
l'être sans compte parce que son SDK typé rend l'intégration vérifiable : le
typage a d'ailleurs attrapé une vraie erreur. Une intégration DocuSign écrite à
l'aveugle — authentification JWT, gabarits d'enveloppe, positionnement des
onglets de signature — ne serait vérifiable par rien et donnerait une fausse
impression d'avancement. Elle s'écrira contre le bac à sable, le jour où le
compte existe. Les variables `DOCUSIGN_*` sont déjà prévues dans `env/`.

Le simulateur ne signe rien tout seul : les enveloppes restent « envoyées »
jusqu'à ce qu'un événement arrive, comme chez un vrai prestataire où c'est le
signataire qui agit. Et `downloadSigned` échoue explicitement plutôt que de
fabriquer un document qui ressemblerait à une preuve sans en être une.

## Protocole de visite (v0)

Éléments de sécurité à prévoir dans le flux de prise de RDV, même en mode mock :
- Vérification d'identité (KYC) du visiteur avant le RDV
- Pré-autorisation carte bancaire
- Caméra activée obligatoire pendant la visite (confirmé — pas d'option pour la désactiver)
- Enregistrement vidéo conservé **15 jours**, purgé automatiquement ensuite

Type de visite proposé au locataire : accompagnée physique **ou** visio en direct, au choix.

### État au 3 septembre 2026

Le protocole est appliqué, avec deux tempéraments explicites tant qu'aucun
prestataire n'est branché :

| Contrôle | État |
|---|---|
| Identité du visiteur | **Bloquant.** Repose sur la pièce d'identité vérifiée du dossier locataire : pas de contrôle séparé à refaire. Sans elle, aucun créneau n'est réservable. |
| Pré-autorisation carte | **Non demandée** tant que `PAYMENT_DRIVER=mock`. La visite est alors confirmée d'emblée, et l'écran dit pourquoi. Exiger une empreinte qu'on ne peut pas prendre bloquerait tout rendez-vous ; en inscrire une « autorisée » sans carte serait un mensonge. Redevient bloquante avec un vrai prestataire. |
| Caméra obligatoire | Portée par `Visit.cameraRequired`, non désactivable. |
| Rétention 15 jours | `Visit.recordingExpiresAt` est calculée **à l'ouverture de la salle**, pas espérée d'un ménage ultérieur. **Aucune tâche ne la balaie encore** — à brancher avant toute visio réelle. |

Le montant de l'empreinte (1 €), le délai d'annulation (4 h) et la rétention
(15 jours) vivent dans `platform_settings` : aucun n'est codé en dur.

Les créneaux sont ouverts par le **propriétaire** sur son bien. La maquette les
annonce « ouverts par le propriétaire et l'agent du secteur » : le modèle
(`VisitSlot.openedById`) est prêt pour l'agent, mais le back-office qui le lui
permettrait n'existe pas encore.

## Back-office — précision du 3 septembre 2026

Le registre de l'agence affiche l'état réel de chaque intégration (`mock` /
réel) plutôt qu'un voyant vert générique, et le compte « prestataires réels »
en tête de page est calculé, pas écrit en dur. Un back-office qui laisserait
croire que les contrôles tournent est plus dangereux qu'une absence d'écran :
c'est là qu'un agent décide de mettre un bien en ligne ou de valider une
identité.

La mise en ligne d'un bien depuis le back-office resynchronise l'assiette
facturée au propriétaire (`SubscriptionService.syncQuantity`). Tant que
`PAYMENT_DRIVER=mock`, cette synchronisation ne sort pas de la base ; elle
deviendra un appel réel au prestataire le jour où un compte est branché.

## E-mails — précision du 4 septembre 2026

Le contrat du prestataire est écrit (`MailDriver`) et deux drivers existent :

| Driver | Rôle |
|---|---|
| `mock` | écrit chaque message dans `storage/private/mails/` (`.html` + `.txt`). Un e-mail se juge sur son rendu et ses liens, pas sur une ligne de log. |
| `smtp` | envoi réel, via nodemailer. |

C'est la **seule intégration réelle écrite avant qu'un compte n'existe**, et
c'est assumé : contrairement à DocuSign, SMTP est un protocole, pas une API
propriétaire. Le driver se vérifie de bout en bout contre
[Mailpit](https://github.com/axllent/mailpit) — `npm run mail:up`, interface sur
http://localhost:8025 — connexion, en-têtes, encodage, rendu compris. La même
classe parlera ensuite à Brevo, Mailjet ou SES : seules les variables changent.

Un nom de driver inconnu fait échouer le démarrage, comme ailleurs. La
vérification SMTP au lancement, elle, ne bloque pas : une API qui refuserait de
démarrer parce qu'un serveur de messagerie est momentanément muet rendrait tout
le site indisponible pour un canal accessoire. Elle se contente d'un
avertissement.

### Ce que les e-mails ne contiennent pas

Aucune donnée de dossier — ni revenu, ni pièce jointe, ni lien vers un fichier
privé. Le message annonce qu'il s'est passé quelque chose et renvoie sur le
site, où la session contrôle qui voit quoi. Une boîte aux lettres se transfère,
se pirate et s'indexe : la promesse faite au locataire ne s'arrête pas au bord
du navigateur.

Pas d'image distante non plus, ni de pixel de suivi. Le HTML est écrit en tables
et en styles en ligne, avec `bgcolor` doublant chaque `background` : sans quoi
le bouton d'action s'affiche en blanc sur blanc dans une partie des clients de
messagerie.

### Journal des envois

`email_messages` consigne le destinataire, le gabarit, le sujet, le statut et le
driver — **jamais le corps rendu ni les variables**. C'est aussi la raison pour
laquelle les messages porteurs d'un lien à usage unique partent en direct plutôt
que par une file d'attente : une file devrait stocker ce lien, et un lien de
réinitialisation en base vaut un mot de passe en clair.

Un plafond de trois envois par gabarit, par adresse et par heure empêche
d'utiliser les formulaires publics pour inonder la boîte de quelqu'un d'autre.
Le dépassement est silencieux côté « mot de passe oublié » : signaler qu'on a
atteint le plafond reviendrait à confirmer que l'adresse a un compte.

### Deux régimes d'envoi

| | Messages du compte | Notifications d'événements |
|---|---|---|
| Exemples | confirmation d'adresse, mot de passe | candidature reçue, pièce refusée, visite réservée |
| Envoi | immédiat, dans la requête | différé, par une file |
| Pourquoi | ils portent un lien à usage unique, qu'une file devrait stocker — or un lien de réinitialisation en base vaut un mot de passe | une candidature ne doit ni échouer ni attendre parce qu'un serveur SMTP est lent |
| Contenu | rendu à l'émission | reconstruit **à l'envoi**, depuis la base |

Le second point mérite d'être explicite : la file ne stocke qu'un gabarit, un
destinataire et l'identifiant de l'objet concerné. Tout le reste est relu au
moment d'envoyer. Rien n'est donc recopié — le journal ne devient pas un double
des données du produit — et un message parti avec dix minutes de retard dit ce
qui est vrai, pas ce qui l'était à la mise en file. Si l'objet a disparu entre
les deux, ou si la situation a changé au point que le message n'a plus de sens
(une pièce refusée puis remplacée), il est abandonné plutôt que réessayé.

Cinq tentatives espacées de 1, 5, 25 puis 125 minutes, puis abandon : une boîte
pleine se vide, un serveur tombé se relève, mais réessayer indéfiniment ferait
passer le domaine pour un émetteur de spam.

Une clé d'unicité empêche le doublon. Elle porte l'identité de l'**événement**,
pas celle de l'objet : une candidature ne se signale qu'une fois, mais une même
pièce peut être refusée, corrigée, puis refusée à nouveau — et le locataire doit
l'apprendre les deux fois.

### Ordonnanceur

`@nestjs/schedule` sert deux tâches, et n'a été introduit qu'à partir du moment
où il en servait deux :

| Tâche | Cadence |
|---|---|
| Vidage de la file d'envoi | toutes les 30 secondes |
| Purge des enregistrements de visite | tous les jours à 3 h |

La seconde referme une dette ouverte depuis l'écran 5 : `recordingExpiresAt`
était posée à l'ouverture de la salle, mais rien ne la balayait. Une durée de
conservation qu'aucune tâche n'applique n'est pas une durée de conservation.

Ces tâches supposent **une seule instance d'API**, ce qui est le cas du pilote.
Le jour où il y en aura plusieurs, il faudra les verrouiller pour qu'elles ne
tournent pas en double.

### État au 4 septembre 2026

Trois gabarits liés au compte (confirmation d'adresse, réinitialisation, mot de
passe modifié) et onze notifications d'événements : candidature reçue, retenue,
écartée, acceptée ; pièce refusée ; dossier vérifié ou refusé ; annonce publiée
ou renvoyée ; visite réservée ou annulée.

Restent à écrire, faute de parcours atteignable aujourd'hui : bail prêt à
signer, bail signé, honoraires réglés, échec de prélèvement d'abonnement. Les
trois premiers supposent un modèle de bail validé, le dernier un compte Stripe.
