# Ordre de développement des écrans

Construis et teste dans cet ordre. Un écran doit être fonctionnel avant de passer au suivant — ne pas paralléliser tous les écrans dès le départ, ça complique le débogage et la revue.

1. **Recherche et fiche annonce** (locataire) — consultable sans compte
2. **Création de compte + espace propriétaire** (dépôt d'annonce, abonnement)
3. **Création de compte + dossier locataire** (upload de documents)
4. **Candidature à un bien**
5. **Prise de RDV de visite** (accompagnée ou visio)
6. **Génération de bail + signature électronique** (peut tourner en mode test/mock tant que DocuSign n'est pas branché en production)
7. **Paiement des honoraires** (peut tourner en mode test/mock au départ avec Stripe sandbox)

Si tu te reprends en main après une interruption : regarde quel écran de cette liste est le dernier fonctionnel et complet, et reprends à partir du suivant plutôt que de repartir de zéro ou de sauter des étapes.
