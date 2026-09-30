import 'fake-indexeddb/auto';
import { openAppDb } from '../../src/storage/db';
import { storeContract } from './store-contract';

let n = 0;
storeContract('IdbStore', () => openAppDb(`idb-store-${n++}`));
