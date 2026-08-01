import { apiErrorResponse } from '../../../services/api-service';
import { identityService } from '../../../services/identity-service';

/**
 * The caller, fetched through the private API rather than read locally (#54).
 *
 * The first route handler on the service seam. It deliberately does not touch
 * the data layer: the whole point is that the answer comes back from a Lambda
 * that verified the user's own access token, so a matching `userId` here is
 * evidence the authenticated hop works end to end.
 */
export async function GET() {
  try {
    const service = await identityService();
    return Response.json(await service.getMe());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
