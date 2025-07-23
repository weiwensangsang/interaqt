import { controller } from './index.js';
import { startServer } from './server.js';

controller.setup(true).then(() => 
  startServer(controller, {
    port: 3000,
    parseUserId: h => h['x-user-id']
  })
);