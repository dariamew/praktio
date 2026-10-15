// Explicit fixture entry point for integration tests; production starts server/index.js.
import path from 'node:path';
import {tmpdir} from 'node:os';
import {seed} from './sample-data.js';
import {seedCollege} from './college-data.js';

const directory=path.resolve(process.env.DATA_DIR||'.');
if(process.env.NODE_ENV==='production'||!directory.startsWith(path.resolve(tmpdir())+path.sep)||!path.basename(directory).startsWith('prakt'))throw Error('Test fixtures require an isolated temporary database.');
const {db}=await import('../../server/index.js');
seed(db);
seedCollege(db);
