# Modèle de données — entités principales

Ces entités sont confirmées comme périmètre de base. Étendre si besoin technique, mais ne pas en retirer sans le signaler.

- **Utilisateur** — rôle : propriétaire / locataire / agent interne
- **Bien** — annonce, caractéristiques, statut (en ligne, en cours de visite, loué)
- **Dossier locataire** — documents (identité, revenus, garant), statut de vérification
- **Candidature** — lien entre un bien et un locataire, avec statut
- **Visite** — RDV, type (accompagnée / visio), statut
- **Bail** — document généré à partir d'un modèle légal, statut de signature
- **Paiement / honoraire** — montant, statut, méthode

## Points d'attention

- Le **bail** doit être généré à partir d'un template légal verrouillé (bail nu ou meublé selon le type de bien) — pas de génération libre. Le champ de statut de signature doit refléter le cycle DocuSign (envoyé, signé, refusé).
- Le **paiement/honoraire** doit pouvoir distinguer la part propriétaire et la part locataire dans le barème d'honoraires (encore non figé — voir `legal-context.md`), et le statut du circuit des fonds (la plateforme encaisse pour le compte du propriétaire, donc prévoir un état "reversé au propriétaire").
- Le **dossier locataire** doit prévoir un état de vérification par un prestataire KYC externe, actuellement mocké (voir `integrations.md`).
