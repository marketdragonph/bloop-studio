// A board, the Director's plan storage and ops, and a turn context — for the Director tests.
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { DirectorPlans } from '../src/server/repositories/director-plans.js';
import { BoardOps } from '../src/server/director/ops/board-ops.js';
import { BuildStages } from '../src/server/director/plan/stages.js';
import { TurnLedger } from '../src/server/director/turn/ledger.js';

export function harness({ runner = { isRunning: () => false, start() {} } } = {}) {
    const db = openDatabase(':memory:');
    const spaces = new SpacesRepository(db);
    const space = spaces.create({ name: 'test' });
    const plans = new DirectorPlans(db);
    const ops = new BoardOps({ spaces });
    const stages = new BuildStages({ plans, ops, spaces });
    const events = [];
    const turn = () => ({
        spaceId: space.id, spaces, plans, stages, ops, runner, ledger: new TurnLedger(),
        emit: (event, data) => events.push({ event, data }), lengths: [3, 4, 5, 6, 8, 10], withSound: true, clipFamily: 'ltx',
    });
    return { db, spaces, space, plans, ops, stages, events, turn };
}
