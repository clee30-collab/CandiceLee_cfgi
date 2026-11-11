// Two small state machines.
//
// 1. StateMachine: event-driven. You `send('pickPlate')` and it only moves
//    if that event is allowed from the current state. Good for game flow.
//
// 2. RandomMachine: time-driven with *structured* randomness. Each state
//    lasts a random time inside a range, then picks the next state using
//    weights. Pure Math.random() feels like noise; weights + durations feel
//    like behaviour (a pea that mostly sits still, sometimes fidgets, and
//    very occasionally gets bumped).

export function range(min, max) {
    return min + Math.random() * (max - min);
}

// weightedPick({ a: 3, b: 1 }) returns 'a' 75% of the time
export function weightedPick(weights) {
    const entries = Object.entries(weights);
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = Math.random() * total;
    for (const [key, w] of entries) {
        r -= w;
        if (r <= 0) return key;
    }
    return entries[entries.length - 1][0];
}

export class StateMachine {
    constructor({ initial, states }) {
        this.states = states;
        this.state = initial;
        this.time = 0;           // seconds spent in current state
        this.listeners = [];
        this.states[initial].enter?.();
    }

    can(event) {
        return Boolean(this.states[this.state].on?.[event]);
    }

    send(event, payload) {
        const target = this.states[this.state].on?.[event];
        if (!target) return false;
        this.goto(target, payload);
        return true;
    }

    goto(target, payload) {
        const prev = this.state;
        this.states[prev].exit?.();
        this.state = target;
        this.time = 0;
        this.states[target].enter?.(payload);
        for (const fn of this.listeners) fn(target, prev, payload);
    }

    onChange(fn) {
        this.listeners.push(fn);
    }

    update(dt) {
        this.time += dt;
        this.states[this.state].update?.(dt, this);
    }
}

export class RandomMachine extends StateMachine {
    // states: { name: { duration: [min, max], next: { other: weight }, enter, update } }
    constructor(opts) {
        super(opts);
        this.duration = range(...this.states[this.state].duration);
    }

    goto(target, payload) {
        super.goto(target, payload);
        this.duration = range(...this.states[target].duration);
    }

    update(dt) {
        super.update(dt);
        if (this.time >= this.duration) {
            this.goto(weightedPick(this.states[this.state].next));
        }
    }
}
