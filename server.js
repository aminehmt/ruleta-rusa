"use strict";

/**
 * RULETA RUSA ONLINE - fichier unique (v10)
 * ------------------------------------
 * CORRECTIF DE CETTE VERSION :
 * Le HTML/CSS/JS du client etait auparavant stocke dans UNE SEULE chaine
 * de caracteres geante sur une seule ligne, ce qui rendait le fichier
 * illisible et non-editable dans VS Code (message "tokenization skipped").
 *
 * Desormais, le client est stocke comme un TABLEAU de lignes JS
 * (CLIENT_HTML_LINES), chaque ligne HTML/CSS/JS occupant sa propre ligne
 * dans le code source de ce fichier. Le tableau est ensuite assemble
 * avec .join("\n") pour reconstituer le HTML complet au moment de servir
 * la page. Resultat : le fichier est desormais entierement lisible et
 * editable dans n'importe quel editeur, sans aucune ligne demesuree.
 *
 * Le CSS de l'ecran de jeu a egalement ete corrige pour eliminer tout
 * chevauchement visuel entre le nom du joueur, la barre de timer, le
 * cercle des joueurs et le panneau d'actions (voir commentaires dans le
 * bloc CSS "GAME SCREEN" plus bas).
 *
 * Le backend (moteur de jeu, salons, reconnexion, timer 3 minutes,
 * gestion des sons) est fonctionnellement identique a la version
 * precedente, deja validee.
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

  eliminateForInactivity(playerId) {
    if (this.status !== "PLAYING") return { finished: this.status === "FINISHED" };
    const player = this.getPlayer(playerId);
    if (player.eliminated) return { finished: false };
    player.ownedSkills.forEach((s) => { player.status[s] = "dead"; });
    player.eliminated = true;
    this._pushLog(player.name + " est elimine pour inactivite.");
    if (this.pendingResolution && this.pendingResolution.playerId === playerId) {
      this.pendingResolution = null;
      this.deck = buildRevolverDeck();
    }
    this.pendingDoubleShot = 0;
    const eliminatedIndex = this.players.findIndex((p) => p.id === playerId);
    if (this._checkVictory()) return { finished: true };
    if (this._triggerDuelIfNeeded(eliminatedIndex)) return { finished: true };
    if (this.currentPlayer().id === playerId) {
      this.turnIndex = this._stepIndex(eliminatedIndex);
    }
    return { finished: false };
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

function genRoomCode() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var code = "";
  for (var i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function genPlayerId() {
  return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Timer d'inactivite : 3 minutes.
var TURN_TIMEOUT_MS = 180000;

function RoomManager() {
  this.rooms = new Map();
}

RoomManager.prototype.createRoom = function (socketId, hostName) {
  var code;
  do { code = genRoomCode(); } while (this.rooms.has(code));
  var playerId = genPlayerId();
  var room = {
    code: code,
    hostPlayerId: playerId,
    players: [{ playerId: playerId, socketId: socketId, name: hostName, connected: true }],
    game: null,
    createdAt: Date.now(),
    turnTimer: null,
    turnTimerPlayerId: null,
    turnStartedAt: null,
  };
  this.rooms.set(code, room);
  return { room: room, playerId: playerId };
};

RoomManager.prototype.getRoom = function (code) { return this.rooms.get(code); };

RoomManager.prototype.joinRoom = function (code, socketId, name) {
  var room = this.rooms.get(code);
  if (!room) throw new Error("Salon introuvable");
  if (room.game) throw new Error("La partie a deja commence");
  if (room.players.length >= 6) throw new Error("Le salon est complet (6 joueurs max)");
  var nameTaken = room.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });
  if (nameTaken) throw new Error("Ce pseudo est deja pris dans ce salon");
  var playerId = genPlayerId();
  room.players.push({ playerId: playerId, socketId: socketId, name: name, connected: true });
  return { room: room, playerId: playerId };
};

RoomManager.prototype.rejoinRoom = function (code, playerId, socketId) {
  var room = this.rooms.get(code);
  if (!room) throw new Error("Ce salon n'existe plus");
  var player = room.players.find(function (p) { return p.playerId === playerId; });
  if (!player) throw new Error("Vous n'apparteniez pas a ce salon");
  player.socketId = socketId;
  player.connected = true;
  return room;
};

RoomManager.prototype.markDisconnected = function (socketId) {
  var affectedRooms = [];
  this.rooms.forEach(function (room) {
    var player = room.players.find(function (p) { return p.socketId === socketId; });
    if (player) {
      player.connected = false;
      affectedRooms.push(room);
    }
  });
  var self = this;
  affectedRooms.forEach(function (room) {
    var anyoneConnected = room.players.some(function (p) { return p.connected; });
    if (!anyoneConnected) {
      self.clearTurnTimer(room);
      self.rooms.delete(room.code);
    } else if (!room.game) {
      room.players = room.players.filter(function (p) { return p.connected; });
      if (room.hostPlayerId && !room.players.some(function (p) { return p.playerId === room.hostPlayerId; })) {
        if (room.players.length > 0) room.hostPlayerId = room.players[0].playerId;
      }
    }
  });
  return affectedRooms.filter(function (room) { return this.rooms.has(room.code); }, this);
};

RoomManager.prototype.startGame = function (code, requesterPlayerId) {
  var room = this.rooms.get(code);
  if (!room) throw new Error("Salon introuvable");
  if (room.hostPlayerId !== requesterPlayerId) throw new Error("Seul l'hote peut demarrer la partie");
  if (room.players.length < 2) throw new Error("Il faut au moins 2 joueurs");
  room.game = new RuletaRusaGame(room.players.map(function (p) { return { id: p.playerId, name: p.name }; }));
  return room;
};

RoomManager.prototype.resetGame = function (code) {
  var room = this.rooms.get(code);
  if (!room) throw new Error("Salon introuvable");
  this.clearTurnTimer(room);
  room.game = null;
};

RoomManager.prototype.clearTurnTimer = function (room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnTimerPlayerId = null;
    room.turnStartedAt = null;
  }
};

RoomManager.prototype.armTurnTimer = function (room, onTimeout) {
  this.clearTurnTimer(room);
  if (!room.game || room.game.status !== "PLAYING") return;
  var currentId = room.game.pendingResolution ? room.game.pendingResolution.playerId : room.game.currentPlayer().id;
  room.turnTimerPlayerId = currentId;
  room.turnStartedAt = Date.now();
  room.turnTimer = setTimeout(function () { onTimeout(currentId); }, TURN_TIMEOUT_MS);
};

RoomManager.EXPORT_TIMEOUT_MS = TURN_TIMEOUT_MS;

/* ===================== CLIENT WEB (HTML/CSS/JS EN MEMOIRE, une ligne par element de tableau) ===================== */

var CLIENT_HTML = [
  '<!DOCTYPE html>',
  '<html lang="fr">',
  '<head>',
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">',
  '<title>Ruleta Rusa</title>',
  '<link id="favicon" rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'46\' fill=\'%23000\'/%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'46\' fill=\'none\' stroke=\'%23e01a1a\' stroke-width=\'7\'/%3E%3Ccircle cx=\'50\' cy=\'27\' r=\'6\' fill=\'%23e01a1a\'/%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'27\' fill=\'none\' stroke=\'%23555\' stroke-width=\'4\'/%3E%3Ccircle cx=\'50\' cy=\'30\' r=\'4\' fill=\'%23555\'/%3E%3Ccircle cx=\'67\' cy=\'40\' r=\'4\' fill=\'%23555\'/%3E%3Ccircle cx=\'67\' cy=\'60\' r=\'4\' fill=\'%23555\'/%3E%3Ccircle cx=\'50\' cy=\'70\' r=\'4\' fill=\'%23555\'/%3E%3Ccircle cx=\'33\' cy=\'60\' r=\'4\' fill=\'%23555\'/%3E%3Ccircle cx=\'33\' cy=\'40\' r=\'4\' fill=\'%23555\'/%3E%3C/svg%3E">',
  '<style>',
  '@import url(\'https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&display=swap\');',
  '',
  '* {',
  '  box-sizing: border-box;',
  '  margin: 0;',
  '  padding: 0;',
  '}',
  '',
  ':root {',
  '  --bg: #000000;',
  '  --bg-panel: #0d0d0d;',
  '  --bg-card: #141414;',
  '  --red: #e01a1a;',
  '  --red-dark: #8f0f0f;',
  '  --white: #f5f5f5;',
  '  --gray: #8a8a8a;',
  '  --gray-dim: #555555;',
  '  --green: #2ecc71;',
  '  --gold: #d9a634;',
  '}',
  '',
  'html, body {',
  '  background: var(--bg);',
  '  color: var(--white);',
  '  font-family: \'Archivo Black\', Arial, sans-serif;',
  '  height: 100%;',
  '  width: 100%;',
  '  overflow: hidden;',
  '}',
  '',
  '#app {',
  '  height: 100vh;',
  '  width: 100vw;',
  '  display: flex;',
  '  flex-direction: column;',
  '  overflow: hidden;',
  '}',
  '',
  '.screen {',
  '  display: none;',
  '  flex: 1;',
  '  min-height: 0;',
  '  overflow: hidden;',
  '}',
  '.screen.active {',
  '  display: flex;',
  '  flex-direction: column;',
  '}',
  '.screen-scrollable {',
  '  overflow-y: auto;',
  '}',
  '',
  '/* ---------- TOPBAR ---------- */',
  '.topbar {',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: space-between;',
  '  padding: clamp(8px, 1.5vh, 18px) clamp(12px, 3vw, 28px);',
  '  border-bottom: 1px solid #1c1c1c;',
  '  flex-shrink: 0;',
  '}',
  '.topbar .logo {',
  '  font-family: \'Anton\', sans-serif;',
  '  font-size: clamp(14px, 2vh, 20px);',
  '  color: var(--red);',
  '  letter-spacing: 1px;',
  '}',
  '.topbar .topbar-right {',
  '  display: flex;',
  '  align-items: center;',
  '  gap: clamp(10px, 2vw, 22px);',
  '  font-size: clamp(9px, 1.4vh, 12px);',
  '  letter-spacing: 1px;',
  '  color: var(--gray);',
  '}',
  '.topbar .icon-btn {',
  '  color: var(--gray);',
  '  cursor: pointer;',
  '  background: none;',
  '  border: none;',
  '  font-family: inherit;',
  '  font-size: clamp(9px, 1.4vh, 12px);',
  '  letter-spacing: 1px;',
  '}',
  '.topbar .icon-btn:hover { color: var(--red); }',
  '',
  '/* ---------- HOME ---------- */',
  '#screen-home {',
  '  align-items: center;',
  '  justify-content: center;',
  '  padding: 3vh 20px;',
  '  overflow-y: auto;',
  '}',
  '.home-box {',
  '  max-width: 440px;',
  '  width: 100%;',
  '  text-align: center;',
  '}',
  '.revolver-logo {',
  '  width: clamp(70px, 12vh, 100px);',
  '  height: clamp(70px, 12vh, 100px);',
  '  border-radius: 50%;',
  '  border: 4px solid var(--red);',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  margin: 0 auto clamp(10px, 2vh, 18px);',
  '  position: relative;',
  '  box-shadow: 0 0 30px rgba(224,26,26,0.35);',
  '}',
  '.revolver-logo::before {',
  '  content: "";',
  '  position: absolute;',
  '  width: 10px;',
  '  height: 10px;',
  '  background: var(--red);',
  '  border-radius: 50%;',
  '  top: 12px;',
  '}',
  '.revolver-logo-inner {',
  '  width: 62%;',
  '  height: 62%;',
  '  border-radius: 50%;',
  '  border: 2px solid var(--gray-dim);',
  '  position: relative;',
  '}',
  '.revolver-dot {',
  '  position: absolute;',
  '  width: 7px;',
  '  height: 7px;',
  '  background: var(--gray-dim);',
  '  border-radius: 50%;',
  '}',
  '.title-main {',
  '  font-family: \'Anton\', sans-serif;',
  '  font-size: clamp(32px, 6.5vh, 50px);',
  '  color: var(--red);',
  '  letter-spacing: 2px;',
  '  line-height: 1;',
  '}',
  '.title-sub {',
  '  font-family: \'Anton\', sans-serif;',
  '  font-size: clamp(32px, 6.5vh, 50px);',
  '  color: var(--white);',
  '  letter-spacing: 2px;',
  '  line-height: 1;',
  '  margin-bottom: 8px;',
  '}',
  '.credit-line {',
  '  font-size: 10px;',
  '  color: var(--gray);',
  '  letter-spacing: 2px;',
  '  margin-bottom: 6px;',
  '  text-transform: uppercase;',
  '}',
  '.credit-line .sep { color: var(--red); margin: 0 6px; }',
  '.credit-line-2 {',
  '  font-size: 9px;',
  '  color: var(--gray-dim);',
  '  letter-spacing: 2px;',
  '  margin-bottom: clamp(14px, 2.5vh, 26px);',
  '  text-transform: uppercase;',
  '}',
  '.credit-line-2 .by-tag { color: var(--red); }',
  '',
  '.field-block {',
  '  margin-bottom: clamp(10px, 1.6vh, 16px);',
  '  text-align: left;',
  '}',
  '.field-block label {',
  '  display: block;',
  '  font-size: 10px;',
  '  letter-spacing: 1px;',
  '  color: var(--gray);',
  '  margin-bottom: 6px;',
  '  text-transform: uppercase;',
  '}',
  '.field-block input {',
  '  width: 100%;',
  '  background: var(--bg-card);',
  '  border: 1px solid #262626;',
  '  color: var(--white);',
  '  padding: clamp(10px, 1.6vh, 13px) 14px;',
  '  font-family: \'Archivo Black\', Arial, sans-serif;',
  '  font-size: 14px;',
  '  border-radius: 4px;',
  '}',
  '.field-block input:focus { outline: none; border-color: var(--red); }',
  '',
  '.btn {',
  '  display: block;',
  '  width: 100%;',
  '  padding: clamp(11px, 1.8vh, 15px);',
  '  border: none;',
  '  border-radius: 4px;',
  '  font-family: \'Anton\', sans-serif;',
  '  font-size: clamp(13px, 2vh, 15px);',
  '  letter-spacing: 2px;',
  '  text-transform: uppercase;',
  '  cursor: pointer;',
  '  transition: transform .1s ease, opacity .2s ease;',
  '}',
  '.btn:active { transform: scale(0.98); }',
  '.btn:disabled { opacity: 0.35; cursor: not-allowed; }',
  '.btn-primary {',
  '  background: var(--red);',
  '  color: var(--white);',
  '  box-shadow: 0 8px 24px rgba(224,26,26,0.3);',
  '}',
  '.btn-primary:hover:not(:disabled) { background: #ff2727; }',
  '.btn-outline {',
  '  background: transparent;',
  '  border: 1px solid #333;',
  '  color: var(--white);',
  '}',
  '.btn-outline:hover { border-color: var(--red); color: var(--red); }',
  '.btn-ghost {',
  '  background: transparent;',
  '  border: none;',
  '  color: var(--gray);',
  '  font-size: 11px;',
  '  letter-spacing: 1px;',
  '  padding: 10px;',
  '  text-transform: uppercase;',
  '}',
  '.btn-ghost:hover { color: var(--red); }',
  '',
  '.divider-or {',
  '  text-align: center;',
  '  color: var(--gray-dim);',
  '  font-size: 10px;',
  '  letter-spacing: 3px;',
  '  margin: clamp(12px, 2vh, 20px) 0;',
  '  text-transform: uppercase;',
  '}',
  '.error-text {',
  '  color: var(--red);',
  '  font-size: 12px;',
  '  margin-top: 12px;',
  '  min-height: 16px;',
  '  letter-spacing: 0.5px;',
  '}',
  '',
  '/* ---------- LOBBY ---------- */',
  '#screen-lobby {',
  '  align-items: center;',
  '  justify-content: center;',
  '  padding: 3vh 20px;',
  '  overflow-y: auto;',
  '}',
  '.lobby-box {',
  '  max-width: 440px;',
  '  width: 100%;',
  '  text-align: center;',
  '}',
  '.lobby-code-display {',
  '  font-family: \'Anton\', sans-serif;',
  '  font-size: clamp(28px, 5vh, 40px);',
  '  letter-spacing: 6px;',
  '  color: var(--gold);',
  '  margin: 8px 0 6px;',
  '}',
  '.lobby-sub {',
  '  font-size: 11px;',
  '  color: var(--gray);',
  '  letter-spacing: 1px;',
  '  margin-bottom: clamp(16px, 2.5vh, 26px);',
  '}',
  '.player-slot-list {',
  '  list-style: none;',
  '  margin-bottom: clamp(14px, 2vh, 22px);',
  '  text-align: left;',
  '}',
  '.player-slot-list li {',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 12px;',
  '  padding: 11px 14px;',
  '  background: var(--bg-card);',
  '  border-radius: 4px;',
  '  margin-bottom: 6px;',
  '  font-size: 13px;',
  '}',
  '.player-slot-list li .slot-idx {',
  '  color: var(--gray-dim);',
  '  font-family: \'Anton\', sans-serif;',
  '  font-size: 12px;',
  '  width: 16px;',
  '}',
  '.player-slot-list li .host-tag {',
  '  margin-left: auto;',
  '  font-size: 9px;',
  '  color: var(--gold);',
  '  border: 1px solid var(--gold);',
  '  padding: 2px 7px;',
  '  border-radius: 3px;',
  '  letter-spacing: 1px;',
  '}',
  '.player-slot-list li .disc-tag {',
  '  margin-left: 6px;',
  '  font-size: 9px;',
  '  color: var(--red);',
  '}',
  '.lobby-footnote {',
  '  font-size: 10px;',
  '  color: var(--gray-dim);',
  '  letter-spacing: 0.5px;',
  '  margin-top: 18px;',
  '  line-height: 1.7;',
  '}',
  '',
  '/* =====================================================================',
  '   GAME SCREEN - CSS CORRIGE (v10) : plus aucun chevauchement possible.',
  '   Principe : .turn-label / .turn-name / .turn-timer-bar / .actions-panel',
  '   ont une taille FIXE (flex: 0 0 auto, bornee par clamp()). Seul',
  '   .circle-wrap est flexible (flex: 1 1 auto) : c\'est la seule zone qui',
  '   grandit ou retrecit selon l\'espace disponible, ce qui empeche',
  '   mecaniquement tout chevauchement avec les zones voisines.',
  '   ===================================================================== */',
  `#screen-game { align-items: stretch; }
.game-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.4vh 3vw calc(1.4vh + 64px);
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.turn-label {
  flex: 0 0 auto;
  font-size: clamp(11px, 1.6vh, 15px);
  letter-spacing: 3px;
  color: var(--gray);
  text-transform: uppercase;
  line-height: 1.3;
  margin-bottom: 2px;
}
.turn-name {
  flex: 0 0 auto;
  font-family: 'Anton', sans-serif;
  font-size: clamp(20px, 3.4vh, 32px);
  letter-spacing: 1px;
  line-height: 1.15;
  white-space: nowrap;
  margin-bottom: 6px;
}
.turn-timer-bar {
  flex: 0 0 auto;
  width: min(360px, 65vw);
  height: 5px;
  background: #1c1c1c;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}
.turn-timer-bar .fill {
  height: 100%;
  background: var(--red);
  width: 100%;
  transform-origin: left;
  transition: transform linear;
}

.circle-wrap {
  flex: 1 1 auto;
  position: relative;
  width: min(46vh, 60vw, 480px);
  height: min(46vh, 60vw, 480px);
  max-width: 92%;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  margin: 0 auto;
}
.revolver-hub {
  width: 32%;
  height: 32%;
  min-width: 96px;
  min-height: 96px;
  max-width: 160px;
  max-height: 160px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #1a1a1a, #050505 70%);
  border: 4px solid var(--gray-dim);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color .2s ease, box-shadow .2s ease;
  position: relative;
  z-index: 3;
  padding: 6px;
  box-sizing: border-box;
}
.revolver-hub.my-turn { border-color: var(--red); box-shadow: 0 0 36px rgba(224,26,26,0.45); }
.revolver-hub .hub-count { font-size: clamp(10px, 1.5vh, 14px); letter-spacing: 0.5px; color: var(--gray); margin-bottom: 3px; line-height: 1.15; text-align: center; }
.revolver-hub .hub-hint { font-size: clamp(8px, 1.1vh, 11px); letter-spacing: 0.5px; color: var(--red); text-transform: uppercase; text-align: center; line-height: 1.15; padding: 0 6px; }
.revolver-hub .hub-dots { display: flex; gap: 3px; margin-bottom: 4px; flex-wrap: wrap; justify-content: center; max-width: 90%; }
.revolver-hub .hub-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--gray-dim); flex-shrink: 0; }

.player-node {
  position: absolute;
  width: 21%;
  min-width: 74px;
  max-width: 140px;
  transform: translate(-50%, -50%);
  text-align: center;
  z-index: 2;
}
.player-node .node-ring {
  width: 62%;
  aspect-ratio: 1;
  min-width: 46px;
  max-width: 74px;
  margin: 0 auto 4px;
  border-radius: 50%;
  border: 2px solid #2a2a2a;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Anton', sans-serif;
  font-size: clamp(14px, 1.9vh, 19px);
  color: var(--gray);
  position: relative;
  transition: border-color .2s ease, box-shadow .2s ease;
  box-sizing: border-box;
}
.player-node.is-turn .node-ring { border-color: var(--red); box-shadow: 0 0 18px rgba(224,26,26,0.4); color: var(--white); }
.player-node.is-you .node-ring { background: #1c1414; }
.player-node.eliminated .node-ring { opacity: 0.3; }
.player-node.eliminated .node-name { opacity: 0.35; }
.player-node.is-offline .node-ring { border-style: dashed; opacity: 0.55; }
.player-node .turn-dot {
  position: absolute; top: -4px; right: -2px; width: 10px; height: 10px; border-radius: 50%;
  background: var(--red); border: 2px solid var(--bg); display: none;
}
.player-node.is-turn .turn-dot { display: block; }
.player-node .node-name {
  font-size: clamp(9px, 1.2vh, 12px);
  letter-spacing: 0.3px;
  margin-bottom: 3px;
  color: var(--white);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
}
.player-node .you-flag { font-size: 8px; color: var(--red); letter-spacing: 1px; margin-bottom: 2px; text-transform: uppercase; line-height: 1; }
.node-tokens { display: flex; gap: 3px; justify-content: center; }
.node-token {
  width: clamp(13px, 1.9vh, 18px);
  height: clamp(13px, 1.9vh, 18px);
  border-radius: 50%;
  border: 2px solid var(--gray-dim);
  display: flex; align-items: center; justify-content: center;
  font-size: clamp(7px, 1vh, 9px);
  font-weight: 700;
  color: var(--gray);
  flex-shrink: 0;
  box-sizing: border-box;
}
.node-token.alive { border-color: var(--green); color: var(--green); }
.node-token.exhausted { border-color: var(--gold); color: var(--gold); }
.node-token.dead { border-color: var(--gray-dim); color: var(--gray-dim); text-decoration: line-through; }

.actions-panel {
  flex: 0 0 auto;
  width: 100%;
  max-width: 720px;
  margin-top: 8px;
}
.reveal-btn {
  width: 100%;
  padding: clamp(12px, 2vh, 18px);
  background: var(--red);
  color: var(--white);
  border: none;
  border-radius: 6px;
  font-family: 'Anton', sans-serif;
  font-size: clamp(15px, 2.2vh, 20px);
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 8px 22px rgba(224,26,26,0.35);
}
.reveal-btn:hover { background: #ff2727; }
.reveal-btn:disabled { opacity: 0.3; cursor: not-allowed; box-shadow: none; }

.skills-divider {
  text-align: center;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--gray-dim);
  margin: clamp(6px, 1vh, 10px) 0 clamp(6px, 0.9vh, 9px);
  text-transform: uppercase;
}
.skills-panel { display: flex; gap: clamp(6px, 1.2vw, 12px); justify-content: center; flex-wrap: wrap; }
.skill-card {
  flex: 1 1 30%;
  min-width: 120px;
  max-width: 230px;
  background: var(--bg-card);
  border: 1px solid #262626;
  border-radius: 6px;
  padding: clamp(7px, 1.1vh, 11px) 8px;
  text-align: center;
  cursor: pointer;
  transition: border-color .15s ease;
  box-sizing: border-box;
}
.skill-card:hover:not(:disabled) { border-color: var(--red); }
.skill-card:disabled { opacity: 0.3; cursor: not-allowed; }
.skill-card .skill-icon { font-family: 'Anton', sans-serif; font-size: clamp(15px, 2.1vh, 20px); color: var(--white); margin-bottom: 3px; line-height: 1; }
.skill-card .skill-name { font-family: 'Anton', sans-serif; font-size: clamp(9.5px, 1.3vh, 12px); letter-spacing: 0.5px; text-transform: uppercase; color: var(--white); margin-bottom: 2px; line-height: 1.2; }
.skill-card .skill-desc { font-size: clamp(7.5px, 1.05vh, 9.5px); color: var(--gray-dim); letter-spacing: 0.2px; line-height: 1.25; display: block; }

.hint-line { text-align: center; font-size: 12px; color: var(--gray); margin-bottom: 7px; letter-spacing: 0.5px; line-height: 1.3; }
.hint-line.warn { color: var(--red); }

/* Espace fixe sous la zone de jeu pour que les boutons SON / JOURNAL
   (position: fixed) ne recouvrent jamais les dernieres cartes de
   capacite : ils s'empilent visuellement EN DESSOUS du panneau
   d'actions au lieu de se superposer par-dessus. */
.log-toggle, .sound-toggle {
  bottom: 10px;
}

@media (max-height: 760px) {
  .turn-name { font-size: clamp(17px, 2.6vh, 24px); margin-bottom: 3px; }
  .turn-timer-bar { margin-bottom: 5px; }
  .circle-wrap { width: min(36vh, 52vw, 380px); height: min(36vh, 52vw, 380px); }
  .actions-panel { margin-top: 5px; }
}
@media (max-height: 600px) {
  .turn-label { display: none; }
  .turn-name { font-size: clamp(15px, 2.2vh, 19px); margin-bottom: 3px; }
  .circle-wrap { width: min(34vh, 48vw, 340px); height: min(34vh, 48vw, 340px); }
}

/* Mobile (portrait, largeur <= 480px) : tailles agrandies d'environ 25%
   par rapport a la base desktop reduite, et surtout on reserve assez de
   place SOUS le panneau d'actions pour que les boutons flottants SON et
   JOURNAL ne chevauchent jamais les dernieres cartes de capacite : ils
   se retrouvent visuellement empiles en dessous, jamais par-dessus. */
@media (max-width: 480px) {
  .game-body { padding-bottom: calc(2vh + 76px); }
  .turn-name { font-size: clamp(19px, 4.2vh, 26px); }
  .turn-label { font-size: clamp(10px, 1.9vh, 13px); }
  .circle-wrap { width: min(40vh, 78vw, 340px); height: min(40vh, 78vw, 340px); }
  .revolver-hub { min-width: 100px; min-height: 100px; }
  .player-node { min-width: 78px; }
  .player-node .node-ring { min-width: 48px; }
  .actions-panel { max-width: 100%; margin-top: 14px; }
  .reveal-btn { padding: clamp(13px, 2.6vh, 17px); font-size: clamp(14px, 2.6vh, 17px); }
  .skills-panel { gap: 8px; }
  .skill-card { flex: 1 1 100%; min-width: 0; max-width: 100%; padding: 10px 12px; }
  .skill-card .skill-icon { font-size: 17px; }
  .skill-card .skill-name { font-size: 12px; }
  .skill-card .skill-desc { font-size: 10px; }
}

/* Boutons flottants SON / JOURNAL reduits sur mobile pour liberer
   encore plus de place et garantir qu'ils restent bien empiles sous le
   contenu, jamais superposes a une carte de capacite. */
@media (max-width: 480px) {
  .log-toggle {
    bottom: 8px;
    right: 8px;
    padding: 7px 12px;
    font-size: 9px;
  }
  .sound-toggle {
    bottom: 8px;
    left: 8px;
    padding: 7px 12px;
    font-size: 9px;
  }
}
`,
  '/* ---------- LOG / SOUND ---------- */',
  '.log-toggle {',
  '  position: fixed;',
  '  bottom: 12px;',
  '  right: 12px;',
  '  background: var(--bg-card);',
  '  border: 1px solid #262626;',
  '  color: var(--gray);',
  '  border-radius: 30px;',
  '  padding: 8px 14px;',
  '  font-size: 10px;',
  '  letter-spacing: 1px;',
  '  cursor: pointer;',
  '  z-index: 10;',
  '}',
  '.sound-toggle {',
  '  position: fixed;',
  '  bottom: 12px;',
  '  left: 12px;',
  '  background: var(--bg-card);',
  '  border: 1px solid #262626;',
  '  color: var(--gray);',
  '  border-radius: 30px;',
  '  padding: 8px 14px;',
  '  font-size: 10px;',
  '  letter-spacing: 1px;',
  '  cursor: pointer;',
  '  z-index: 10;',
  '}',
  '.log-drawer {',
  '  position: fixed;',
  '  bottom: 0;',
  '  right: 0;',
  '  width: 300px;',
  '  max-height: 280px;',
  '  background: var(--bg-panel);',
  '  border: 1px solid #262626;',
  '  border-radius: 8px 0 0 0;',
  '  padding: 14px;',
  '  overflow-y: auto;',
  '  z-index: 9;',
  '  display: none;',
  '}',
  '.log-drawer.active { display: block; }',
  '.log-drawer h3 { font-size: 10px; letter-spacing: 2px; color: var(--gray); margin-bottom: 8px; text-transform: uppercase; }',
  '.log-drawer ul { list-style: none; font-size: 11px; }',
  '.log-drawer li { padding: 5px 0; border-bottom: 1px solid #1c1c1c; color: var(--gray); }',
  '.log-drawer li:last-child { border-bottom: none; }',
  '',
  '/* ---------- CINEMATIC ---------- */',
  '.cinematic-overlay {',
  '  display: none;',
  '  position: fixed;',
  '  inset: 0;',
  '  background: rgba(0,0,0,0.94);',
  '  align-items: center;',
  '  justify-content: center;',
  '  z-index: 100;',
  '  flex-direction: column;',
  '  text-align: center;',
  '}',
  '.cinematic-overlay.active { display: flex; }',
  '.cinematic-text {',
  '  font-family: \'Anton\', sans-serif;',
  '  font-size: min(18vw, 90px);',
  '  letter-spacing: 4px;',
  '  animation: pop 0.4s ease;',
  '}',
  '.cinematic-text.is-click { color: var(--green); }',
  '.cinematic-text.is-bang { color: var(--red); text-shadow: 0 0 40px rgba(224,26,26,0.7); }',
  '.cinematic-sub-name { font-family: \'Anton\', sans-serif; font-size: min(6vw, 24px); color: var(--white); margin-top: 8px; }',
  '.cinematic-sub-hint { font-size: 12px; color: var(--gray); margin-top: 6px; letter-spacing: 1px; }',
  '@keyframes pop {',
  '  0% { transform: scale(0.3); opacity: 0; }',
  '  60% { transform: scale(1.15); opacity: 1; }',
  '  100% { transform: scale(1); opacity: 1; }',
  '}',
  '',
  '/* ---------- MODALS ---------- */',
  '.modal-overlay {',
  '  display: none;',
  '  position: fixed;',
  '  inset: 0;',
  '  background: rgba(0,0,0,0.75);',
  '  align-items: center;',
  '  justify-content: center;',
  '  z-index: 60;',
  '  padding: 20px;',
  '}',
  '.modal-overlay.active { display: flex; }',
  '.modal-box {',
  '  background: var(--bg-panel);',
  '  border: 1px solid #262626;',
  '  border-radius: 8px;',
  '  padding: 24px;',
  '  max-width: 380px;',
  '  width: 100%;',
  '  max-height: 85vh;',
  '  overflow-y: auto;',
  '}',
  '.modal-box-wide { max-width: 560px; }',
  '.modal-box h3 { font-family: \'Anton\', sans-serif; font-size: 20px; letter-spacing: 1px; margin-bottom: 6px; text-transform: uppercase; }',
  '.modal-box .modal-hint { font-size: 12px; color: var(--gray); margin-bottom: 16px; letter-spacing: 0.3px; }',
  '.modal-options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }',
  '.modal-options button {',
  '  padding: 12px 14px;',
  '  border-radius: 4px;',
  '  border: 1px solid #262626;',
  '  background: var(--bg-card);',
  '  color: var(--white);',
  '  cursor: pointer;',
  '  text-align: left;',
  '  font-family: \'Archivo Black\', Arial, sans-serif;',
  '  font-size: 13px;',
  '}',
  '.modal-options button:hover { border-color: var(--red); }',
  '.mirar-peek {',
  '  text-align: center;',
  '  font-family: \'Anton\', sans-serif;',
  '  font-size: 36px;',
  '  padding: 20px;',
  '  border-radius: 6px;',
  '  background: var(--bg-card);',
  '  margin-bottom: 16px;',
  '}',
  '.mirar-peek.is-click { color: var(--green); }',
  '.mirar-peek.is-bang { color: var(--red); }',
  '.reorder-slots { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; justify-content: center; }',
  '.reorder-slot {',
  '  width: 50px;',
  '  height: 50px;',
  '  border-radius: 8px;',
  '  border: 2px solid #262626;',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  font-size: 10px;',
  '  font-weight: 700;',
  '  cursor: pointer;',
  '  user-select: none;',
  '  font-family: \'Anton\', sans-serif;',
  '}',
  '.reorder-slot.slot-click { background: #0e1f14; border-color: var(--green); color: var(--green); }',
  '.reorder-slot.slot-bang { background: #260c0c; border-color: var(--red); color: var(--red); }',
  '.reorder-slot .slot-index { display: block; font-size: 7px; color: var(--gray-dim); margin-bottom: 2px; font-family: \'Archivo Black\', Arial, sans-serif; }',
  '',
  '.rules-modal .modal-box { max-width: 620px; text-align: left; position: relative; }',
  '.rules-modal h4 { font-family: \'Anton\', sans-serif; font-size: 14px; color: var(--gold); letter-spacing: 1px; margin: 16px 0 6px; text-transform: uppercase; }',
  '.rules-modal p, .rules-modal li { font-size: 12.5px; color: var(--gray); line-height: 1.6; letter-spacing: 0.2px; }',
  '.rules-modal ul { padding-left: 18px; margin-bottom: 4px; }',
  '.rules-modal .rules-icon { color: var(--red); font-weight: 700; }',
  '.rules-modal .close-x { position: absolute; top: 14px; right: 18px; background: none; border: none; color: var(--gray); font-size: 22px; cursor: pointer; }',
  '.rules-modal .close-x:hover { color: var(--red); }',
  '',
  '/* ---------- END SCREEN ---------- */',
  '#screen-end { align-items: center; justify-content: center; padding: 3vh 20px; }',
  '.end-box { max-width: 400px; text-align: center; }',
  '.end-title { font-family: \'Anton\', sans-serif; font-size: clamp(30px, 6vh, 42px); color: var(--red); letter-spacing: 1px; margin-bottom: 10px; }',
  '.end-message { font-size: 13px; color: var(--gray); margin-bottom: 24px; letter-spacing: 0.3px; }',
  '</style>',
  '</head>',
  '<body>',
  '',
  '<div id="app">',
  '',
  '  <section id="screen-home" class="screen active">',
  '    <div class="home-box">',
  '      <div class="revolver-logo">',
  '        <div class="revolver-logo-inner">',
  '          <div class="revolver-dot" style="top:4px;left:44%;"></div>',
  '          <div class="revolver-dot" style="top:27%;left:71%;"></div>',
  '          <div class="revolver-dot" style="top:27%;left:17%;"></div>',
  '          <div class="revolver-dot" style="top:60%;left:71%;"></div>',
  '          <div class="revolver-dot" style="top:60%;left:17%;"></div>',
  '          <div class="revolver-dot" style="top:83%;left:44%;"></div>',
  '        </div>',
  '      </div>',
  '      <div class="title-main">RULETA</div>',
  '      <div class="title-sub">RUSA</div>',
  '      <div class="credit-line">GDM GAMES<span class="sep">&middot;</span>RA&Uacute;L L&Oacute;PEZ<span class="sep">&middot;</span>&Eacute;DITION NUM&Eacute;RIQUE</div>',
  '      <div class="credit-line-2"><span class="by-tag">BY DOUBLE A</span></div>',
  '',
  '      <div class="field-block">',
  '        <label for="input-name">Ton pseudo</label>',
  '        <input id="input-name" type="text" maxlength="20" placeholder="Ex: Amine">',
  '      </div>',
  '',
  '      <button id="btn-create" class="btn btn-primary">Cr&eacute;er un salon</button>',
  '',
  '      <div class="divider-or">ou</div>',
  '',
  '      <div class="field-block">',
  '        <label for="input-code">Code du salon</label>',
  '        <input id="input-code" type="text" maxlength="5" placeholder="Ex: AB3F9" style="text-transform:uppercase">',
  '      </div>',
  '      <button id="btn-join" class="btn btn-outline">Rejoindre</button>',
  '      <button id="btn-rules" class="btn-ghost" style="width:100%;margin-top:10px">&#128293; Comment jouer ?</button>',
  '',
  '      <p id="home-error" class="error-text"></p>',
  '    </div>',
  '  </section>',
  '',
  '  <section id="screen-lobby" class="screen">',
  '    <div class="lobby-box">',
  '      <div class="lobby-code-display" id="lobby-code"></div>',
  '      <div class="lobby-sub">PARTAGE CE CODE POUR REJOINDRE (2 A 6 JOUEURS)</div>',
  '',
  '      <ul id="lobby-players" class="player-slot-list"></ul>',
  '',
  '      <button id="btn-start" class="btn btn-primary" style="display:none">Jouer</button>',
  '      <p id="lobby-hint" class="error-text" style="color:var(--gray)"></p>',
  '      <p id="lobby-error" class="error-text"></p>',
  '',
  '      <div class="lobby-footnote">7 JETONS CLICK &middot; 1 JETON BANG &middot; 3 CAPACIT&Eacute;S PAR JOUEUR<br>DERNIER SURVIVANT REMPORTE LA PARTIE<br>3 MIN D\'INACTIVIT&Eacute; = &Eacute;LIMINATION AUTOMATIQUE</div>',
  '    </div>',
  '  </section>',
  '',
  '  <section id="screen-game" class="screen">',
  '    <div class="topbar">',
  '      <div class="logo">RULETA RUSA</div>',
  '      <div class="topbar-right">',
  '        <span id="survivors-count">- SURVIVANTS</span>',
  '        <button id="btn-quit" class="icon-btn">&times; QUITTER</button>',
  '      </div>',
  '    </div>',
  '',
  '    <div class="game-body">',
  '      <div class="turn-label" id="turn-label">C\'EST LE TOUR DE</div>',
  '      <div class="turn-name" id="turn-name">--</div>',
  '      <div class="turn-timer-bar" id="turn-timer-bar" style="display:none"><div class="fill" id="turn-timer-fill"></div></div>',
  '',
  '      <div class="circle-wrap" id="circle-wrap">',
  '        <div class="revolver-hub" id="revolver-hub">',
  '          <div class="hub-dots" id="hub-dots"></div>',
  '          <div class="hub-count" id="hub-count">8 / 8 JETONS</div>',
  '          <div class="hub-hint" id="hub-hint">TOUCHER POUR R&Eacute;V&Eacute;LER</div>',
  '        </div>',
  '      </div>',
  '',
  '      <div class="actions-panel" id="actions-panel" style="display:none">',
  '        <p class="hint-line warn" id="must-reveal-hint" style="display:none">Aucune fiche disponible : tu dois r&eacute;v&eacute;ler le barillet.</p>',
  '        <p class="hint-line warn" id="double-shot-hint" style="display:none">Disparo doble actif : r&eacute;v&egrave;le une fiche suppl&eacute;mentaire.</p>',
  '        <button id="btn-reveal" class="reveal-btn">R&Eacute;V&Eacute;LER UN JETON</button>',
  '        <div class="skills-divider">&mdash; OU UTILISER UNE CAPACIT&Eacute; &mdash;</div>',
  '        <div class="skills-panel" id="skills-panel"></div>',
  '      </div>',
  '    </div>',
  '  </section>',
  '',
  '  <section id="screen-end" class="screen">',
  '    <div class="end-box">',
  '      <div class="end-title" id="end-title">PARTIE TERMIN&Eacute;E</div>',
  '      <p class="end-message" id="end-message"></p>',
  '      <button id="btn-rematch" class="btn btn-primary">Relancer une partie</button>',
  '    </div>',
  '  </section>',
  '',
  '</div>',
  '',
  '<button class="log-toggle" id="log-toggle">JOURNAL</button>',
  '<button class="sound-toggle" id="sound-toggle">&#128266; SON</button>',
  '<div class="log-drawer" id="log-drawer">',
  '  <h3>Journal de partie</h3>',
  '  <ul id="game-log"></ul>',
  '</div>',
  '',
  '<div id="reveal-cinematic" class="cinematic-overlay">',
  '  <div id="reveal-cinematic-text" class="cinematic-text"></div>',
  '  <div id="reveal-cinematic-name" class="cinematic-sub-name"></div>',
  '  <div id="reveal-cinematic-hint" class="cinematic-sub-hint"></div>',
  '</div>',
  '',
  '<div id="modal-target" class="modal-overlay">',
  '  <div class="modal-box">',
  '    <h3 id="modal-title">Choisis une cible</h3>',
  '    <div id="modal-options" class="modal-options"></div>',
  '    <button id="modal-cancel" class="btn btn-outline">Annuler</button>',
  '  </div>',
  '</div>',
  '',
  '<div id="modal-bang-choice" class="modal-overlay">',
  '  <div class="modal-box">',
  '    <h3>BANG !</h3>',
  '    <p class="modal-hint">Choisis quelle fiche encore en jeu tu perds d&eacute;finitivement.</p>',
  '    <div id="bang-choice-options" class="modal-options"></div>',
  '  </div>',
  '</div>',
  '',
  '<div id="modal-reorder" class="modal-overlay">',
  '  <div class="modal-box modal-box-wide">',
  '    <h3 id="modal-reorder-title">R&eacute;organise le barillet</h3>',
  '    <p class="modal-hint">Clique sur 2 cases pour les &eacute;changer, jusqu\'&agrave; obtenir l\'ordre que tu veux.</p>',
  '    <div id="reorder-slots" class="reorder-slots"></div>',
  '    <button id="btn-confirm-reorder" class="btn btn-primary">Confirmer l\'ordre</button>',
  '  </div>',
  '</div>',
  '',
  '<div id="modal-mirar" class="modal-overlay">',
  '  <div class="modal-box">',
  '    <h3>Mirar</h3>',
  '    <p id="mirar-peek-result" class="mirar-peek"></p>',
  '    <div class="modal-options">',
  '      <button id="mirar-keep">Laisser en place</button>',
  '      <button id="mirar-bottom">Mettre au fond du barillet</button>',
  '    </div>',
  '  </div>',
  '</div>',
  '',
  '<div id="modal-click-recharge" class="modal-overlay">',
  '  <div class="modal-box">',
  '    <h3>CLICK !</h3>',
  '    <p class="modal-hint">Choisis quelle fiche &eacute;puis&eacute;e tu recharges.</p>',
  '    <div id="click-recharge-options" class="modal-options"></div>',
  '  </div>',
  '</div>',
  '',
  '<div id="modal-rules" class="modal-overlay rules-modal">',
  '  <div class="modal-box">',
  '    <button class="close-x" id="rules-close-x">&times;</button>',
  '    <h3>Comment jouer</h3>',
  '    <p><span class="rules-icon">&#9679;</span> But du jeu : &ecirc;tre le dernier survivant. Chaque joueur poss&egrave;de 3 fiches de capacit&eacute;, uniques &agrave; chaque partie.</p>',
  '    <h4>Le tour de jeu</h4>',
  '    <p>&Agrave; ton tour, choisis soit de r&eacute;v&eacute;ler une fiche du barillet (8 fiches : 7 CLICK et 1 BANG), soit d\'utiliser une capacit&eacute; encore disponible.</p>',
  '    <h4>CLICK vs BANG</h4>',
  '    <ul>',
  '      <li><b>CLICK</b> : rien de grave, mais si une de tes capacit&eacute;s &eacute;tait &eacute;puis&eacute;e, tu peux la recharger.</li>',
  '      <li><b>BANG</b> : tu perds d&eacute;finitivement une de tes fiches encore en jeu, puis tu r&eacute;organises le barillet.</li>',
  '    </ul>',
  '    <h4>Capacit&eacute;s (s\'&eacute;puisent apr&egrave;s usage, se rechargent avec un CLICK)</h4>',
  '    <ul>',
  '      <li><b>Voltear</b> : &eacute;puise une capacit&eacute; d\'un adversaire.</li>',
  '      <li><b>Reordenar</b> : regarde et r&eacute;organise le barillet (impossible s\'il ne reste qu\'1 fiche).</li>',
  '      <li><b>Cambio de turno</b> : force un autre joueur &agrave; jouer &agrave; ta place.</li>',
  '      <li><b>Mirar</b> : regarde la prochaine fiche sans la r&eacute;v&eacute;ler (impossible s\'il ne reste qu\'1 fiche).</li>',
  '      <li><b>Cambio de sentido</b> : inverse le sens du tour.</li>',
  '      <li><b>Disparo doble</b> : le joueur suivant doit r&eacute;v&eacute;ler deux fiches d\'affil&eacute;e.</li>',
  '    </ul>',
  '    <h4>Inactivit&eacute;</h4>',
  '    <p>Si tu ne joues pas dans les 3 minutes, ou si tu es d&eacute;connect&eacute; trop longtemps pendant ton tour, tu es &eacute;limin&eacute; automatiquement pour ne pas bloquer la partie.</p>',
  '    <h4>Fin de partie</h4>',
  '    <p>D&egrave;s qu\'il ne reste que 2 joueurs, un duel final recharge toutes leurs capacit&eacute;s encore en jeu. Le dernier survivant gagne.</p>',
  '  </div>',
  '</div>',
  '',
  '<script src="/socket.io/socket.io.js"></script>',
  '<script>',
  '"use strict";',
  '',
  '/* ---------- SON (synthese Web Audio, aucun fichier externe) ---------- */',
  'var SoundFX = (function () {',
  '  var ctx = null;',
  '  var enabled = true;',
  '',
  '  function getCtx() {',
  '    if (!ctx) {',
  '      var AC = window.AudioContext || window.webkitAudioContext;',
  '      ctx = new AC();',
  '    }',
  '    if (ctx.state === "suspended") ctx.resume();',
  '    return ctx;',
  '  }',
  '',
  '  function noiseBuffer(c, duration) {',
  '    var sr = c.sampleRate;',
  '    var buf = c.createBuffer(1, sr * duration, sr);',
  '    var data = buf.getChannelData(0);',
  '    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;',
  '    return buf;',
  '  }',
  '',
  '  function playClick() {',
  '    if (!enabled) return;',
  '    var c = getCtx();',
  '    var t = c.currentTime;',
  '    var osc = c.createOscillator();',
  '    var gain = c.createGain();',
  '    osc.type = "square";',
  '    osc.frequency.setValueAtTime(1400, t);',
  '    osc.frequency.exponentialRampToValueAtTime(600, t + 0.03);',
  '    gain.gain.setValueAtTime(0.22, t);',
  '    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);',
  '    osc.connect(gain);',
  '    gain.connect(c.destination);',
  '    osc.start(t);',
  '    osc.stop(t + 0.07);',
  '  }',
  '',
  '  function playBang() {',
  '    if (!enabled) return;',
  '    var c = getCtx();',
  '    var t = c.currentTime;',
  '    var noise = c.createBufferSource();',
  '    noise.buffer = noiseBuffer(c, 0.5);',
  '    var noiseFilter = c.createBiquadFilter();',
  '    noiseFilter.type = "lowpass";',
  '    noiseFilter.frequency.setValueAtTime(2200, t);',
  '    noiseFilter.frequency.exponentialRampToValueAtTime(120, t + 0.35);',
  '    var noiseGain = c.createGain();',
  '    noiseGain.gain.setValueAtTime(0.9, t);',
  '    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);',
  '    noise.connect(noiseFilter);',
  '    noiseFilter.connect(noiseGain);',
  '    noiseGain.connect(c.destination);',
  '',
  '    var osc = c.createOscillator();',
  '    var oscGain = c.createGain();',
  '    osc.type = "sawtooth";',
  '    osc.frequency.setValueAtTime(140, t);',
  '    osc.frequency.exponentialRampToValueAtTime(40, t + 0.25);',
  '    oscGain.gain.setValueAtTime(0.5, t);',
  '    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);',
  '    osc.connect(oscGain);',
  '    oscGain.connect(c.destination);',
  '',
  '    noise.start(t);',
  '    noise.stop(t + 0.45);',
  '    osc.start(t);',
  '    osc.stop(t + 0.3);',
  '  }',
  '',
  '  function playSkill() {',
  '    if (!enabled) return;',
  '    var c = getCtx();',
  '    var t = c.currentTime;',
  '    var osc = c.createOscillator();',
  '    var gain = c.createGain();',
  '    osc.type = "triangle";',
  '    osc.frequency.setValueAtTime(520, t);',
  '    osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);',
  '    gain.gain.setValueAtTime(0.15, t);',
  '    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);',
  '    osc.connect(gain);',
  '    gain.connect(c.destination);',
  '    osc.start(t);',
  '    osc.stop(t + 0.16);',
  '  }',
  '',
  '  function playWin() {',
  '    if (!enabled) return;',
  '    var c = getCtx();',
  '    var t = c.currentTime;',
  '    [523, 659, 784, 1046].forEach(function (freq, i) {',
  '      var tt = t + i * 0.12;',
  '      var osc = c.createOscillator();',
  '      var gain = c.createGain();',
  '      osc.type = "triangle";',
  '      osc.frequency.setValueAtTime(freq, tt);',
  '      gain.gain.setValueAtTime(0.18, tt);',
  '      gain.gain.exponentialRampToValueAtTime(0.001, tt + 0.35);',
  '      osc.connect(gain);',
  '      gain.connect(c.destination);',
  '      osc.start(tt);',
  '      osc.stop(tt + 0.4);',
  '    });',
  '  }',
  '',
  '  function toggle() { enabled = !enabled; return enabled; }',
  '  function isEnabled() { return enabled; }',
  '',
  '  return { playClick: playClick, playBang: playBang, playSkill: playSkill, playWin: playWin, toggle: toggle, isEnabled: isEnabled };',
  '})();',
  '',
  '/* ---------- ETAT + PERSISTANCE (reconnexion) ---------- */',
  'var socket = io();',
  'var state = {',
  '  myId: null, name: "", code: null, playerId: null, isHost: false,',
  '  lastGameState: null, reorderDeck: null, reorderSelectedIdx: null, reorderMode: null',
  '};',
  '',
  'function el(id) { return document.getElementById(id); }',
  '',
  'function saveSession() {',
  '  try {',
  '    localStorage.setItem("ruletaRusaSession", JSON.stringify({ code: state.code, playerId: state.playerId, name: state.name }));',
  '  } catch (e) {}',
  '}',
  'function loadSession() {',
  '  try {',
  '    var raw = localStorage.getItem("ruletaRusaSession");',
  '    return raw ? JSON.parse(raw) : null;',
  '  } catch (e) { return null; }',
  '}',
  'function clearSession() {',
  '  try { localStorage.removeItem("ruletaRusaSession"); } catch (e) {}',
  '}',
  '',
  'function showScreen(id) {',
  '  var screens = document.querySelectorAll(".screen");',
  '  for (var i = 0; i < screens.length; i++) screens[i].classList.remove("active");',
  '  el(id).classList.add("active");',
  '}',
  '',
  'socket.on("connect", function () {',
  '  state.myId = socket.id;',
  '  var session = loadSession();',
  '  if (session && session.code && session.playerId) {',
  '    state.code = session.code;',
  '    state.playerId = session.playerId;',
  '    state.name = session.name;',
  '    socket.emit("room:rejoin", { code: session.code, playerId: session.playerId });',
  '  }',
  '});',
  '',
  'socket.on("room:rejoined", function (data) {',
  '  state.code = data.code;',
  '  state.playerId = data.playerId;',
  '  saveSession();',
  '  if (!data.started) {',
  '    showScreen("screen-lobby");',
  '  } else if (data.gameStatus === "FINISHED") {',
  '    if (data.finalState) renderEndScreen(data.finalState);',
  '  } else {',
  '    showScreen("screen-game");',
  '  }',
  '});',
  '',
  'socket.on("room:rejoinFailed", function () { clearSession(); });',
  '',
  '/* ---------- ECRAN ACCUEIL ---------- */',
  'el("btn-create").addEventListener("click", function () {',
  '  var name = el("input-name").value.trim();',
  '  if (!name) { showHomeError("Entre un pseudo pour continuer."); return; }',
  '  state.name = name;',
  '  socket.emit("room:create", { name: name });',
  '});',
  '',
  'el("btn-join").addEventListener("click", function () {',
  '  var name = el("input-name").value.trim();',
  '  var code = el("input-code").value.trim().toUpperCase();',
  '  if (!name) { showHomeError("Entre un pseudo pour continuer."); return; }',
  '  if (!code) { showHomeError("Entre le code du salon."); return; }',
  '  state.name = name;',
  '  socket.emit("room:join", { code: code, name: name });',
  '});',
  '',
  'function showHomeError(msg) { el("home-error").textContent = msg; }',
  '',
  'el("btn-rules").addEventListener("click", function () { el("modal-rules").classList.add("active"); });',
  'el("rules-close-x").addEventListener("click", function () { el("modal-rules").classList.remove("active"); });',
  'el("modal-rules").addEventListener("click", function (e) { if (e.target === el("modal-rules")) el("modal-rules").classList.remove("active"); });',
  '',
  'el("btn-start").addEventListener("click", function () { socket.emit("room:start", { code: state.code, playerId: state.playerId }); });',
  'el("btn-rematch").addEventListener("click", function () { socket.emit("room:rematch", { code: state.code, playerId: state.playerId }); });',
  'el("btn-quit").addEventListener("click", function () {',
  '  socket.emit("room:leave", { code: state.code, playerId: state.playerId });',
  '  clearSession();',
  '  window.location.reload();',
  '});',
  '',
  'el("log-toggle").addEventListener("click", function () { el("log-drawer").classList.toggle("active"); });',
  'el("sound-toggle").addEventListener("click", function () {',
  '  var isOn = SoundFX.toggle();',
  '  el("sound-toggle").innerHTML = isOn ? "&#128266; SON" : "&#128263; MUET";',
  '});',
  '',
  'socket.on("room:created", function (data) {',
  '  state.code = data.code;',
  '  state.playerId = data.playerId;',
  '  state.isHost = true;',
  '  saveSession();',
  '  el("home-error").textContent = "";',
  '});',
  '',
  'socket.on("room:joined", function (data) {',
  '  state.code = data.code;',
  '  state.playerId = data.playerId;',
  '  state.isHost = false;',
  '  saveSession();',
  '  el("home-error").textContent = "";',
  '});',
  '',
  'socket.on("error:message", function (data) {',
  '  var message = data.message;',
  '  var homeVisible = el("screen-home").classList.contains("active");',
  '  var lobbyVisible = el("screen-lobby").classList.contains("active");',
  '  if (homeVisible) showHomeError(message);',
  '  else if (lobbyVisible) el("lobby-error").textContent = message;',
  '  else alert(message);',
  '});',
  '',
  'socket.on("lobby:update", function (data) {',
  '  state.code = data.code;',
  '  state.isHost = data.hostPlayerId === state.playerId;',
  '  if (data.started) return;',
  '  showScreen("screen-lobby");',
  '  el("lobby-code").textContent = data.code;',
  '  el("lobby-error").textContent = "";',
  '  var list = el("lobby-players");',
  '  list.innerHTML = "";',
  '  data.players.forEach(function (p, idx) {',
  '    var li = document.createElement("li");',
  '    var isHostPlayer = p.playerId === data.hostPlayerId;',
  '    var hostTag = isHostPlayer ? \'<span class="host-tag">HOTE</span>\' : "";',
  '    var discTag = !p.connected ? \'<span class="disc-tag">deconnecte</span>\' : "";',
  '    li.innerHTML = \'<span class="slot-idx">\' + (idx + 1) + \'</span><span>\' + escapeHtml(p.name) + \'</span>\' + discTag + hostTag;',
  '    list.appendChild(li);',
  '  });',
  '  el("btn-start").style.display = state.isHost ? "block" : "none";',
  '  el("btn-start").disabled = data.players.length < 2;',
  '  el("lobby-hint").textContent = state.isHost',
  '    ? (data.players.length < 2 ? "Il faut au moins 2 joueurs pour lancer la partie." : "Tu peux lancer la partie quand tout le monde est pret (max 6).")',
  '    : "En attente que l\'hote lance la partie...";',
  '});',
  '',
  '/* ---------- PARTIE EN COURS ---------- */',
  'var lastRevealHandled = null;',
  'var lastWinnerHandled = null;',
  'var timerInterval = null;',
  '',
  'function stopTurnTimerBar() {',
  '  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }',
  '  el("turn-timer-bar").style.display = "none";',
  '}',
  '',
  'function startTurnTimerBar(turnStartedAt, durationMs) {',
  '  stopTurnTimerBar();',
  '  if (!turnStartedAt || !durationMs) return;',
  '  var bar = el("turn-timer-bar");',
  '  var fill = el("turn-timer-fill");',
  '  bar.style.display = "block";',
  '  function update() {',
  '    var elapsed = Date.now() - turnStartedAt;',
  '    var remainingRatio = Math.max(0, 1 - elapsed / durationMs);',
  '    fill.style.transition = "none";',
  '    fill.style.transform = "scaleX(" + remainingRatio + ")";',
  '    if (remainingRatio <= 0) stopTurnTimerBar();',
  '  }',
  '  update();',
  '  timerInterval = setInterval(update, 250);',
  '}',
  '',
  'socket.on("game:state", function (gs) {',
  '  state.lastGameState = gs;',
  '  if (gs.status === "FINISHED") {',
  '    stopTurnTimerBar();',
  '    if (gs.winnerId !== lastWinnerHandled) {',
  '      lastWinnerHandled = gs.winnerId;',
  '      SoundFX.playWin();',
  '    }',
  '    renderEndScreen(gs);',
  '    return;',
  '  }',
  '  showScreen("screen-game");',
  '  renderGame(gs);',
  '',
  '  if (gs.lastReveal && gs.lastReveal !== lastRevealHandled) {',
  '    lastRevealHandled = gs.lastReveal;',
  '    var revealerId = gs.lastReveal.revealerId;',
  '    var revealer = gs.players.find(function (p) { return p.id === revealerId; });',
  '    playRevealCinematic(gs.lastReveal.token, revealer, function () {',
  '      var me = gs.players.find(function (p) { return p.isYou; });',
  '      if (!me) return;',
  '      if (gs.lastReveal.awaitingClickRecharge && gs.turnPlayerId === me.id) {',
  '        openClickRechargeModal(me);',
  '      } else if (gs.lastReveal.awaitingBangResolution && gs.pendingResolution && gs.pendingResolution.playerId === me.id) {',
  '        if (gs.pendingResolution.stage === "choose_skill") openBangChoiceModal(me);',
  '        else if (gs.pendingResolution.stage === "reorder" || gs.pendingResolution.stage === "reorder_only") openReorderModal("bang", null);',
  '      }',
  '    });',
  '  } else if (gs.pendingResolution) {',
  '    var me2 = gs.players.find(function (p) { return p.isYou; });',
  '    if (me2 && gs.pendingResolution.playerId === me2.id) {',
  '      if (gs.pendingResolution.stage === "choose_skill" && !el("modal-bang-choice").classList.contains("active")) {',
  '        openBangChoiceModal(me2);',
  '      } else if ((gs.pendingResolution.stage === "reorder" || gs.pendingResolution.stage === "reorder_only") && !el("modal-reorder").classList.contains("active")) {',
  '        openReorderModal("bang", null);',
  '      }',
  '    }',
  '  }',
  '',
  '  if (gs.turnStartedAt && gs.turnTimeoutMs) {',
  '    startTurnTimerBar(gs.turnStartedAt, gs.turnTimeoutMs);',
  '  } else {',
  '    stopTurnTimerBar();',
  '  }',
  '});',
  '',
  'socket.on("game:mirarPeekResult", function (data) { showMirarResult(data.peekedToken); });',
  'socket.on("game:reordenarPeekResult", function (data) { openReorderModal("reordenar", data.currentDeck); });',
  '',
  'var SKILL_LABELS = {',
  '  VOLTEAR: "Voltear", REORDENAR: "Reordenar", CAMBIO_TURNO: "Cambiar turno",',
  '  MIRAR: "Mirar", CAMBIO_SENTIDO: "Cambiar sentido", DISPARO_DOBLE: "Disparo doble"',
  '};',
  'var SKILL_ICONS = {',
  '  VOLTEAR: "\\u2195", REORDENAR: "\\u21bb", CAMBIO_TURNO: "\\u2192",',
  '  MIRAR: "\\u25c9", CAMBIO_SENTIDO: "\\u21c4", DISPARO_DOBLE: "\\u00d72"',
  '};',
  'var SKILL_DESC = {',
  '  VOLTEAR: "Epuise un pouvoir adverse", REORDENAR: "Regarde et reordonne la pile",',
  '  CAMBIO_TURNO: "Force un autre joueur", MIRAR: "Regarde le prochain jeton",',
  '  CAMBIO_SENTIDO: "Inverse le sens du tour", DISPARO_DOBLE: "Impose 2 tirages"',
  '};',
  'var SKILLS_REQUIRE_2_TOKENS = { MIRAR: true, REORDENAR: true };',
  '',
  'function renderGame(gs) {',
  '  var me = gs.players.find(function (p) { return p.isYou; });',
  '  var turnPlayer = gs.players.find(function (p) { return p.id === gs.turnPlayerId; });',
  '  var isMyTurn = turnPlayer && me && turnPlayer.id === me.id;',
  '  var resolutionPending = !!gs.pendingResolution;',
  '',
  '  var aliveCount = gs.players.filter(function (p) { return !p.eliminated; }).length;',
  '  el("survivors-count").textContent = aliveCount + " SURVIVANT" + (aliveCount > 1 ? "S" : "");',
  '',
  '  if (isMyTurn) {',
  '    el("turn-label").textContent = "";',
  '    el("turn-name").textContent = "A TOI DE JOUER";',
  '  } else {',
  '    el("turn-label").textContent = "C\'EST LE TOUR DE";',
  '    el("turn-name").textContent = turnPlayer ? turnPlayer.name.toUpperCase() : "--";',
  '  }',
  '',
  '  el("hub-count").textContent = gs.deckCount + " / 8 JETONS";',
  '  var hub = el("revolver-hub");',
  '  hub.classList.toggle("my-turn", isMyTurn && !resolutionPending);',
  '  var hubHint = el("hub-hint");',
  '  if (isMyTurn && !resolutionPending && !gs.mustRevealOnly) {',
  '    hubHint.style.display = "block";',
  '    hubHint.textContent = "TOUCHER POUR REVELER";',
  '  } else {',
  '    hubHint.style.display = "none";',
  '  }',
  '  hub.onclick = function () {',
  '    if (isMyTurn && !resolutionPending) socket.emit("game:revealTop", { code: state.code, playerId: state.playerId });',
  '  };',
  '',
  '  var dotsContainer = el("hub-dots");',
  '  dotsContainer.innerHTML = "";',
  '  for (var d = 0; d < gs.deckCount; d++) {',
  '    var dot = document.createElement("div");',
  '    dot.className = "hub-dot";',
  '    dotsContainer.appendChild(dot);',
  '  }',
  '',
  '  renderCircle(gs, me);',
  '',
  '  var actionsPanel = el("actions-panel");',
  '  actionsPanel.style.display = (isMyTurn && !resolutionPending) ? "block" : "none";',
  '',
  '  if (isMyTurn && me && !resolutionPending) {',
  '    var mustReveal = gs.mustRevealOnly;',
  '    el("must-reveal-hint").style.display = mustReveal ? "block" : "none";',
  '    el("double-shot-hint").style.display = gs.pendingDoubleShot > 0 ? "block" : "none";',
  '    el("btn-reveal").onclick = function () { socket.emit("game:revealTop", { code: state.code, playerId: state.playerId }); };',
  '',
  '    var skillsPanel = el("skills-panel");',
  '    skillsPanel.innerHTML = "";',
  '    if (!mustReveal) {',
  '      me.ownedSkills.forEach(function (skill) {',
  '        var card = document.createElement("button");',
  '        card.className = "skill-card";',
  '        var lockedByTokenCount = SKILLS_REQUIRE_2_TOKENS[skill] && gs.deckCount <= 1;',
  '        card.disabled = me.status[skill] !== "alive" || lockedByTokenCount;',
  '        var desc = lockedByTokenCount ? "Indispo (1 jeton restant)" : SKILL_DESC[skill];',
  '        card.innerHTML =',
  '          \'<div class="skill-icon">\' + SKILL_ICONS[skill] + \'</div>\' +',
  '          \'<div class="skill-name">\' + SKILL_LABELS[skill] + \'</div>\' +',
  '          \'<span class="skill-desc">\' + desc + \'</span>\';',
  '        card.onclick = function () { SoundFX.playSkill(); handleSkillClick(skill, gs, me); };',
  '        skillsPanel.appendChild(card);',
  '      });',
  '    }',
  '  }',
  '',
  '  var logList = el("game-log");',
  '  logList.innerHTML = "";',
  '  gs.log.slice().reverse().forEach(function (entry) {',
  '    var li = document.createElement("li");',
  '    li.textContent = entry.message;',
  '    logList.appendChild(li);',
  '  });',
  '}',
  '',
  'function renderCircle(gs, me) {',
  '  var wrap = el("circle-wrap");',
  '  var existingNodes = wrap.querySelectorAll(".player-node");',
  '  existingNodes.forEach(function (n) { n.remove(); });',
  '',
  '  var n = gs.players.length;',
  '  var radiusPercent = 42;',
  '  gs.players.forEach(function (p, idx) {',
  '    var angle = (idx / n) * 2 * Math.PI - Math.PI / 2;',
  '    var x = 50 + radiusPercent * Math.cos(angle);',
  '    var y = 50 + radiusPercent * Math.sin(angle);',
  '',
  '    var node = document.createElement("div");',
  '    node.className = "player-node";',
  '    if (p.id === gs.turnPlayerId) node.classList.add("is-turn");',
  '    if (p.isYou) node.classList.add("is-you");',
  '    if (p.eliminated) node.classList.add("eliminated");',
  '    if (p.connected === false) node.classList.add("is-offline");',
  '    node.style.left = x + "%";',
  '    node.style.top = y + "%";',
  '',
  '    var initials = p.name.slice(0, 2).toUpperCase();',
  '    var tokensHtml = p.ownedSkills.map(function (skill) {',
  '      var st = p.status[skill];',
  '      return \'<div class="node-token \' + st + \'">\' + SKILL_ICONS[skill] + \'</div>\';',
  '    }).join("");',
  '',
  '    node.innerHTML =',
  '      \'<div class="node-ring"><div class="turn-dot"></div>\' + initials + \'</div>\' +',
  '      (p.isYou ? \'<div class="you-flag">TOI</div>\' : \'\') +',
  '      \'<div class="node-name">\' + escapeHtml(p.name.toUpperCase()) + (p.eliminated ? " \\u2620" : "") + \'</div>\' +',
  '      \'<div class="node-tokens">\' + tokensHtml + \'</div>\';',
  '',
  '    wrap.appendChild(node);',
  '  });',
  '}',
  '',
  'function skillButtonLabel(skill) { return SKILL_LABELS[skill]; }',
  '',
  'function handleSkillClick(skill, gs, me) {',
  '  if (skill === "REORDENAR") { socket.emit("game:useSkill", { code: state.code, playerId: state.playerId, skillName: "REORDENAR", options: {} }); return; }',
  '  if (skill === "CAMBIO_SENTIDO") { socket.emit("game:useSkill", { code: state.code, playerId: state.playerId, skillName: "CAMBIO_SENTIDO", options: {} }); return; }',
  '  if (skill === "DISPARO_DOBLE") { socket.emit("game:useSkill", { code: state.code, playerId: state.playerId, skillName: "DISPARO_DOBLE", options: {} }); return; }',
  '  if (skill === "MIRAR") { socket.emit("game:peekMirar", { code: state.code, playerId: state.playerId }); return; }',
  '  if (skill === "VOLTEAR") {',
  '    var targets = [];',
  '    gs.players.forEach(function (p) {',
  '      if (p.isYou || p.eliminated) return;',
  '      p.ownedSkills.forEach(function (s) { if (p.status[s] === "alive") targets.push({ playerId: p.id, playerName: p.name, skill: s }); });',
  '    });',
  '    openTargetModal("Choisis une fiche adverse a epuiser", targets.map(function (t) {',
  '      return {',
  '        label: t.playerName + " \\u2014 " + SKILL_LABELS[t.skill],',
  '        onSelect: function () { socket.emit("game:useSkill", { code: state.code, playerId: state.playerId, skillName: "VOLTEAR", options: { targetPlayerId: t.playerId, targetSkill: t.skill } }); }',
  '      };',
  '    }));',
  '    return;',
  '  }',
  '  if (skill === "CAMBIO_TURNO") {',
  '    var targets2 = gs.players.filter(function (p) { return !p.isYou && !p.eliminated; });',
  '    openTargetModal("Choisis qui doit jouer a ta place", targets2.map(function (p) {',
  '      return {',
  '        label: p.name,',
  '        onSelect: function () { socket.emit("game:useSkill", { code: state.code, playerId: state.playerId, skillName: "CAMBIO_TURNO", options: { targetPlayerId: p.id } }); }',
  '      };',
  '    }));',
  '    return;',
  '  }',
  '}',
  '',
  'function playRevealCinematic(token, revealer, onDone) {',
  '  if (token === "BANG") SoundFX.playBang(); else SoundFX.playClick();',
  '  var overlay = el("reveal-cinematic");',
  '  var textEl = el("reveal-cinematic-text");',
  '  var nameEl = el("reveal-cinematic-name");',
  '  var hintEl = el("reveal-cinematic-hint");',
  '  textEl.textContent = token === "BANG" ? "BANG!" : "CLICK!";',
  '  textEl.className = "cinematic-text " + (token === "BANG" ? "is-bang" : "is-click");',
  '  nameEl.textContent = revealer ? revealer.name : "";',
  '  hintEl.textContent = token === "BANG" ? "Doit perdre une capacite !" : "";',
  '  overlay.classList.add("active");',
  '  setTimeout(function () {',
  '    overlay.classList.remove("active");',
  '    if (onDone) onDone();',
  '  }, 1300);',
  '}',
  '',
  'function openClickRechargeModal(me) {',
  '  var exhausted = me.ownedSkills.filter(function (s) { return me.status[s] === "exhausted"; });',
  '  if (exhausted.length === 0) return;',
  '  var box = el("click-recharge-options");',
  '  box.innerHTML = "";',
  '  exhausted.forEach(function (s) {',
  '    var btn = document.createElement("button");',
  '    btn.textContent = SKILL_LABELS[s];',
  '    btn.onclick = function () {',
  '      socket.emit("game:resolveClickRecharge", { code: state.code, playerId: state.playerId, skillToRecharge: s });',
  '      el("modal-click-recharge").classList.remove("active");',
  '    };',
  '    box.appendChild(btn);',
  '  });',
  '  el("modal-click-recharge").classList.add("active");',
  '}',
  '',
  'function openBangChoiceModal(me) {',
  '  var inPlay = me.ownedSkills.filter(function (s) { return me.status[s] !== "dead"; });',
  '  var box = el("bang-choice-options");',
  '  box.innerHTML = "";',
  '  inPlay.forEach(function (s) {',
  '    var btn = document.createElement("button");',
  '    btn.textContent = SKILL_LABELS[s] + " (" + me.status[s] + ")";',
  '    btn.onclick = function () {',
  '      socket.emit("game:resolveBangSkillChoice", { code: state.code, playerId: state.playerId, skillToLose: s });',
  '      el("modal-bang-choice").classList.remove("active");',
  '    };',
  '    box.appendChild(btn);',
  '  });',
  '  el("modal-bang-choice").classList.add("active");',
  '}',
  '',
  'function openReorderModal(mode, currentDeck) {',
  '  state.reorderMode = mode;',
  '  state.reorderDeck = currentDeck ? currentDeck.slice() : new Array(7).fill("CLICK").concat(["BANG"]);',
  '  state.reorderSelectedIdx = null;',
  '  el("modal-reorder-title").textContent = mode === "reordenar" ? "Reordenar : reorganise le barillet" : "Reorganise le barillet";',
  '  renderReorderSlots();',
  '  el("modal-reorder").classList.add("active");',
  '}',
  '',
  'function renderReorderSlots() {',
  '  var container = el("reorder-slots");',
  '  container.innerHTML = "";',
  '  state.reorderDeck.forEach(function (token, idx) {',
  '    var slot = document.createElement("div");',
  '    slot.className = "reorder-slot " + (token === "BANG" ? "slot-bang" : "slot-click");',
  '    if (state.reorderSelectedIdx === idx) slot.style.outline = "3px solid #fff";',
  '    slot.innerHTML = \'<div><span class="slot-index">\' + (idx + 1) + \'</span>\' + (token === "BANG" ? "BANG" : "CLICK") + \'</div>\';',
  '    slot.onclick = function () {',
  '      if (state.reorderSelectedIdx === null) {',
  '        state.reorderSelectedIdx = idx;',
  '      } else if (state.reorderSelectedIdx === idx) {',
  '        state.reorderSelectedIdx = null;',
  '      } else {',
  '        var tmp = state.reorderDeck[idx];',
  '        state.reorderDeck[idx] = state.reorderDeck[state.reorderSelectedIdx];',
  '        state.reorderDeck[state.reorderSelectedIdx] = tmp;',
  '        state.reorderSelectedIdx = null;',
  '      }',
  '      renderReorderSlots();',
  '    };',
  '    container.appendChild(slot);',
  '  });',
  '}',
  '',
  'el("btn-confirm-reorder").addEventListener("click", function () {',
  '  if (state.reorderMode === "reordenar") {',
  '    socket.emit("game:useSkill", { code: state.code, playerId: state.playerId, skillName: "REORDENAR", options: { newOrder: state.reorderDeck } });',
  '  } else {',
  '    socket.emit("game:resolveBangReorder", { code: state.code, playerId: state.playerId, newOrder: state.reorderDeck });',
  '  }',
  '  el("modal-reorder").classList.remove("active");',
  '});',
  '',
  'function showMirarResult(peekedToken) {',
  '  var resultEl = el("mirar-peek-result");',
  '  resultEl.textContent = peekedToken;',
  '  resultEl.className = "mirar-peek " + (peekedToken === "BANG" ? "is-bang" : "is-click");',
  '  el("modal-mirar").classList.add("active");',
  '}',
  '',
  'el("mirar-keep").addEventListener("click", function () {',
  '  socket.emit("game:useSkill", { code: state.code, playerId: state.playerId, skillName: "MIRAR", options: { keepOnTop: true } });',
  '  el("modal-mirar").classList.remove("active");',
  '});',
  'el("mirar-bottom").addEventListener("click", function () {',
  '  socket.emit("game:useSkill", { code: state.code, playerId: state.playerId, skillName: "MIRAR", options: { keepOnTop: false } });',
  '  el("modal-mirar").classList.remove("active");',
  '});',
  '',
  'function openTargetModal(title, options) {',
  '  el("modal-title").textContent = title;',
  '  var box = el("modal-options");',
  '  box.innerHTML = "";',
  '  if (options.length === 0) box.innerHTML = \'<p style="color:#8a8a8a;font-size:13px;">Aucune cible disponible.</p>\';',
  '  options.forEach(function (opt) {',
  '    var btn = document.createElement("button");',
  '    btn.textContent = opt.label;',
  '    btn.onclick = function () { opt.onSelect(); closeModal(); };',
  '    box.appendChild(btn);',
  '  });',
  '  el("modal-target").classList.add("active");',
  '}',
  'function closeModal() { el("modal-target").classList.remove("active"); }',
  'el("modal-cancel").addEventListener("click", closeModal);',
  '',
  'function renderEndScreen(gs) {',
  '  showScreen("screen-end");',
  '  var winner = gs.players.find(function (p) { return p.id === gs.winnerId; });',
  '  if (winner) {',
  '    el("end-title").textContent = winner.isYou ? "TU AS GAGNE !" : "PARTIE TERMINEE";',
  '    el("end-message").textContent = winner.name + " est le dernier survivant.";',
  '  } else {',
  '    el("end-title").textContent = "MATCH NUL";',
  '    el("end-message").textContent = "Personne n\'a survecu a la Ruleta Rusa.";',
  '  }',
  '  el("btn-rematch").style.display = state.isHost ? "block" : "none";',
  '}',
  '',
  'function escapeHtml(str) {',
  '  var div = document.createElement("div");',
  '  div.textContent = str;',
  '  return div.innerHTML;',
  '}',
  '</script>',
  '</body>',
  '</html>',
  '',
].join('\n');

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

function emitError(socket, message) {
  socket.emit("error:message", { message: message });
}

function broadcastRoomLobby(room) {
  io.to(room.code).emit("lobby:update", {
    code: room.code,
    hostPlayerId: room.hostPlayerId,
    players: room.players.map(function (p) { return { playerId: p.playerId, name: p.name, connected: p.connected }; }),
    started: !!room.game,
  });
}

function broadcastGameState(room, extra) {
  extra = extra || {};
  if (!room.game) return;
  room.players.forEach(function (p) {
    var gameState = room.game.publicState(p.playerId);
    gameState.players.forEach(function (gp) {
      var roomPlayer = room.players.find(function (rp) { return rp.playerId === gp.id; });
      gp.connected = roomPlayer ? roomPlayer.connected : false;
    });
    gameState.turnTimeoutMs = TURN_TIMEOUT_MS;
    gameState.turnStartedAt = room.turnStartedAt || null;
    for (var key in extra) gameState[key] = extra[key];
    io.to(p.socketId).emit("game:state", gameState);
  });
}

function handleTurnTimeout(room, playerId) {
  if (!room.game || room.game.status !== "PLAYING") return;
  room.game.eliminateForInactivity(playerId);
  broadcastGameState(room);
  if (room.game.status === "PLAYING") {
    rooms.armTurnTimer(room, function (nextPlayerId) { handleTurnTimeout(room, nextPlayerId); });
  } else {
    rooms.clearTurnTimer(room);
  }
}

io.on("connection", function (socket) {
  socket.on("room:create", function (data) {
    try {
      var cleanName = (data.name || "").trim().slice(0, 20) || "Joueur";
      var res = rooms.createRoom(socket.id, cleanName);
      socket.join(res.room.code);
      socket.emit("room:created", { code: res.room.code, playerId: res.playerId });
      broadcastRoomLobby(res.room);
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("room:join", function (data) {
    try {
      var cleanCode = (data.code || "").trim().toUpperCase();
      var cleanName = (data.name || "").trim().slice(0, 20) || "Joueur";
      var res = rooms.joinRoom(cleanCode, socket.id, cleanName);
      socket.join(res.room.code);
      socket.emit("room:joined", { code: res.room.code, playerId: res.playerId });
      broadcastRoomLobby(res.room);
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("room:rejoin", function (data) {
    try {
      var cleanCode = (data.code || "").trim().toUpperCase();
      var playerId = data.playerId;
      if (!playerId) throw new Error("Identifiant de session manquant");
      var room = rooms.rejoinRoom(cleanCode, playerId, socket.id);
      socket.join(room.code);
      var payload = { code: room.code, playerId: playerId, started: !!room.game };
      if (room.game) {
        payload.gameStatus = room.game.status;
        if (room.game.status === "FINISHED") payload.finalState = room.game.publicState(playerId);
      }
      socket.emit("room:rejoined", payload);
      if (room.game) broadcastGameState(room); else broadcastRoomLobby(room);
    } catch (err) {
      socket.emit("room:rejoinFailed", { message: err.message });
    }
  });

  socket.on("room:start", function (data) {
    try {
      var room = rooms.startGame(data.code, data.playerId);
      broadcastRoomLobby(room);
      broadcastGameState(room);
      rooms.armTurnTimer(room, function (playerId) { handleTurnTimeout(room, playerId); });
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:revealTop", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      var result = room.game.revealTop(data.playerId);
      broadcastGameState(room, { lastReveal: result });
      if (room.game.status === "PLAYING") {
        rooms.armTurnTimer(room, function (playerId) { handleTurnTimeout(room, playerId); });
      } else {
        rooms.clearTurnTimer(room);
      }
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:resolveClickRecharge", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      room.game.resolveClickRecharge(data.playerId, data.skillToRecharge);
      broadcastGameState(room);
      if (room.game.status === "PLAYING") {
        rooms.armTurnTimer(room, function (playerId) { handleTurnTimeout(room, playerId); });
      } else {
        rooms.clearTurnTimer(room);
      }
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:resolveBangSkillChoice", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      var result = room.game.resolveBangSkillChoice(data.playerId, data.skillToLose);
      broadcastGameState(room, { bangSkillResult: result });
      rooms.armTurnTimer(room, function (playerId) { handleTurnTimeout(room, playerId); });
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:resolveBangReorder", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      room.game.resolveBangReorder(data.playerId, data.newOrder);
      broadcastGameState(room);
      if (room.game.status === "PLAYING") {
        rooms.armTurnTimer(room, function (playerId) { handleTurnTimeout(room, playerId); });
      } else {
        rooms.clearTurnTimer(room);
      }
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:peekMirar", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      var result = room.game.peekMirar(data.playerId);
      socket.emit("game:mirarPeekResult", { peekedToken: result.peekedToken });
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("game:useSkill", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room || !room.game) throw new Error("Partie introuvable");
      var result = room.game.useSkill(data.playerId, data.skillName, data.options);
      if (result && result.awaitingReorderInput) {
        socket.emit("game:reordenarPeekResult", { currentDeck: result.currentDeck });
      } else {
        broadcastGameState(room, { lastSkillResult: result });
        if (room.game.status === "PLAYING") {
          rooms.armTurnTimer(room, function (playerId) { handleTurnTimeout(room, playerId); });
        } else {
          rooms.clearTurnTimer(room);
        }
      }
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("room:rematch", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room) throw new Error("Salon introuvable");
      if (room.hostPlayerId !== data.playerId) throw new Error("Seul l'hote peut relancer une partie");
      rooms.resetGame(data.code);
      broadcastRoomLobby(room);
    } catch (err) { emitError(socket, err.message); }
  });

  socket.on("room:leave", function (data) {
    try {
      var room = rooms.getRoom(data.code);
      if (!room) return;
      rooms.clearTurnTimer(room);
      room.players = room.players.filter(function (p) { return p.playerId !== data.playerId; });
      if (room.players.length === 0) {
        rooms.rooms.delete(room.code);
      } else {
        if (room.hostPlayerId === data.playerId) room.hostPlayerId = room.players[0].playerId;
        if (!room.game) {
          broadcastRoomLobby(room);
        } else {
          room.game.eliminateForInactivity(data.playerId);
          broadcastGameState(room);
          if (room.game.status === "PLAYING") {
            rooms.armTurnTimer(room, function (pid) { handleTurnTimeout(room, pid); });
          } else {
            rooms.clearTurnTimer(room);
          }
        }
      }
      socket.leave(data.code);
    } catch (err) { /* quitter ne doit jamais planter */ }
  });

  socket.on("disconnect", function () {
    var affected = rooms.markDisconnected(socket.id);
    affected.forEach(function (room) {
      if (room.game) broadcastGameState(room); else broadcastRoomLobby(room);
    });
  });
});

server.listen(PORT, function () {
  console.log("Ruleta Rusa Online demarre sur http://localhost:" + PORT);
});
