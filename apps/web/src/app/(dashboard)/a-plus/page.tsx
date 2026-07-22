import { redirect } from 'next/navigation';
import { auth0 } from '../../../lib/auth0';
import { listAPlusDrafts } from '../../../lib/a-plus-drafts';
import { DesignsList } from './designs-list';

// Always reflect the latest drafts (created/edited/deleted) on navigation.
export const dynamic = 'force-dynamic';

export default async function APlusDesignsPage() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    redirect('/login');
  }

  const drafts = await listAPlusDrafts(session.user.sub);

  return (
    <DesignsList
      drafts={drafts.map((draft) => ({
        draftId: draft.draftId,
        name: draft.name,
        productName: draft.productName,
        asins: draft.asins,
        contentTier: draft.contentTier,
        updatedAt: draft.updatedAt,
      }))}
    />
  );
}
