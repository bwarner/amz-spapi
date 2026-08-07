import { NextResponse, type NextRequest } from 'next/server';
import { AmazonApiTypeSchema } from '@farvisionllc/models';
import { auth0 } from '../../../../lib/auth0';
import { apiErrorResponse } from '../../../../services/api-service';
import { credentialService } from '../../../../services/credential-service';

/**
 * DELETE /api/amazon/disconnect — forget an Amazon connection.
 *
 * Query: `apiType` (SP_API | ADS_API), `profile` (default: `default`).
 *
 * The deletion happens in the credentials Lambda (#55). This route decides
 * nothing about which document is removed beyond naming the profile: the API
 * takes the user from the verified JWT, so a caller cannot disconnect somebody
 * else's account by editing a query string.
 */
export async function DELETE(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const apiType = AmazonApiTypeSchema.safeParse(searchParams.get('apiType'));
  if (!apiType.success) {
    return NextResponse.json(
      { error: 'Invalid apiType. Must be SP_API or ADS_API.' },
      { status: 400 }
    );
  }

  const profileName = searchParams.get('profile') || 'default';

  try {
    const credentials = await credentialService();
    const result = await credentials.disconnect(apiType.data, profileName);

    return NextResponse.json({
      success: true,
      // `deleted: false` means there was nothing there. Still a success — the
      // caller asked for it to be gone and it is — but reported, so a UI that
      // wants to say "already disconnected" can.
      deleted: result.deleted,
      message: result.deleted
        ? `${apiType.data} account disconnected.`
        : `No ${apiType.data} connection named "${profileName}".`,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
