import type { BattleConfig } from '../core/BattleSetup';
import { Game } from '../core/Game';
import { audio } from '../fx/Audio';
import { Lockstep, type LockstepSim } from '../net/Lockstep';
import { TurnApplier } from '../net/navalTurns';
import { NetClient } from '../net/NetClient';
import { type ServerMsg, TURN_TICKS, type Turn } from '../net/protocol';
import { Lobby } from '../ui/Lobby';
import type { ActiveBattle, BattleLink } from './ActiveBattle';
import { NavalBattle } from './NavalBattle';
import type { Shell } from './Shell';

// The LAN screens and battles on this peer: the lobby, the server link, and a battle's lockstep,
// from loading (or replaying the log when rejoining) to the report.

/** A LAN battle on this peer: the lockstep that feeds it, and how it got here. */
interface LanBattle {
  config: BattleConfig;
  you: number;
  sim: LockstepSim;
  lockstep: Lockstep;
  /** Builds the battle's view once the battle is caught up. */
  present: (link: BattleLink) => ActiveBattle;
  /** The battle on screen, once presented. */
  view: ActiveBattle | null;
  /** Replaying the server's log before the battle is shown (rejoining, or after a desync). */
  replaying: boolean;
  /** Resyncs requested in this battle; past MAX_RESYNCS we stop and play on. */
  resyncs: number;
  /** A resync was asked for and its log has not arrived yet. */
  awaitingLog: boolean;
  sentOver: boolean;
  /** Seconds the turn buffer has been empty. */
  starved: number;
}

const MAX_RESYNCS = 3;

/** A LAN battle's sim and view: the one place a new kind of battle hooks in. */
function buildLanBattle(shell: Shell, config: BattleConfig, you: number): Pick<LanBattle, 'sim' | 'present'> {
  const game = new Game(config);
  const turns = new TurnApplier(game);
  return { sim: turns, present: (link) => new NavalBattle(shell, config, game, link, turns.ship(you)) };
}

export class LanLink {
  private net: NetClient | null = null;
  private lobby: Lobby | null = null;
  /** The LAN battle in progress here, shown or still replaying. */
  lan: LanBattle | null = null;
  private bannerText = '';

  constructor(
    private shell: Shell,
    private banner: HTMLElement,
  ) {}

  get client(): NetClient | null {
    return this.net;
  }

  open(): void {
    if (!this.net) {
      const n = (this.net = new NetClient());
      n.listen((m) => this.onNet(m));
      n.onStatus(() => this.updateBanner());
      const { menu } = this.shell;
      const l = (this.lobby = new Lobby(this.shell.menuLayer, n, {
        click: () => audio.ui('click'),
        preview: (spec, offset) => this.shell.preview(spec, offset),
        back: () => this.close(),
        chooseShip: (shipId, titans, era) => {
          l.hide();
          menu.showLanHangar(shipId, titans, era, (id) => {
            l.pickShip(id);
            l.show();
          });
        },
      }));
    }
    this.lobby!.show();
  }

  /** Runs the frame while a battle replays its log off screen; false when there is nothing to replay. */
  frame(): boolean {
    const nb = this.lan;
    if (!nb?.replaying) return false;
    nb.lockstep.fastForward(40);
    if (nb.lockstep.backlog <= TURN_TICKS * 2) {
      nb.replaying = false;
      this.present(nb);
    }
    this.updateBanner();
    return true;
  }

  /** Back from the LAN screens to the title. */
  private close(): void {
    const n = this.net;
    if (n?.lobby) n.leave();
    this.lobby?.hide();
    n?.close();
    this.net = null;
    this.lobby = null;
    this.lan = null;
    this.updateBanner();
    this.shell.menu.showTitle();
  }

  /** The LAN battle is done here (report closed, or the server ended it): back to the lobby. */
  private closeBattle(note?: string): void {
    this.shell.closeBattle();
    this.lan = null;
    this.updateBanner();
    if (!this.lobby) return;
    this.lobby.show();
    if (note) this.lobby.notice(note);
  }

  private present(nb: LanBattle): void {
    const host = () => this.net?.isHost ?? false;
    const link: BattleLink = {
      lockstep: nb.lockstep,
      get host() {
        return host();
      },
      frame: (dt) => {
        nb.starved = nb.lockstep.started && nb.lockstep.backlog === 0 ? nb.starved + dt : 0;
        this.updateBanner();
      },
      over: () => {
        if (nb.sentOver) return;
        nb.sentOver = true;
        this.net?.send({ t: 'over' });
      },
      end: () => this.net?.send({ t: 'end' }),
      // Leaving mid-battle: the AI takes the ship over for the others.
      leave: () => {
        this.net?.leave();
        this.closeBattle();
      },
      toLobby: () => this.closeBattle(),
      leaveLobby: () => {
        this.net?.leave();
        this.closeBattle();
      },
    };
    nb.view = nb.present(link);
    this.shell.show(nb.view);
  }

  /** Build a LAN battle from its config and, when rejoining or resyncing, the turns so far. */
  private start(config: BattleConfig, you: number, turns: Turn[] | null, resyncs = 0): void {
    this.shell.closeBattle();
    this.shell.menu.hide();
    this.lobby?.hide();
    const nb: LanBattle = { config, you, ...buildLanBattle(this.shell, config, you), lockstep: null!, view: null, replaying: false, resyncs, awaitingLog: false, sentOver: false, starved: 0 };
    // Checkpoints passed while replaying were settled long ago; reporting them again only adds noise.
    nb.lockstep = new Lockstep(nb.sim, (m) => {
      if (m.t === 'hash' && nb.replaying) return;
      this.net?.send(m);
    });
    for (const t of turns ?? []) nb.lockstep.onTurn(t);
    this.lan = nb;
    if (!turns?.length) this.net?.send({ t: 'loaded' });
    if (nb.lockstep.backlog > TURN_TICKS * 4) nb.replaying = true;
    else this.present(nb);
    this.updateBanner();
  }

  /** The battle on screen is this LAN battle's. */
  private get shown(): ActiveBattle | null {
    const v = this.lan?.view;
    return v && this.shell.battle === v ? v : null;
  }

  private onNet(m: ServerMsg): void {
    const n = this.net!;
    const lan = this.lan;
    switch (m.t) {
      case 'welcome':
        // The server restarted, or forgot us while we were away: that battle is gone.
        if (n.lostSeat && lan) this.closeBattle('Lost the seat in that battle: the LAN server restarted.');
        return;
      case 'start':
        return this.start(m.config, m.you, null);
      case 'turn':
        lan?.lockstep.onTurn(m.turn);
        return;
      case 'log': {
        const same = lan && lan.config.seed === m.config.seed && lan.you === m.you;
        // Back after a dropped connection with the battle still intact: just take the turns we missed.
        if (same && !lan.awaitingLog) {
          for (const t of m.turns) lan.lockstep.onTurn(t);
          return;
        }
        return this.start(m.config, m.you, m.turns, same ? lan.resyncs : 0);
      }
      case 'desync':
        if (!lan || lan.awaitingLog || lan.resyncs >= MAX_RESYNCS) return;
        lan.resyncs++;
        lan.awaitingLog = true;
        n.send({ t: 'resync' });
        this.updateBanner();
        return;
      case 'ended':
        // Normally everyone saw the battle end and the report is up; otherwise the server called it.
        if (lan && !this.shell.battle?.ended) this.closeBattle('The battle was called off before it finished here.');
        return;
      case 'lobby': {
        const shown = this.shown;
        if (!m.lobby && shown && !shown.ended) this.closeBattle();
        return;
      }
    }
  }

  private setBanner(text: string, cls = ''): void {
    const el = this.banner;
    if (text === this.bannerText && el.className === `net-banner ${cls}`.trim()) return;
    this.bannerText = text;
    el.textContent = text;
    el.className = `net-banner ${cls}`.trim();
    el.hidden = !text;
  }

  /** What the LAN banner should say right now. */
  private updateBanner(): void {
    const nb = this.lan;
    const net = this.net;
    if (!nb || !net) return this.setBanner('');
    if (net.status !== 'online') return this.setBanner('Lost the LAN server. Reconnecting…', 'warn');
    // Battle over here: the report is up and turns may stop at any moment.
    if (this.shown?.ended) return this.setBanner('');
    if (nb.replaying) {
      const done = nb.lockstep.played;
      const pct = Math.floor((100 * done) / Math.max(1, done + nb.lockstep.backlog / TURN_TICKS));
      return this.setBanner(`${nb.resyncs ? 'Getting back in step with the other captains' : 'Rejoining the battle'}: ${pct}%`, 'screen');
    }
    if (nb.awaitingLog) return this.setBanner('Getting back in step with the other captains…');
    if (!nb.lockstep.started) {
      const l = net.lobby;
      const total = nb.config.players.length;
      return this.setBanner(total > 1 ? `Waiting for every captain to load: ${Math.min(total, l?.loaded ?? 0)} of ${total}` : 'Casting off…');
    }
    if (nb.lockstep.catchingUp) return this.setBanner('Catching up…');
    if (nb.starved > 0.6) return this.setBanner('Waiting for the LAN server…', 'warn');
    if (nb.resyncs >= MAX_RESYNCS) return this.setBanner('Out of step with the other captains. This battle may play out differently here.', 'warn');
    this.setBanner('');
  }
}
