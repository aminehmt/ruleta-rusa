"use strict";

/**
 * RULETA RUSA ONLINE - fichier unique (v6)
 * ------------------------------------
 * Ce fichier contient TOUT : serveur Express + Socket.IO, moteur de jeu,
 * et client HTML/CSS/JS servi directement en memoire.
 *
 * CORRECTIONS DE CETTE VERSION :
 * - BUG CORRIGE : la cinematique CLICK/BANG affichait parfois le mauvais
 *   nom de joueur. Cause : le tour avancait deja cote serveur avant que
 *   l'etat ne soit diffuse (cas d'un CLICK simple, sans BANG). Le serveur
 *   renvoie desormais explicitement "revealerId" (l'identite du joueur qui
 *   vient reellement de tirer), et le client l'utilise au lieu de deviner
 *   via turnPlayerId.
 * - Ajout de la mention "BY DOUBLE A" sous "EDITION NUMERIQUE" sur l'ecran
 *   d'accueil.
 * - Confirmation/renforcement de la regle : Mirar et Reordenar sont bloques
 *   des qu'il ne reste qu'une seule fiche dans le barillet (deja correct
 *   cote serveur), avec desormais un affichage visuel explicite cote client
 *   (bouton grise + message "Indisponible (1 seul jeton restant)") pour que
 *   le joueur comprenne immediatement pourquoi il doit reveler ou choisir
 *   une autre capacite.
 *
 * INSTALLATION :
 *   npm init -y
 *   npm install express socket.io
 *   node server.js
 *
 * Puis ouvrir http://localhost:3000
 */

var http = require("http");
var express = require("express");
var Server = require("socket.io").Server;

const ALL_SKILLS = ["VOLTEAR", "REORDENAR", "CAMBIO_TURNO", "MIRAR", "CAMBIO_SENTIDO", "DISPARO_DOBLE"];
const TOKEN_CLICK = "CLICK";
const TOKEN_BANG = "BANG";
const CHAMBER_SIZE = 8;
const BULLETS = 1;

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildRevolverDeck() {
  const deck = new Array(CHAMBER_SIZE - BULLETS).fill(TOKEN_CLICK).concat(new Array(BULLETS).fill(TOKEN_BANG));
  return shuffle(deck);
}

function skillLabel(skill) {
  return {
    VOLTEAR: "Voltear",
    REORDENAR: "Reordenar",
    CAMBIO_TURNO: "Cambio de turno",
    MIRAR: "Mirar",
    CAMBIO_SENTIDO: "Cambio de sentido",
    DISPARO_DOBLE: "Disparo doble",
  }[skill] || skill;
}

function pickSkillsForPlayer() {
  const pool = shuffle(ALL_SKILLS);
  return pool.slice(0, 3);
}

function createPlayer(id, name) {
  const chosen = pickSkillsForPlayer();
  const status = {};
  chosen.forEach((s) => { status[s] = "alive"; });
  return { id, name, ownedSkills: chosen, status, eliminated: false };
}

function usableSkills(player) {
  return player.ownedSkills.filter((s) => player.status[s] !== "dead");
}
function availableSkills(player) {
  return player.ownedSkills.filter((s) => player.status[s] === "alive");
}
function exhaustedSkills(player) {
  return player.ownedSkills.filter((s) => player.status[s] === "exhausted");
}
function isAlive(player) {
  return !player.eliminated && usableSkills(player).length > 0;
}

class RuletaRusaGame {
  constructor(playerInfos) {
    if (playerInfos.length < 2 || playerInfos.length > 6) {
      throw new Error("Le jeu necessite entre 2 et 6 joueurs");
    }
    this.players = playerInfos.map((p) => createPlayer(p.id, p.name));
    this.deck = buildRevolverDeck();
    this.turnIndex = 0;
    this.direction = 1;
    this.log = [];
    this.status = "PLAYING";
    this.winnerId = null;
    this.pendingForcedTurn = null;
    this.pendingDoubleShot = 0;
    this.duelTriggered = this.players.length <= 2;
    this.pendingResolution = null;
    this._pushLog("La partie commence avec " + this.players.length + " joueurs.");
  }

  _pushLog(message) {
    this.log.push({ t: Date.now(), message });
    if (this.log.length > 200) this.log.shift();
  }

  getPlayer(id) {
    const p = this.players.find((pl) => pl.id === id);
    if (!p) throw new Error("Joueur introuvable");
    return p;
  }

  currentPlayer() { return this.players[this.turnIndex]; }
  alivePlayers() { return this.players.filter(isAlive); }

  _stepIndex(fromIdx) {
    let idx = fromIdx;
    for (let i = 0; i < this.players.length; i++) {
      idx = (idx + this.direction + this.players.length) % this.players.length;
      if (isAlive(this.players[idx])) return idx;
    }
    return fromIdx;
  }

  _nextTurn() {
    if (this.pendingForcedTurn) {
      const forcedIdx = this.players.findIndex((p) => p.id === this.pendingForcedTurn);
      this.pendingForcedTurn = null;
      if (forcedIdx !== -1 && isAlive(this.players[forcedIdx])) {
        this.turnIndex = forcedIdx;
        return;
      }
    }
    this.turnIndex = this._stepIndex(this.turnIndex);
  }

  _checkVictory() {
    const alive = this.alivePlayers();
    if (alive.length === 1) {
      this.status = "FINISHED";
      this.winnerId = alive[0].id;
      this._pushLog(alive[0].name + " remporte la partie !");
      return true;
    }
    if (alive.length === 0) {
      this.status = "FINISHED";
      this.winnerId = null;
      this._pushLog("Match nul : plus aucun survivant.");
      return true;
    }
    return false;
  }

  _triggerDuelIfNeeded(eliminatedIndex) {
    const alive = this.alivePlayers();
    if (alive.length === 2 && !this.duelTriggered) {
      this.duelTriggered = true;
      alive.forEach((p) => {
        p.ownedSkills.forEach((s) => {
          if (p.status[s] === "exhausted") p.status[s] = "alive";
        });
      });
      const eliminatedName = eliminatedIndex !== null && this.players[eliminatedIndex]
        ? this.players[eliminatedIndex].name : "un joueur";
      this._pushLog("Duel final entre " + alive[0].name + " et " + alive[1].name + " ! Leurs fiches encore vivantes sont rechargees.");
      if (eliminatedIndex !== null) this.turnIndex = this._stepIndex(eliminatedIndex);
      return true;
    }
    return false;
  }

  assertTurn(playerId) {
    if (this.status !== "PLAYING") throw new Error("La partie est terminee");
    if (this.pendingResolution) throw new Error("Une resolution de tirage est en attente");
    if (this.currentPlayer().id !== playerId) throw new Error("Ce n'est pas votre tour");
  }

  mustRevealOnly(player) { return availableSkills(player).length === 0; }

  _ensureDeckNotEmpty() {
    if (this.deck.length === 0) {
      this.deck = buildRevolverDeck();
      this._pushLog("Le barillet etait vide : il est reconstitue et remelange.");
    }
  }

  revealTop(playerId) {
    this.assertTurn(playerId);
    this._ensureDeckNotEmpty();
    const player = this.getPlayer(playerId);
    const token = this.deck.shift();

    if (token === TOKEN_CLICK) {
      this._pushLog(player.name + " tire... CLICK.");
      const exhausted = exhaustedSkills(player);
      if (exhausted.length === 0) {
        this._finishNonBangReveal();
        return { token: token, revealerId: playerId };
      }
      return { token: token, awaitingClickRecharge: true, revealerId: playerId };
    }

    this._pushLog(player.name + " tire... BANG !");
    const stillInPlay = usableSkills(player);
    this.pendingResolution = { type: "BANG", playerId: playerId, stage: stillInPlay.length > 0 ? "choose_skill" : "reorder_only" };
    if (stillInPlay.length === 0) {
      player.eliminated = true;
      this._pushLog(player.name + " n'avait plus aucune fiche vivante : il est elimine !");
    }
    return { token: token, awaitingBangResolution: true, mustChooseSkill: stillInPlay.length > 0, revealerId: playerId };
  }

  resolveClickRecharge(playerId, skillToRecharge) {
    const player = this.getPlayer(playerId);
    if (this.currentPlayer().id !== playerId) throw new Error("Ce n'est pas votre tour");
    if (!player.ownedSkills.includes(skillToRecharge) || player.status[skillToRecharge] !== "exhausted") {
      throw new Error("Fiche invalide : elle doit etre epuisee et vous appartenir");
    }
    player.status[skillToRecharge] = "alive";
    this._pushLog(player.name + " recharge sa fiche " + skillLabel(skillToRecharge) + " grace au CLICK.");
    this._finishNonBangReveal();
  }

  _finishNonBangReveal() {
    if (this.pendingDoubleShot > 0) {
      this.pendingDoubleShot -= 1;
      this._pushLog("Une fiche supplementaire doit encore etre revelee (Disparo doble).");
      return;
    }
    this._nextTurn();
  }

  resolveBangSkillChoice(playerId, skillToLose) {
    if (!this.pendingResolution || this.pendingResolution.type !== "BANG" || this.pendingResolution.playerId !== playerId) {
      throw new Error("Aucune resolution de BANG en attente pour ce joueur");
    }
    if (this.pendingResolution.stage !== "choose_skill") throw new Error("Le choix de fiche a deja ete fait");
    const player = this.getPlayer(playerId);
    if (!player.ownedSkills.includes(skillToLose) || player.status[skillToLose] === "dead") {
      throw new Error("Fiche invalide : elle doit encore etre en jeu et vous appartenir");
    }
    player.status[skillToLose] = "dead";
    this._pushLog(player.name + " perd definitivement sa fiche " + skillLabel(skillToLose) + ".");

    let eliminatedNow = false;
    if (usableSkills(player).length === 0) {
      player.eliminated = true;
      eliminatedNow = true;
      this._pushLog(player.name + " n'a plus aucune fiche vivante : il est elimine !");
    }
    this.pendingResolution.stage = "reorder";
    this.pendingResolution.eliminatedNow = eliminatedNow;
    return { eliminated: eliminatedNow, awaitingReorder: true };
  }

  resolveBangReorder(playerId, newOrder) {
    if (!this.pendingResolution || this.pendingResolution.type !== "BANG" || this.pendingResolution.playerId !== playerId) {
      throw new Error("Aucune resolution de BANG en attente pour ce joueur");
    }
    if (this.pendingResolution.stage !== "reorder" && this.pendingResolution.stage !== "reorder_only") {
      throw new Error("Ce n'est pas encore le moment de reorganiser le barillet");
    }
    if (!Array.isArray(newOrder) || newOrder.length !== CHAMBER_SIZE) throw new Error("L'ordre fourni doit contenir exactement 8 fiches");
    const bangCount = newOrder.filter((t) => t === TOKEN_BANG).length;
    const clickCount = newOrder.filter((t) => t === TOKEN_CLICK).length;
    if (bangCount !== BULLETS || clickCount !== CHAMBER_SIZE - BULLETS) throw new Error("L'ordre fourni doit contenir exactement 1 BANG et 7 CLICK");

    this.deck = newOrder.slice();
    const player = this.getPlayer(playerId);
    this._pushLog(player.name + " reorganise entierement le barillet.");
    const eliminatedNow = !!this.pendingResolution.eliminatedNow;
    this.pendingResolution = null;
    const eliminatedIndex = eliminatedNow ? this.players.findIndex((p) => p.id === playerId) : null;
    if (this._checkVictory()) return { finished: true };
    if (this._triggerDuelIfNeeded(eliminatedIndex)) return { finished: true };
    this.pendingDoubleShot = 0;
    this._nextTurn();
    return { finished: false };
  }

  useSkill(playerId, skillName, options) {
    options = options || {};
    this.assertTurn(playerId);
    if (!ALL_SKILLS.includes(skillName)) throw new Error("Competence inconnue");
    const player = this.getPlayer(playerId);
    if (this.mustRevealOnly(player)) throw new Error("Aucune fiche disponible : vous devez reveler la pile de revolver");
    if (!player.ownedSkills.includes(skillName)) throw new Error("Vous ne possedez pas cette fiche de competence");
    if (player.status[skillName] !== "alive") throw new Error("Cette fiche de competence n'est plus disponible (epuisee ou morte)");

    switch (skillName) {
      case "VOLTEAR": return this._useVoltear(player, options);
      case "REORDENAR": return this._useReordenar(player, options);
      case "CAMBIO_TURNO": return this._useCambioTurno(player, options);
      case "MIRAR": return this._useMirar(player, options);
      case "CAMBIO_SENTIDO": return this._useCambioSentido(player, options);
      case "DISPARO_DOBLE": return this._useDisparoDoble(player, options);
      default: throw new Error("Competence non geree");
    }
  }

  _exhaust(player, skillName) {
    player.status[skillName] = "exhausted";
  }

  _afterSkillUsage(player, skillName) {
    this._exhaust(player, skillName);
    let eliminatedNow = false;
    if (usableSkills(player).length === 0) {
      player.eliminated = true;
      eliminatedNow = true;
      this._pushLog(player.name + " est elimine !");
    }
    if (this._checkVictory()) return { finished: true, eliminated: eliminatedNow };
    const elimIdx = eliminatedNow ? this.players.findIndex((p) => p.id === player.id) : null;
    if (this._triggerDuelIfNeeded(elimIdx)) return { finished: true, eliminated: eliminatedNow };
    return { finished: false, eliminated: eliminatedNow };
  }

  _useVoltear(player, options) {
    const targetId = options.targetPlayerId;
    const targetSkill = options.targetSkill;
    if (!targetId || !targetSkill) throw new Error("VOLTEAR necessite targetPlayerId et targetSkill");
    const target = this.getPlayer(targetId);
    if (target.id === player.id) throw new Error("Impossible de se cibler soi-meme");
    if (!target.ownedSkills.includes(targetSkill)) throw new Error("Le joueur cible ne possede pas cette fiche");
    if (target.status[targetSkill] !== "alive") throw new Error("La fiche cible n'est pas disponible (deja epuisee ou morte)");

    target.status[targetSkill] = "exhausted";
    this._pushLog(player.name + " utilise Voltear : la fiche " + skillLabel(targetSkill) + " de " + target.name + " est maintenant epuisee.");

    const selfResult = this._afterSkillUsage(player, "VOLTEAR");
    if (selfResult.finished) return Object.assign({ skillName: "VOLTEAR" }, selfResult);

    if (usableSkills(target).length === 0 && !target.eliminated) {
      target.eliminated = true;
      this._pushLog(target.name + " est elimine !");
      if (this._checkVictory()) return { skillName: "VOLTEAR", eliminated: selfResult.eliminated, finished: true };
      const elimIdx = this.players.findIndex((p) => p.id === target.id);
      if (this._triggerDuelIfNeeded(elimIdx)) return { skillName: "VOLTEAR", eliminated: selfResult.eliminated, finished: true };
    }

    if (this.status === "PLAYING") this._nextTurn();
    return { skillName: "VOLTEAR", eliminated: selfResult.eliminated, finished: false };
  }

  _useReordenar(player, options) {
    if (this.deck.length <= 1) {
      throw new Error("Impossible d'utiliser Reordenar : il ne reste qu'une fiche dans le barillet");
    }
    const newOrder = options.newOrder;
    if (!Array.isArray(newOrder) || newOrder.length !== this.deck.length) {
      return { skillName: "REORDENAR", awaitingReorderInput: true, currentDeck: this.deck.slice() };
    }
    const bangsBefore = this.deck.filter((t) => t === TOKEN_BANG).length;
    const bangsAfter = newOrder.filter((t) => t === TOKEN_BANG).length;
    const clicksBefore = this.deck.filter((t) => t === TOKEN_CLICK).length;
    const clicksAfter = newOrder.filter((t) => t === TOKEN_CLICK).length;
    if (bangsAfter !== bangsBefore || clicksAfter !== clicksBefore) {
      throw new Error("La composition du barillet doit rester identique");
    }
    this.deck = newOrder.slice();
    this._pushLog(player.name + " regarde et reordonne le barillet.");

    const result = this._afterSkillUsage(player, "REORDENAR");
    if (result.finished) return Object.assign({ skillName: "REORDENAR" }, result);
    this._nextTurn();
    return { skillName: "REORDENAR", finished: false };
  }

  _useCambioTurno(player, options) {
    const targetId = options.targetPlayerId;
    if (!targetId) throw new Error("CAMBIO_TURNO necessite targetPlayerId");
    const target = this.getPlayer(targetId);
    if (target.id === player.id) throw new Error("Impossible de se donner le tour a soi-meme");
    if (!isAlive(target)) throw new Error("Le joueur cible n'est plus en jeu");

    this._pushLog(player.name + " donne le tour a " + target.name + ".");
    const result = this._afterSkillUsage(player, "CAMBIO_TURNO");
    if (result.finished) return Object.assign({ skillName: "CAMBIO_TURNO" }, result);

    const targetIdx = this.players.findIndex((p) => p.id === target.id);
    this.turnIndex = targetIdx;
    return { skillName: "CAMBIO_TURNO", finished: false };
  }

  peekMirar(playerId) {
    this.assertTurn(playerId);
    const player = this.getPlayer(playerId);
    if (this.mustRevealOnly(player)) throw new Error("Aucune fiche disponible : vous devez reveler la pile de revolver");
    if (!player.ownedSkills.includes("MIRAR") || player.status.MIRAR !== "alive") {
      throw new Error("Vous ne possedez pas la fiche Mirar ou elle n'est plus disponible");
    }
    if (this.deck.length <= 1) throw new Error("Impossible d'utiliser Mirar : il ne reste qu'une fiche dans le barillet");
    return { peekedToken: this.deck[0] };
  }

  _useMirar(player, options) {
    if (this.deck.length <= 1) throw new Error("Impossible d'utiliser Mirar : il ne reste qu'une fiche dans le barillet");
    const topToken = this.deck[0];
    const keepOnTop = options.keepOnTop !== false;
    if (!keepOnTop) { this.deck.shift(); this.deck.push(topToken); }
    this._pushLog(player.name + " utilise Mirar (regarde discretement le barillet).");

    const result = this._afterSkillUsage(player, "MIRAR");
    if (result.finished) return Object.assign({ skillName: "MIRAR" }, result);
    this._nextTurn();
    return { skillName: "MIRAR", finished: false };
  }

  _useCambioSentido(player) {
    this.direction *= -1;
    this._pushLog(player.name + " inverse le sens du jeu (" + (this.direction === 1 ? "horaire" : "antihoraire") + ").");
    const result = this._afterSkillUsage(player, "CAMBIO_SENTIDO");
    if (result.finished) return Object.assign({ skillName: "CAMBIO_SENTIDO" }, result);
    this._nextTurn();
    return { skillName: "CAMBIO_SENTIDO", finished: false };
  }

  _useDisparoDoble(player) {
    this._pushLog(player.name + " joue Disparo doble : le prochain joueur devra reveler deux fiches.");
    const result = this._afterSkillUsage(player, "DISPARO_DOBLE");
    if (result.finished) return Object.assign({ skillName: "DISPARO_DOBLE" }, result);
    this._nextTurn();
    this.pendingDoubleShot = 1;
    return { skillName: "DISPARO_DOBLE", finished: false };
  }

  publicState(forPlayerId) {
    forPlayerId = forPlayerId || null;
    const me = forPlayerId ? this.players.find((p) => p.id === forPlayerId) : null;
    return {
      status: this.status,
      winnerId: this.winnerId,
      direction: this.direction,
      pendingDoubleShot: this.pendingDoubleShot,
      turnPlayerId: this.status === "PLAYING" ? this.currentPlayer().id : null,
      deckCount: this.deck.length,
      duelTriggered: this.duelTriggered,
      mustRevealOnly: me ? this.mustRevealOnly(me) : null,
      pendingResolution: this.pendingResolution
        ? { type: this.pendingResolution.type, playerId: this.pendingResolution.playerId, stage: this.pendingResolution.stage }
        : null,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, ownedSkills: p.ownedSkills.slice(),
        status: Object.assign({}, p.status), eliminated: p.eliminated, isYou: p.id === forPlayerId,
      })),
      log: this.log.slice(-30),
    };
  }
}

/* ===================== GESTION DES SALONS (ROOMS) ===================== */

function genRoomCode() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var code = "";
  for (var i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function RoomManager() {
  this.rooms = new Map();
}

RoomManager.prototype.createRoom = function (hostSocketId, hostName) {
  var code;
  do { code = genRoomCode(); } while (this.rooms.has(code));
  var room = {
    code: code,
    hostSocketId: hostSocketId,
    players: [{ socketId: hostSocketId, name: hostName, id: hostSocketId }],
    game: null,
    createdAt: Date.now(),
  };
  this.rooms.set(code, room);
  return room;
};

RoomManager.prototype.getRoom = function (code) { return this.rooms.get(code); };

RoomManager.prototype.joinRoom = function (code, socketId, name) {
  var room = this.rooms.get(code);
  if (!room) throw new Error("Salon introuvable");
  if (room.game) throw new Error("La partie a deja commence");
  if (room.players.length >= 6) throw new Error("Le salon est complet (6 joueurs max)");
  var nameTaken = room.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });
  if (nameTaken) throw new Error("Ce pseudo est deja pris dans ce salon");
  room.players.push({ socketId: socketId, name: name, id: socketId });
  return room;
};

RoomManager.prototype.removePlayerFromAllRooms = function (socketId) {
  var affected = [];
  this.rooms.forEach(function (room) {
    var before = room.players.length;
    room.players = room.players.filter(function (p) { return p.socketId !== socketId; });
    if (room.players.length !== before) {
      affected.push(room);
      if (room.hostSocketId === socketId && room.players.length > 0) {
        room.hostSocketId = room.players[0].socketId;
      }
    }
  });
  var self = this;
  affected.forEach(function (room) {
    if (room.players.length === 0) self.rooms.delete(room.code);
  });
  return affected;
};

RoomManager.prototype.startGame = function (code, requesterSocketId) {
  var room = this.rooms.get(code);
  if (!room) throw new Error("Salon introuvable");
  if (room.hostSocketId !== requesterSocketId) throw new Error("Seul l'hote peut demarrer la partie");
  if (room.players.length < 2) throw new Error("Il faut au moins 2 joueurs");
  room.game = new RuletaRusaGame(room.players.map(function (p) { return { id: p.id, name: p.name }; }));
  return room;
};

RoomManager.prototype.resetGame = function (code) {
  var room = this.rooms.get(code);
  if (!room) throw new Error("Salon introuvable");
  room.game = null;
};

/* ===================== CLIENT WEB (HTML/CSS/JS EN MEMOIRE) ===================== */

var CLIENT_HTML = '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Ruleta Rusa</title>\n<style>\n@import url(\'https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&display=swap\');\n\n* { box-sizing: border-box; margin: 0; padding: 0; }\n\n:root {\n  --bg: #000000;\n  --bg-panel: #0d0d0d;\n  --bg-card: #141414;\n  --red: #e01a1a;\n  --red-dark: #8f0f0f;\n  --white: #f5f5f5;\n  --gray: #8a8a8a;\n  --gray-dim: #555555;\n  --green: #2ecc71;\n  --gold: #d9a634;\n}\n\nhtml, body { background: var(--bg); color: var(--white); font-family: \'Archivo Black\', Arial, sans-serif; min-height: 100vh; }\n.hidden-visually { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; }\n\n#app { min-height: 100vh; display: flex; flex-direction: column; }\n\n.screen { display: none; flex: 1; }\n.screen.active { display: flex; flex-direction: column; }\n\n/* ---------- TOPBAR (in-game) ---------- */\n.topbar {\n  display: flex; align-items: center; justify-content: space-between;\n  padding: 18px 28px; border-bottom: 1px solid #1c1c1c;\n}\n.topbar .logo { font-family: \'Anton\', sans-serif; font-size: 20px; color: var(--red); letter-spacing: 1px; }\n.topbar .topbar-right { display: flex; align-items: center; gap: 22px; font-size: 12px; letter-spacing: 1px; color: var(--gray); }\n.topbar .quit-btn { color: var(--gray); cursor: pointer; background: none; border: none; font-family: inherit; font-size: 12px; letter-spacing: 1px; }\n.topbar .quit-btn:hover { color: var(--red); }\n\n/* ---------- HOME SCREEN ---------- */\n#screen-home { align-items: center; justify-content: center; padding: 40px 20px; }\n.home-box { max-width: 460px; width: 100%; text-align: center; }\n.revolver-logo {\n  width: 110px; height: 110px; border-radius: 50%;\n  border: 4px solid var(--red);\n  display: flex; align-items: center; justify-content: center;\n  margin: 0 auto 20px;\n  position: relative;\n  box-shadow: 0 0 30px rgba(224,26,26,0.35);\n}\n.revolver-logo::before {\n  content: ""; position: absolute; width: 10px; height: 10px; background: var(--red); border-radius: 50%; top: 14px;\n}\n.revolver-logo-inner { width: 70px; height: 70px; border-radius: 50%; border: 2px solid var(--gray-dim); position: relative; }\n.revolver-dot { position: absolute; width: 8px; height: 8px; background: var(--gray-dim); border-radius: 50%; }\n\n.title-main { font-family: \'Anton\', sans-serif; font-size: 54px; color: var(--red); letter-spacing: 2px; line-height: 1; }\n.title-sub { font-family: \'Anton\', sans-serif; font-size: 54px; color: var(--white); letter-spacing: 2px; line-height: 1; margin-bottom: 10px; }\n.credit-line { font-size: 11px; color: var(--gray); letter-spacing: 2px; margin-bottom: 8px; text-transform: uppercase; }\n.credit-line .sep { color: var(--red); margin: 0 8px; }\n.credit-line-2 { font-size: 10px; color: var(--gray-dim); letter-spacing: 2px; margin-bottom: 34px; text-transform: uppercase; }\n.credit-line-2 .by-tag { color: var(--red); }\n\n.field-block { margin-bottom: 18px; text-align: left; }\n.field-block label { display: block; font-size: 11px; letter-spacing: 1px; color: var(--gray); margin-bottom: 8px; text-transform: uppercase; }\n.field-block input {\n  width: 100%; background: var(--bg-card); border: 1px solid #262626; color: var(--white);\n  padding: 14px 16px; font-family: \'Archivo Black\', Arial, sans-serif; font-size: 14px; border-radius: 4px;\n}\n.field-block input:focus { outline: none; border-color: var(--red); }\n\n.btn {\n  display: block; width: 100%; padding: 16px; border: none; border-radius: 4px;\n  font-family: \'Anton\', sans-serif; font-size: 16px; letter-spacing: 2px; text-transform: uppercase;\n  cursor: pointer; transition: transform .1s ease, opacity .2s ease;\n}\n.btn:active { transform: scale(0.98); }\n.btn:disabled { opacity: 0.35; cursor: not-allowed; }\n.btn-primary { background: var(--red); color: var(--white); box-shadow: 0 8px 24px rgba(224,26,26,0.3); }\n.btn-primary:hover:not(:disabled) { background: #ff2727; }\n.btn-outline { background: transparent; border: 1px solid #333; color: var(--white); }\n.btn-outline:hover { border-color: var(--red); color: var(--red); }\n\n.divider-or { text-align: center; color: var(--gray-dim); font-size: 11px; letter-spacing: 3px; margin: 22px 0; text-transform: uppercase; }\n.error-text { color: var(--red); font-size: 12px; margin-top: 14px; min-height: 16px; letter-spacing: 0.5px; }\n\n/* ---------- LOBBY SCREEN ---------- */\n#screen-lobby { align-items: center; justify-content: center; padding: 40px 20px; }\n.lobby-box { max-width: 460px; width: 100%; text-align: center; }\n.lobby-code-display { font-family: \'Anton\', sans-serif; font-size: 42px; letter-spacing: 6px; color: var(--gold); margin: 10px 0 8px; }\n.lobby-sub { font-size: 12px; color: var(--gray); letter-spacing: 1px; margin-bottom: 30px; }\n\n.count-row { display: flex; align-items: center; justify-content: center; gap: 24px; margin-bottom: 30px; }\n.count-btn {\n  width: 44px; height: 44px; border-radius: 50%; border: 1px solid #333; background: var(--bg-card);\n  color: var(--white); font-size: 20px; cursor: pointer; font-family: \'Anton\', sans-serif;\n}\n.count-btn:hover { border-color: var(--red); color: var(--red); }\n.count-value { font-family: \'Anton\', sans-serif; font-size: 40px; color: var(--white); min-width: 50px; }\n\n.player-slot-list { list-style: none; margin-bottom: 26px; text-align: left; }\n.player-slot-list li {\n  display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: var(--bg-card);\n  border-radius: 4px; margin-bottom: 8px; font-size: 14px;\n}\n.player-slot-list li .slot-idx { color: var(--gray-dim); font-family: \'Anton\', sans-serif; font-size: 13px; width: 18px; }\n.player-slot-list li .host-tag { margin-left: auto; font-size: 10px; color: var(--gold); border: 1px solid var(--gold); padding: 2px 8px; border-radius: 3px; letter-spacing: 1px; }\n\n.lobby-footnote { font-size: 11px; color: var(--gray-dim); letter-spacing: 0.5px; margin-top: 24px; line-height: 1.8; }\n\n/* ---------- GAME SCREEN ---------- */\n#screen-game { align-items: stretch; }\n.game-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; position: relative; }\n\n.turn-label { font-size: 12px; letter-spacing: 3px; color: var(--gray); text-transform: uppercase; margin-bottom: 6px; }\n.turn-name { font-family: \'Anton\', sans-serif; font-size: 40px; letter-spacing: 1px; margin-bottom: 30px; }\n\n/* Cercle des joueurs autour du barillet */\n.circle-wrap { position: relative; width: min(640px, 90vw); height: min(640px, 90vw); display: flex; align-items: center; justify-content: center; }\n\n.revolver-hub {\n  width: 200px; height: 200px; border-radius: 50%;\n  background: radial-gradient(circle at 35% 30%, #1a1a1a, #050505 70%);\n  border: 3px solid var(--gray-dim);\n  display: flex; flex-direction: column; align-items: center; justify-content: center;\n  cursor: pointer; transition: border-color .2s ease, box-shadow .2s ease;\n  position: relative; z-index: 3;\n}\n.revolver-hub.my-turn { border-color: var(--red); box-shadow: 0 0 40px rgba(224,26,26,0.45); }\n.revolver-hub .hub-icon { font-family: \'Anton\', sans-serif; font-size: 40px; color: var(--red); margin-bottom: 6px; }\n.revolver-hub .hub-count { font-size: 12px; letter-spacing: 1px; color: var(--gray); margin-bottom: 4px; }\n.revolver-hub .hub-hint { font-size: 10px; letter-spacing: 1px; color: var(--red); text-transform: uppercase; }\n.revolver-hub .hub-dots { display: flex; gap: 4px; margin-bottom: 8px; }\n.revolver-hub .hub-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gray-dim); }\n.revolver-hub .hub-dot.is-click { background: var(--red); }\n\n.player-node {\n  position: absolute;\n  width: 148px;\n  transform: translate(-50%, -50%);\n  text-align: center;\n  z-index: 2;\n}\n.player-node .node-ring {\n  width: 78px; height: 78px; border-radius: 50%; margin: 0 auto 8px;\n  border: 2px solid #2a2a2a; background: var(--bg-card);\n  display: flex; align-items: center; justify-content: center;\n  font-family: \'Anton\', sans-serif; font-size: 22px; color: var(--gray);\n  position: relative; transition: border-color .2s ease, box-shadow .2s ease;\n}\n.player-node.is-turn .node-ring { border-color: var(--red); box-shadow: 0 0 22px rgba(224,26,26,0.4); color: var(--white); }\n.player-node.is-you .node-ring { background: #1c1414; }\n.player-node.eliminated .node-ring { opacity: 0.3; }\n.player-node.eliminated .node-name { opacity: 0.35; }\n.player-node .turn-dot {\n  position: absolute; top: -4px; right: 6px; width: 12px; height: 12px; border-radius: 50%;\n  background: var(--red); border: 2px solid var(--bg); display: none;\n}\n.player-node.is-turn .turn-dot { display: block; }\n.player-node .node-name { font-size: 13px; letter-spacing: 0.5px; margin-bottom: 6px; color: var(--white); }\n.player-node .you-flag { font-size: 9px; color: var(--red); letter-spacing: 1px; margin-bottom: 4px; text-transform: uppercase; }\n.node-tokens { display: flex; gap: 5px; justify-content: center; }\n.node-token {\n  width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--gray-dim);\n  display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 700; color: var(--gray);\n}\n.node-token.alive { border-color: var(--green); color: var(--green); }\n.node-token.exhausted { border-color: var(--gold); color: var(--gold); }\n.node-token.dead { border-color: var(--gray-dim); color: var(--gray-dim); text-decoration: line-through; }\n\n/* ---------- ACTIONS PANEL ---------- */\n.actions-panel { width: 100%; max-width: 640px; margin-top: 30px; }\n.reveal-btn {\n  width: 100%; padding: 20px; background: var(--red); color: var(--white); border: none; border-radius: 6px;\n  font-family: \'Anton\', sans-serif; font-size: 18px; letter-spacing: 2px; text-transform: uppercase; cursor: pointer;\n  box-shadow: 0 10px 28px rgba(224,26,26,0.35);\n}\n.reveal-btn:hover { background: #ff2727; }\n.reveal-btn:disabled { opacity: 0.3; cursor: not-allowed; box-shadow: none; }\n\n.skills-divider { text-align: center; font-size: 11px; letter-spacing: 2px; color: var(--gray-dim); margin: 18px 0 14px; text-transform: uppercase; }\n.skills-panel { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }\n.skill-card {\n  flex: 1; min-width: 130px; max-width: 160px; background: var(--bg-card); border: 1px solid #262626;\n  border-radius: 6px; padding: 16px 10px; text-align: center; cursor: pointer; transition: border-color .15s ease;\n}\n.skill-card:hover:not(:disabled) { border-color: var(--red); }\n.skill-card:disabled { opacity: 0.3; cursor: not-allowed; }\n.skill-card .skill-icon { font-family: \'Anton\', sans-serif; font-size: 22px; color: var(--white); margin-bottom: 8px; }\n.skill-card .skill-name { font-family: \'Anton\', sans-serif; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--white); margin-bottom: 4px; }\n.skill-card .skill-desc { font-size: 10px; color: var(--gray-dim); letter-spacing: 0.3px; }\n\n.hint-line { text-align: center; font-size: 12px; color: var(--gray); margin-bottom: 12px; letter-spacing: 0.5px; }\n.hint-line.warn { color: var(--red); }\n\n/* ---------- LOG PANEL ---------- */\n.log-toggle { position: fixed; bottom: 20px; right: 20px; background: var(--bg-card); border: 1px solid #262626; color: var(--gray); border-radius: 30px; padding: 10px 18px; font-size: 11px; letter-spacing: 1px; cursor: pointer; z-index: 10; }\n.log-drawer {\n  position: fixed; bottom: 0; right: 0; width: 320px; max-height: 320px; background: var(--bg-panel);\n  border: 1px solid #262626; border-radius: 8px 0 0 0; padding: 16px; overflow-y: auto; z-index: 9;\n  display: none;\n}\n.log-drawer.active { display: block; }\n.log-drawer h3 { font-size: 11px; letter-spacing: 2px; color: var(--gray); margin-bottom: 10px; text-transform: uppercase; }\n.log-drawer ul { list-style: none; font-size: 12px; }\n.log-drawer li { padding: 6px 0; border-bottom: 1px solid #1c1c1c; color: var(--gray); }\n.log-drawer li:last-child { border-bottom: none; }\n\n/* ---------- CINEMATIC ---------- */\n.cinematic-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.94); align-items: center; justify-content: center; z-index: 100; flex-direction: column; text-align: center; }\n.cinematic-overlay.active { display: flex; }\n.cinematic-text { font-family: \'Anton\', sans-serif; font-size: 96px; letter-spacing: 4px; animation: pop 0.4s ease; }\n.cinematic-text.is-click { color: var(--green); }\n.cinematic-text.is-bang { color: var(--red); text-shadow: 0 0 40px rgba(224,26,26,0.7); }\n.cinematic-sub-name { font-family: \'Anton\', sans-serif; font-size: 26px; color: var(--white); margin-top: 10px; }\n.cinematic-sub-hint { font-size: 13px; color: var(--gray); margin-top: 8px; letter-spacing: 1px; }\n@keyframes pop { 0% { transform: scale(0.3); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }\n\n/* ---------- MODALS ---------- */\n.modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); align-items: center; justify-content: center; z-index: 60; padding: 20px; }\n.modal-overlay.active { display: flex; }\n.modal-box { background: var(--bg-panel); border: 1px solid #262626; border-radius: 8px; padding: 28px; max-width: 380px; width: 100%; }\n.modal-box-wide { max-width: 560px; }\n.modal-box h3 { font-family: \'Anton\', sans-serif; font-size: 22px; letter-spacing: 1px; margin-bottom: 6px; text-transform: uppercase; }\n.modal-box .modal-hint { font-size: 12px; color: var(--gray); margin-bottom: 18px; letter-spacing: 0.3px; }\n.modal-options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }\n.modal-options button {\n  padding: 13px 16px; border-radius: 4px; border: 1px solid #262626; background: var(--bg-card); color: var(--white);\n  cursor: pointer; text-align: left; font-family: \'Archivo Black\', Arial, sans-serif; font-size: 13px;\n}\n.modal-options button:hover { border-color: var(--red); }\n\n.mirar-peek { text-align: center; font-family: \'Anton\', sans-serif; font-size: 40px; padding: 24px; border-radius: 6px; background: var(--bg-card); margin-bottom: 18px; }\n.mirar-peek.is-click { color: var(--green); }\n.mirar-peek.is-bang { color: var(--red); }\n\n.reorder-slots { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; justify-content: center; }\n.reorder-slot {\n  width: 58px; height: 58px; border-radius: 8px; border: 2px solid #262626; display: flex; align-items: center;\n  justify-content: center; font-size: 11px; font-weight: 700; cursor: pointer; user-select: none;\n  font-family: \'Anton\', sans-serif;\n}\n.reorder-slot.slot-click { background: #0e1f14; border-color: var(--green); color: var(--green); }\n.reorder-slot.slot-bang { background: #260c0c; border-color: var(--red); color: var(--red); }\n.reorder-slot .slot-index { display: block; font-size: 8px; color: var(--gray-dim); margin-bottom: 2px; font-family: \'Archivo Black\', Arial, sans-serif; }\n\n/* ---------- END SCREEN ---------- */\n#screen-end { align-items: center; justify-content: center; padding: 40px 20px; }\n.end-box { max-width: 420px; text-align: center; }\n.end-title { font-family: \'Anton\', sans-serif; font-size: 46px; color: var(--red); letter-spacing: 1px; margin-bottom: 12px; }\n.end-message { font-size: 14px; color: var(--gray); margin-bottom: 30px; letter-spacing: 0.3px; }\n\n@media (max-width: 700px) {\n  .circle-wrap { width: 92vw; height: 92vw; }\n  .revolver-hub { width: 140px; height: 140px; }\n  .player-node { width: 100px; }\n  .player-node .node-ring { width: 56px; height: 56px; font-size: 16px; }\n  .title-main, .title-sub { font-size: 38px; }\n  .turn-name { font-size: 28px; }\n}\n</style>\n</head>\n<body>\n\n<div id="app">\n\n  <!-- ACCUEIL -->\n  <section id="screen-home" class="screen active">\n    <div class="home-box">\n      <div class="revolver-logo">\n        <div class="revolver-logo-inner">\n          <div class="revolver-dot" style="top:6px;left:29px;"></div>\n          <div class="revolver-dot" style="top:19px;left:50px;"></div>\n          <div class="revolver-dot" style="top:44px;left:50px;"></div>\n          <div class="revolver-dot" style="top:56px;left:29px;"></div>\n          <div class="revolver-dot" style="top:44px;left:8px;"></div>\n          <div class="revolver-dot" style="top:19px;left:8px;"></div>\n        </div>\n      </div>\n      <div class="title-main">RULETA</div>\n      <div class="title-sub">RUSA</div>\n      <div class="credit-line">GDM GAMES<span class="sep">&middot;</span>RA&Uacute;L L&Oacute;PEZ<span class="sep">&middot;</span>&Eacute;DITION NUM&Eacute;RIQUE</div>\n      <div class="credit-line-2"><span class="by-tag">BY DOUBLE A</span></div>\n\n      <div class="field-block">\n        <label for="input-name">Ton pseudo</label>\n        <input id="input-name" type="text" maxlength="20" placeholder="Ex: Amine">\n      </div>\n\n      <button id="btn-create" class="btn btn-primary">Cr&eacute;er un salon</button>\n\n      <div class="divider-or">ou</div>\n\n      <div class="field-block">\n        <label for="input-code">Code du salon</label>\n        <input id="input-code" type="text" maxlength="5" placeholder="Ex: AB3F9" style="text-transform:uppercase">\n      </div>\n      <button id="btn-join" class="btn btn-outline">Rejoindre</button>\n\n      <p id="home-error" class="error-text"></p>\n    </div>\n  </section>\n\n  <!-- LOBBY -->\n  <section id="screen-lobby" class="screen">\n    <div class="lobby-box">\n      <div class="lobby-code-display" id="lobby-code"></div>\n      <div class="lobby-sub">PARTAGE CE CODE POUR REJOINDRE (2 A 6 JOUEURS)</div>\n\n      <ul id="lobby-players" class="player-slot-list"></ul>\n\n      <button id="btn-start" class="btn btn-primary" style="display:none">Jouer</button>\n      <p id="lobby-hint" class="error-text" style="color:var(--gray)"></p>\n      <p id="lobby-error" class="error-text"></p>\n\n      <div class="lobby-footnote">7 JETONS CLICK &middot; 1 JETON BANG &middot; 3 CAPACIT&Eacute;S PAR JOUEUR<br>DERNIER SURVIVANT REMPORTE LA PARTIE</div>\n    </div>\n  </section>\n\n  <!-- JEU -->\n  <section id="screen-game" class="screen">\n    <div class="topbar">\n      <div class="logo">RULETA RUSA</div>\n      <div class="topbar-right">\n        <span id="survivors-count">- SURVIVANTS</span>\n        <button id="btn-quit" class="quit-btn">&times; QUITTER</button>\n      </div>\n    </div>\n\n    <div class="game-body">\n      <div class="turn-label" id="turn-label">C\'EST LE TOUR DE</div>\n      <div class="turn-name" id="turn-name">--</div>\n\n      <div class="circle-wrap" id="circle-wrap">\n        <div class="revolver-hub" id="revolver-hub">\n          <div class="hub-dots" id="hub-dots"></div>\n          <div class="hub-count" id="hub-count">8 / 8 JETONS</div>\n          <div class="hub-hint" id="hub-hint">TOUCHER POUR R&Eacute;V&Eacute;LER</div>\n        </div>\n        <!-- player-node elements injected here dynamically -->\n      </div>\n\n      <div class="actions-panel" id="actions-panel" style="display:none">\n        <p class="hint-line warn" id="must-reveal-hint" style="display:none">Aucune fiche disponible : tu dois r&eacute;v&eacute;ler le barillet.</p>\n        <p class="hint-line warn" id="double-shot-hint" style="display:none">Disparo doble actif : r&eacute;v&egrave;le une fiche suppl&eacute;mentaire.</p>\n        <button id="btn-reveal" class="reveal-btn">R&Eacute;V&Eacute;LER UN JETON</button>\n        <div class="skills-divider">— OU UTILISER UNE CAPACIT&Eacute; —</div>\n        <div class="skills-panel" id="skills-panel"></div>\n      </div>\n    </div>\n  </section>\n\n  <!-- FIN -->\n  <section id="screen-end" class="screen">\n    <div class="end-box">\n      <div class="end-title" id="end-title">PARTIE TERMIN&Eacute;E</div>\n      <p class="end-message" id="end-message"></p>\n      <button id="btn-rematch" class="btn btn-primary">Relancer une partie</button>\n    </div>\n  </section>\n\n</div>\n\n<button class="log-toggle" id="log-toggle">JOURNAL</button>\n<div class="log-drawer" id="log-drawer">\n  <h3>Journal de partie</h3>\n  <ul id="game-log"></ul>\n</div>\n\n<div id="reveal-cinematic" class="cinematic-overlay">\n  <div id="reveal-cinematic-text" class="cinematic-text"></div>\n  <div id="reveal-cinematic-name" class="cinematic-sub-name"></div>\n  <div id="reveal-cinematic-hint" class="cinematic-sub-hint"></div>\n</div>\n\n<div id="modal-target" class="modal-overlay">\n  <div class="modal-box">\n    <h3 id="modal-title">Choisis une cible</h3>\n    <div id="modal-options" class="modal-options"></div>\n    <button id="modal-cancel" class="btn btn-outline">Annuler</button>\n  </div>\n</div>\n\n<div id="modal-bang-choice" class="modal-overlay">\n  <div class="modal-box">\n    <h3>BANG !</h3>\n    <p class="modal-hint">Choisis quelle fiche encore en jeu tu perds d&eacute;finitivement.</p>\n    <div id="bang-choice-options" class="modal-options"></div>\n  </div>\n</div>\n\n<div id="modal-reorder" class="modal-overlay">\n  <div class="modal-box modal-box-wide">\n    <h3 id="modal-reorder-title">R&eacute;organise le barillet</h3>\n    <p class="modal-hint">Clique sur 2 cases pour les &eacute;changer, jusqu\'&agrave; obtenir l\'ordre que tu veux.</p>\n    <div id="reorder-slots" class="reorder-slots"></div>\n    <button id="btn-confirm-reorder" class="btn btn-primary">Confirmer l\'ordre</button>\n  </div>\n</div>\n\n<div id="modal-mirar" class="modal-overlay">\n  <div class="modal-box">\n    <h3>Mirar</h3>\n    <p id="mirar-peek-result" class="mirar-peek"></p>\n    <div class="modal-options">\n      <button id="mirar-keep">Laisser en place</button>\n      <button id="mirar-bottom">Mettre au fond du barillet</button>\n    </div>\n  </div>\n</div>\n\n<div id="modal-click-recharge" class="modal-overlay">\n  <div class="modal-box">\n    <h3>CLICK !</h3>\n    <p class="modal-hint">Choisis quelle fiche &eacute;puis&eacute;e tu recharges.</p>\n    <div id="click-recharge-options" class="modal-options"></div>\n  </div>\n</div>\n\n<script src="/socket.io/socket.io.js"></script>\n<script>\n"use strict";\n\nvar socket = io();\nvar state = { myId: null, name: "", code: null, isHost: false, lastGameState: null, reorderDeck: null, reorderSelectedIdx: null, reorderMode: null };\nfunction el(id) { return document.getElementById(id); }\n\nfunction showScreen(id) {\n  var screens = document.querySelectorAll(".screen");\n  for (var i = 0; i < screens.length; i++) screens[i].classList.remove("active");\n  el(id).classList.add("active");\n}\n\nel("btn-create").addEventListener("click", function () {\n  var name = el("input-name").value.trim();\n  if (!name) { showHomeError("Entre un pseudo pour continuer."); return; }\n  state.name = name;\n  socket.emit("room:create", { name: name });\n});\n\nel("btn-join").addEventListener("click", function () {\n  var name = el("input-name").value.trim();\n  var code = el("input-code").value.trim().toUpperCase();\n  if (!name) { showHomeError("Entre un pseudo pour continuer."); return; }\n  if (!code) { showHomeError("Entre le code du salon."); return; }\n  state.name = name;\n  socket.emit("room:join", { code: code, name: name });\n});\n\nfunction showHomeError(msg) { el("home-error").textContent = msg; }\n\nel("btn-start").addEventListener("click", function () { socket.emit("room:start", { code: state.code }); });\nel("btn-rematch").addEventListener("click", function () { socket.emit("room:rematch", { code: state.code }); });\nel("btn-quit").addEventListener("click", function () { window.location.reload(); });\n\nel("log-toggle").addEventListener("click", function () { el("log-drawer").classList.toggle("active"); });\n\nsocket.on("connect", function () { state.myId = socket.id; });\nsocket.on("room:created", function (data) { state.code = data.code; state.isHost = true; el("home-error").textContent = ""; });\nsocket.on("room:joined", function (data) { state.code = data.code; state.isHost = false; el("home-error").textContent = ""; });\n\nsocket.on("error:message", function (data) {\n  var message = data.message;\n  var homeVisible = el("screen-home").classList.contains("active");\n  var lobbyVisible = el("screen-lobby").classList.contains("active");\n  if (homeVisible) showHomeError(message);\n  else if (lobbyVisible) el("lobby-error").textContent = message;\n  else alert(message);\n});\n\nsocket.on("lobby:update", function (data) {\n  state.code = data.code;\n  state.isHost = data.hostSocketId === socket.id;\n  if (data.started) return;\n  showScreen("screen-lobby");\n  el("lobby-code").textContent = data.code;\n  el("lobby-error").textContent = "";\n  var list = el("lobby-players");\n  list.innerHTML = "";\n  data.players.forEach(function (p, idx) {\n    var li = document.createElement("li");\n    var isHostPlayer = p.id === data.hostSocketId;\n    var hostTag = isHostPlayer ? \'<span class="host-tag">HOTE</span>\' : "";\n    li.innerHTML = \'<span class="slot-idx">\' + (idx + 1) + \'</span><span>\' + escapeHtml(p.name) + \'</span>\' + hostTag;\n    list.appendChild(li);\n  });\n  el("btn-start").style.display = state.isHost ? "block" : "none";\n  el("btn-start").disabled = data.players.length < 2;\n  el("lobby-hint").textContent = state.isHost\n    ? (data.players.length < 2 ? "Il faut au moins 2 joueurs pour lancer la partie." : "Tu peux lancer la partie quand tout le monde est pret (max 6).")\n    : "En attente que l\'hote lance la partie...";\n});\n\nvar lastRevealHandled = null;\n\nsocket.on("game:state", function (gs) {\n  state.lastGameState = gs;\n  if (gs.status === "FINISHED") { renderEndScreen(gs); return; }\n  showScreen("screen-game");\n  renderGame(gs);\n\n  if (gs.lastReveal && gs.lastReveal !== lastRevealHandled) {\n    lastRevealHandled = gs.lastReveal;\n    /* CORRECTIF : on utilise desormais revealerId (fourni explicitement par\n       le serveur) pour identifier le joueur qui vient reellement de tirer,\n       au lieu de deviner via turnPlayerId qui peut deja avoir avance\n       (cas d\'un simple CLICK sans BANG ni resolution en attente). */\n    var revealerId = gs.lastReveal.revealerId;\n    var revealer = gs.players.find(function (p) { return p.id === revealerId; });\n    playRevealCinematic(gs.lastReveal.token, revealer, function () {\n      var me = gs.players.find(function (p) { return p.isYou; });\n      if (!me) return;\n      if (gs.lastReveal.awaitingClickRecharge && gs.turnPlayerId === me.id) {\n        openClickRechargeModal(me);\n      } else if (gs.lastReveal.awaitingBangResolution && gs.pendingResolution && gs.pendingResolution.playerId === me.id) {\n        if (gs.pendingResolution.stage === "choose_skill") openBangChoiceModal(me);\n        else if (gs.pendingResolution.stage === "reorder" || gs.pendingResolution.stage === "reorder_only") openReorderModal("bang", null);\n      }\n    });\n  } else if (gs.pendingResolution) {\n    var me2 = gs.players.find(function (p) { return p.isYou; });\n    if (me2 && gs.pendingResolution.playerId === me2.id) {\n      if (gs.pendingResolution.stage === "choose_skill" && !el("modal-bang-choice").classList.contains("active")) {\n        openBangChoiceModal(me2);\n      } else if ((gs.pendingResolution.stage === "reorder" || gs.pendingResolution.stage === "reorder_only") && !el("modal-reorder").classList.contains("active")) {\n        openReorderModal("bang", null);\n      }\n    }\n  }\n});\n\nsocket.on("game:mirarPeekResult", function (data) { showMirarResult(data.peekedToken); });\nsocket.on("game:reordenarPeekResult", function (data) { openReorderModal("reordenar", data.currentDeck); });\n\nvar SKILL_LABELS = { VOLTEAR: "Voltear", REORDENAR: "Reordenar", CAMBIO_TURNO: "Cambiar turno", MIRAR: "Mirar", CAMBIO_SENTIDO: "Cambiar sentido", DISPARO_DOBLE: "Disparo doble" };\nvar SKILL_ICONS = { VOLTEAR: "\\u2195", REORDENAR: "\\u21bb", CAMBIO_TURNO: "\\u2192", MIRAR: "\\u25c9", CAMBIO_SENTIDO: "\\u21c4", DISPARO_DOBLE: "\\u00d72" };\nvar SKILL_DESC = {\n  VOLTEAR: "Epuise un pouvoir adverse",\n  REORDENAR: "Melange la pile",\n  CAMBIO_TURNO: "Force un autre joueur",\n  MIRAR: "Regarde le prochain jeton",\n  CAMBIO_SENTIDO: "Inverse le sens",\n  DISPARO_DOBLE: "Impose 2 tirages"\n};\n/* Pouvoirs qui necessitent au moins 2 fiches dans le barillet pour etre\n   utilises (regle officielle : impossible de "voir/reordonner" s\'il ne\n   reste qu\'une seule fiche, puisqu\'il n\'y a alors rien a reordonner). */\nvar SKILLS_REQUIRE_2_TOKENS = { MIRAR: true, REORDENAR: true };\n\nfunction renderGame(gs) {\n  var me = gs.players.find(function (p) { return p.isYou; });\n  var turnPlayer = gs.players.find(function (p) { return p.id === gs.turnPlayerId; });\n  var isMyTurn = turnPlayer && me && turnPlayer.id === me.id;\n  var resolutionPending = !!gs.pendingResolution;\n\n  var aliveCount = gs.players.filter(function (p) { return !p.eliminated; }).length;\n  el("survivors-count").textContent = aliveCount + " SURVIVANT" + (aliveCount > 1 ? "S" : "");\n\n  el("turn-label").textContent = isMyTurn ? "C\'EST TON TOUR" : "C\'EST LE TOUR DE";\n  el("turn-name").textContent = isMyTurn ? "" : (turnPlayer ? turnPlayer.name.toUpperCase() : "--");\n  if (isMyTurn) { el("turn-label").textContent = ""; el("turn-name").textContent = "A TOI DE JOUER"; }\n\n  el("hub-count").textContent = gs.deckCount + " / 8 JETONS";\n  var hub = el("revolver-hub");\n  hub.classList.toggle("my-turn", isMyTurn && !resolutionPending);\n  var hubHint = el("hub-hint");\n  if (isMyTurn && !resolutionPending && !gs.mustRevealOnly) {\n    hubHint.style.display = "block";\n    hubHint.textContent = "TOUCHER POUR REVELER";\n  } else {\n    hubHint.style.display = "none";\n  }\n  hub.onclick = function () {\n    if (isMyTurn && !resolutionPending) socket.emit("game:revealTop", { code: state.code });\n  };\n\n  var dotsContainer = el("hub-dots");\n  dotsContainer.innerHTML = "";\n  for (var d = 0; d < gs.deckCount; d++) {\n    var dot = document.createElement("div");\n    dot.className = "hub-dot";\n    dotsContainer.appendChild(dot);\n  }\n\n  renderCircle(gs, me);\n\n  var actionsPanel = el("actions-panel");\n  actionsPanel.style.display = (isMyTurn && !resolutionPending) ? "block" : "none";\n\n  if (isMyTurn && me && !resolutionPending) {\n    var mustReveal = gs.mustRevealOnly;\n    el("must-reveal-hint").style.display = mustReveal ? "block" : "none";\n    el("double-shot-hint").style.display = gs.pendingDoubleShot > 0 ? "block" : "none";\n    el("btn-reveal").onclick = function () { socket.emit("game:revealTop", { code: state.code }); };\n\n    var skillsPanel = el("skills-panel");\n    skillsPanel.innerHTML = "";\n    if (!mustReveal) {\n      me.ownedSkills.forEach(function (skill) {\n        var card = document.createElement("button");\n        card.className = "skill-card";\n        /* CORRECTIF : Mirar et Reordenar sont visuellement desactives des\n           qu\'il ne reste qu\'une seule fiche dans le barillet, en plus du\n           blocage deja applique cote serveur. Le joueur voit ainsi tout de\n           suite qu\'il doit reveler ou choisir une autre capacite. */\n        var lockedByTokenCount = SKILLS_REQUIRE_2_TOKENS[skill] && gs.deckCount <= 1;\n        card.disabled = me.status[skill] !== "alive" || lockedByTokenCount;\n        var desc = lockedByTokenCount ? "Indisponible (1 seul jeton restant)" : SKILL_DESC[skill];\n        card.innerHTML =\n          \'<div class="skill-icon">\' + SKILL_ICONS[skill] + \'</div>\' +\n          \'<div class="skill-name">\' + SKILL_LABELS[skill] + \'</div>\' +\n          \'<div class="skill-desc">\' + desc + \'</div>\';\n        card.onclick = function () { handleSkillClick(skill, gs, me); };\n        skillsPanel.appendChild(card);\n      });\n    }\n  }\n\n  var logList = el("game-log");\n  logList.innerHTML = "";\n  gs.log.slice().reverse().forEach(function (entry) {\n    var li = document.createElement("li");\n    li.textContent = entry.message;\n    logList.appendChild(li);\n  });\n}\n\nfunction renderCircle(gs, me) {\n  var wrap = el("circle-wrap");\n  var existingNodes = wrap.querySelectorAll(".player-node");\n  existingNodes.forEach(function (n) { n.remove(); });\n\n  var n = gs.players.length;\n  var radiusPercent = 42;\n  gs.players.forEach(function (p, idx) {\n    var angle = (idx / n) * 2 * Math.PI - Math.PI / 2;\n    var x = 50 + radiusPercent * Math.cos(angle);\n    var y = 50 + radiusPercent * Math.sin(angle);\n\n    var node = document.createElement("div");\n    node.className = "player-node";\n    if (p.id === gs.turnPlayerId) node.classList.add("is-turn");\n    if (p.isYou) node.classList.add("is-you");\n    if (p.eliminated) node.classList.add("eliminated");\n    node.style.left = x + "%";\n    node.style.top = y + "%";\n\n    var initials = p.name.slice(0, 2).toUpperCase();\n    var tokensHtml = p.ownedSkills.map(function (skill) {\n      var st = p.status[skill];\n      return \'<div class="node-token \' + st + \'">\' + SKILL_ICONS[skill] + \'</div>\';\n    }).join("");\n\n    node.innerHTML =\n      \'<div class="node-ring"><div class="turn-dot"></div>\' + initials + \'</div>\' +\n      (p.isYou ? \'<div class="you-flag">TOI</div>\' : \'\') +\n      \'<div class="node-name">\' + escapeHtml(p.name.toUpperCase()) + (p.eliminated ? " \\u2620" : "") + \'</div>\' +\n      \'<div class="node-tokens">\' + tokensHtml + \'</div>\';\n\n    wrap.appendChild(node);\n  });\n}\n\nfunction handleSkillClick(skill, gs, me) {\n  if (skill === "REORDENAR") { socket.emit("game:useSkill", { code: state.code, skillName: "REORDENAR", options: {} }); return; }\n  if (skill === "CAMBIO_SENTIDO") { socket.emit("game:useSkill", { code: state.code, skillName: "CAMBIO_SENTIDO", options: {} }); return; }\n  if (skill === "DISPARO_DOBLE") { socket.emit("game:useSkill", { code: state.code, skillName: "DISPARO_DOBLE", options: {} }); return; }\n  if (skill === "MIRAR") { socket.emit("game:peekMirar", { code: state.code }); return; }\n  if (skill === "VOLTEAR") {\n    var targets = [];\n    gs.players.forEach(function (p) {\n      if (p.isYou || p.eliminated) return;\n      p.ownedSkills.forEach(function (s) { if (p.status[s] === "alive") targets.push({ playerId: p.id, playerName: p.name, skill: s }); });\n    });\n    openTargetModal("Choisis une fiche adverse a epuiser", targets.map(function (t) {\n      return {\n        label: t.playerName + " \\u2014 " + SKILL_LABELS[t.skill],\n        onSelect: function () { socket.emit("game:useSkill", { code: state.code, skillName: "VOLTEAR", options: { targetPlayerId: t.playerId, targetSkill: t.skill } }); }\n      };\n    }));\n    return;\n  }\n  if (skill === "CAMBIO_TURNO") {\n    var targets2 = gs.players.filter(function (p) { return !p.isYou && !p.eliminated; });\n    openTargetModal("Choisis qui doit jouer a ta place", targets2.map(function (p) {\n      return {\n        label: p.name,\n        onSelect: function () { socket.emit("game:useSkill", { code: state.code, skillName: "CAMBIO_TURNO", options: { targetPlayerId: p.id } }); }\n      };\n    }));\n    return;\n  }\n}\n\nfunction playRevealCinematic(token, revealer, onDone) {\n  var overlay = el("reveal-cinematic");\n  var textEl = el("reveal-cinematic-text");\n  var nameEl = el("reveal-cinematic-name");\n  var hintEl = el("reveal-cinematic-hint");\n  textEl.textContent = token === "BANG" ? "BANG!" : "CLICK!";\n  textEl.className = "cinematic-text " + (token === "BANG" ? "is-bang" : "is-click");\n  nameEl.textContent = revealer ? revealer.name : "";\n  hintEl.textContent = token === "BANG" ? "Doit perdre une capacite !" : "";\n  overlay.classList.add("active");\n  setTimeout(function () { overlay.classList.remove("active"); if (onDone) onDone(); }, 1300);\n}\n\nfunction openClickRechargeModal(me) {\n  var exhausted = me.ownedSkills.filter(function (s) { return me.status[s] === "exhausted"; });\n  if (exhausted.length === 0) return;\n  var box = el("click-recharge-options");\n  box.innerHTML = "";\n  exhausted.forEach(function (s) {\n    var btn = document.createElement("button");\n    btn.textContent = SKILL_LABELS[s];\n    btn.onclick = function () {\n      socket.emit("game:resolveClickRecharge", { code: state.code, skillToRecharge: s });\n      el("modal-click-recharge").classList.remove("active");\n    };\n    box.appendChild(btn);\n  });\n  el("modal-click-recharge").classList.add("active");\n}\n\nfunction openBangChoiceModal(me) {\n  var inPlay = me.ownedSkills.filter(function (s) { return me.status[s] !== "dead"; });\n  var box = el("bang-choice-options");\n  box.innerHTML = "";\n  inPlay.forEach(function (s) {\n    var btn = document.createElement("button");\n    btn.textContent = SKILL_LABELS[s] + " (" + me.status[s] + ")";\n    btn.onclick = function () {\n      socket.emit("game:resolveBangSkillChoice", { code: state.code, skillToLose: s });\n      el("modal-bang-choice").classList.remove("active");\n    };\n    box.appendChild(btn);\n  });\n  el("modal-bang-choice").classList.add("active");\n}\n\nfunction openReorderModal(mode, currentDeck) {\n  state.reorderMode = mode;\n  state.reorderDeck = currentDeck ? currentDeck.slice() : new Array(7).fill("CLICK").concat(["BANG"]);\n  state.reorderSelectedIdx = null;\n  el("modal-reorder-title").textContent = mode === "reordenar" ? "Reordenar : reorganise le barillet" : "Reorganise le barillet";\n  renderReorderSlots();\n  el("modal-reorder").classList.add("active");\n}\n\nfunction renderReorderSlots() {\n  var container = el("reorder-slots");\n  container.innerHTML = "";\n  state.reorderDeck.forEach(function (token, idx) {\n    var slot = document.createElement("div");\n    slot.className = "reorder-slot " + (token === "BANG" ? "slot-bang" : "slot-click");\n    if (state.reorderSelectedIdx === idx) slot.style.outline = "3px solid #fff";\n    slot.innerHTML = \'<div><span class="slot-index">\' + (idx + 1) + \'</span>\' + (token === "BANG" ? "BANG" : "CLICK") + \'</div>\';\n    slot.onclick = function () {\n      if (state.reorderSelectedIdx === null) { state.reorderSelectedIdx = idx; }\n      else if (state.reorderSelectedIdx === idx) { state.reorderSelectedIdx = null; }\n      else {\n        var tmp = state.reorderDeck[idx];\n        state.reorderDeck[idx] = state.reorderDeck[state.reorderSelectedIdx];\n        state.reorderDeck[state.reorderSelectedIdx] = tmp;\n        state.reorderSelectedIdx = null;\n      }\n      renderReorderSlots();\n    };\n    container.appendChild(slot);\n  });\n}\n\nel("btn-confirm-reorder").addEventListener("click", function () {\n  if (state.reorderMode === "reordenar") {\n    socket.emit("game:useSkill", { code: state.code, skillName: "REORDENAR", options: { newOrder: state.reorderDeck } });\n  } else {\n    socket.emit("game:resolveBangReorder", { code: state.code, newOrder: state.reorderDeck });\n  }\n  el("modal-reorder").classList.remove("active");\n});\n\nfunction showMirarResult(peekedToken) {\n  var resultEl = el("mirar-peek-result");\n  resultEl.textContent = peekedToken;\n  resultEl.className = "mirar-peek " + (peekedToken === "BANG" ? "is-bang" : "is-click");\n  el("modal-mirar").classList.add("active");\n}\n\nel("mirar-keep").addEventListener("click", function () {\n  socket.emit("game:useSkill", { code: state.code, skillName: "MIRAR", options: { keepOnTop: true } });\n  el("modal-mirar").classList.remove("active");\n});\nel("mirar-bottom").addEventListener("click", function () {\n  socket.emit("game:useSkill", { code: state.code, skillName: "MIRAR", options: { keepOnTop: false } });\n  el("modal-mirar").classList.remove("active");\n});\n\nfunction openTargetModal(title, options) {\n  el("modal-title").textContent = title;\n  var box = el("modal-options");\n  box.innerHTML = "";\n  if (options.length === 0) box.innerHTML = \'<p style="color:#8a8a8a;font-size:13px;">Aucune cible disponible.</p>\';\n  options.forEach(function (opt) {\n    var btn = document.createElement("button");\n    btn.textContent = opt.label;\n    btn.onclick = function () { opt.onSelect(); closeModal(); };\n    box.appendChild(btn);\n  });\n  el("modal-target").classList.add("active");\n}\nfunction closeModal() { el("modal-target").classList.remove("active"); }\nel("modal-cancel").addEventListener("click", closeModal);\n\nfunction renderEndScreen(gs) {\n  showScreen("screen-end");\n  var winner = gs.players.find(function (p) { return p.id === gs.winnerId; });\n  if (winner) {\n    el("end-title").textContent = winner.isYou ? "TU AS GAGNE !" : "PARTIE TERMINEE";\n    el("end-message").textContent = winner.name + " est le dernier survivant.";\n  } else {\n    el("end-title").textContent = "MATCH NUL";\n    el("end-message").textContent = "Personne n\'a survecu a la Ruleta Rusa.";\n  }\n  el("btn-rematch").style.display = state.isHost ? "block" : "none";\n}\n\nfunction escapeHtml(str) {\n  var div = document.createElement("div");\n  div.textContent = str;\n  return div.innerHTML;\n}\n</script>\n</body>\n</html>';

/* ===================== SERVEUR ===================== */

var app = express();
var server = http.createServer(app);
var io = new Server(server, { cors: { origin: "*" } });

var PORT = process.env.PORT || 3000;
var rooms = new RoomManager();

app.get("/", function (req, res) {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(CLIENT_HTML);
});

function broadcastRoomLobby(room) {
  io.to(room.code).emit("lobby:update", {
    code: room.code,
    hostSocketId: room.hostSocketId,
    players: room.players.map(function (p) { return { id: p.id, name: p.name }; }),
    started: !!room.game,
  });
}

function broadcastGameState(room, extra) {
  extra = extra || {};
  if (!room.game) return;
  room.players.forEach(function (p) {
    var state = room.game.publicState(p.socketId);
    for (var key in extra) state[key] = extra[key];
    io.to(p.socketId).emit("game:state", state);
  });
}

function emitError(socket, message) {
  socket.emit("error:message", { message: message });
}

io.on("connection", function (socket) {
  socket.on("room:create", function (data) {
    try {
      var cleanName = (data.name || "").trim().slice(0, 20) || "Joueur";
      var room = rooms.createRoom(socket.id, cleanName);
      socket.join(room.code);
      socket.emit("room:created", { code: room.code });
      broadcastRoomLobby(room);
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("room:join", function (data) {
    try {
      var cleanCode = (data.code || "").trim().toUpperCase();
      var cleanName = (data.name || "").trim().slice(0, 20) || "Joueur";
      var room = rooms.joinRoom(cleanCode, socket.id, cleanName);
      socket.join(room.code);
      socket.emit("room:joined", { code: room.code });
      broadcastRoomLobby(room);
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("room:start", function (data) {
    try {
      var room = rooms.startGame(data.code, socket.id);
      broadcastRoomLobby(room);
      broadcastGameState(room);
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:revealTop", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      var result = room.game.revealTop(socket.id);
      broadcastGameState(room, { lastReveal: result });
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:resolveClickRecharge", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      room.game.resolveClickRecharge(socket.id, data.skillToRecharge);
      broadcastGameState(room);
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:resolveBangSkillChoice", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      var result = room.game.resolveBangSkillChoice(socket.id, data.skillToLose);
      broadcastGameState(room, { bangSkillResult: result });
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:resolveBangReorder", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      room.game.resolveBangReorder(socket.id, data.newOrder);
      broadcastGameState(room);
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:peekMirar", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      var result = room.game.peekMirar(socket.id);
      socket.emit("game:mirarPeekResult", { peekedToken: result.peekedToken });
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:useSkill", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      var result = room.game.useSkill(socket.id, data.skillName, data.options || {});
      if (result && result.awaitingReorderInput) {
        socket.emit("game:reordenarPeekResult", { currentDeck: result.currentDeck });
      } else {
        broadcastGameState(room, { lastSkillResult: result });
      }
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("room:rematch", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room) throw new Error("Salon introuvable");
      if (room.hostSocketId !== socket.id) throw new Error("Seul l'hote peut relancer une partie");
      rooms.resetGame(data.code);
      broadcastRoomLobby(room);
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("disconnect", function () {
    var affected = rooms.removePlayerFromAllRooms(socket.id);
    affected.forEach(function (room) { broadcastRoomLobby(room); });
  });
});

server.listen(PORT, function () {
  console.log("Ruleta Rusa Online demarre sur http://localhost:" + PORT);
});
