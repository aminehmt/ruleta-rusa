# Ruleta Rusa Online (Adaptation non-officielle)

Adaptation web multijoueur en temps reel, inspiree du jeu de societe **Ruleta Rusa** de Raul Lopez (edite par GDM Games). Ce projet est une reimplementation independante du code, des regles et de l'interface : aucun asset (illustrations, textes de la boite, marque) du jeu original n'a ete copie.

## Jouer en ligne

Le jeu est deploye et accessible directement ici :

**[https://ruleta-rusa-e8gk.onrender.com/](https://ruleta-rusa-e8gk.onrender.com/)**

Cree un salon, partage le code a 5 caracteres a tes amis (2 a 6 joueurs), et lancez la partie.

## A propos du jeu

Chaque joueur recoit 3 fiches de capacite assignees aleatoirement parmi 6 possibles (Voltear, Reordenar, Cambio de turno, Mirar, Cambio de sentido, Disparo doble). A chaque tour, on choisit entre reveler une fiche du barillet (7 CLICK + 1 BANG) ou utiliser une capacite encore disponible. Un BANG fait perdre une fiche definitivement ; le dernier joueur avec au moins une fiche encore en jeu remporte la partie.

Regles completes disponibles directement dans l'interface via le bouton "Comment jouer ?".

## Stack technique

- **Backend** : Node.js, Express, Socket.IO (temps reel)
- **Frontend** : HTML/CSS/JS vanilla, integre directement dans le serveur (aucune dependance de build)
- **Deploiement** : [Render](https://render.com)

## Installation en local

```bash
git clone https://github.com/aminehmt/ruleta-rusa.git
cd ruleta-rusa
npm install
npm start
```

Puis ouvrir [http://localhost:3000](http://localhost:3000).

## Licence et statut du projet

Ce depot est distribue sous licence MIT (voir [LICENSE](LICENSE)) pour tout le **code source** ecrit dans le cadre de ce projet (moteur de jeu, serveur, interface).

**Ce projet n'est pas affilie, approuve ou sponsorise par GDM Games ou Raul Lopez.** Il s'agit d'un projet personnel, non commercial et realise a titre d'apprentissage, inspire des mecaniques du jeu de societe original. Le nom "Ruleta Rusa", les visuels et le texte du livret du jeu physique restent la propriete de leurs ayants droit respectifs. Aucun asset du jeu original (illustrations, texte exact des regles, logo) n'est reproduit dans ce projet.

Si vous etes ayant droit du jeu original et souhaitez faire retirer ce projet ou discuter de son statut, merci d'ouvrir une issue sur ce depot.

## Auteur

Developpe par [Amine Hamiti](https://github.com/aminehmt) &mdash; *by Double A*.
