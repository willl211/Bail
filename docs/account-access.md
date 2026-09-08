# Accès au compte — septembre 2026

La navigation publique conserve Rechercher et une seule entrée Mon compte, vers `/connexion`. Cette page propose une connexion commune aux trois rôles et deux liens d’inscription explicitement distincts : « Je cherche un logement » et « Je mets un bien en location ».

Les inscriptions restent accessibles sur `/dossier` et `/proprietaires`, notamment depuis les appels à l’action existants. Elles utilisent un formulaire partagé, avec un rôle fixé par la page, et renvoient vers la connexion commune lorsqu’un compte existe déjà. Les liens de reconnexion après changement de mot de passe ou d’e-mail utilisent également `/connexion`.

Après connexion, le rôle renvoyé par l’API détermine la destination : dossier locataire, portefeuille propriétaire ou back-office agent. Les paramètres `candidature` et `bien` sont conservés pour reprendre une candidature ou mettre un bien de côté côté locataire. Aucune URL de redirection libre n’est acceptée.

Le panneau `AuthScenery` reprend l’image architecturale existante, les tons pierre, bois et olive et un pied sauge. Il apparaît à droite sur ordinateur, sous les formulaires sur mobile. Les styles sont limités aux nouvelles classes des pages d’accès. Le contenu, les filtres et le design de Rechercher ne sont pas modifiés.

Vérifications : connexions réelles des trois comptes de démonstration dans un navigateur isolé ; rendu des trois pages sur ordinateur et mobile, y compris 320 px ; tests de navigation, de contexte de candidature, d’inscription et d’erreur de connexion. Aucun compte n’a été créé pour la vérification visuelle.
