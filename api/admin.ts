import { handleAdmin } from '../server/admin.js';

export const maxDuration = 120;
export default { fetch: (request: Request) => handleAdmin(request) };
