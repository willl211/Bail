# Modèle de données — entités principales

Ces entités sont confirmées comme périmètre de base. Étendre si besoin technique, mais ne pas en retirer sans le signaler.

- **Utilisateur** — rôle : propriétaire / locataire / agent interne
- **Bien** — annonce, caractéristiques, statut (en ligne, en cours de visite, loué)
- **Dossier locataire** — documents (identité, revenus, garant), statut de vérification
- **Candidature** — lien entre un bien et un locataire, avec statut
- **Visite** — RDV, type (accompagnée / visio), statut
- **Bail** — document généré à partir d'un modèle légal, statut de signature
- **Paiement / honoraire** — montant, statut, méthode
- **Analyse de bulletin** — extension du 10 septembre 2026 : travail asynchrone lié à une pièce, source/version, résultat de lecture structuré, état et tentatives. Suppression en cascade avec la pièce. Aucune décision de validation ni modification du revenu déclaré dans cette entité ; voir [le fonctionnement](payslip-analysis.md).

## Points d'attention

- Le **bail** doit être généré à partir d'un template légal verrouillé (bail nu ou meublé selon le type de bien) — pas de génération libre. Le champ de statut de signature doit refléter le cycle DocuSign (envoyé, signé, refusé).
- Le **paiement/honoraire** doit pouvoir distinguer la part propriétaire et la part locataire dans le barème d'honoraires (encore non figé — voir `legal-context.md`), et le statut du circuit des fonds (la plateforme encaisse pour le compte du propriétaire, donc prévoir un état "reversé au propriétaire").
- Le **dossier locataire** doit prévoir un état de vérification par un prestataire KYC externe, actuellement mocké (voir `integrations.md`).
