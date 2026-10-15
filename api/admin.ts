import { handleAdmin } from '../server/admin';

export const maxDuration = 120;
export default { fetch: (request: Request) => handleAdmin(request) };
