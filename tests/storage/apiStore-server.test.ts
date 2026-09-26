import { realServerStore } from './realServer';
import { storeContract } from './store-contract';

storeContract('ApiStore → real server', async () => (await realServerStore()).store, { serverOwnsDriveStatus: true });
