import { describe, expect, it } from 'vitest';
import { junoSeats } from './junoSeats';
const people = ['a', 'b', 'c', 'd', 'e', 'f'].map(userId => ({ userId, name: userId }));
describe('Juno table seat layout', () => {
  it('keeps the viewer below and opponents in fixed relative positions', () => {
    const seats = junoSeats(people.slice(0, 4), 'c'); expect(seats.bottom?.userId).toBe('c');
    expect(Object.values(seats).filter(Boolean)).toHaveLength(4);
    expect(junoSeats(people.slice(0, 4), 'c')).toEqual(seats);
  });
  it('leaves real empty seats with two players', () => {
    const seats = junoSeats(people.slice(0, 2), 'a');
    expect(seats.top?.userId).toBe('b'); expect(seats.bottom?.userId).toBe('a');
    expect(seats.left).toBeNull(); expect(seats.right).toBeNull();
  });
  it('does not invent a player for a spectator', () => {
    const seats = junoSeats(people.slice(0, 3), 'watcher');
    expect(Object.values(seats).filter(Boolean)).toHaveLength(3);
    expect(seats.bottom).toBeNull();
  });
  it('splits the top row in two with five players', () => {
    const seats = junoSeats(people.slice(0, 5), 'a');
    expect(seats.bottom?.userId).toBe('a');
    expect(seats.left?.userId).toBe('b'); expect(seats.topLeft?.userId).toBe('c');
    expect(seats.topRight?.userId).toBe('d'); expect(seats.right?.userId).toBe('e');
    expect(seats.top).toBeNull();
    expect(Object.values(seats).filter(Boolean)).toHaveLength(5);
  });
  it('holds three across the top row with six players', () => {
    const seats = junoSeats(people, 'a');
    expect(seats.bottom?.userId).toBe('a');
    expect(seats.left?.userId).toBe('b'); expect(seats.topLeft?.userId).toBe('c');
    expect(seats.top?.userId).toBe('d'); expect(seats.topRight?.userId).toBe('e');
    expect(seats.right?.userId).toBe('f');
    expect(Object.values(seats).filter(Boolean)).toHaveLength(6);
  });
  it('seats six spectators without inventing anyone', () => {
    const seats = junoSeats(people, 'watcher');
    expect(Object.values(seats).filter(Boolean)).toHaveLength(6);
  });
});
