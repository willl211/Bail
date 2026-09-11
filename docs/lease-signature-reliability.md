# Fiabilisation des signatures de bail — 9 septembre 2026

Le point 2 de l'audit concernait le passage à `SIGNED` après deux événements `signed` du même signataire. Le traitement compte désormais les deux identifiants réellement envoyés au prestataire : `LANDLORD` et `TENANT`. Le registre admin et la fiche du bail utilisent cette même règle.

## Notifications et transitions

- Une signature du bailleur ou du locataire conduit à `PARTIALLY_SIGNED`.
- Les signatures des deux parties sont nécessaires pour atteindre `SIGNED`. `completed` seul ne constitue pas la preuve des signatures manquantes ; il est conservé comme information.
- Un même identifiant d'événement est ignoré lors d'un rejeu. Plusieurs identifiants concernant le même signataire ne comptent toujours que pour une seule signature.
- La date finale correspond à la plus tardive des premières signatures reçues pour chaque partie. Les répétitions et notifications de livraison ne la repoussent pas.
- Seuls les baux `SENT_FOR_SIGNATURE` ou `PARTIALLY_SIGNED` acceptent une transition. Les événements tardifs ne modifient pas les états `SIGNED`, `DECLINED`, `CANCELLED` ou `EXPIRED`, ni les baux qui ne sont pas encore partis en signature.
- Les événements sans identifiant stable, de type inconnu, sans signataire pour une signature, ou avec un signataire ou un horodatage invalide sont refusés. Une enveloppe inconnue, ambiguë ou appartenant à un autre prestataire n'est pas appliquée.

## Simultanéité et notifications aux parties

Le traitement prend un verrou PostgreSQL sur le bail avant de lire son historique. Deux notifications simultanées ne peuvent plus s'écraser : la seconde traite l'état enregistré par la première.

Le changement de statut, l'historique et la mise en file des notifications de signature aux deux parties font partie de la même transaction. Si cette mise en file échoue, l'ensemble est annulé et le prestataire peut rejouer l'événement. Les clés de dédoublonnage évitent les envois multiples. Aucun appel réseau de messagerie n'est effectué dans la transaction.

## Mode simulé et limites

En mode `mock`, la route `/api/v1/leases/signature/webhook` exige une session d'agent connecté. Une requête anonyme ou un compte propriétaire/locataire ne peut plus simuler une signature. Le payload du simulateur exige `id`, `envelopeId`, `type` et, pour `signed`, `signerId`. `occurredAt` est facultatif en simulation et vaut sinon l'heure de réception.

Le driver réel reste responsable de l'authentification cryptographique des notifications et de leur conversion vers ces identifiants. Cette correction ne branche pas DocuSign et ne transforme pas les signatures simulées en actes signés. Les blocages liés au modèle légal et à la génération du bail restent appliqués.

Aucune migration ni modification de baux existants n'est effectuée. Les anciennes décisions ne sont pas réécrites automatiquement. Le contrôle en lecture seule de la base locale au moment de cette correction n'a trouvé aucun bail enregistré. Cette intervention porte sur les notifications reçues ; elle ne remplace pas un travail ultérieur sur l'idempotence de la création des enveloppes chez le prestataire réel.

## Tests

La suite d'intégration des notifications de bail vérifie notamment les doublons du bailleur, le compteur admin et la fiche du bail, `completed` reçu avant les signatures, les notifications simultanées, les états finaux, la date de signature, les payloads invalides, les accès au simulateur et le rejeu après une panne de mise en file.
