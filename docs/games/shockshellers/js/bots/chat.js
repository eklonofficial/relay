// How bots talk: about what is actually happening, by name, to the people in the lobby and to each
// other. Each bot has its own voice (lowercase or not, punctuation, how often it talks); lines go out
// after a typing delay; a line that names another bot can draw a reply, so short back-and-forths
// happen; people's messages get answered (a greeting, a "gg", a name, a jab, "are you bots").
// Lobby-wide and per-bot pacing keep it lively without flooding the chat.

// Lines by situation. {name}: who the line is about or to; {me}: the speaker; {w}: a weapon name.
const L = {
  hello: ['hi {name}', 'hey {name}', 'yo {name}', 'welcome {name}', 'sup {name}', 'hiii', 'hey!'],
  glhf: ['glhf', 'gl hf all', 'good luck everyone', 'lets goo', 'ready', 'this map again lol'],
  diedTo: ['nice shot {name}', 'ns {name}', 'how did {name} hit that', 'ugh {name}', 'ok {name} that was clean', 'wow {name}', 'lag', 'so close', 'i had you {name}'],
  diedAgain: ['{name} again??', 'why is it always {name}', '{name} stop', 'ok {name} you are dead next', '{name} is cracked', 'someone get {name} pls', 'im coming for you {name}'],
  diedSniper: ['{name} camping that spot lol', 'who is sniping from up there', 'stop sniping {name}', 'that sniper again', 'ok i see you {name}'],
  diedRocket: ['rockets really {name}', 'bro used the zooka', 'boom ok', '{name} and that rocket'],
  diedClose: ['shotgun ugh', '{name} in my face', 'did {name} just whisk me', 'point blank lol'],
  tilted: ['im so bad today', 'cant hit anything', 'this is not my round', 'ok im trying harder', 'my aim is gone'],
  killed: ['gg {name}', 'got you {name}', 'sorry {name}', 'lol {name}', 'gotcha', 'too easy', 'nice try {name}'],
  revenge: ['revenge {name}', 'thats for earlier {name}', 'finally got you {name}', 'payback {name}', 'told you {name}'],
  streak: ['im on fire', 'lets goooo', 'cant stop me', 'egg-cellent', '{n} in a row!', 'someone stop me lol'],
  shutdown: ['ended your streak {name}', 'streak over {name}', 'no more streak {name}'],
  niceKill: ['nice one {name}', 'good shot {name}', 'clean {name}', 'ns {name}'],
  retort: ['luck', 'lol', 'whatever {name}', 'watch this {name}', '1v1 me {name}', 'ok ok', 'you got lucky {name}', 'next time {name}', 'xd'],
  laugh: ['lol', 'lmao', 'haha', 'xd'],
  gg: ['gg', 'gg wp', 'ggs', 'gg all', 'good game'],
  greetBack: ['hey {name}', 'hi {name}!', 'yo {name}', 'sup {name}', 'hello {name}'],
  answerName: ['what {name}', 'yeah?', 'me?', 'hm?', 'whats up {name}', 'im busy lol', 'yo'],
  answerTrash: ['says you {name}', 'scoreboard says otherwise', 'ok {name}', 'cope', 'lol relax', 'we will see {name}'],
  answerBot: ['im not a bot lol', 'beep boop', 'no u', 'bot? me? never', 'thats rude {name}', 'we are all eggs here'],
  answerQuestion: ['idk', 'maybe', 'no idea', 'probably', 'ask {name}', 'yes', 'nope'],
  calloutSniper: ['sniper up high', 'watch out sniper', '{name} is sniping', 'careful {name} has a sniper'],
  callout: ['{name} {where}', 'enemy {where}', '{name} spotted {where}', 'one {where}', 'push {where}'],
  carrying: ['got the spatula!', 'i have it, cover me', 'spatula is mine', 'protect me pls'],
  theyCarry: ['{name} has the spatula!', 'get {name}!', 'kill the spatula guy', 'stop {name}'],
  roost: ['on the coop!', 'come to the roost', 'holding the coop', 'get in the zone'],
  lastMinute: ['last minute!', 'one minute left', 'clutch time', 'come on team'],
  leader: ['{name} is carrying', 'how is {name} so good', 'someone stop {name}', '{name} top frag again'],
  idle: ['anyone else lagging', 'where is everyone', 'this map is fun', 'ok where are you all', 'quiet round huh'],
  winning: ['easy round', 'we got this', 'gg go next', 'too good'],
  losing: ['we need to group up', 'come on guys', 'how are they winning', 'stop feeding lol'],
  voteYes: ['yeah skip it', 'skip', 'gg next map', 'sure', 'yes pls', 'this map is mid', 'ok next'],
  voteNo: ['nah i like this map', 'noo im on a streak', 'one more min', 'no way', 'nope', 'cmon i was winning'],
  switching: ['ok switching guns', 'time for the {w}', 'fine, {w} it is', 'trying the {w}'],
  bye: ['gg all', 'gtg', 'bye'],
};
// How likely each situation makes a talkative bot speak (before its own chattiness).
const CHANCE = { hello: 0.8, glhf: 0.45, diedTo: 0.45, diedAgain: 0.8, diedSniper: 0.6, diedRocket: 0.5, diedClose: 0.45, tilted: 0.5, killed: 0.3, revenge: 0.85,
  streak: 0.7, shutdown: 0.7, niceKill: 0.25, retort: 0.6, laugh: 0.4, gg: 0.9, greetBack: 0.85, answerName: 0.9, answerTrash: 0.7, answerBot: 0.9, answerQuestion: 0.5,
  calloutSniper: 0.5, callout: 0.18, carrying: 0.6, theyCarry: 0.6, roost: 0.35, lastMinute: 0.5, leader: 0.6, idle: 0.5, winning: 0.5, losing: 0.5, voteYes: 1, voteNo: 1, switching: 0.5, bye: 0.6 };

export class Social {
  constructor(mgr) { this.mgr = mgr; this.queue = []; this.lastLine = -1e9; this.lastIdle = 0; this.said = new Map(); }
  get m() { return this.mgr.match; }
  rnd() { return this.mgr.rng(); }
  // One bot considers saying a `kind` line about/to `about` (a player). force: no pacing or chance
  // (votes). Returns whether it will speak.
  say(id, kind, about = null, { force = false, vars = {}, replyTo = null, depth = 0 } = {}) {
    const m = this.m, b = this.mgr.bots.get(id), t = m.tick;
    if (!b || m.options.botChat === false) return false;
    const lines = L[kind]; if (!lines) return false;
    if (!force) {
      // Pacing: ~2.5 s between any two bot lines in the lobby, ~8–20 s per bot (chattier = sooner);
      // replies to someone talking to us skip the bot's own wait.
      const gap = Math.round((8 + (1 - b.per.chatty) * 12) / (1 / 30));
      // Answering a person skips the lobby-wide wait too (they asked; someone answers).
      const toHuman = replyTo !== null && this.m.players.get(replyTo)?.bot === false;
      if ((!toHuman && t - this.lastLine < 75) || (!replyTo && t - (b.lastChat ?? -1e9) < gap) || this.queue.length > 3 || this.queue.some(q => q.id === id)) return false;
      // Even quiet players answer when a person talks to them.
      const chance = (CHANCE[kind] || 0.3) * (0.35 + b.per.chatty * 0.9);
      if (this.rnd() > (toHuman ? Math.max(0.7, chance) : chance)) return false;
    }
    const name = about !== null ? this.m.players.get(about)?.name || '' : '';
    // Not the same line twice in a row.
    let msg = lines[Math.floor(this.rnd() * lines.length)];
    if (this.said.get(id) === msg && lines.length > 1) msg = lines[(lines.indexOf(msg) + 1) % lines.length];
    this.said.set(id, msg);
    msg = msg.replace(/\{name\}/g, name).replace(/\{me\}/g, b.p.name).replace(/\{w\}/g, vars.w || '').replace(/\{where\}/g, vars.where || '').replace(/\{n\}/g, vars.n ?? '').replace(/\s+/g, ' ').trim();
    if (!msg) return false;
    msg = this.voice(b, msg);
    b.lastChat = t; this.lastLine = t;
    // A typing delay: a beat to react, then about a fifth of a second per character.
    this.queue.push({ id, msg, wait: Math.round(30 * (0.5 + msg.length * 0.07 + this.rnd() * 1.2)), about, kind, depth });
    return true;
  }
  // A bot's own way of typing.
  voice(b, msg) {
    const v = b.voice || (b.voice = { lower: this.rnd() < 0.6, punct: this.rnd() < 0.25, extra: this.rnd() < 0.2 ? ['!', ' lol', ' xd', '!!'][Math.floor(this.rnd() * 4)] : '' });
    if (v.lower) msg = msg.toLowerCase(); else msg = msg[0].toUpperCase() + msg.slice(1);
    if (v.punct && !/[!?.]$/.test(msg)) msg += '.';
    if (v.extra && this.rnd() < 0.3 && !/[!?.]$/.test(msg)) msg += v.extra;
    return msg;
  }
  // Every tick: send the lines whose typing is done; now and then, unprompted talk.
  tick() {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (--q.wait > 0) continue;
      this.queue.splice(i, 1);
      if (!this.mgr.bots.has(q.id)) continue;
      this.mgr.onChat?.(q.id, q.msg);
      this.heard(q.id, q.msg, { depth: q.depth + 1, about: q.about, kind: q.kind });
    }
    const m = this.m;
    if (m.over) return; // the podium: only the gg's
    if (m.tick - this.lastIdle > 30 * 25 && m.tick - this.lastLine > 30 * 10) { this.lastIdle = m.tick; this.ambient(); }
    const left = m.timeLeft?.();
    if (left !== null && left !== undefined && left < 60 && !this.saidLastMinute && m.roundEnds) { this.saidLastMinute = true; this.anyone('lastMinute'); }
  }
  // A random talkative bot says something.
  anyone(kind, about = null, opts) {
    const ids = [...this.mgr.bots.keys()].sort(() => this.rnd() - 0.5);
    for (const id of ids) if (this.say(id, kind, about, opts)) return id;
    return null;
  }
  // Unprompted: about the scoreboard, the round, a sniper someone keeps dying to, or nothing much.
  ambient() {
    const m = this.m, ps = [...m.players.values()];
    if (!ps.length) return;
    const top = ps.slice().sort((a, b) => b.score - a.score)[0];   // (the leader by points)
    const r = this.rnd();
    if (m.mode.teams && r < 0.35) {
      const s = m.mode.score; const bot = [...this.mgr.bots.values()][Math.floor(this.rnd() * this.mgr.bots.size)];
      if (bot && s) { const mine = s[bot.p.team], theirs = s[bot.p.team === 1 ? 2 : 1]; if (mine !== theirs) this.say(bot.p.id, mine > theirs ? 'winning' : 'losing'); }
    } else if (r < 0.7 && top && top.kills >= 5) {
      const ids = [...this.mgr.bots.keys()].filter(id => id !== top.id);
      if (ids.length) this.say(ids[Math.floor(this.rnd() * ids.length)], 'leader', top.id);
    } else this.anyone('idle');
  }
  // Someone said something (a person, or a bot's line arriving). Bots it concerns may answer.
  heard(from, msg, ctx = {}) {
    const m = this.m, p = m.players.get(from); if (!p) return;
    if ((ctx.depth || 0) > 2) return; // short exchanges, not endless threads
    const text = msg.toLowerCase(), human = !p.bot;
    // Named bots answer first.
    const named = [...this.mgr.bots.values()].filter(b => b.p.id !== from && text.includes(b.p.name.toLowerCase()));
    const reply = (id, kind, about = from) => this.say(id, kind, about, { replyTo: from, depth: ctx.depth || 0 });
    if (/\b(bot|bots|ai|npc)\b/.test(text)) { (named[0] ? reply(named[0].p.id, 'answerBot') : this.anyone('answerBot', from, { replyTo: from })); return; }
    if (/\b(gg|ggs|good game)\b/.test(text)) { const n = 1 + Math.floor(this.rnd() * 3); for (let i = 0; i < n; i++) this.anyone('gg', from, { replyTo: from }); return; }
    if (/^(hi|hey|hello|yo|sup|hii+|heyy+)\b/.test(text)) { if (named[0]) reply(named[0].p.id, 'greetBack'); else if (human) this.anyone('greetBack', from, { replyTo: from }); return; }
    if (/\b(ez|noob|trash|bad|suck|garbage|cringe)\b/.test(text)) { const t = named[0]?.p.id ?? (human ? null : null); if (t !== null && t !== undefined) reply(t, 'answerTrash'); else if (human) this.anyone('answerTrash', from, { replyTo: from }); return; }
    if (ctx.kind === 'callout' || ctx.kind === 'calloutSniper' || ctx.kind === 'theyCarry' || ctx.kind === 'leader') return; // about them, not to them
    if (named[0]) { reply(named[0].p.id, ctx.kind && /^(diedTo|diedAgain|killed|revenge|shutdown|diedSniper|diedRocket|diedClose)$/.test(ctx.kind) ? 'retort' : 'answerName'); return; }
    if (/\b(lol|lmao|haha|xd)\b/.test(text) && this.rnd() < 0.3) { this.anyone('laugh', from, { replyTo: from }); return; }
    if (human && /\?$/.test(text)) this.anyone('answerQuestion', from, { replyTo: from });
  }
}
// "north side", "up high on the east", from where an egg stands on the map.
// ground: the map's usual floor height (high ground is well above it).
export function where(m, x, y, z, ground = 0) {
  const g = m.grid, cx = g.w / 2, cz = g.d / 2, dx = x - cx, dz = z - cz;
  const side = Math.hypot(dx, dz) < Math.min(g.w, g.d) * 0.15 ? 'in the middle' : Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east side' : 'west side') : (dz > 0 ? 'south side' : 'north side');
  return (y > ground + 3.5 ? 'up high ' : '') + side;
}
