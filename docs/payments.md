# Paiements — étape 3, 14 septembre 2026

Honoraires locataire et abonnement propriétaire disposent désormais d'un parcours Stripe Checkout hébergé. Les validations locales sont distinctes de la recette Stripe : aucune clé n'est configurée dans cet environnement et aucun paiement n'a été envoyé à Stripe.

## Comportement livré

- **Honoraires** : le bouton ouvre Checkout. Montant et devise viennent du serveur ; bail signé et barème approuvé restent obligatoires. Une tentative conserve son montant et sa ventilation, même si le bien ou le barème change ensuite.
- **Abonnement** : état `INCOMPLETE` jusqu'à confirmation. Avec des biens diffusés, Checkout collecte le premier règlement et la carte ; sans bien, Checkout en mode `setup` enregistre la carte avant la création d'un abonnement de quantité zéro. Le tarif par bien est annoncé avant l'enregistrement. Les changements de diffusion reprennent la synchronisation de quantité existante.
- **Carte et factures** : accès au portail Stripe du propriétaire connecté. Les factures d'abonnement sont enregistrées même si `invoice.paid` précède `invoice.created`. Aucune fausse carte Visa n'est affichée lorsque Stripe est actif.
- **Résiliation/reprise** : la reprise envoie explicitement `cancel_at_period_end: false` avant d'effacer la résiliation locale. La résiliation effective du dernier abonnement retire les annonces en ligne, avec motif et historique ; la résiliation programmée les conserve jusqu'au terme. Une notification concernant un ancien abonnement ne retire pas les annonces d'un nouveau.
- **Publication** : avec Stripe, l'administrateur ne peut publier qu'après activation de l'abonnement (les renouvellements en retard conservent le délai de relance). Publication et résiliation partagent un verrou propriétaire ; une mise à jour de quantité échouée est reprise par le marqueur durable de facturation.
- **Retour de Stripe** : affiche l'attente et actualise pendant 30 secondes, avec un bouton d'actualisation manuelle. Un paramètre d'URL ne confirme jamais un paiement.
- **Sécurité** : signature du corps brut obligatoire ; les clés et événements Stripe réels sont refusés. En mode mock, le webhook exige un agent connecté. Aucune donnée de carte ne transite par l'API whoma.
- **Visites** : l'intention d'empreinte demande désormais `capture_method: manual`. Le parcours complet de confirmation, libération et expiration reste à finaliser avec les étapes 3 et 6. Depuis le 16 septembre, les réservations nécessitant cette empreinte sont explicitement bloquées et une annulation locale ne marque plus l'empreinte « libérée » sans confirmation bancaire. Voir [les visites](visits.md).

## Reprises et cohérence

La table additive `payment_checkouts` stocke une tentative et ses paramètres avant tout appel réseau. Un verrou PostgreSQL et une portée unique empêchent deux clics de créer deux règlements. La clé Stripe est dérivée de l'identifiant durable ; une réponse perdue est rejouée avec la même clé et les mêmes paramètres.

La session est relue chez Stripe avant toute confirmation. Son identité, sa devise et son montant doivent correspondre à la tentative locale. Les écritures de confirmation sont atomiques. Pour la facturation récurrente, l'abonnement et la facture sont relus sous verrou ; une ancienne notification d'échec ne rétrograde pas une facture payée. Une notification d'échec est mise en file une seule fois dans la transaction.

Une nouvelle tentative n'est autorisée qu'après expiration **confirmée par Stripe** de la précédente. Fermer l'onglet ou revenir sur le site n'annule pas la session : le bouton permet de la reprendre. Après une expiration, un premier clic peut annoncer l'expiration et le suivant ouvrir la nouvelle session.

Une création dont la réponse a été perdue et qui n'a pas pu être rapprochée après 23 heures est bloquée pour vérification humaine : les clés d'idempotence Stripe peuvent être supprimées après 24 heures. Ne jamais effacer une tentative ni changer sa clé pour contourner ce blocage. Rechercher la session ou l'abonnement dans Stripe grâce aux métadonnées `checkoutId` / `localSubscriptionId`, puis rapprocher les identifiants. Les anciennes intentions d'honoraires sans tentative Checkout doivent également être rapprochées avant tout nouveau règlement.

## Configuration sandbox

Dans `backend/.env`, renseigner localement, sans partager ni committer les secrets :

```dotenv
PAYMENT_DRIVER=stripe
PAYMENT_RETURN_ORIGIN=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRODUCT_ID=prod_...
```

1. Créer une sandbox Stripe et un produit pour l'abonnement propriétaire. Le montant mensuel reste celui du barème en base ; aucun prix n'est codé en dur.
2. Configurer le portail client Stripe pour la modification de carte et l'accès aux factures. Désactiver les changements de formule et de quantité dans le portail : la quantité suit les annonces diffusées dans whoma. Configurer les relances Stripe et la résiliation après épuisement des tentatives : `PAST_DUE` ne retire pas immédiatement les annonces, la fin effective de l'abonnement les retire.
3. En local, connecter Stripe CLI et lancer :

   ```text
   stripe listen --forward-to localhost:4000/api/v1/payments/webhook
   ```

   Utiliser le secret `whsec_...` affiché par cette commande. Le secret du tableau de bord et celui du listener local sont différents.
4. Redémarrer le backend. Sur une préproduction HTTPS, utiliser son origine publique pour `PAYMENT_RETURN_ORIGIN` et déclarer le webhook dans Stripe.
5. Événements utiles : `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.created`, `invoice.finalized`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.voided`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.

Utiliser des comptes et baux fictifs dans une base de recette isolée. Les abonnements `mock` du jeu de démonstration ne sont pas des abonnements Stripe : leurs identifiants ne peuvent pas être réutilisés. Ne pas marquer le barème de démonstration comme juridiquement approuvé pour contourner les contrôles ; préparer un barème fictif uniquement dans la base de recette, puis faire valider le vrai barème avant tout encaissement réel.

## Recette Stripe encore à effectuer

- Honoraires : succès, carte refusée, authentification bancaire, abandon puis reprise, session expirée, double clic et retour avant le webhook.
- Abonnement : première facture payée ; souscription à zéro bien avec carte enregistrée ; publication/retrait et prorata ; échec puis régularisation d'une facture ; résiliation et reprise vérifiées dans les deux interfaces.
- Portail : carte mise à jour, facture accessible, aucune possibilité de changer la quantité directement.
- Interrompre le listener puis le rétablir ; rejouer les notifications et vérifier qu'aucun règlement ni e-mail n'est dupliqué.

## Limites explicites

- Cette étape couvre les encaissements pour compte propre. Loyers, dépôts de garantie, reversements et Stripe Connect ne sont pas activés.
- Remboursements, litiges, avoirs et reçus/factures d'honoraires à télécharger ne sont pas intégrés dans whoma. Un remboursement effectué dans Stripe doit être rapproché manuellement ; la synchronisation des remboursements devra précéder leur ouverture aux utilisateurs.
- Le barème réel, la ventilation des prestations et leur exigibilité restent à valider juridiquement. Les contrôles existants ne constituent pas une certification de conformité.
- La bascule en argent réel est volontairement interdite par le driver pendant le développement.

Références techniques : [Checkout](https://docs.stripe.com/payments/checkout/how-checkout-works), [enregistrement d'une carte](https://docs.stripe.com/payments/checkout/save-and-reuse), [webhooks](https://docs.stripe.com/webhooks), [idempotence](https://docs.stripe.com/api/idempotent_requests), [reprise d'un abonnement](https://docs.stripe.com/billing/subscriptions/cancel).
