const fs = require('fs');
const edits = [
  ['packages/server/src/games/juno.test.ts',
    'deadline: 45_000, winnerId: null, result: null, lastMove: null, blockedTurns: 0, reportWindows: [],\n',
    'deadline: 45_000, winnerId: null, result: null, lastMove: null, blockedTurns: 0, reportWindows: [],\n    specials: true, stacking: false, stackDraw: 0,\n'],
  ['packages/server/src/games/junoIntoxicated.test.ts',
    'reportWindows: [], memoryEnabled: true, intoxicatedEnabled: true };',
    'reportWindows: [], memoryEnabled: true, intoxicatedEnabled: true, specials: true, stacking: false, stackDraw: 0 };'],
  ['packages/server/src/games/junoMemory.test.ts',
    'reportWindows: [], memoryEnabled: true };',
    'reportWindows: [], memoryEnabled: true, specials: true, stacking: false, stackDraw: 0 };'],
  ['packages/server/src/games/junoPizza.test.ts',
    'reportWindows: [], memoryEnabled: true, intoxicatedEnabled: true, pizzaEnabled: true };',
    'reportWindows: [], memoryEnabled: true, intoxicatedEnabled: true, pizzaEnabled: true, specials: true, stacking: false, stackDraw: 0 };'],
  ['packages/server/src/games/junoReports.test.ts',
    'winnerId: null, result: null, lastMove: null, blockedTurns: 0, reportWindows: [] };',
    'winnerId: null, result: null, lastMove: null, blockedTurns: 0, reportWindows: [], specials: true, stacking: false, stackDraw: 0 };'],
];
for (const triple of edits) {
  const f = triple[0], a = triple[1], b = triple[2];
  let s = fs.readFileSync(f, 'utf8');
  if (!s.includes(a)) { console.log('MISS', f); process.exitCode = 1; continue; }
  s = s.split(a).join(b);
  fs.writeFileSync(f, s);
  console.log('ok', f);
}
