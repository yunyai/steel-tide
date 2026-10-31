import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/Events';

type Map = { ping: number };

describe('event bus', () => {
  it('runs every sim listener before any view listener, whatever the order they joined in', () => {
    const bus = new EventBus<Map>();
    const order: string[] = [];
    bus.view('ping', () => order.push('view'));
    bus.on('ping', () => order.push('sim'));
    bus.emit('ping', 1);
    expect(order).toEqual(['sim', 'view']);
  });

  it('keeps going past a view listener that throws, and never rethrows', () => {
    const bus = new EventBus<Map>();
    const errors: unknown[] = [];
    bus.onViewError = (e) => errors.push(e);
    const seen: string[] = [];
    bus.view('ping', () => {
      throw new Error('boom');
    });
    bus.view('ping', () => seen.push('view'));
    expect(() => bus.emit('ping', 1)).not.toThrow();
    expect(seen).toEqual(['view']);
    expect(errors).toHaveLength(1);
  });

  it('lets a sim listener leave mid-emit without skipping the next one', () => {
    const bus = new EventBus<Map>();
    const seen: string[] = [];
    const off = bus.on('ping', () => {
      seen.push('a');
      off();
    });
    bus.on('ping', () => seen.push('b'));
    bus.emit('ping', 1);
    bus.emit('ping', 2);
    expect(seen).toEqual(['a', 'b', 'b']);
  });

  it('does not call a listener added during the emit that added it', () => {
    const bus = new EventBus<Map>();
    const seen: string[] = [];
    bus.on('ping', () => {
      seen.push('first');
      if (seen.length === 1) bus.on('ping', () => seen.push('late'));
    });
    bus.emit('ping', 1);
    expect(seen).toEqual(['first']);
    bus.emit('ping', 2);
    expect(seen).toEqual(['first', 'first', 'late']);
  });

  it('removes only the listener it handed back', () => {
    const bus = new EventBus<Map>();
    let n = 0;
    const fn = () => n++;
    const off = bus.view('ping', fn);
    bus.view('ping', fn);
    off();
    off();
    bus.emit('ping', 1);
    expect(n).toBe(1);
  });
});
